# İP-1b · Kütüphane kolu para ve kontenjan sözleşmesi

**Dal:** `ip1b-kutuphane-kontenjan` · **Taban:** `e726b9b` (main)
**Kaynak bulgular:** `docs/DENETIM-RAPORU-2026-07-31.md` → P1-20, P1-21, P1-22, P2-8, P2-40

Bu belge kütüphane kolunun (deneme bileti + çalışma alanı rezervasyonu) kontenjan,
canlılık, silme ve bilet kodu kurallarını **bağlayıcı sözleşme** olarak yazar.
Kütüphane kolu şu an lansman planında değildir; bu paket mevcut kusurları kapatır,
yeni yetenek eklemez.

---

## 0. Ölçüm — denetim raporundan farklar

Kod yazmadan önce yapılan bağımsız ölçüm, raporla üç noktada ayrıştı. Farklarda
**ölçüme** güvenildi.

| Rapor iddiası | Ölçüm | Sonuç |
|---|---|---|
| `Library.deleted_at` iki serviste de **hiç geçmiyor** (P1-21) | `study_reservation_service.reserve` ve `quote` hem `deleted_at` hem `status` kontrol ediyor | Rapor kısmen yanlış. Açık yollar: deneme kaydı/ödemesi/callback'i, `list_public_sessions`, çalışma ödemesi, iki `auto_release_no_shows` |
| `delete_library` `admin_service`'te (P1-22) | `library_service.py:707`. `admin_service.py:323` yalnız `delete_tutor` | Guard'lar iki ayrı dosyaya yazıldı |
| `complete_checkout` claim'siz (P2-8) | Callback yolu **zaten** `escrow.claim` kullanıyordu | P2-8 yalnız `pay()` için geçerliydi |

### Ölçümün raporda olmayan üç bulgusu

1. **`ACTIVE_REGISTRATION_STATUSES` yalnız kontenjan sabiti değil.**
   `messaging_service.py:176,182` kütüphaneyle DM kapısını, `roster` operatör
   yoklama listesini, `bulk_upload_documents` toplu karne eşlemesini ondan
   besliyor. Brief "PENDING_PAYMENT'ı bu sabite ekle" diyordu; **eklenmedi** —
   ödemesiz bir kayıt operatör listesine ve DM hakkına girerdi (P0-6 komşuluğu).
   Kontenjan ayrı bir yüklemle ifade edildi.

2. **`_unique_short_code` statü filtresi, `verify_attendance` ile uyumsuz.**
   Üretici yalnız PAID/ATTENDED satırlara karşı tekillik arıyordu; doğrulama ise
   statüye **bakmadan** arıyor. Yani iptal edilmiş bir kaydın kodu canlı bir
   bilete yeniden dağıtılabiliyordu. 31⁶ ≈ 8,9×10⁸ alanda 10.000 bilette
   çakışma olasılığı ≈ %5,6.

3. **Kütüphane kapasitesi sayı tabanlıdır; GiST exclusion onu ifade edemez.**
   Exclusion "hiçbir iki satır çakışmasın" der — ancak kapasite=1'i anlatır.
   Brief'in 3.1(b) reçetesi bu yüzden kısmen uygulanamadı; ikisi de yapıldı
   (§3.2).

### Gerçek üretim hatası (kırmızı matris buldu)

`library_exam_service.pay()`'in **idempotent erken dönüşü** (zaten ödenmiş kayda
tekrar "Öde" denmesi) `RegistrationOut.model_validate(reg)` içinde `reg.session`
ilişkisini lazy-load etmeye çalışıyor, async oturumda `MissingGreenlet` fırlatıyor
ve **HTTP 500** üretiyordu. Başarı yolunda görünmüyordu: `_get_session_or_404`
oturumu kimlik haritasına koyduğu için many-to-one okuması IO'suz karşılanıyordu.
Düzeltildi (`set_committed_value` ile ilişki "yüklenmiş ve None" işaretlenir;
alan zaten hemen ardından açıkça yazılıyor). Nöbetçi: `P-1b` düğümü.

---

## 1. Kontenjan sözleşmesi

### 1.1 Koltuk yüklemi

Bir satır şu iki hâlde **koltuk tutar**:

```
status ∈ (PAID, ATTENDED)
  ya da
status = PENDING_PAYMENT  ∧  hold_expires_at > now()      -- DB saati
```

Kaynak: `services/library_capacity.py::holds_seat`. Yüklem hem karar (kayıt/ödeme)
hem gösterim (`registered_count`, `available`, `remaining`) yollarında **aynıdır** —
ekranda boş görünen bir koltuğun kayıt anında dolu çıkması, kuralın kendisi kadar
kötü bir kusurdur.

`ACTIVE_REGISTRATION_STATUSES` **değiştirilmedi** (gerekçe §0/1).

### 1.2 PENDING_PAYMENT serbest bırakma kararı

**Seçilen: TTL yüklemi.** Tutma bir zaman damgasıdır (`hold_expires_at`); süresi
dolduğu an koltuk kendiliğinden boşalır.

| Seçenek | Neden seçilmedi / seçildi |
|---|---|
| Süresiz tutma | Ödeme sayfasını kapatan tek kişi kontenjanı sonsuza dek kilitler |
| `EXPIRED` durumu + arka plan süpürgesi | Yeni durum değeri (`REGISTRATION_TRANSITIONS`, şemalar, frontend) + yeni zamanlanmış iş ister; süpürge gecikirse koltuk yine kilitli kalır — yani yeni bir arıza sınıfı ("süpürge koşmadı") doğar |
| **TTL yüklemi (seçilen)** | Hiçbir işin koşmasına bağlı değil; satır `PENDING_PAYMENT` kalır ve öğrenci "Biletlerim"den ödemeyi sürdürebilir. Koltuk hâlâ boşsa `pay()` onu geri alır, doluysa 409 verir |

Süre: `LIBRARY_SEAT_HOLD_MINUTES` (varsayılan **30 dk**) — 3DS'li bir ödeme
yolculuğunun rahat üstünde. **Yeni arka plan işi kurulmadı** (brief'in şartı).

`hold_expires_at = NULL` → tutma yok. Bu sürümden önce açılmış kayıtlar koltuk
tutmaz; `pay()` onları "tutma sona ermiş" yolundan geçirir (§1.4).

### 1.3 Serileştirme ve kilit sırası

Kanonik sıra:

```
Library  →  LibraryExamSession  →  ExamRegistration / StudyReservation
```

Kontenjan **advisory kilitle** serileştirilir (satır kilidiyle değil): advisory
kilitler ayrı bir isim alanındadır, satır yazımlarının kanonik sırasını bozmaz ve
`services/escrow.py`'deki uçuş-içi iade nöbetiyle aynı mekanizmadır.

Sınıf numaraları **tek kayıt defterinde** (`services/escrow.py`):

| Sınıf | Kullanım |
|---|---|
| 1-5 | `EscrowSpec.lock_class` — iade uçuş-içi nöbeti (booking/exam/study/order/return) |
| **6** | `EXAM_SESSION_CAPACITY_LOCK_CLASS` — oturum kontenjanı |
| **7** | `LIBRARY_CAPACITY_LOCK_CLASS` — kütüphane çalışma alanı kapasitesi |

Deneme kolu yalnız 6'yı, çalışma kolu yalnız 7'yi alır; **hiçbir yol ikisini
birden almaz** → bu iki sınıf arasında deadlock kurulamaz. `pay()` ayrıca kendi
kaydının iade sınıfını (2 / 3) alır; oturum kilidiyle çakışmaz çünkü sıralama
daima "önce kayıt nöbeti, sonra oturum kilidi"dir ve bu sıra tek yerde
(`library_exam_service.pay`) kurulur.

### 1.4 Üç yazma yolunun sözleşmesi

| Yol | Davranış |
|---|---|
| `register()` / `reserve()` | Oturum/kütüphane kilidi al → koltuk say → dolu ise **409** → kaydı `hold_expires_at` ile aç. Kısa transaction, **dış servis çağrısı yok** |
| `pay()` | (a) kayıt başına uçuş-içi nöbeti (§4) → (b) **tutma canlıysa** koltuk zaten bizimdir, kilit ALINMAZ, tutma uzatılır → (c) **tutma sona ermişse** kilit altında koltuk yeniden alınır, dolu ise 409 → (d) tahsilat → (e) atomik claim |
| `complete_checkout()` | Kilit altında koltuk sayılır; **dolu ise bilet basılmaz ve tahsilat iade edilir** (para zaten alınmıştır, 409 yetmez) |

**Bilinçli takas:** `pay()`'in (c) yolunda oturum kilidi sağlayıcı çağrısı boyunca
tutulur. Ortak durum (a)-(b)'dir ve orada kilit hiç alınmaz, dolayısıyla ödeme
başlatma yolu oturum başına serileşmez. (c) nadir yoldur (öğrenci ödemeyi yarım
bırakıp ≥30 dk sonra dönmüştür). Alternatifi istek ortasında ikinci bir commit'tir
ve bu projede zaten sakıncalı bulunmuştur (denetim P2-3/TB-4). Kalan risk §7'de.

### 1.5 Neden exclusion kapasiteyi zorlayamaz

`ex_study_res_client_no_overlap` **aynı öğrencinin** aynı kütüphanede çakışan iki
ödenmiş rezervasyonunu DB'de imkânsızlaştırır (ders tarafındaki
`ex_bookings_no_overlap` kardeşi). N koltuklu bir salonun kontenjanını ise
ifade **edemez**: exclusion "hiçbir iki satır çakışmasın" der, yani ancak
kapasite=1'i anlatır. Sayı tabanlı kontenjan serileştirme ister. İkisi birbirinin
yerine geçmez; ikisi de gereklidir.

---

## 2. Kütüphane canlılık sözleşmesi

`libraries.deleted_at` dolu bir kütüphane katalogdan düşer; **para yüzeyleri de
düşer**.

| Yüzey | Kural |
|---|---|
| `register()` / `reserve()` | silinmiş → **404**, onaysız (≠ ACTIVE) → **409** |
| `pay()` (her iki kol) | aynı |
| `complete_checkout()` (her iki kol) | ölü sayılır → tahsilat **iade** edilir |
| `list_public_sessions` | boş liste |
| `auto_release_no_shows` (her iki kol) | **atlar** ve `ALARM` loglar |

Desen `study_reservation_service.reserve`'den kopyalandı (orada zaten doğruydu);
yeni desen icat edilmedi.

**`list_public_sessions` neden kaçmıştı:** soft-delete yalnız `deleted_at`
damgalar, `status` `ACTIVE` kalır — yalnız statüye bakan kontrol silinmiş
kütüphanenin oturumlarını satmaya devam ediyordu.

**No-show neden serbest bırakmıyor:** `released_at` geri alınamaz bir damgadır
(`services/escrow.py` H2 — dolu satır asla iadeye claim edilemez). Silinmiş
tedarikçiye yazılan hak ediş geri alınamazdı. Sessizce atlamak da eski hatayı
yeni bir sessiz hatayla ("para sonsuza dek emanette") değiştirmek olurdu; bu
yüzden **ALARM** üretilir. Silme guard'ı (§3) bu durumu artık en baştan
engelliyor — kalan satırlar geçmişten ya da doğrudan veri müdahalesinden gelir
ve insan kararı ister.

---

## 3. Silme guard'ı sözleşmesi

### Kütüphane (`library_service.delete_library`) — 409 sebepleri

1. emanetteki deneme bileti (`PAID`/`REFUNDING` ∧ `released_at IS NULL`),
2. emanetteki çalışma rezervasyonu (aynı ölçüt),
3. **gelecek tarihli** `SCHEDULED` deneme oturumu — bilet satılmamış olsa bile.

(3)'ün gerekçesi: planlı oturum bir **taahhüttür**; silme onu sessizce yutmamalı.
Admin önce oturumu iptal eder — o yol gerekli iadeleri ve bildirimleri üretir.

### Eğitmen (`admin_service.delete_tutor`) — 409 sebepleri

1. `HELD`/`REFUNDING` ders ödemesi (canlı booking üzerinden),
2. sonuçlanmamış (`PENDING`/`ACCEPTED`) ders.

Kapsam bilinçli olarak **paradır**; ders kolunun iş mantığına dokunulmadı, burada
yalnız **okuma** vardır. İP-4 dosya listesiyle kesişim yoktur (§6).

### Guard fazla geniş değil

Kapanmış para (`RELEASED`/`REFUNDED`), geçmiş oturum ve iptal edilmiş oturum
**engellemez** — aksi halde hiçbir tedarikçi hiçbir zaman silinemezdi. Bu iddia
ayrıca ölçülür: **D-3** ve **D-5** negatif kontrol düğümleridir ve hem kırmızı hem
yeşil turda yeşil kalır. Yalnız "409 dönüyor mu" ölçen bir sözleşme, her şeyi
reddeden bir uygulamayla da yeşil kalırdı.

Hata mesajı **hangi kaydın engellediğini söyler**: sebebini söylemeyen bir
"silinemez", admini kör bir aramaya iter.

---

## 4. Bilet kodu sözleşmesi

`verify_attendance` bir bileti **yalnız koda** bakarak bulur ve `.first()` ile
alır. İki canlı satır aynı kodu taşırsa yanlış öğrencinin katılımı doğrulanır ve
**yanlış emanet serbest bırakılır**.

- **DB kısıtı:** dört kısmi unique index (`deleted_at IS NULL`) — doğrulama da
  yalnız canlı satırlara bakar; NULL kodlar Postgres'te çakışmaz.
- **Statü filtresi yok:** doğrulama statüye bakmadığı için üretici de bakmaz.
- **Üretici iki kola birden bakar:** operatör tek ekrandan hem bileti hem
  rezervasyonu okutuyor; çapraz çakışma doğrulamayı yanlış bilete götürür. DB
  kısıtı tablo başınadır (çapraz tabloya kısıt yazılamaz), üretici tarafı onun
  **tamamlayıcısıdır**.
- `gen_qr_token` tek yere taşındı (`core/codes.py`); eskiden üç ayrı serviste
  satır içi `secrets.token_urlsafe(24)` çağrısıydı ve arkasında ne kontrol ne
  kısıt vardı.

**Uçuş-içi ödeme nöbeti (P2-8):** `pay()` düz ORM ataması yerine koşullu UPDATE
kullanır (`payment_service.pay` deseni) ve öncesinde `escrow.try_inflight_lock`
alır. Eskiden iki eşzamanlı istek de sağlayıcıya gidiyor, karttan **iki kez**
çekiliyor ve ikinci yazım birincinin `qr_token`'ını **eziyordu** — öğrencinin
elindeki bilet sessizce geçersizleşiyordu.

---

## 5. Migration zinciri

| Revizyon | `down_revision` | İçerik |
|---|---|---|
| `ip1b_kontenjan_kilidi` | `ip2a_iade_para_guvenligi` | `hold_expires_at` ×2 · `ix_exam_reg_session_status` · `study_reservations.time_slot` (generated) · `ex_study_res_client_no_overlap` · `CREATE EXTENSION IF NOT EXISTS btree_gist` |
| `ip1b_bilet_kodu_tekilligi` | `ip1b_kontenjan_kilidi` | 4 kısmi unique index (qr_token / short_code × 2 tablo) |

**Tek head:** `ip1b_bilet_kodu_tekilligi`. `alembic check` → *No new upgrade
operations detected* (model ↔ şema sapması yok).

Boş DB'de doğrulandı: `upgrade head` → `downgrade -1` → `upgrade head` →
`downgrade -2` → `upgrade head`; sonrasında beş yapı da yerinde.

İkinci migration **savunmacıdır**: çakışan kod bulursa ne olduğunu söyleyen bir
hatayla durur. Mevcut veride çakışma ölçüldü — yok (deneme 2/2, çalışma 7/7 ve
6/6 tekil).

---

## 6. Kırmızı matris

**28 düğüm · 26'sı kırmızı başladı** (`c7df828`, üretim kodundan ÖNCE).
D-3 ve D-5 bilinçli **negatif kontroldür** (guard fazla geniş değil) ve her iki
turda yeşildir.

| Düğüm | İddia | Kırmızı gerekçe (düzeltme öncesi) |
|---|---|---|
| K-1 | 2 kişilik oturuma 5 eşzamanlı kayıt → 2'si | 5 kayıt kabul edildi (409 = 0) |
| K-2 | PENDING_PAYMENT koltuk tutar | ikinci kayıt kabul edildi |
| K-3 | `pay()` kontenjanı görür | 1 kişilik oturumda 2 ödenmiş kayıt |
| K-4 | callback kontenjanı görür | callback ikinci bileti bastı |
| K-5 | eşzamanlı iki `pay()` aşamaz | 2 koltuk satıldı |
| K-6 | eşzamanlı iki rezervasyon aşamaz | çakışan 2 ödenmiş rezervasyon |
| K-7 | çakışma DB'de engellenir | `IntegrityError` gelmedi |
| S-1 / S-1b | silinmiş kütüphaneye kayıt → 404 | servis 201, HTTP 201 |
| S-2 / S-2b | silinmiş kütüphaneye ödeme → 404 | ödeme alındı |
| S-3 | public liste göstermez | oturumlar listelendi |
| S-4 / S-4b | no-show serbest bırakmaz | `released_at` damgalandı |
| D-1 / D-2 / D-2b | açık emanet/taahhüt silmeyi engeller | silme başarılı |
| D-3 / D-5 | temiz kütüphane/eğitmen silinir | **yeşil (negatif kontrol)** |
| D-4 | açık emanetli eğitmen silinemez | silme başarılı |
| C-1 / C-1b / C-1c | kod DB'de tekil | `IntegrityError` gelmedi |
| C-2 / C-2b | üretici çakışmayı görür | aynı kod/token ikinci kez dağıtıldı |
| P-1 / P-2 | eşzamanlı iki ödeme tek tahsilat | 2 kez tahsilat |
| P-1b | ikinci ödeme bileti ezmez | **HTTP 500** (gerçek üretim hatası, §0) |

### Yarış penceresi neden ayrıca kuruluyor

İlk mutasyon provasında ölçüldü: kontenjan kilidi sökülmesine rağmen (M39/M42)
beş eşzamanlı kayıt yine sırayla koştu ve K-1/K-6 yeşil kaldı — yani "koruma var
mı" sorusunu hiç sormamışlardı. `count → INSERT → COMMIT` arası o kadar kısa ki
olay döngüsü tarafları aynı pencereye sokmuyor; yarış **umut ediliyordu**.

`_KontenjanPenceresi` sayımın ardına **süreli bir bariyer** koyar: taraflar orada
buluşursa hepsi "koltuk boş" okumasını yazımdan önce yapmış olur. Koruma
yerindeyse ikinci taraf sayıma hiç ulaşamaz (advisory kilitte bekler), bariyer
dolmaz ve pencere kendini **kalıcı olarak kapatır** — doğru uygulama tek bir
gecikme öder. İddia değişmedi; yalnız yarışın gerçekleştiği artık **ölçülüyor**
(`birlikte_gelen == 0`) ve yamanın tuttuğu doğrulanıyor (`cagri` sayacı).

---

## 7. Mutasyon kataloğu

**12/12 yakalandı.** Sürücüler: `backend/scripts/mutation_drill.py` (bayt yedeği,
kirli ağaçta ret, HEAD+worktree eşitlik doğrulaması) ve
`backend/scripts/ip1b_ddl_drill.py`.

| No | Mutasyon | Kırılan |
|---|---|---|
| M39 | oturum kontenjan kilidi kaldırıldı | K-1 |
| M40 | ödeme bekleyen tutma koltuk tutmuyor | K-1, K-2, K-6 |
| M41 | `pay()` kontenjanı hiç görmüyor | K-3, K-5 |
| M42 | çalışma alanı kapasite kilidi kaldırıldı | K-6 |
| M43 | `register`'da canlılık kapısı yok | S-1, S-1b |
| M44 | kütüphane silme guard'ı kaldırıldı | D-1, D-2, D-2b |
| M45 | QR token üreticisi çakışmayı aramıyor | C-2b |
| M46 | uçuş-içi nöbeti kaldırıldı (+study eki) | P-1, P-2 |
| DDL-1 | `ex_study_res_client_no_overlap` düşürüldü | K-7 |
| DDL-2..4 | bilet kodu unique index'leri düşürüldü | C-1, C-1b, C-1c |

**M39/M42 ilk turda KAÇTI** → §D disiplini uygulandı: (1) testin yetersiz olduğu
kabul edildi, (2) önce regresyon güçlendirildi (`3a0fb09`), (3) mutasyon tekrar
uygulandı, (4) kırıldığı gösterildi, (5) geri alındı, (6) temiz hâlde yeşil
doğrulandı.

**Neden ayrı bir DDL sürücüsü:** iki koruma DB şemasında yaşar; model dosyasını
değiştirmek zaten uygulanmış bir migration'ı geri almaz, yani dosya yaması onları
**sökemez** ve prova sessizce "yakalandı" derdi. DDL sürücüsü kısıt tanımını
düşürmeden önce `pg_get_constraintdef`/`indexdef` ile okur, geri yüklemeyi
**davranışla** doğrular (hedef test tekrar yeşil olmalı) ve mutasyondan önce
testin yeşil olduğunu ayrıca kontrol eder — zaten kırmızı bir test hiçbir şey
kanıtlamaz.

> İlk DDL koşusunda geri yükleme *metin* karşılaştırmasında takıldı: PostgreSQL
> kısıtı yeniden oluştururken `WHERE` ifadesinin parantezlemesini normalize
> ediyor. Kısıt yerindeydi (DB güvendeydi), doğrulama yanlış alarm veriyordu.
> Karar artık davranıştadır; metin farkı yalnız raporlanır.

---

## 8. Kalan riskler ve P2'ler

| # | Konu | Not |
|---|---|---|
| TB-A | `pay()`'in "tutma sona ermiş" yolunda oturum/kütüphane advisory kilidi sağlayıcı çağrısı boyunca tutulur | Nadir yol (§1.4). Kaldırmak istek-ortası ikinci commit ister (TB-4 komşuluğu). Ölçülmüş bir zarar yok; iyzico CF `initialize` ~1 sn |
| TB-B | Çapraz tablo kod tekilliği yalnız **üreticide** garanti | DB kısıtı tablo başınadır. Kalan pencere: iki kolda eşzamanlı üretim (üretici okuması ile INSERT arası). 192 bit token'da ihmal edilebilir; `short_code` için 31⁶ alanda pratikte görülmez ama **teorik olarak açıktır**. Kapatmak ortak bir `ticket_codes` tablosu ister |
| TB-C | Eşzamanlı iki `pay()` çağrısı **farklı** kayıtlarda hâlâ ayrı ayrı tahsilat yapabilir | Bu doğru davranıştır (iki farklı müşteri). Aynı kayıtta çift tahsilat kapatıldı |
| TB-D | `quote()` onaysız (≠ACTIVE) kütüphanede fiyat döndürmeye devam ediyor | Salt okuma; `reserve` zaten 409 veriyor. Bilinçli olarak değiştirilmedi (frontend sözleşmesi) |
| TB-E | Yasal metinler (`legalContent.ts`) ile iade kuralı uyumu | İP-1b kapsamı dışı; kök `CLAUDE.md`'de zaten kayıtlı |

**Açık P0/P1 yok.** P1-20, P1-21, P1-22, P2-8, P2-40 kapandı; P1-22'nin eğitmen
bacağı da yapıldı (P2'ye bırakılmadı).
