# İP-12 · Mağaza Panel Yüzeyi — Kabul Sözleşmesi

> Paket: İP-12 (`ip12-magaza-panel`) · Taban `ff9eb1d` → `1fa89ba` (doküman merge'ü)
> Kaynak: `docs/panel-arastirmasi.md` A grubu (A1–A7, A9–A12)
> Tarih: 7–8 Ağustos 2026

Bu paket öncekilerden farklı bir başarısızlık sınıfına bakıyor. Önceki
paketler para/veri sözleşmesiydi; kusur DB'de görünürdü. Bu paket tamamen
**arayüz** ve buradaki tipik yalancı yeşil şudur: ekran render edilir, test
elementi DOM'da bulur, ama filtre hiçbir şeyi filtrelemez — çünkü parametre
sunucuya **hiç gitmez**. Bu yüzden her filtre/sayfalama/sıralama node'u sahte
adapter'ın `istekler` dizisinden **gerçekten gönderilen** sorgu parametresini
okur; "element var mı" tek başına hiçbir yerde kanıt sayılmadı.

---

## 1. Bölüm 2 ölçümü ve rapordan farklar

Rapor iki yerde iyimser çıktı; **ikisi de kapsamı büyüttü**.

| # | Rapor ne diyordu | Ölçüm ne buldu |
|---|---|---|
| (c) | A6/§5.2: "`search_products` yayınevi/yazarı **zaten destekliyor**, admin listesine bağlanması yeter" | Yalnız **public** uç için doğru. `GET /store/admin/products` ayrı bir servis fonksiyonuna (`list_products_admin`) bağlı ve yalnız `limit`+`offset` alıyordu; `q`, filtre ve toplam **yoktu**. Public uca yönlendirmek de çözüm değil: o `status == ACTIVE` zorluyor, yönetim listesi taslak/gizli göstermek zorunda. **A1 ve A6 büyüdü.** |
| (g) | A3: "dashboard **zaten** `stock <= 5` kullanıyor — aynı sabite bağlanmalı" | Eşik **üç** yerde bağımsız gömülüydü: `admin_service.py:171`, `ProductDetailPage.tsx:33` (`LOW_STOCK = 5`), dashboard kart açıklaması. **A3'ün "tek kaynak" hedefi üçünü birden toplamayı gerektirdi.** |

Doğrulanan iddialar: §5.1 (ISBN/SKU vektörde yok; trigram kolu yalnız `title`) ·
§6/Y3 (iki uç da `limit=100`, istemci `offset` göndermiyor) · A7 (`?status=` ve
`useAdminOrders(statusFilter)` hazır, `OrdersPanel` argümansız çağırıyor) ·
§6/Y4 (ham enum basılıyor) · (h) iki dashboard linki de yanlış.

### Ölçümün kendi bulduğu: üç ayrı kimlik

Rapor bunları ayırmıyordu; A5 için sözleşmeye girdi:

| Alan | Ne | Nereden gelir |
|---|---|---|
| `isbn` | Kitabın yayıncılık kimliği | insan girdisi |
| `barcode` | **Elimizdeki fiziksel kalemin üzerinde okunan** EAN-13/UPC | insan girdisi; `isbn`'den **asla kopyalanmaz** (modeldeki gerekçe: kitap olmayan üründe EAN var ISBN yok; set ürünün barkodu içindekilerden farklı; bazı baskılar promosyon barkodu taşır) |
| `sku` | **Bizim** stok kalemi kimliğimiz (`FZK-000042`) | `products_sku_autofill` BEFORE INSERT trigger'ı; verilen değer **ezilir** |

### Diğer ölçümler

- **(f)** `search_vector` = `Computed(persisted=True)`, `to_tsvector('simple', tr_normalize(title+description+author+publisher))`. Trigram: yalnız `ix_products_title_trgm`.
- **(i)** Sessiz kesilen listeler: `/store/admin/products` (tavan 200) ve `/store/admin/orders` (tavan 200). İlki bu pakette **sayfalamaya** geçti; ikincisine **kesilme uyarısı** eklendi (sayfalama kapsam dışı).
- **(j)** Ham ID girdileri: `CountSessionsPage` ("Ürün numaraları", virgülle ayrılmış) ve `DamageDialog` (`type="number"`). İkisi de A12 ile kaldırıldı.

### Kaynak doküman

`docs/panel-arastirmasi.md` paket başında **çalışma ağacında yoktu**.
`stash@{0}`'ın *untracked* bölümünde (`stash@{0}^3`) bulundu — `git stash show`
untracked kısmı listelemediği için ilk bakışta görünmüyordu. Kurtarma ana
dizinde zaten yapılmış ve push edilmişti (`1fa89ba`); İP-12 worktree'sine
fast-forward merge ile alındı, içerik stash'tekiyle birebir aynı (480 satır).

---

## 2. FAZ 0 · TB-23

**Ölçüm boşta makinede yapıldı.** Ölçümden önce çalışan `scraper.py`, `uvicorn`
(+ multiprocessing worker) ve başka bir worktree'nin `vite` dev sunucusu
durduruldu — yüklü makinede ölçülen "en yavaş test" testi değil makine
durumunu ölçer ve onun 3-4 katı dar bütçe olmaz.

| Adım | Sonuç |
|---|---|
| Tam suite `--testTimeout=60000` (hiçbir test kesilmesin, gerçek süreler okunsun) | 74 dosya / 756 test **geçti**, 79.4 s |
| En yavaş test | **2409 ms** — TB-23'ün kaydettiği 2455 ms ile %2 fark, **kayıt doğrulandı** |
| 20. sıra | 591 ms (kuyruk hızlı; sorun birkaç ağır testte) |
| Seçilen bütçe | **9000 ms** |
| Yeni ayarla 5 tam koşum | **5/5 kez 74 dosya / 756 test**, 21.7–24.6 s |
| 5 koşumun tepe değeri | **2959 ms** — her koşumda aynı test: `PackageLabel` "print CSS'i etiketin GÖRÜNÜRLÜĞÜNÜ geri verir", yani TB-19/9'un kaydettiği testin ta kendisi |
| Marj | 9000 / 2959 = **3.04×** (3–4 kat aralığının içinde) |

**Neden TB-23'ün önerdiği 20000 alınmadı:** en yavaş testin 8.3 katı olurdu ve
2.4 s'lik bir testin 15 s'ye çıkmasını — gerçek bir performans regresyonunu —
sessizce yutardı. Bütçe testi kesmeyecek kadar geniş, regresyonu gizlemeyecek
kadar dar olmalı. Değer `vitest.config.ts`'te **tek yerde**; dosya başına ezme
yok (mevcut ezme de yoktu, doğrulandı).

**Dört flake kaydının durumu** (5/5 koşum, yeni bütçedeki payları):

| Dosya | Durum | En ağır testi | Bütçe payı | Eski 5000 ms'de |
|---|---|---|---|---|
| `PackageLabel.test.tsx` (TB-19/9) | 5/5 geçti | 2959 ms | %33 | %59 |
| `packingScreens.acceptance.test.tsx` | 5/5 geçti | 2222 ms | %25 | %44 |
| `inventoryScreens.acceptance.test.tsx` (TB-14/8) | 5/5 geçti | 1786 ms | %20 | %36 |
| `packingLabel.acceptance.test.tsx` | 5/5 geçti | 1797 ms | %20 | %36 |

Borç defteri kendi kuralını uyguladı: **TB-23, TB-19/9 ve TB-14/8 silindi**,
yerlerine kapanma notu bırakıldı. TB-23'ün (2) numaralı sonraki adımı —
"bu testlerin neden saniyeler sürdüğünü ayrıca incelemek" — **yapılmadı** ve
kapsam dışıdır; bütçe gerçeğe yaklaştırıldı, testler hızlandırılmadı (P2).

---

## 3. Kırmızı matris

**57 node, 56'sı kırmızı başladı.** Üç dosya:

| Dosya | Node | Tür |
|---|---|---|
| `backend/tests/integration/test_ip12_urun_listesi_pg.py` | 23 | gerçek PostgreSQL + gerçek HTTP + gerçek yetki çözümü (dependency override yok) |
| `frontend/src/pages/dashboards/adminStorePanel.acceptance.test.tsx` | 30 | gerçek DOM + gerçek istek gövdesi |
| `frontend/src/pages/admin/inventory/ip12ProductPicker.acceptance.test.tsx` | 5 | gerçek DOM + gerçek istek gövdesi |

Kırmızı başlamayan tek node **P-2'nin sunucu yarısı** ve bu **beklenen**:
`limit`/`offset` uçta zaten vardı, eksik olan istemcinin göndermesiydi. P-2'nin
kırmızı yarısı DOM matrisinde yaşıyor ("yeni istek gitti mi + offset arttı
mı"); backend node'u uygulama sırasında sunucu yarısının bozulmadığını
garanti eden nöbetçidir. Gerekçe testin docstring'inde yazılı.

### Kırmızı matriste bulunan dört yalancı yeşil

FastAPI tanımadığı query parametresini **sessizce yok sayar**. Dolayısıyla
"filtre yok" durumunda tüm katalog döner ve yalnız pozitif iddia soran bir
test (*X listede var mı*) kendiliğinden geçer. CLAUDE.md §E'nin sorusu —
"eski bozuk kod da aynı testi geçer miydi?" — üçünde **evet**ti:

| Test | Kusur | Düzeltme |
|---|---|---|
| `test_f7b_yayinevi_turkce_normalize` | yalnız pozitif iddia | negatif kontrol: başka yayınevi listede **olmamalı** |
| `test_a1b_diakritik_duyarsiz` | yalnız pozitif iddia | negatif kontrol: alakasız ürün listede **olmamalı** |
| `test_f_taslak_urun_admin_listesinde_kalir` | filtre uygulanmasa da geçerdi | **iki** şey birden istiyor: filtre gerçekten uygulanmalı **ve** taslak kalmalı |
| `test_p2_offset_gercekten_kaydiriyor` | meşru yeşil (yukarıda) | docstring'e dürüstlük notu |

---

## 4. Sunucu sayfalamasının gerçekten sunucuda olduğu kanıtı

İki katmanda ölçülüyor:

1. **Sunucu (PG):** `test_p2_offset_gercekten_kaydiriyor` — aynı `limit` ile iki
   farklı `offset`, **kesişmeyen** kayıt kümesi döndürüyor.
2. **İstemci (DOM):** "sonraki sayfa YENİ bir istek üretir ve offset ARTAR" —
   `istekler` dizisinden `/store/admin/products` çağrılarının **sayısı** ve son
   isteğin `offset` parametresi okunuyor. Ayırt edici ölçüt bu: istemci
   dilimlemesi yapan bir uygulama DOM'da aynı sonucu üretir ama **yeni istek
   üretmez**. Mutasyon M1 bunu doğruladı.

Toplam kayıt `X-Total-Count` başlığıyla dönüyor ve **ayrı bir COUNT** ile
hesaplanıyor; sayım ve sayfa sorgusu aynı WHERE yardımcısını (`_admin_filtreleri`)
paylaşıyor — ayrı olsalardı "120 kayıt" yazıp 3 satır gösteren bir liste
mümkün olurdu. `test_p3b` bunu ölçüyor (limit toplamdan küçük seçilip eşitlik
aranıyor; uç `len(rows)` döndürerek geçemez).

Sıralamada ikincil anahtar `id`: eşit fiyatlı/stoklu satırlarda sıra
deterministik olmalı, yoksa sayfa 1 ile 2 aynı kaydı gösterebilir ya da bir
kayıt hiç görünmeyebilir.

---

## 5. LOW_STOCK_THRESHOLD tek kaynak

`backend/core/stock_policy.py` — değer **yalnız burada**. Frontend kendi
kopyasını tutmuyor, `GET /store/config` ile **okuyor**.

**Kova tanımı da tek yerde.** Uygulama sırasında ölçülen gerçek çatışma:
dashboard sayacı `stock <= eşik` diyor (stoğu 0 olanı **da** sayıyor), ama
`azalan` bilerek `0 < stock` — F-2'nin sözleşmesi: *"stoğu 0 olan 'azalan'
değil 'tükendi'dir; biri yeniden sipariş, diğeri acil"*. Kart `?stok=azalan`a
bağlansaydı **sayı ile liste farklı küme gösterirdi** — P-9'un engellemek için
var olduğu sapmanın ta kendisi.

Kullanıcı kararıyla üçüncü bir filtre değeri eklendi:

| Değer | Tanım |
|---|---|
| `tukendi` | `stock <= 0` (yalnız fiziksel) |
| `azalan` | `0 < stock <= eşik` |
| `var` | `stock > eşik` **veya** dijital |
| **`kritik`** | `stock <= eşik` — `tukendi` + `azalan` **birleşimi**; dashboard "Düşük stok" kartının saydığı kümenin tam karşılığı |

Kart artık `?stok=kritik`e gidiyor: sayı ile liste **aynı küme**.
`test_p9_dashboard_ayni_esigi_kullanir` bunu davranışla ölçüyor. Kapsam farkı
bilinçli ve testte hesaba katılı: dashboard yalnız `ACTIVE` sayar (kart metni
öyle diyor), yönetim listesi katalogun tamamını gösterir.

Bu, görev tanımının F-5 maddesinden (`?stok=azalan`) **gerekçeli sapmadır**.

---

## 6. ISBN arama kuralı

`services/store_service.py::_arama_kolu` — admin ve vitrin **paylaşır**
(ISBN'i yalnız yönetim tarafına eklemek iki arama yüzeyini ayırırdı).

| Girdi | Dal | Gerekçe |
|---|---|---|
| **Tam 13 haneli** saf rakam | `isbn == q OR barcode == q` — trigram **kapalı** | ISBN'de "yakın eşleşme" yoktur, komşu ISBN **başka bir kitaptır**. Trigram tam tersini yapar: `...567` ile `...568` üç-gram düzeyinde neredeyse aynı. Okutulan barkodun yanlış kitabı getirmesi, aramanın hiç çalışmamasından kötüdür. |
| **4–12 haneli** saf rakam | `isbn LIKE 'q%' OR barcode LIKE 'q%'` — **önek** | Yayınevi öneki (`978605…`) kitapçının gerçek daraltma ekseni; barkod okuyucu bazen eksik okur. **Önek, benzerlik değil**: ISBN ortasından bir parça (`0512`) anlam taşımaz ve eşleşmez (`test_a6` bunu ölçüyor). |
| **1–3 haneli** rakam | metin dalı | `978` kataloğun tamamına yakınını döndürür, hiçbir şey daraltmaz |
| `FZK-000042` deseni | `upper(sku) == upper(q)` | SKU tekildir, benzerliğe bırakmanın anlamı yok |
| Diğer | `search_vector @@ tsquery OR title % q` | trigram yazım hatası toleransı sağlar ("matematık") |

---

## 7. search_vector migration'ı ve backfill kararı

`ip12_urun_arama_vektoru` (`revises: ip5_siparis_vergi_kirilimi`).

İfade `title+description+author+publisher` → **+ `isbn` + `sku`**. PostgreSQL
üretilmiş kolonun ifadesini `ALTER` ile değiştirmeye izin vermediği için
**DROP + ADD**; GIN index kolonla birlikte düşüp yeniden kuruluyor. Ayrıca
`ix_products_isbn`.

**Backfill otomatik ve bilinçli:** üretilmiş kolon eklendiğinde PostgreSQL tüm
satırlar için değeri kendisi hesaplar (ayrı UPDATE yok). Güvenli, çünkü vektör
**türetilmiş** veridir — kaynak kolonlar değişmediği için bilgi kaybı
imkânsız, yalnız türev yeniden üretiliyor; katalog ayrıca küçük.
`downgrade` aynı yolla **eski ifadeyi geri kurar**, dönüş kayıpsız.

Doğrulama (boş DB'de): `upgrade → downgrade -1 → upgrade` ✅ · tek head ✅ ·
`alembic check` → **"No new upgrade operations detected."** ✅ · index **modele
de** eklendi (İP-5'te bu bir P1'di, tekrarlanmadı).

**Not — vektör değişikliğinin nöbetçisi ayrı bir node:** `_arama_kolu`'nun
kimlik dalları ISBN/SKU'yu **doğrudan kolondan** okur ve vektöre hiç uğramaz;
yani A-3 ve A-4, migration geri alınsa bile geçerdi. Vektörü HTTP'den zorlamak
için çok kelimeli sorgu denendi ("geometri 978…") ama o sorguda trigram kolu
başlık benzerliğiyle eşleşme üretip iddiayı **maskeledi** — test vektörsüz de
geçiyordu. Vektörün içeriği yapısal bir iddia olduğu için artık doğrudan SQL
ile ölçülüyor (`search_vector @@ to_tsquery(...)`); davranış tarafını
A-3/A-4/A-7 taşıyor.

---

## 8. Türkçe durum etiketleri

`frontend/src/lib/orderStatus.ts` — `orderPayment.ts`'in kardeşi.

| Enum | Etiket | Ton | Neden |
|---|---|---|---|
| `PENDING` | Ödeme bekliyor | warning | |
| `PAID` | Hazırlanacak | **info** | Ödenmiş sipariş bir **iş**tir; yeşil iş bittiğinde gelir |
| `SHIPPED` | Kargoda | info | |
| `DELIVERED` | Teslim edildi | success | |
| `CANCELLED` | İptal edildi | neutral | |
| `REFUNDED` | İade edildi | danger | |

Bilinmeyen durum **ham** basılır: yeni bir durum eklendiğinde ekranın boş
hücre göstermesi, yanlış etiketten kötüdür. Ödeme etiketleri mevcut
`ORDER_PAYMENT_LABELS`'tan; yalnız ton eşlemesi eklendi.

---

## 9. Mutasyon kataloğu

Sürücü: `scratchpad/mutasyon.ps1` — kirli ağaçta **başlamaz**, `git checkout --`
**kullanmaz** (byte kopyası + geri yükleme), her mutasyondan sonra **SHA-256**
ile dosyanın başlangıç hâline döndüğünü doğrular, "hedef bulunamadı" =
**başarısızlık**.

**12/12 yakalandı. Ağaç temiz kaldı.**

| # | Mutasyon | Node |
|---|---|---|
| M1 | sayfalama parametresini istemciden kaldır | P-2 |
| M2 | `X-Total-Count` dönüşünü kaldır | P-3 |
| M3 | `stock` alanını `ProductSearchOut`'tan çıkar | P-5 |
| M4 | eşiği ikinci bir sabite ayır (`<= 3`) | P-9 |
| M5 | stok filtresini sunucuda yok say | F-1/F-2/F-3 |
| M6 | dashboard linkinden filtreyi çıkar | F-5 |
| M7 | ISBN'i kimlik dalından çıkar | A-3 |
| M8 | 13 hane yönlendirmesini kaldır | A-5 |
| M9 | sipariş durum filtresini hook'a geçirme | O-1 |
| M10 | `Badge` yerine ham enum bas | O-4 |
| M11 | "sonuç yok" varyantını kaldır | E-3 |
| M12 | kesilme uyarısını kaldır | E-4 |

**İlk turda üçü kaçtı; sebepleri ayrı ayrı dürüstçe kaydedildi:**

- **M6, M9 — sürücünün kendi kusuru.** Test adlarını Türkçe karaktersiz
  yazmıştım (`"Dusuk stok"`, `"durum secimi"`); `-t` hiçbir teste uymadı,
  **sıfır test koştu** ve exit 0 döndü. Yani "kaçtı" sonucu testin
  zayıflığını değil sürücünün yanlış hedeflemesini ölçüyordu. Bu tam olarak
  sürücünün "hedef bulunamadı = başarısızlık" kuralının test seçici tarafında
  da gerekli olduğunu gösteriyor.
- **M7 — gerçek eşdeğer mutasyon.** Tam eşleşme dalını silmek davranışı
  bozmuyordu: akış bir alttaki **önek** dalına düşüyor ve
  `isbn LIKE '<13hane>%'` aynı tek kaydı döndürüyordu. Bileşik varyantla
  değiştirildi (ISBN'i kimlik dalından tamamen çıkar, yalnız `barcode` kalsın)
  ve yakalandı.

---

## 10. Doğrulama sonuçları

| Koşum | Sonuç | Beklenen |
|---|---|---|
| `pytest tests/integration -k ip12` | **23 passed** | yeni |
| `-k ip5` | **47 passed** | 47 ✅ |
| `-k ip2a` | **49 passed** | 49 ✅ |
| `-k ip4` | **21 passed** | 21 ✅ |
| `-k ip1b` | **28 passed** | 28 ✅ |
| `-k f30` | **314 passed** | 314 ✅ |
| `pytest tests/integration` | **1222 passed, 16 skipped** (= 1238) | 1215 + 23 ✅ |
| `pytest tests/acceptance` | **197 passed** | 197 ✅ |
| `ruff check .` | All checks passed | |
| Frontend `vitest` | **76 dosya / 791 test** | taban 74/756 + 35 yeni ✅ |
| `tsc -b` | temiz | |
| `npm run lint` | **34 uyarı / 0 hata** | taban ile **birebir**; İP-12 tek uyarı eklemedi ✅ |
| `git diff --check` | temiz | |

Hijyen nöbetçisi sessiz (suite kalıcı satır bırakmadı).

### Uyarlanan komşu kabul testleri (sessiz değil, gerekçeli)

İkisinde de **davranış iddiaları aynen korundu**; değişen yalnız DOM'da
elemana erişme yöntemi:

- `adminSafetyStates.acceptance.test.tsx` (4 test) — ürün satırını
  `div.rounded-xl` ile buluyordu; A1 ile satır `<tr>` oldu. Bir yardımcıya
  alındı, seçici iki düzeni de kabul ediyor. 23/23.
- `inventoryScreens.acceptance.test.tsx` (7 çağrı noktası) — hasar
  diyaloğunda ham ID kutusuna "5" yazıyordu; A12 ile seçici geldi. Yardımcı
  eklendi, fixture'a arama ucu kondu (yanıt sorgudaki terimi ID olarak
  yorumluyor). 57/57.

### Kendi testlerimde bulunan ve düzeltilen kusurlar

Yukarıdaki dört yalancı yeşile ek olarak:

- Stok rozeti testleri filtre çubuğundaki `<option>Tükendi</option>` ile
  çakışıyordu — genel metin sorgusu seçeneği yakalayıp rozeti doğrulamış gibi
  görünüyordu. `within(tablo)`ya daraltıldı.
- "iki metin AYNI olamaz" testi `/ürün/i` ile "Ürün ara" etiketini
  yakalıyordu — `heading` rolüne çevrildi.
- Ürün seçici testleri **yanlış uca** bakıyordu (`/inventory/counts`; gerçeği
  `/inventory/count-sessions`) — test kendi yanlış fixture'ına bakıp "istek
  gitmedi" diyordu.
- Mutation asenkron olduğu için tıklamadan hemen sonra `istekler`e bakmak
  isteği yolda yakalıyordu → `waitFor`.
- Seçilenler listesi boşalınca bileşen render edilmiyor; **bayat DOM
  referansı** üzerinden sorgu "hâlâ duruyor" diyordu → ölçüm bölümün ekrandan
  kalkması oldu.
- `item_count` diye bir alan varsaymıştım; şemada yok, kalem sayısı `items`
  dizisinden okunuyor.

---

## 11. Kalan P2'ler

| # | Kayıt | Yer | Not |
|---|---|---|---|
| 1 | **A8 · sipariş tarih ön ayarları** | uç + `OrdersPanel` | Kapsam dışıydı: uca `created_at` aralığı gerekiyor (İP-13). "Bugün ne sattık" hâlâ gözle tarama. |
| 2 | **B1 · sipariş detay sayfası** | yeni ekran + `store.py` | Raporun "en büyük tekil boşluğu". Sipariş kuyruklardan düştüyse kalemlerini gösteren ekran yok. |
| 3 | **Sipariş listesinde sayfalama yok** | `/store/admin/orders` | Tavan 200; şimdilik **kesilme uyarısı** var. Sayfalama geldiğinde uyarı KALKMALI (E-5 nöbetçisi bunu koruyor). |
| 4 | B2 toplu işlem · B3 kayıtlı görünüm · B4 kolon seçici · B5 komut paleti | — | Kapsam dışı. |
| 5 | **TB-23'ün (2). adımı** | `PackageLabel` / `packing*` testleri | Bu testlerin neden saniyeler sürdüğü incelenmedi; bütçe gerçeğe yaklaştırıldı, testler hızlandırılmadı. |
| 6 | **Kısmi ISBN önek araması index kullanmıyor** | `_arama_kolu` | `LIKE 'x%'` normal btree'den yararlanamaz; bilinçli sadelik (katalog bu ölçekte). Büyürse `varchar_pattern_ops` index'i eklenecek yer migration dosyasında yazılı. |
| 7 | **Yerel PG'de 120+ test veritabanı birikmiş** | `postgresql-x64-17` | Önceki paketlerden kalma (`adana_ip5_test`, `adana_ip4_test`, …). Bu paketin kapsamı dışı ama disk ve envanter kirliliği; toplu temizlik bir karar bekliyor. |
| 8 | **Compose postgres container'ı hiçbir ağa bağlı değil** | `adana-ozel-ders-postgres-1` | Ayakta ama yalnız `docker exec` ile erişilebiliyor; TCP ile erişilemiyor. Gerçek geliştirme/test sunucusu yerel Windows PostgreSQL 17. Compose dosyasındaki `5433:5432` eşlemesi çalışan container'da yok — compose sonradan değişmiş olmalı. Kafa karıştırıcı; ya container yeniden yaratılmalı ya da compose gerçeğe uydurulmalı. |
