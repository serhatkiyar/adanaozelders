# İP-4 — Admin operasyon yüzeyi sözleşmesi

**Dal:** `ip4-admin-operasyon` · **Taban:** `e726b9b` (main)
**Kaynak:** `docs/DENETIM-RAPORU-2026-07-31.md` §4.2 (P1-1, P1-4, P1-5, P1-6),
§5 (eksik admin akışları), §9 İP-4 · `docs/teknik-borc.md` TB-14 #1

Bu paket önceki üçünden farklıdır: ağırlığı frontend'dedir ve admin ekranları
için **ilk gerçek DOM kabul testleri** burada yazılmıştır. Ekranın "çalışıyor
gibi görünmesi" ile çalışması arasındaki farkı yalnız gerçek tıklama + gerçekten
gönderilen istek ayırır — bu paketin dört bulgusundan üçü (P1-1, P1-5, P1-6) tam
olarak o boşlukta oluşmuştu.

---

## 1. Kırmızı matris ve her node'un gerekçesi

Üretim kodu yazılmadan önce, ayrı commit'te (`3aa64d8`). Ölçülen başlangıç:
**backend 20 kırmızı / 1 yeşil**, **frontend 25 kırmızı node + toplanamayan 1
dosya** (`AdminOperationsPage` henüz yoktu) / 17 yeşil.

Yeşil başlayan node'lar kusur değildir: matrisin "bozulmamalı" yarısıdır
(negatif iddialar ve mevcut doğru davranışlar). Ayrı ayrı sayılmaları
bilinçlidir — kök `CLAUDE.md` §E: bir iddianın gücü, yanlış uygulamayı
kırmasıyla ölçülür; hiç kırılamayacak bir iddia da kanıt üretmez ama nöbet tutar.

### A · Eğitmen onay kuyruğu (P1-1) — gerçek DOM

| Node | İddia | Gerekçe |
|---|---|---|
| A-1 | Kuyruk `/yonetim/egitmenler` altında, kendi başlığı ve sayacıyla render ediliyor | `useApproveTutor`/`useRejectTutor` tüm kod tabanında TEK yerde kullanılıyordu: `AdminHome.tsx`'in `section === "overview"` dalı. O dal ulaşılamaz (`AdminSectionPage` prop tipi `Exclude<Tab,"overview">`, `App.tsx` ADMIN kökünü `/yonetim`'e yönlendiriyor) |
| A-1b ✔ | Bekleyen yoksa kuyruk başlığı **hiç basılmaz** | Boş bir "0 başvuru" bölümü gözü alıştırır; gerçek kuyruk fark edilmez |
| A-2 | `PENDING_APPROVAL` satırında Onayla + Reddet var | `ListingRow` aksiyonları o durum için **yalnız "Sil"** sunuyordu — admin ya SQL'e iniyor ya eğitmeni siliyordu |
| A-2b ✔ | `APPROVED` satırında bu aksiyonlar **yok** | Yanlış satıra tıklama riski |
| A-3 | Onayla tıklaması gerçekten `POST /admin/tutors/{id}/approve` üretiyor | Kaynak taraması ölü daldaki butonu da "var" sayar — P1-1 tam olarak böyle gözden kaçtı |
| A-3b | Onay isteği patlarsa kullanıcı hatayı **görür** | Sessiz başarısızlık, "onaylandı" ile aynı görünür |
| A-4 | Reddet gerekçesiz gönderilemiyor (düğme disabled + hiç istek gitmiyor) | Denetim raporu eksik akış 6: eğitmen red gerekçesini göremiyor, admin de girmiyordu |
| A-4b | Gerekçe yazılınca istek gövdesinde `reason` ile gidiyor | "Alan var ama gönderilmiyor" hâlini ayırt eder |
| A-4c | Yalnız boşluktan oluşan gerekçe kabul edilmiyor | Zorunluluk "tek karakter yaz geç"e indirgenmemeli |
| A-5 | Onay sonrası liste tazeleniyor, satır kuyruktan düşüyor | Cache invalidation unutulursa ekran yalan söyler |
| A-6 | (backend) `POST /admin/tutors/{id}/reject` gerekçesiz → **422** | Uç gövdesizdi |
| A-6b | (backend) Gerekçe `audit_logs`'a yazılıyor | Karar gerekçesiz denetim izine giremez |
| A-6c | (backend) Çok kısa/boş gerekçe → 422 | |

### B · Sıkışmış para ve ölü iş (P1-4)

| Node | İddia | Gerekçe |
|---|---|---|
| B-1 | `GET /admin/escrow/stuck` tavanı dolmuş `REFUNDING` kayıtları dönüyor | `escrow_reconciler.py` deneme sınırı dolan iadeyi `logger.error("MANUEL müdahale gerekli")` ile bırakıyordu; `grep REFUNDING backend/api/` → **sıfır** |
| B-1b | Kalıcı `MANUAL_REVIEW` (PK-δ) kayıtları da dönüyor | Kuyruğun asıl konusu |
| B-1c ✔ | **Denemesi tükenmemiş** `REFUNDING` kuyruğa **girmiyor** | Matrisin en kritik negatif iddiası: her `REFUNDING`'i listeleyen bir uygulama da B-1'i geçerdi, ama ekran reconciler'ın dakikalar içinde çözeceği kayıtlarla dolar ve gerçek sıkışıklık gürültüde kaybolur |
| B-2 | `GET /admin/outbox/failed` dead-letter işleri dönüyor | `grep OutboxEvent backend/api/` → **sıfır** |
| B-2b ✔ | `PENDING`/`SENT` işler listede **yok** | |
| B-2c | Ham `payload` **sızmıyor**, ama `order_id` korunuyor | Payload alıcının telefonunu taşır (KVKK). Aynı testte "fazla daraltma" da yasak: teşhis için gereken sipariş numarası kaybolmamalı |
| B-3 | Retry işi yeniden kuyruğa alıyor ve **sayacı sıfırlıyor** | Sayaç tavanda bırakılırsa worker ilk turda yeniden çarpar; retry hiçbir şey yapmamış olur |
| B-3b | İkinci retry **yeni iş üretmiyor**, `requeued=false` | At-least-once worker'da ikinci sıfırlama, iki ayrı gönderim penceresi demektir |
| B-3c | `SENT` iş retry edilemiyor → **409** | SMS/e-posta geri alınamaz |
| B-3d | Olmayan iş → **404** | |
| B-4 | Üç uç da izin duvarlı: yetkisiz admin **403** | P1-14'ün anlattığı boşluk: yetki yalnız servis fonksiyonu doğrudan çağrılarak kanıtlanmıştı; router'a kablolanması test edilmiyordu |
| B-4b | `operations.view` retry'e **yetmiyor** | Görev ayrılığı |
| B-4c | Yeni izinler `admin_permissions` tablosunda **gerçekten var** | `266eeeac2a47` tuzağı: katalogda olup DB'de olmayan izin hiçbir role bağlanamaz; uç SUPER_ADMIN dahil herkese 403 döner ve menü de gizli olduğu için hata **görünmez** |
| B-5 | (DOM) Ekran iki kuyruğu da listeliyor, retry gerçek POST üretiyor, onaysız istek gitmiyor, hata görünüyor, `view`-only admin retry düğmesini görmüyor | |

### C · Onaysız tek-tık yıkım (P1-5 sınıfı) — gerçek DOM

Denetim raporunun adlandırdığı örnek (`AdminStore.tsx` sipariş iadesi) **İP-2b
turunda zaten düzeltilmişti** (`ReasonDialog` + `isPending` + `onError`). Ama
aynı dosyada aynı sınıftan üç aksiyon korumasız kalmıştı ve matris onlara
kaydırıldı — bu bir kapsam daralması değil, aynı bulgunun yaşayan örneklerine
taşınmasıdır:

| Node | Aksiyon | Neden yıkıcı |
|---|---|---|
| C-1a | Ürün silme (`remove.mutate()` doğrudan) | Katalogdan ürün düşürür |
| C-1b | Kategori silme | Kategori ağacını değiştirir |
| C-1c | "Teslim edildi" | Siparişi terminal duruma taşır, teslimat akışını kapatır |
| C-2 | İstek uçarken onay düğmesi disabled, ikinci tık ikinci istek üretmiyor | |
| C-3 | Patlarsa **sunucunun gerekçesi** ekranda görünüyor | |

### D · "Yalancı boş durum" (P1-6) — gerçek DOM

Dört yüzey × üç iddia (500 → hata görünür + boş metin görünmez; 403 → aynısı;
gerçekten boşsa boş metin **görünür**):

* `AdminStore` siparişler ("Sipariş yok.")
* `AdminStore` iadeler ("Bekleyen iade talebi yok.")
* `AdminHome` diploma kuyruğu ("Teyit bekleyen belge yok 🎉")
* `AdminPayouts` ödeme geçmişi ("Henüz ödeme kaydı yok.")

403 ayrı node'dur çünkü `lib/queryClient.ts` 403/404'ü bildirimden muaf tutar —
o durumda hata **tamamen** sessizdir. Üçüncü iddia ("gerçekten boşsa boş metin
görünür") hata durumunun boş durumu yutmasını engeller.

### E · Admin iade filtresi (TB-14 #1)

| Node | İddia |
|---|---|
| E-1 | `refund_status=GECERSIZ` → **422** (bugün: boş liste) |
| E-1b | `status=GECERSIZ` → **422** — *matrise İP-4 turunda EKLENDİ* |
| E-2 ✔ | Geçerli enum değeri **çalışmaya devam ediyor** (tabanda zaten yeşildi) |

**E-1b neden eklendi:** TB-14 yalnız `refund_status`'ı adlandırıyor. Düzeltilmiş
bir tuzağın yanına aynısını korumasız bırakmak, bir sonraki yöneticinin aynı
yanılgıyı öteki filtreyle yaşamasıdır. Kapsam genişlemesi tek satırlıktır ve
aynı çağrının içindedir.

### F · Fail-closed erişim

| Node | İddia |
|---|---|
| F-1 | `adminAreaAccess(undefined, …)` → `{canView:false, canManage:false}` (saf) |
| F-1b | (DOM) İzin bilgisi hiç yüklenmemişken yönetim aksiyonu gösterilmiyor |
| F-1c ✔ | Boş izin listesi zaten kapalıydı |
| F-1d ✔ | Yalnız `view` izni olan admin listeyi görür, aksiyon alamaz |

---

## 2. Ürün kararları

### PK-İP4-1 — Red gerekçesi ZORUNLU

`POST /admin/tutors/{id}/reject` artık `TutorRejectIn` alır: `min_length=3`,
`max_length=500`, `str_strip_whitespace=True`. Gerekçe `audit_logs.reason`
alanına yazılır.

**Neden zorunlu:** denetim raporu "eksik akış 6" iki şeyi birden söylüyordu —
eğitmen red gerekçesini göremiyor **ve admin de girmiyor**. İkincisinin sebebi
ucun gövdesiz olmasıydı. Gerekçeyi zorunlu kılmak kaynağı kapatır; gerekçenin
eğitmene **gösterilmesi** ayrı bir üründür (model alanı + eğitmen ekranı) ve bu
paketin kapsamında değildir — bkz. §6 kalan borçlar.

### PK-İP4-2 — Retry idempotency sözleşmesi

Yeniden kuyruğa alma **koşullu tek UPDATE**'tir: `WHERE status = 'FAILED'`.

* İlk çağrı: `status=PENDING`, `attempts=0`, `next_attempt_at=now` → `requeued=true`
* İkinci çağrı: hiçbir satır etkilenmez → `requeued=false`, **200** (hata değil)
* `SENT` / `CANCELLED`: **409** — gönderilmiş bildirim ikinci kez gönderilmez
* Olmayan kayıt: **404**

`requeued` alanı yanıtta taşınır ve arayüz iki hâli **farklı metinle** söyler.
Her tıklamada "kuyruğa alındı" demek, operatörün işi kaç kez tetiklediğini
bilmemesi demektir.

**Sayaç neden sıfırlanıyor:** tavanda bırakılan bir iş worker'ın ilk turunda
yeniden tavana çarpar ve anında `FAILED`'a döner — retry hiçbir şey yapmamış
olur. Sıfırlama yöneticinin bilinçli kararıdır (`operations.manage`) ve denetim
izine yazılır. İkinci kez sıfırlanMAMASI ise at-least-once worker'da çift
gönderim penceresini kapatır.

**Denetim izi yalnız `requeued=true` iken yazılır:** idempotent no-op'u
kaydetmek izi anlamsız tekrarla doldururdu.

### PK-İP4-3 — "Elle iade et" düğmesi YOK

Sıkışmış para ekranı **salt okunurdur**. İade kararının tek sahibi
`services/escrow.py`'nin iki fazlı claim'idir (İP-2a sözleşmesi); yönetici
yüzeyinden ikinci bir para yolu açmak o güvenliği geri alır. Ekran bunun yerine
**sağlayıcı referansını** öne çıkarır — yöneticinin yapacağı iş sağlayıcı
panelinde mutabakattır.

### PK-İP4-4 — Kuyruk gürültüsüz

Sıkışmış para kuyruğuna yalnız `refund_attempts >= REFUND_MAX_ATTEMPTS` olan
`REFUNDING` kayıtlar ve kalıcı `MANUAL_REVIEW` kayıtlar girer. Taze bir
`REFUNDING` alarm değildir; reconciler onu dakikalar içinde sonuca sürer.

### PK-İP4-5 — Ham `payload` dönmez (KVKK)

Dead-letter listesi whitelist projeksiyonu uygular: `id`, `kind`, `status`,
`attempts`, `last_error`, `order_id`, zaman damgaları. `payload` alıcının
telefonunu/e-postasını taşır ve teşhis için gerekmez. Aynı disiplin İP-3'ün
`services/delivery_timeline.py`'sinde de uygulanıyor.

### PK-İP4-6 — Fail-closed erişim

`adminAreaAccess(undefined, …)` artık kapalıdır. `AdminSidebar` da aynı
sözleşmeye çekildi.

**Neden bedeli yok:** `ProtectedRoute` admin ekranlarını `/auth/me` çözülene
kadar hiç render etmez ve `/auth/me` `admin_permissions`'ı her zaman döndürür
(`schemas/user.py` varsayılanı `[]`). `undefined` yalnız eski persist edilmiş
bir oturumda görülür — orada da doğru davranış "aksiyonu gösterme"dir.

**Fail-open'ın gerçek bedeli:** `lib/queryClient.ts` 403'ü bildirimden muaf
tuttuğu için yetkisiz yönetici yıkıcı butona basıp **hiçbir şey olmadığını**
görüyordu. "Karar backend'de" doğruydu ama karar kullanıcıya ulaşmıyordu.

### PK-İP4-7 — Ekran, `AdminSectionPage` bölümü değil birinci sınıf sayfa

Görev tanımı "Hata Çözme sekmesi"ni `AdminSectionPage`'e yeni bir `section`
olarak geçirmeyi öneriyordu. Ekran bunun yerine `pages/admin/AdminOperationsPage.tsx`
olarak, modern admin sayfalarının (`AdminPayoutsPage`, `AdminSettingsPage`)
desenine göre yazıldı.

**Gerekçe:** `AdminHome.tsx` bu paketin **küçülttüğü** legacy yüzeydir (ölü
"overview" dalı silindi). Yeni bir operasyon ekranını oraya koymak, az önce
temizlenen dosyayı yeniden büyütür ve `admin/ui` tasarım diliyle legacy stil
karışır. Teslim edilen yetenek aynıdır: `/yonetim/hata-cozme`, `operations.view`
ile kapılı menü öğesi, deep-link'lenebilir rota. `AdminSectionPage` prop tipi
yine de genişletildi (`Exclude<Tab,"overview">` → `Tab`) — dışlamanın kendisi
P1-1'in mekanizmasıydı.

---

## 3. Yeni uçların izin sözleşmesi

| Uç | İzin | Yazma? |
|---|---|---|
| `GET /admin/escrow/stuck` | `operations.view` | Hayır (salt okunur) |
| `GET /admin/outbox/failed` | `operations.view` | Hayır (salt okunur) |
| `POST /admin/outbox/{id}/retry` | `operations.manage` | Evet (idempotent, denetim izli) |

İzinler `core/admin_permissions.py` katalogunda (grup: **Platform**) ve
migration `ip4_operasyon_izinleri` ile DB'de. Rol dağıtımı:

| Rol | `operations.view` | `operations.manage` |
|---|---|---|
| SUPER_ADMIN | ✔ | ✔ |
| COMMERCE_MANAGER | ✔ | — |

**`payments.*` neden yeniden kullanılmadı:** hakediş ödemesi kaydetmek ile
sarkan bir sağlayıcı iadesini incelemek farklı işlerdir ve ikincisi SMS/e-posta
yeniden gönderimini de kapsar. `inventory.*` ve `packing.*` ile aynı gerekçe.

**Görev ayrılığı:** kuyruğu **gören** kişi tek başına geri alınamaz dış yan
etki **tetikleyemez**. Bu yüzden `manage` yalnız SUPER_ADMIN'de.

---

## 4. Mutasyon kataloğu ve sonuçları

Sürücü: `scratchpad/ip4_mutation_drill.py`. TB-14 #7'nin işaret ettiği üç eksiği
kapatır: **(a)** geri dönüş SHA-256 ile doğrulanır, **(b)** mutasyondan önce
yeşil taban çizgisi alınır, **(c)** hedef metin dosyada **tam olarak bir kez**
geçmelidir. Kirli çalışma ağacında başlamayı reddeder ve `git checkout --`
KULLANMAZ — geri dönüş bayt yedeğinden yazılır.

| # | Mutasyon | Hedef node | Taban | Mutant | Sonuç | SHA eşit |
|---|---|---|---|---|---|---|
| M1 | Onayla butonunun `onClick`'i kaldırıldı | A-3 | 0 | 1 | **YAKALANDI** | ✔ |
| M2a | Red gerekçesi zorunluluğu (frontend `required`/`minLength`) kaldırıldı | A-4 | 0 | 1 | **YAKALANDI** | ✔ |
| M2b | Red gerekçesi şeması (backend `TutorRejectIn`) devre dışı | A-6 | 0 | 1 | **YAKALANDI** | ✔ |
| M3 | `/admin/escrow/stuck` izin duvarı kaldırıldı | B-4 | 0 | 1 | **YAKALANDI** | ✔ |
| M4 | `ConfirmDialog` atlanıp doğrudan `mutate()` (ürün silme) | C-1 | 0 | 1 | **YAKALANDI** | ✔ |
| M5 | `isError` kontrolü kaldırıldı (AdminStore iadeler) | D-1 | 0 | 1 | **YAKALANDI** | ✔ |
| M6 | `refund_status` enum bağı ham `str`'ye gevşetildi | E-1 | 0 | 1 | **YAKALANDI** | ✔ |
| M7 | `adminAccess` fail-open'a döndürüldü | F-1 | 0 | 1 | **YAKALANDI** | ✔ |

Kaçan yok. Prova sonunda çalışma ağacı **temiz** ve sekiz dosyanın da SHA-256'sı
başlangıçtakiyle **aynı**.

**Sürücünün kendi bulduğu kusur:** ilk koşumda beş mutasyon "HEDEF YOK" verdi —
depo CRLF'e normalize ediyor, desenlerdeki LF eşleşmiyordu. (c) guard'ı olmasa
prova **sessizce hiçbir şey ölçmez** ve sekizde beşi "yakalandı" diye
raporlanırdı. Bu, TB-14 #7(c)'nin neden gerçek bir borç olduğunun canlı örneği.

---

## 5. Test altyapısı ve bulunan kusurlar (§I)

### Yeni dosyalar

| Dosya | Sınıf |
|---|---|
| `backend/tests/integration/test_ip4_admin_operations_pg.py` | Gerçek PostgreSQL + gerçek HTTP (21 test) |
| `backend/tests/integration/ip4_factory.py` | Fabrika (İP-2a `IadeFabrikasi`'ndan türer) |
| `frontend/src/pages/dashboards/adminTutorApproval.acceptance.test.tsx` | Gerçek DOM + gerçek tıklama + gözlenen istek (13) |
| `frontend/src/pages/dashboards/adminSafetyStates.acceptance.test.tsx` | Aynı sınıf (23) |
| `frontend/src/pages/admin/adminOperations.acceptance.test.tsx` | Aynı sınıf (10) |

Snapshot yok, "import oldu / render oldu" testi yok, `vi.mock` yok. Frontend
testleri gerçek `apiClient` örneğini kullanır; yalnız **adapter** değiştirilir —
böylece interceptor zinciri, query key'ler ve gerçekten gönderilen gövde ölçülür.

### Kendi testlerimde bulunan ve düzeltilen kusurlar

1. **B-3 idempotency iddiası yanlış sayıyordu.** `once` sayacı tohumlanan satırı
   zaten içeriyordu; beklenen `once + 1` değil `once` olmalıydı. İddia
   **güçlendi** (retry HİÇ yeni satır üretmemeli), zayıflamadı.
2. **İki operasyon testi kırılgan bekliyordu.** Bölüm başlığı veriden bağımsız
   basıldığı için `findByRole("heading")` sonrası senkron `getByText` yükleme
   penceresinde yalancı kırmızı veriyordu. Artık önce satırın kendisi beklenir.
   (Görev tanımının uyardığı `inventoryScreens` zamanlama deseni bilinçli olarak
   **kopyalanmadı**; `waitFor` yalnız bir yerde, kullanıcı olayı sonrası
   kullanılıyor.)
3. **"Sipariş #77" iddiası iki satırda birden eşleşiyordu** — ilgili `<li>`
   içine daraltıldı.
4. **D-node'larında `findByText` çoklu eşleşmeyle patlıyordu:** ortak
   `ErrorState` hem başlık hem açıklama basıyor. `findAllByText`'e çevrildi;
   iddianın ağırlığı zaten ikinci satırdadır (boş-durum metni görünmemeli).
5. **`ip2a_factory.Siparis` alan adı** `id` değil `order_id` — ilk yazımda
   yanlış kullanılmıştı, `AttributeError` ile kırmızıydı. Bu "sahte kırmızı"
   düzeltildi (§E: yanlış sebeple kırmızı bir test kanıt değildir).

### Ölçüm sırasında bulunan altyapı tuzağı

**Aynı test veritabanına iki pytest oturumu paralel koşturulamaz.** İP-3 taban
ölçümü arka planda koşarken İP-4 matrisi de aynı `adana_ip4_test`'e koştu;
hijyen nöbetçisi `clients: 1→2, libraries: 1→0, library_operators: 1→0` bildirdi
— gerçek bir sızıntı değil, **iki oturumun birbirinin sayaçlarını görmesi**.
Arka plan koşumu durduruldu, artık satır elle temizlendi, sonraki ölçümler
sıralı yapıldı. TB-9'un akrabası ama ondan farklı bir tuzak; kayda geçirilmesi
için bkz. §6.

---

## 5b. Kapanış ölçümleri

Hepsi gerçek PostgreSQL'e karşı (`POSTGRES_DB=adana_ip4_test`, tek kullanımlık).
**Redis kapalıydı** — `core/ratelimit` ve `token_denylist` bilinçli fail-open
olduğu için testler etkilenmez; log'da bağlantı uyarıları görünür.

| Koşum | Sonuç |
|---|---|
| `pytest tests/integration -k ip2a` | **49 passed** — değişmedi |
| `pytest tests/integration -k ip3` | **115 passed** — değişmedi |
| `pytest tests/integration -k ip4` | **21 passed** |
| `pytest tests/integration` (tam) | **1124 passed, 16 skipped, 0 failed** |
| `pytest tests/acceptance` | **197 passed** |
| `pytest tests` (birim, integration/acceptance/verify hariç) | **685 passed** |
| `ruff check .` | temiz |
| `npm run test` (Vitest) | **73 dosya / 744 test** (taban 70/697) |
| `npx tsc -b` · `npx eslint` | temiz |
| Yeni DOM dosyaları × 5 tekrar | 5/5 yeşil — **flaky yok** |
| Alembic | tek head `ip4_operasyon_izinleri`; boş tek kullanımlık DB'de `upgrade head` + `downgrade -1` doğrulandı |
| `git diff --check` | temiz |

**İP-4'ün kendi hijyen deltası: SIFIR.** `-k ip4` koşumu öncesi/sonrası
`outbox_events`, `notifications`, `audit_logs`, `tutors`, `clients`,
`admin_roles` sayıları birebir aynı (10/4/0/0/0/5 → 10/4/0/0/0/5). Test
veritabanında kalan `outbox_events: 10` + `notifications: 4` **TB-8'de belgeli
mevcut kalıntıdır** (teslimat/stok paketlerinden, tur başına tam bu delta);
İP-4'ün deltası değildir.

### Bulunan yalancı kırmızı (İP-4 kaynaklı DEĞİL)

`tests/test_production_guard.py::test_guvenli_uretim_yapilandirmasi_gecer`,
kabukta `ADMIN_PASSWORD=change-this-admin-password` **export edilmişken** düşüyor.

* Dosya İP-4'te **hiç değişmedi** (0 satır).
* Sebep: `_settings()` `Settings(_env_file=None, …)` kullanıyor. `_env_file=None`
  `.env` **dosyasını** devre dışı bırakır ama **ortam değişkenlerini bırakmaz**;
  pydantic-settings zayıf varsayılan parolayı ortamdan okur ve üretim guard'ı
  onu **doğru biçimde** reddeder (aynı değer `:78`'de zaten guard tetikleyicisi
  olarak parametrize edilmiş).
* Başka bir `ADMIN_PASSWORD` değeriyle test anında geçiyor; hiç ayarlı değilken
  de geçiyor (**685 passed**).
* Neden önemli: entegrasyon testlerini `backend/tests/integration/conftest.py`'nin
  **belgelediği** biçimde (env değişkenlerini komut satırında vererek) koşan her
  geliştirici aynı kabukta bu yalancı kırmızıyı görür.
* Düzeltme İP-4 kapsamı dışında bırakıldı (guard sözleşme dosyasına bu pakette
  dokunmak sessiz kapsam kayması olurdu) → [[TB-18]].

---

## 6. Kalan borçlar (P2)

| # | Kayıt | Yer | Sonraki adım |
|---|---|---|---|
| 1 | **Red gerekçesi eğitmene GÖSTERİLMİYOR** | `Tutor` modeli · eğitmen paneli | Gerekçe bugün yalnız `audit_logs`'ta. Eğitmenin görmesi için kalıcı bir alan (`Tutor.rejection_reason` ya da bir durum-geçmişi tablosu) + eğitmen ekranı gerekir. Denetim raporu eksik akış 6'nın **ikinci yarısı**; kaynağı (admin girmiyordu) bu pakette kapandı |
| 2 | **Sıkışmış para kuyruğu sayfalanmıyor** | `admin_operations_service.list_stuck_escrow` | Beş model tam taranıyor, tavan yok. Bugün gerçekçi: kuyruk tanım gereği küçük (otomatiğin çözemediği kayıtlar). Kuyruk büyürse asıl sorun kuyruğun kendisidir — ama `limit/offset` yine de eklenmeli |
| 3 | **`AdminHome` hâlâ üç ayrı ekranı taşıyor** | `pages/dashboards/AdminHome.tsx` | Ölü dal silinince 805 → ~660 satır. İlan/diploma/ad-değişikliği ayrı sayfalara bölünmeli (modern `pages/admin/*` deseni) |
| 4 | **Paralel pytest oturumu tuzağı belgesiz** | `tests/integration/conftest.py` hijyen nöbetçisi | Nöbetçi, aynı DB'ye ikinci bir oturum bağlıyken yanıltıcı rapor veriyor. Ya advisory-lock ile ikinci oturum reddedilmeli ya da mesajda bu olasılık anılmalı |
| 5 | **`ADMIN_NAV_ITEMS` dizi sırası grup sırasıyla aynı değil** | `adminNavigation.ts` | Yeni öğe eklerken doğru yeri bulmak elle; yapısal nöbetçi yok. (Mevcut hâli doğru; kırılganlık kayda geçiyor) |
| 6 | **`getErrorDetail` testi yok** | `lib/errors.ts` | Yeni saf yardımcı; davranışı üç DOM testinde dolaylı ölçülüyor ama kendi birim testi yok |

**Kapsam dışı bırakılan ve DOKUNULMAYANLAR** (görev tanımı gereği): TB-15
(`_out_of_stock_refund`, `complete_checkout` geç-tahsilat) · KDV/fatura ·
kütüphane kontenjanı · React 19 / npm audit daraltması (TB-16) ·
`escrow_reconciler` para mantığı (yalnız `_REFUNDING_TARGETS` **okundu**).

---

## 7. Denetim raporundan sapmalar

1. **P1-5 kısmen kapalıydı.** Raporun adlandırdığı satır (`AdminStore.tsx:735`
   `refund.mutate(o.id)`) İP-2b turunda `ReasonDialog`'a bağlanmıştı. Matris
   aynı dosyadaki üç yaşayan örneğe (ürün silme, kategori silme, "Teslim
   edildi") taşındı ve gerekçesi §1/C'de yazılı.
2. **P1-6'nın `AdminPayoutsPage:168-176` referansı `PendingList`'i gösteriyor**,
   ama orada `isError` **zaten vardı**. Gerçek boşluk `HistoryList`'teydi
   ("Henüz ödeme kaydı yok." — raporun alıntıladığı metin de oradan). Node o
   yüzeye kuruldu.
3. **E-1b matrise eklendi** (raporda/TB-14'te yok) — gerekçe §1/E.
