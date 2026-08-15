# İP-21 — Nöbetçi Denetimi (yalancı yeşil temizliği)

> **Dal:** `ip21-nobetci-denetimi` · **Worktree:** `Desktop/adana-ip21` ·
> **DB:** `adana_ip21_test` · **Redis:** db13 · `PAYMENT_PROVIDER=fake`
>
> Bu paket yeni bir özellik getirmez. Getirdiği tek şey **kanıt**: bugün
> "yeşil" diyen ama hiçbir şeyi korumayan testleri gerçekten nöbetçi hâline
> getirir, ve bunu ölçerek yapar.

---

## 0. Neden bu paket — teşhis ÖLÇÜMÜ (15 Ağu 2026)

Borç defterinde tek bir aile birikmişti: **"test yeşil ama koruma yok."** On
kayıt, üçü son üç bağımsız denetimden. Kayıtlar eski olduğu için hiçbirine
güvenilmedi; **hepsi bu dalda yeniden ölçüldü.**

Ölçüm sürücüsü, TB-45'in şikâyet ettiği kusuru **kendisi yapmaz**: her
mutasyondan önce hedef testlerin temiz ağaçta yeşil olduğunu doğrular; taban
kırmızıysa sonuç "GEÇERSİZ" sayılır, "yakalandı" denmez. Yama md5
doğrulamalıdır ve `git checkout --` kullanılmaz (TB-45/kullanıcı işi silme
dersi).

### 0.1 Ölçülen — davranış boşlukları (gerçek PostgreSQL)

| Kayıt | Mutasyon | Yeşil taban | Mutasyon sonrası | Sonuç |
|---|---|---|---|---|
| **TB-43a** | `apply_refunded_amount`'tan `LEAST(…, total)` tavanı söküldü | 31 passed | **31 passed** | 🔴 nöbetsiz |
| **TB-43b** | `refunded_at = COALESCE(…)` → düz `now()` | 31 passed | **31 passed** | 🔴 nöbetsiz |
| **TB-44** | `study_queue::_order_id` sırası tersine çevrildi | 33 passed | **33 passed** | 🔴 nöbetsiz |
| **TB-47** | ip16 izin migration'ının rol bağı **taşıma** INSERT'i etkisizleştirildi | 7 passed | **7 passed** | 🔴 nöbetsiz |

Dördü de bugün açık. Hiçbiri "eskiden öyleydi" değil.

### 0.2 Ölçülen — araç ve altyapı boşlukları (kaynak)

| Kayıt | Bulgu | Kanıt |
|---|---|---|
| **TB-45** | Yeşil taban nöbetçisi ORTAK sürücüde yok | `_yesil_taban` yalnız `mutation_drill_ip18.py:219`'da; `mutation_drill.py`'de yok |
| **TB-42** | `ERROR` gölgelemesi düğüm ayracı olmayan koleksiyon hatasını saymıyor | `mutation_drill.py:214` → `s.startswith("ERROR ") and "::" in s` |
| **TB-51** | Rate-limit istemcisi ilk event loop'a bağlı → suite içinde **fail-open** | `core/ratelimit.py:22` modül düzeyi `_client` singleton'ı; İP-19 turunda ölçüldü: tek başına 429, suite içinde 61/61 → 200 |
| **TB-28** | Entegrasyon testleri **canlı Redis db0**'a yazabiliyor | `core/config.py:79` varsayılan `redis://localhost:6379/0`; test tarafında Postgres'teki `db_guard` gibi bir koruma **yok** |
| **TB-46** | `app.routes` üzerinden yol araması yasağı yalnız **yorumda** | Üç dosyada yorum var, ihlal yok — ama yeni dosya yazanı hiçbir şey durdurmuyor |

### 0.3 Bu ailenin neden özel bir paketi hak ettiği

Bu depo, yeşil test sayısının kalite kanıtı olmadığını **acıyla** öğrendi (kök
`CLAUDE.md`'nin test bölümü bu yüzden var). İP-19 bağımsız denetimi aynı
sınıftan iki iddiayı daha çürüttü: D-14 "beş metrik doğru hesaplanır" boş bir
tarih aralığında yalnız anahtar varlığına bakıyordu ve o boşluk **gerçek bir
hatayı** (km/teslimat %50 şişme) örtmüştü; §3.4 "yazma uçları rate-limit'li"
ise kodda hiç karşılığı olmayan bir cümleydi.

Yani sorun tek tek testler değil, **ölçüm zincirinin kendisi**. Zincirin
halkaları: (a) mutasyon sürücüsü doğru sayıyor mu, (b) test gerçekten koşuyor
mu, (c) test doğru şeyi mi ölçüyor, (d) nöbetçi kandırılabilir mi. Bu paket
dördünü de sırayla ele alır.

---

## 1. Bağlayıcı kararlar

### K-1 · Önce ölçüm aracı, sonra ölçüm

TB-45 ve TB-42 **ilk fazdır**. Gerekçe: bu paketin geri kalanı mutasyon
provasıyla kanıtlanacak; aracın kendisi yanlış sayarken üretilen kanıt
kanıt değildir. Araç düzeldikten sonra **İP-14/16/17/18/19 katalogları bir kez
yeniden koşulur** ve raporlanan sayıların değişip değişmediği ölçülür — değişen
varsa ilgili paketin kapanış raporundaki sayı düzeltilir (silinmez, düzeltilir).

### K-2 · Nöbetsiz davranışa DAVRANIŞ nöbetçisi yazılır

TB-43/44/47 için kaynak taraması (§C: düşük güçlü) kabul edilmez. Üçü de
gerçek PostgreSQL üzerinde, davranışın ayırt edici olduğu **fixture** ile
ölçülür:

* **TB-43**: kısmi iade + ikinci hareket. Tam iade tek adımda `LEAST`'i de
  `COALESCE`'ı da devreye sokmaz — mevcut testlerin göremediği tam olarak bu.
* **TB-44**: kovada **iki** yeni kart. Tek kartla sıra gözlenemez.
* **TB-47**: `ROLE_GRANTS` kataloğunda **olmayan** bir role elle verilmiş izin.
  Katalogdaki iki rol üzerinden kurulan iddia, taşıma hiç çalışmasa da geçer.

### K-3 · Redis izolasyonu Postgres'inkiyle aynı sertlikte

`tests/integration/db_guard.py` adı `test` içermeyen bir veritabanında koşmayı
**reddeder**. Redis'in karşılığı yoktur: `REDIS_URL` varsayılanı db0'dır ve
testler geliştirme verisiyle aynı Redis mantığını paylaşır. Aynı sertlik
gelir: **db0 reddedilir**, testler ayrılmış bir veritabanı numarası ister.

Fail-open ilkesi ÜRETİM içindir, testte değil: testte Redis yoksa limiter
sessizce geçiyorsa o test hiçbir şey ölçmez — bu yüzden ölçmesi gereken
testler Redis'i **zorunlu** kılar (yoksa skip, sessiz geçiş değil).

### K-4 · Rate-limit testleri sessizce etkisiz kalamaz

`core/ratelimit._client` düzeltilir (ya da test tarafında sıfırlanması
**zorunlu** hâle getirilir) ve depodaki **mevcut** rate-limit testlerinin
hangisinin gerçekten ölçtüğü tek tek sayılır. Sayım kapanış raporuna girer.

⚠️ Üretimde davranış doğrudur (tek uzun ömürlü loop). Bu bir test kusurudur;
üretim kodunda gereksiz risk alınmaz — istemci yaşam döngüsüne dokunulacaksa
davranışın değişmediği ölçülür.

### K-5 · Yasak yorumdan nöbetçiye çevrilir

TB-46'nın tuzağına **dört kez** düşüldü ve üç dosyada yorumla belgeliydi.
Belge yeni dosya yazanı korumaz. AST meta-testi gelir: `app.routes` /
`api_router.routes` üzerinde `path` araması yapan test kaynağı **reddedilir**.
Meta-test düşük güçlüdür (§C) ve bu açıkça yazılır; yanına **pozitif kontrol**
konur (bilinen kötü örneği gerçekten buluyor mu).

### K-6 · Kandırılabilir nöbetçide kural TERSİNE çevrilir

TB-41 ve TB-40'ta denetçiler çalışan kaçış üretti. Dedektörü kaçışa karşı
yamamak bitmeyen bir yarıştır; tercih **kuralı daraltmaktır**: izinli desen
listesi (allowlist) + boğaz noktası dışında topyekûn yasak. Yamamak
seçilirse gerekçesi yazılır ve kaçış testi eklenir.

### K-7 · Hiçbir üretim davranışı değişmez

Bu paket **koruma** ekler. Üretim kodunda davranış değişikliği yapılacaksa
(TB-51'in istemci yaşam döngüsü gibi) ayrıca ölçülür ve sözleşmeye yazılır.
Kapanış kapısı: paketin tüm mevcut testleri, sayıları DEĞİŞMEDEN geçer
(yalnız yeni düğümler eklenir).

---

## 2. Kapsam

### 2.1 İçeride (10 kayıt)

| Faz | Kayıt | İş |
|---|---|---|
| **1 · araç** | TB-45 | `_yesil_taban` ortak sürücüye taşınır, mutasyondan ÖNCE çağrılır, kırmızı tabanda prova **hata** ile kesilir |
| | TB-42 | `ERROR` eşleştiricisi düğüm ayracı olmayan koleksiyon hatasını da sayar; logger satırlarını saymaz; kendi pozitif kontrolü olur |
| **2 · izolasyon** | TB-28 | Redis guard: db0 reddedilir |
| | TB-51 | Rate-limit istemcisinin loop bağı; mevcut rate-limit testlerinin gerçekten ölçüp ölçmediği sayılır |
| **3 · davranış** | TB-43 | Kısmi iade tavanı + `refunded_at` ilk damga koruması |
| | TB-44 | Yeni kart sırası (iki kartlı fixture) |
| | TB-47 | Katalog dışı rol bağının taşınması |
| **4 · nöbetçi** | TB-46 | `app.routes` yasağının AST meta-testi + pozitif kontrol |
| | TB-41 | `escrow.claim` boğaz noktası: `values` değişkene alınarak kaçılamaz |
| | TB-40 | Kilit sırası nöbetçisi: `FOR UPDATE OF o` kaçışı kapanır |

### 2.2 Dışarıda — gerekçesiyle

* **TB-38** (kaynak sözleşmesi testleri ada duyarlı, davranışa kör) — bu bir
  **ilke**, tek bir düzeltme değil: depodaki her kaynak-sözleşmesi testinin
  yanına davranış nöbetçisi koymak ayrı bir tarama turu ister. İP-21'in
  çıktısı bu turun **ölçülmüş gerekçesi** olur.
* Yeni özellik, UI değişikliği, şema değişikliği **yoktur**.

---

## 3. Matris (üretim kodundan ÖNCE yazılır)

Düğümler kırmızı matris commit'inde tanımlanacak; her biri için "hangi
mutasyon bu düğümü kırar" sütunu doldurulur. Matris commit'i, §0'daki teşhis
ölçümünün **testleştirilmiş** hâlidir: bugün nöbetsiz olan dört davranış
(TB-43a/43b/44/47) o commit'te **kırmızı** düşer.

---

## 4. Doğrulama kapıları

| Kapı | Beklenen |
|---|---|
| `pytest tests/integration` | taban sayısı + yeni düğümler, **0 failed** |
| `pytest tests` (birim) | taban sayısı + yeni düğümler |
| `pytest tests/verify` | değişmez |
| `npx vitest run` · `eslint` · `tsc` · `ruff` · `build` | değişmez |
| **Mutasyon provası** | §0'daki dört mutasyonun tamamı artık **YAKALANIR** |
| **Araç provası** | Düzeltilen sürücü, kırmızı tabanda "YAKALANDI" **diyemez** (kendi pozitif kontrolü) |
| **Katalog yeniden koşumu** | İP-14/16/17/18/19 mutasyon katalogları; raporlanan sayılardaki değişiklik ölçülür ve yazılır |

---

## 5. Riskler

1. **Ortak sürücüyü değiştirmek yedi paketin ölçüm aracını değiştirir.** TB-45
   kaydının kendisi bunu söylüyor ve İP-17 bunun bedelini bir kez ödedi
   (TB-29 düzeltmesi İP-18'in gölgesini çift saydırdı). Bu yüzden K-1 katalog
   yeniden koşumunu **kapı** yapıyor.
2. **`core/ratelimit` bütün paketlerin ortak yüzeyi.** Üretim davranışı
   doğruyken üretim kodunu değiştirmenin riski, test-tarafı çözümün riskinden
   büyük olabilir; karar ölçümle verilir.
3. **Meta-testler düşük güçlüdür** ve bunu gizlemek bu paketin kendi hatası
   olur. Her meta-test kendi sınırını docstring'inde yazar.

---

## 6. Kapanış (15 Ağu 2026)

### 6.1 §3'ün düzeltmesi — dürüst kayıt

Sözleşme §3 şöyle diyordu: *"bugün nöbetsiz olan dört davranış (TB-43a/43b/44/47)
o commit'te **kırmızı** düşer."* **Bu yanlıştı ve ölçümle görüldü:** korunan
davranışlar bugün DOĞRU çalışıyor; eksik olan nöbetçiydi. Dolayısıyla Faz 3'ün
düğümleri **yeşil doğar** ve tek geçerli kanıt, teşhis turunda "hiçbir şey
kırılmıyor" diyen mutasyonların artık YAKALANMASIDIR (kök `CLAUDE.md` §D).

Kırmızı matris disiplini yalnız **eksik kod** için anlamlıdır: Faz 1 ve Faz 2
gerçekten 7 kırmızıyla başladı (guard modülü yoktu, `_yesil_taban` yoktu,
istemci loop'a bağlıydı). Faz 3 ve Faz 4 nöbetçi ekler — kanıtları mutasyon
provasıdır.

### 6.2 Faz sonuçları

| Faz | Düğüm | Kanıt |
|---|---|---|
| 1 · araç | N-1, N-1b, N-2, N-2b, N-2c | 3 kırmızı → yeşil |
| 2 · izolasyon | N-3, N-3b, N-3c, N-3d, N-4, N-4b | 4 kırmızı → yeşil; guard'ın suite'i gerçekten durdurduğu ayrıca ölçüldü |
| 3 · davranış | N-5, N-6, N-6b, N-7, N-8 | **mutasyon 5/5 yakalandı** |
| 4 · nöbetçi | N-9, N-9b, N-9c, N-10, N-10b, N-10c | **kaçış mutasyonu 2/2 yakalandı** (gerçek depo dosyalarına enjekte edildi) |

### 6.3 K-1'in kapısı — katalog yeniden koşumu

Tam katalog (63 mutasyon × 2 suite) saatler sürerdi ve sorunun yalnız bir
yarısını cevaplardı. Sorunun asıl hâli şudur: *araç değişikliği geçmiş bir
provayı ancak (i) o provanın tabanı KIRMIZIYSA ya da (ii) mutasyon düğüm
ayracı olmayan bir ERROR ürettiyse etkiler.* (i) mutasyon uygulamadan
ölçülebilir.

Ölçüldü: 63 mutasyon → **28 benzersiz hedef kümesi**, hepsi temiz ağaçta
**YEŞİL**. Sonuç: **TB-45 düzeltmesi geçmişte raporlanan hiçbir sayıyı
değiştirmez**; kapı bundan sonraki turlar için kurulmuş olur. (ii) ancak
kırmızı taban varsa gündeme gelirdi, gelmedi.

### 6.4 Kapılar

| Kapı | Taban (`b19c773`) | İP-21 |
|---|---|---|
| `pytest tests` (birim) | 993 | **1010** |
| `pytest tests/integration` | 1368 | *(kapanış turunda ölçüldü — aşağıya bak)* |
| `npx vitest run` | 917 · 90 dosya | **917 · 90** (değişmedi) |
| `eslint src` · `tsc -b` · `ruff check .` | 0/32 · temiz | **aynı** |
| Mutasyon | — | **Faz 3: 5/5 · Faz 4: 2/2** |
| Taban taraması | — | **28/28 yeşil** |

### 6.5 Kapsam dışı bırakılanlar

* **TB-40** (kilit sırası nöbetçisi `FOR UPDATE OF o` ile kandırılabiliyor) —
  sözleşme §2.1'de kapsamda gösterilmişti, **kapsam dışına alındı**. Gerekçe:
  düzeltmesi İP-18'in kilit sözleşmesini yeniden tasarlamayı gerektiriyor
  (kural daraltma burada "hangi tablo hangi sırayla kilitlenir"i yeniden
  yazmak demek) ve o davranışın **zaten bir davranış nöbetçisi var**
  (`test_ip18_siparis_kilit_pg::test_yesil_checkout_yolu_*`, gerçek
  `before_cursor_execute` gözlemi). Yani boşluk kaynak sözleşmesindedir,
  korumasızlık değildir. Kayıt defterde duruyor.
* **TB-38** (kaynak sözleşmeleri ada duyarlı, davranışa kör) — §2.2'de zaten
  dışarıdaydı; bu paketin çıktısı onun ölçülmüş gerekçesidir. İP-21 üç yeni
  kaynak sözleşmesi yazdı ve üçü de kendi sınırını docstring'inde yazıyor +
  pozitif kontrol taşıyor; TB-38'in istediği envanter turu hâlâ ayrı bir iş.

### 6.6 Turun kendi hataları — dürüst kayıt

1. **§3'ün kırmızı beklentisi yanlıştı** (§6.1).
2. **Faz 3 provasında P3 "YAKALANMADI" dedi ve nöbetçi suçsuzdu.**
   `if amount <= 0: return` deseni `order_service`'te **iki** fonksiyonda
   geçiyor; `replace(…, 1)` yanlışını (`reserve_refund`) yamalıyordu. Desen
   bağlamla hedeflenince prova yakaladı. Bu, TB-38 ailesinin canlı örneğidir:
   desen eşleşmesi bağlama kördür — ve bu kez ölçüm aracının kendisinde çıktı.
3. **Vitest bir koşumda 1 kırılma verdi, adı yakalanamadı.** Dört koşumda
   tekrarlanmadı. Küçümsenmedi: **[[TB-54]]** açıldı ve tekrarında adı
   kaybetmeden yakalamanın yolu yazıldı.
