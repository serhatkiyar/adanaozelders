# İP-14 — Kütüphane Operatörü Paneli: Üretim Sözleşmesi

**Dal:** `ip14-operator-panel` · **Taban:** `ff9eb1d` (main) · **Tarih:** 8 Ağustos 2026
**Kaynak:** `docs/operator-panel-olcumu.md` §6.1 (ucuz kova) + §7 (audit boşluğu)

Bu paket bir **arayüz + iz** paketidir: yeni uç yazılmadı, şema değiştirilmedi,
para yolları ve yetki kapıları korundu. Yapılan iş, mevcut uçları operatörün
gerçek gününe göre doğru kullanmak ve para etkili aksiyonları denetim izine
bağlamaktır.

---

## 1. Bölüm 2 ölçümü ve raporla farklar

Ölçüm kod okumasıyla yeniden yapıldı (rapora değil ölçüme güvenildi).

### 1.1 Sorgu envanteri — 5 operatör sayfası

| Ekran | Sorgu | `isLoading` | `isError` (öncesi) | Hata hâlinde ne görünüyordu |
|---|---|---|---|---|
| Panel | `useOperatorMe` | ✓ | ✗ | başlık "Yükleniyor…"da kalır |
| Panel | `useLibraryAdminDetail` (×2, aynı key) | ✗ | ✗ | `if (!lib) return null` → banner yok |
| Panel | `useLibraryEarnings` | ✓ | ✗ | `if (!data) return null` → kart **hiç yok** |
| Panel | `usePaymentAvailability` | ✗ | ✗ | sessiz (fail-closed, bilinçli) |
| Oturumlar | `useOperatorMe`, `useLibraryAdminDetail` | kısmen | ✗ | onay bandı yanlış görünebilir |
| Oturumlar | `useManageStudyReservations` | ✓ | ✗ | `length===0 → null` → **kart yok olur** |
| Oturumlar | `useManageSessions` | ✓ | ✗ | "Henüz oturum eklenmedi" |
| Oturumlar | `useRoster` (roster paneli) | ✓ | ✗ | "Henüz kayıtlı katılımcı yok" |
| Oturumlar | `useRoster` (sonuç paneli) | ✓ | ✗ | "Katılımcı yok" |
| Oturumlar | `useUsableCatalogs` | ✗ | ✗ | katalog listesi sessizce boş |
| Kütüphanem | `useOperatorMe`, `useLibraryAdminDetail` | ✓ | ✗ | **sonsuz iskelet** |
| Bakiyem | `useCurrentUser`, `useOperatorMe`, `useLibraryEarnings` | ✓ | ✗ | ₺0 gösterir |
| Bakiyem | `useLibraryEarningsTransactions` | ✓ | ✗ | **"Henüz bir işlem yok"** |
| Bakiyem | `useLibraryPayout` | ✗ | ✗ | sessiz |

**Rapordan fark:** rapor "~15 sorgu" diyordu; sayım **14**. Başka fark bulunmadı.

### 1.2 Diğer ölçümler

| Soru | Ölçüm |
|---|---|
| (b) Uç dönüş şekli | `StudyReservationOut`: `starts_at`/`ends_at`/`status`/`client_name` var → "bugün" istemcide türetilebilir. `ExamSessionOut`: `ends_at` **yok**, `duration_minutes` ile türetilir. |
| (c) Zaman dilimi | Kolonlar `DateTime(timezone=True)`, API **UTC ISO** döner. Hazır desen: `lib/datetime.ts::istanbulNow` (Europe/Istanbul, sabit UTC+3 — backend `APP_UTC_OFFSET_HOURS=3` ile hizalı). |
| (d) Sıralama çağıranları | `list_library_sessions_admin` tam taraması: **tek çağıran** `api/routers/library_exams.py:135` (`GET /exam-sessions/manage`). Public liste ayrı fonksiyondur ve zaten `asc`. |
| (e) 200 tavanı | `library_service.earnings_transactions(limit=200)`; router **limit geçirmiyor**. Kesme iki kez: kaynak başına `.limit(200)` + birleşik `out[:200]`. Eğitmen kolu da aynı (payment_service, 200). |
| (f) `window.confirm` | Operatör tarafında 2 yer: `ExamSessionsManager.tsx:127` (oturum iptali), `:299` (karne yayınlama). |
| (g) Para etkili aksiyonlar | `_attend_exam`, `_attend_study` (escrow RELEASED), `cancel_session` (toplu iade), `publish_results` (geri alınamaz). |
| (h) İP-3 audit deseni | `delivery_service.py:2261` + `_ZimmetAktoru(id, role_id)`; `audit_service.record` yalnız `flush()` eder → çağıranın transaction'ında. `ip3_factory.cleanup` zaten `audit_logs WHERE actor_role=4` siliyor. |
| (i) Ortak sayfa nav'ı | Aynı koşul **7 yerde kopyalanmış** (Notifications, Leaderboard, Settings, Profile, Tasks, Learn, Calendar); hiçbiri role 4'ü tanımıyor. Yalnız `Messages.tsx` doğru. |

**Ölçüm sırasında bulunan, raporda olmayan kusur:** `DashboardHeader`'ın **mobil**
üst barında role bakılmayan sabit bir "Favorilerim" kısayolu vardı. Favoriler
öğrenciye aittir; eğitmen ve operatör kendilerine ait olmayan, boş açılan bir
ekrana giden ikonu görüyordu. Operatörün işi fiziksel olarak mobil olduğundan
(QR kapıda okutulur) yanlış ikonu en çok o görüyordu. Düzeltildi (yalnız CLIENT).

---

## 2. "Bugün" tanımı

* **Saat dilimi: `Europe/Istanbul`** (sabit UTC+3, DST yok). Tarayıcının saat
  dilimi **kullanılmaz**; `new Date().getDate()` hiçbir yerde çağrılmaz.
  Gerekçe: panel bir VPS'ten, seyahatteki telefondan ya da tz'i UTC'ye ayarlı
  bir laptop'tan açılabilir. UTC ile hesaplanırsa 23:30'daki rezervasyon
  "yarın" görünür ve kapıda bekleyen öğrenci listede olmaz.
* Gün anahtarı tek yerde üretilir: `lib/operatorAgenda.ts::istanbulGunAnahtari`
  (`Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" })` → `YYYY-MM-DD`).
* Randevu saati de tarayıcıdan bağımsız gösterilir: `lib/datetime.ts::formatIstanbulTime`.
* Fonksiyonlar `simdi`yi **parametre alır**: aynı render içinde iki farklı
  "şimdi" oluşup liste bir saniyeyle iki güne bölünmesin.

### 2.1 Sayaç ile liste bilinçli olarak farklı kapsamdadır

| | Kapsam | Gerekçe |
|---|---|---|
| Yaklaşan **liste** | Penceresi kapanmış kayıt gösterilmez | "Yaklaşan" başlıklı listede geçmiş satır belirmesin |
| Gün **özeti** (Panel) | Bugünün **tamamı** sayılır (biten dahil) | Akşam 20:00'de "bugün 0 rezervasyon" demek, günü kapatan operatöre gerçeği söylememektir |
| **Sıradaki** | Yalnız `startsAt > şimdi` | Saati geçmiş randevuyu "sıradaki" diye göstermek kapıda yanlış isim söyletir; hepsi geçmişse `null` |

---

## 3. Gruplama kuralı

`gunKovasi(kayit, simdi)` — sırayla değerlendirilir:

1. `endsAt ?? startsAt` < şimdi → **`GECMIS`** (gruplamaya girmez)
2. başlangıç günü ≤ bugün → **`BUGUN`** (dün başlayıp hâlâ süren gece
   penceresi de bugünün işidir)
3. başlangıç günü = yarın → **`YARIN`**
4. başlangıç günü ≤ bugün + 7 → **`BU_HAFTA`**
5. ötesi → **`DAHA_SONRA`**

**"Bu hafta"dan sonrası ne oluyor (§7 sorusu):** listeden **düşmez**, ayrı bir
`DAHA_SONRA` grubunda kalır. Gerekçe: operatör ileri tarihli bir rezervasyonu
sorguladığında "yok" cevabı almamalı; kayıt görünür ama günün işini bastırmaz.

**"Bu hafta" penceresi takvim haftası değil, bugünden itibaren kayan 7 gündür.**
Pazar akşamı takvim haftası biter ve grup boşalırdı; operatör bunu "haftam
bitti" diye değil "liste bozuldu" diye okur.

Diğer kurallar: boş kova **başlık basmaz**; her kova kendi içinde erken→geç
sıralanır; `GECMIS` kovası hiç döndürülmez.

---

## 4. Sıralama değişikliği ve etkilenen çağıranlar

`library_exam_service.list_library_sessions_admin`: `starts_at DESC` →

```
1) gelecek önce, geçmiş sonra        (starts_at < now) ASC
2) gelecek grubunda erken→geç        CASE WHEN geçmiş THEN NULL ELSE starts_at END ASC
3) geçmiş grubunda yeni→eski         starts_at DESC
4) deterministik bağlayıcı           id DESC
```

**Etkilenen çağıranlar (tam tarama):** yalnız `api/routers/library_exams.py`
(`GET /exam-sessions/manage`) — admin ve operatör aynı ucu kullanır, ikisi de
bu sıradan yararlanır. Public liste (`list_public_sessions`) **ayrı
fonksiyondur** ve zaten erken→geç sıralıdır; node **S-3** onun bozulmadığını
nöbetler (ortak yardımcıya çekilirken yön ters çevrilirse kırılır).

Geçmiş oturumlar listeden **çıkarılmadı**: karne yükleme ve sonuç yayınlama
onların üzerinde yapılır.

---

## 5. ErrorState bağlanan sorgular

Önce **0/14**, sonra **10/14**.

| # | Ekran · Sorgu | Durum | Not |
|---|---|---|---|
| 1 | Panel · `useManageStudyReservations` (Bugün bloğu) | ✅ | `bugun-hata` |
| 2 | Panel · `useManageSessions` (Bugün bloğu) | ✅ | aynı blok |
| 3 | Oturumlar · `useManageStudyReservations` | ✅ | `rez-hata` |
| 4 | Oturumlar · `useManageSessions` | ✅ | `oturum-hata` |
| 5 | Oturumlar · `useRoster` (katılımcılar) | ✅ | `roster-hata` |
| 6 | Oturumlar · `useRoster` (sonuç tablosu) | ✅ | `sonuc-roster-hata` |
| 7 | Bakiyem · `useLibraryEarningsTransactions` | ✅ | `islem-hata` |
| 8 | Bakiyem · `useEarningsTransactions` (eğitmen kolu) | ✅ | ortak görünüm |
| 9–10 | Boş≠hata metin ayrımı (oturum listesi, işlem dökümü) | ✅ | node E-5 |

**Kapanmayanlar (bilinçli, P2):**

| Sorgu | Neden bırakıldı |
|---|---|
| `useOperatorMe`, `useLibraryAdminDetail` | Sayfa kabuğunun kimlik sorgusu; hata hâlinde tüm ekran anlamsız kalır. Doğru çözüm sayfa düzeyinde tek bir hata kabuğudur — bu, ekran mimarisi kararıdır ve §6.2 (DataTable/URL state) ile birlikte ele alınmalı. |
| `usePaymentAvailability` | Bilinçli **fail-closed** sessizlik: kol kapalı sayılır, `PaymentBranchNotice` zaten görünür (İP-PK-1 sözleşmesi). |
| `useUsableCatalogs` | Yalnız oturum düzenleme modalındaki seçim listesini besler; boş liste "katalogsuz oturum" akışını bozmaz. |
| `useLibraryPayout` (`LibraryPayoutForm` içi) | Bu paket ödeme hesabı formuna dokunmadı. |

---

## 6. Audit (denetim izi) sözleşmesi

Ortak yardımcı: **`backend/services/operator_audit.py`** — İP-3'ün kurye saha
audit deseni (`delivery_service::_ZimmetAktoru` + `audit_service.record`)
birebir uygulandı. **Yeni audit şeması icat edilmedi.**

| Aksiyon | `action` | `target_type` | `target_id` | Nerede |
|---|---|---|---|---|
| Deneme yoklaması (QR ve listeden-seç) | `exam_attendance.verify` | `exam_registration` | kayıt id | `library_exam_service._attend_exam` |
| Çalışma alanı girişi | `study_attendance.verify` | `study_reservation` | rezervasyon id | `study_reservation_service._attend_study` |
| Oturum iptali | `exam_session.cancel` | `exam_session` | oturum id | `library_exam_service.cancel_session` |
| Karne yayınlama | `exam_results.publish` | `exam_session` | oturum id | `library_exam_service.publish_results` |

**Alanlar:** `actor_id` + `actor_role` (gerçek kullanıcıdan), `details`
(oturum başlığı / pencere etiketi), `after` (yeni durum + `released_at` ya da
`results_published_at`), `meta` (`library_id`, `session_id`, `client_id`).
`before` yazılmaz — bu aksiyonların hepsi tek yönlü geçiştir ve önceki durum
`after`tan okunabilir.

**`reason` neden boş:** bu üç aksiyonun hiçbirinde kullanıcıya gerekçe
sorulmuyor (yoklama fiziksel bir olayın kaydıdır; iptal ve yayın operatörün
kendi işletme kararıdır). İleride onay penceresine gerekçe eklenirse
`record`'a doğrudan geçirilebilir.

**Transaction:** `audit_service.record` yalnız `flush()` eder; `commit`
çağırana aittir. İz **aksiyonla aynı transaction'da** yazılır:

* yoklama: `escrow.claim` **kazanıldıktan sonra**, `db.commit()`'ten önce →
  `already` / 409 / 404 dallarında iz **doğmaz**;
* iptal: `status = CANCELLED` damgasıyla aynı commit'te (iadeler bilinçli
  olarak ayrı commit'lerde yürür);
* yayın: yalnız **ilk** yayında (tekrar çağrı sessizdir, iz de yazılmaz).

**Aktör:** operatör aksiyonunda `actor_role = 4`; aynı uçları kullanan adminde
`1`. Yanlış kişiyi gösteren iz, izsizlikten kötüdür. Aktörü **bilinmeyen**
çağrı (arka plan döngüsü, servis düzeyinde otomasyon) audit **yazmaz** —
uydurulmuş aktör, hiç aktör olmamasından kötüdür (`delivery_service` ile aynı
karar).

**D-1…D-5 sonuçları:** 5/5 yeşil, hepsi gerçek PostgreSQL + gerçek HTTP ile.

---

## 7. Mutasyon kataloğu

Sürücü: `backend/scripts/mutation_drill_ip14.py` (güvenlik mekanizması
`mutation_drill`ten import: bayt yedeği + SHA-256 doğrulamalı geri alma, kirli
ağaçta reddetme, test-DB adı kontrolü, HEAD/`git status` eşitliği).
**Ek nöbet:** "0 test seçildi" başarısızlık sayılır (İP-12'de bu tuzağa
düşülmüştü); koşan test sayısı çıktıdan okunur.

| # | Mutasyon | Beklenen | Sonuç (koşan test) |
|---|---|---|---|
| M-B2 | "Bugün" filtresi kaldırıldı | B-2 kırılsın | ✅ 5 node (43 test) |
| M-B5 | Gün anahtarı UTC'den | B-5 kırılsın | ✅ 5 node (43) |
| M-G1 | Gruplama tek grup | G-1 kırılsın | ✅ 6 node (43) |
| M-S1 | Sıralama DESC'e geri | S-1 kırılsın | ✅ 1 node (7) |
| M-E1 | ErrorState dalı kaldırıldı | E-1 kırılsın | ✅ 2 node (5) |
| M-E5 | Boş ile hata aynı metin | E-5 kırılsın | ✅ 1 node (24) |
| M-K1 | Tavan uyarısı kaldırıldı | K-1 kırılsın | ✅ 1 node (5) |
| M-Y3 | ConfirmDialog atlandı | Y-3 kırılsın | ✅ 2 node (24) |
| M-N1 | Nav öğrenciye sabit | N-1 kırılsın | ✅ 5 node (24) |
| M-D1 | Yoklama audit'i kaldırıldı | D-1 kırılsın | ✅ 2 node (7) |
| M-D2 | İptal audit'i kaldırıldı | D-2 kırılsın | ✅ (7) |
| M-D3 | Yayın audit'i kaldırıldı | D-3 kırılsın | ✅ (7) |
| M-D4 | Audit ayrı transaction'a | D-4 kırılsın | ✅ (7) |
| M-D5 | `actor_role` ADMIN yazıldı | D-5 kırılsın | ✅ 5 node (8) |

**14/14 yakalandı.** Her koşudan sonra HEAD ve `git status` başlangıç durumuna
eşit doğrulandı; geri alma SHA-256 ile denetlendi.

---

## 8. Kırmızı matris

| Grup | Node | Kanıt sınıfı | Kırmızı başladı |
|---|---|---|---|
| B · bugün görünürlüğü | 5 | gerçek DOM + gerçek axios | 5/5 |
| G · gruplama | 5 (+8 saf) | gerçek DOM + saf birim | 13/13 |
| S · sıralama | 3 | gerçek PG + gerçek HTTP | **2/3** (S-3 bilinçli yeşil) |
| E · hata durumu | 6 | gerçek DOM | 6/6 |
| K · kesilme | 2 (+2 saf) | gerçek DOM + saf | 4/4 |
| Y · sayaç ve onay | 6 (+3 saf) | gerçek DOM | 9/9 |
| N · navigasyon | 5 | gerçek DOM | 5/5 |
| D · denetim izi | 5 | gerçek PG + gerçek HTTP | 5/5 |

Toplam **55 node**: 54 kırmızı başladı, 1 (**S-3**) bilinçli yeşil — public
listenin zaten doğru olan sıralamasını nöbetler.

**Kanıt sınıfı dağılımı (CLAUDE.md §H):** gerçek PostgreSQL + gerçek ASGI HTTP
**7**, gerçek DOM + gerçek axios adapter **29**, saf yardımcı/birim **19**.
Kaynak/AST sözleşmesi testi **yok**; snapshot **yok**.

---

## 9. Bulunan test kusurları (CLAUDE.md §I)

Kırmızıyı yeşile çevirirken bulundu ve düzeltildi — hepsi aynı iddiayı **daha
doğru** ölçüyor, zayıflatma yok:

1. **Fixture şeması.** `/payments/availability` yanıtı nesne yazılmıştı; gerçek
   şema `branches` bir **listedir**. Ekran `branches.find` çağırdığı için
   `OperatorHome` render'ı patlıyordu: node'lar kırmızıydı ama **yanlış
   sebeple**. Aynı sınıf hata `/leaderboard` fixture'ında da vardı.
2. **Rota sırası.** Sahte sunucu substring eşler; `"/libraries/12/earnings"`
   deseni `/earnings/transactions` yolunu da yakalıyor, işlem dökümü isteği
   **özet yanıtını** alıyordu (`transactions.map is not a function`).
3. **Uydurma uç yolu.** Karne yayınlama için `/publish-results` yazılmıştı;
   gerçeği `/exam-sessions/{id}/results/publish`.
4. **Eksik fixture → yalancı yeşil.** Ayarlar sayfası ad değişikliği
   taleplerini liste bekliyor; stub'sız bırakılınca render **patlıyor** ama nav
   zaten basıldığı için test **yeşil** kalıyordu (suite raporunda "1 error").
5. **`window.matchMedia` yok.** jsdom bu API'yi hiç sağlamıyor; `themeStore`
   modül yüklenirken çağırdığından `DashboardShell` zinciri **render
   edilmeden** patlıyordu. Repoda bugüne dek panel kabuğunu gerçek DOM'da
   render eden test olmamasının sebebi buydu. `test-setup.ts`'e eklendi.
6. **Süre kırılganlığı.** Gerçek sayfa ağaçlarının jsdom transform'u paralel
   koşuda 5 sn'lik varsayılan bütçeyi aşıyordu. Dosya düzeyinde
   `vi.setConfig({ testTimeout: 20s })` + RTL `asyncUtilTimeout: 5s` verildi;
   **`vitest.config.ts` global ayarına dokunulmadı** (İP-12'nin işi, TB-23).

---

## 10. Kapsam dışı bırakılanlar ve kalan P2'ler

### Bu pakette bilinçli olarak yapılmayanlar

* **§6.2'nin tamamı** — özellikle **yoklama geri alma** ve **tek rezervasyon
  iptali/iadesi**: ikisi de **ürün kararı** bekliyor. `released_at` geri
  alınamaz bir damga olduğu için bunlar saf UI işi değildir; para güvenliği
  kararı gerektirir → ayrı paket.
* **§6.3'ün tamamı** (gereksiz sayılanlar).
* **Sayfalama.** 200 satır tavanı **kaldırılmadı**, yalnız görünür kılındı.
  Uç `limit` parametresi alıyor ama router geçirmiyor; sayfalama eklemek
  DataTable + URL state kararıyla birlikte alınmalı (§6.2/7).
* **Hakediş görünürlüğü** (§6.2/1), **kayıt ara/bilet sorgula** (§6.2/2),
  **anlık doluluk** (§6.2/5), **operatör bildirimleri** (§6.2/6).

### Kalan P2 listesi

| # | Konu | Not |
|---|---|---|
| P2-1 | Kabuk sorgularında (`useOperatorMe`, `useLibraryAdminDetail`) hata durumu | Sayfa düzeyinde tek hata kabuğu ister; ekran mimarisi kararı |
| P2-2 | İşlem dökümü sayfalama | Tavan bugün yalnız **dürüst**; kaldırılmadı |
| P2-3 | Operatör ekranlarında arama/filtre/URL state | §6.2/7 ile birlikte |
| P2-4 | Kütüphanem ve Ayarlar sorgularında hata durumu | Bu paket dört ekrana dokundu; Kütüphanem'in kendi bölüm sorguları kapsam dışıydı |
| P2-5 | `Balance` ödeme metni eğitmen kolunda da değişti | Mekanizma ikisinde de aynı (elle havale); ayrı metin gerekirse ürün kararı |

**Not (yasal metin uyumu):** Bakiyem'deki ödeme açıklaması artık "banka
havalesi" diyor. `legalContent.ts` bu konuda bir vaat içermiyor; çelişki
oluşmadı. Ödeme mekanizması iyzico Pazaryeri alt üye işyerine geçtiğinde bu
metin **yeniden gözden geçirilmelidir**.

---

## 11. Doğrulama sonuçları

| Koşu | Sonuç |
|---|---|
| `pytest tests/integration -k ip14` | **7 passed** |
| `pytest tests/integration -k ip1b` | 28 passed (beklenen 28) |
| `pytest tests/integration -k ip3` | 115 passed (beklenen 115) |
| `pytest tests/integration -k ip1a` | 63 passed (beklenen 63) |
| `pytest tests/integration -k ip2a` | 49 passed (beklenen 49) |
| `pytest tests/integration` (tam) | **1206 passed, 16 skipped** (taban 1215 → +7 İP-14; skip'ler VROOM/dış servis) |
| `pytest tests/acceptance` | **197 passed** (beklenen 197) |
| `ruff check .` | All checks passed |
| `git diff --check` | temiz |
| `npm run test` | **77 dosya / 804 test** (taban 74/756 → +3/+48), 0 hata, 0 yakalanmamış istisna |
| `npx tsc -b` | temiz |
| `npm run lint` | **0 hata / 34 uyarı** — taban ile aynı |
| Yeni DOM testleri × 5 tekrar | 5/5 yeşil (48/48) |

**Migration üretilmedi:** `alembic heads` → `ip5_siparis_vergi_kirilimi (head)`
(taban ile aynı); `git diff ff9eb1d -- backend/migrations` boş.

**İP-12 dosyalarıyla kesişim yok:** `AdminStore.tsx`, `store_service.py`,
`search_vector`, `DataTable`, dashboard kartları — hiçbirine dokunulmadı.
