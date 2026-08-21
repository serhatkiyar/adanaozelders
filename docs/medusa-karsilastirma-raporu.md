# Medusa v2 vs Adana Özel Ders — Products & Inventory Karşılaştırma Raporu

Tarih: 2026-08-19 · Yöntem: her iki taraf da **kaynak koddan** okundu, dokümantasyondan değil.

Kısaltmalar:
- `M:` → `C:/Users/kiyar/Desktop/medusa2/node_modules/@medusajs/`
- `B:` → `C:/Users/kiyar/Desktop/adana-main/`

---

## 0. Temel mimari fark (her şeyin kökü)

| | Medusa | Bizde |
|---|---|---|
| Ürün↔varyant | **İki katmanlı**: `Product` 1—N `ProductVariant`. Fiyat/SKU/stok **varyantta**. Satılabilir birim daima varyanttır. | **Tek katmanlı (düz)**: her varyant kendi `products` satırıdır; `variant_group_id` + `option1_value`/`option2_value` ile kardeşlik kurulur. Fiyat/SKU/barkod/stok/slug her satırda. |
| Kaynak | `M:product/dist/models/product.js:18-178`, `product-variant.js:9-88` | `B:backend/models/store.py:289-553`; `variant_groups` 245-286 |

Bu fark rapordaki neredeyse tüm farkların sebebidir. Bizim modelimiz basit ve barkod/ISBN dünyasına daha uygun (her fiziksel ürünün kendi barkodu ve kendi katalog sayfası var); Medusa'nınki toplu fiyat/stok yönetimine daha uygun.

---

## 1. Karşılaştırma tablosu

### A. PRODUCTS

| Özellik | Medusa | Bizde | Not |
|---|---|---|---|
| Product entity | `product` — 20 kolon + ilişkiler (`M:product/dist/models/product.js:18-178`) | `products` — ~40 kolon (`B:backend/models/store.py:289-553`) | Bizde kitap künyesi (author/publisher/isbn/page_count/dimensions/publication_year/edition/language/cover_type), `kind`, `seller_type`, `tax_rate`, `damaged_stock`, `search_vector` gibi Medusa'da olmayan alanlar var |
| ProductVariant | Ayrı tablo: `sku/barcode/ean/upc`, `manage_inventory`, `allow_backorder`, `variant_rank` (`product-variant.js:9-88`) | **Ayrı tablo yok** — varyant = ürün satırı | Medusa'nın `manage_inventory` karşılığı bizde `stock IS NULL`; backorder yok |
| ProductOption / OptionValue | Serbest metin başlıklı, yeniden kullanılabilir varlıklar (`product-option.js:12-52`, `product-option-value.js:11-43`); 2.16+ Product↔Option N:N | **Kapalı sözlük**: `VARIANT_AXES` kod sabiti (8 eksen) + DB CHECK (`B:backend/models/store.py:230-239, 242, 273-285`) | Bizimki daha katı, veri kirliliğine kapalı; yeni eksen = kod + migration |
| Varyant kombinasyon matrisi (kartezyen) | **VAR** — frontend'de `getPermutations` (`M:dashboard/src/routes/products/product-create/components/product-create-details-variant-section.tsx:49-71`); `should_create` ile kombinasyon eleme + DataGrid'de toplu fiyat/SKU girişi | **YOK** — tek tek `derive_variant` (`B:backend/services/store_service.py:983-1087`, uç `api/routers/store.py:537-553`; UI `AdminStore.tsx:1092-1193`) | **Gerçek eksik.** Medusa'nın kendi hatası da not: her option değişiminde matris sıfırlanıp girilen fiyat/SKU siliniyor (aynı dosya `:241`) |
| Ürün oluşturma formu | **4 sekme**: DETAILS → ORGANIZE → VARIANTS → INVENTORY (`product-create-form.tsx:26-31`) | **Tek uzun form** + katlanır bölümler (`B:frontend/src/pages/dashboards/AdminStore.tsx:492-884`) | Farklı desen; başlı başına eksik sayılmaz |
| Liste kolonları | product, collection, sales_channels, variants, status (`use-product-table-columns.tsx:28-59`) | Başlık(+künye), **Stok rozeti**, Fiyat, Durum, Eklenme (`AdminStore.tsx:174-374`) | Stok kolonu bizde var, Medusa'da yok |
| Liste filtreleri | created/updated tarih, type_id, tag_id, sales_channel_id, status (`use-product-table-filters.tsx:15-104`) | q (başlık/yazar/yayınevi/ISBN/SKU), **stok durumu** (tukendi/azalan/var/kritik), yayınevi, yazar (`AdminStore.tsx:377-453`; backend `store_service.py:1512-1602`) | Farklı eksenler: bizimki envanter-odaklı, onlarınki merchandising-odaklı |
| Sıralama | title, created_at, updated_at | title, price, **stock**, created_at (`Literal` tipli — TB-19) | Bizde daha fazla |
| Toplu işlem (bulk action) | **YOK** (satır seçimi/CommandBar bulunamadı) | **YOK** | Berabere — ikisinde de eksik |
| Görsel yönetimi | Çoklu görsel, dnd sıralama (klavye dahil), thumbnail seç (kısayol `t`), **varyanta görsel atama iki yönlü** (`edit-product-media-form.tsx:72-96`, `edit-product-variant-media-form.tsx`) | **UI'da yalnız tek kapak** (`AdminStore.tsx:1209-1215`). Çoklu görsel API'si **var ama bağlanmamış** (`B:frontend/src/api/store.ts:389-411` hiçbir `.tsx`'ten çağrılmıyor); model `ProductImage` hazır (`store.py:556-571`) | **Gerçek eksik — ve yarısı zaten yazılmış** |
| Yayın durumu | draft/proposed/published/rejected, basit dropdown; **ön koşul/uyarı yok** (`edit-product-form.tsx:93-131`) | ACTIVE/HIDDEN/DRAFT/**PENDING**; admin serbest, eğitmen `status`'u hiç değiştiremez (`store_service.py:1302-1303, 1437-1439`) | Bizde moderasyon var, Medusa'da yok. Ön koşul kontrolü ikisinde de yok |
| CSV import | 3 aşama: yükle → **sadece "N oluşturulacak / N güncellenecek" özeti** → onayla. Hata = tek `MedusaError`, tüm import düşer; **satır bazlı hata raporu yok** (`M:core-flows/.../normalize-for-import.js`, `steps/parse-product-csv.js:37-40`; UI `product-import.tsx`) | Tek adım; **her satır kendi savepoint'inde**, sonuç `{created, skipped, errors:[{row,message}]}` (`B:backend/services/store_service.py:1090-1241`; UI `AdminStore.tsx:1330-1423`) | **Bizim import'umuz Medusa'nınkinden iyi.** Ama bizimki yalnız *oluşturur/atlar* — **güncelleme yapmaz** |
| CSV export | **VAR** — liste filtrelerini devralır, ürün+varyant satırları, `Product X`/`Variant X` önekli kolonlar (`M:core-flows/.../normalize-for-export.js`; UI `export-filters.tsx`) | **YOK** | Gerçek eksik |
| Kategori | `product_category`, materialized path (`mpath`), ağaç, `is_active`/`is_internal`/`rank` (`product-category.js:8-49`) | `product_categories`, `parent_id` **modelde var**, `default_tax_rate` mirası (`store.py:169-216`) — ama **admin UI düz liste, üst kategori seçilemiyor** (`AdminStore.tsx:1427-1503`) | Model hazır, UI yarım |
| Etiket (tag) | `product_tag` (`product-tag.js:8-26`) | **YOK** | |
| Ürün tipi (type) | `product_type` (`product-type.js:5-23`) | **YOK** (kategori üstleniyor) | |
| Koleksiyon | `product_collection` — admin küratörlüğü (`product-collection.js:8-26`) | `Collection`/`CollectionItem` var ama **müşteri tarafı liste** (`store.py:1162-1207`, `FavoritesPage.tsx`) | Aynı isim, farklı kavram |
| Satış kanalı / bölge / fiyat listesi | Var | Yok | Tek mağaza, tek para birimi |

### B. INVENTORY

| Özellik | Medusa | Bizde | Not |
|---|---|---|---|
| Stok nerede | **Ayrı modül**: `InventoryItem` + `InventoryLevel` (kalem×lokasyon) (`M:inventory/dist/models/inventory-item.js:9-45`, `inventory-level.js:8-38`) | **Ürün satırında iki sayı**: `products.stock` + `products.damaged_stock` | |
| Variant↔stok bağı | Link modülü `product_variant_inventory_item` + `required_quantity` (bundle desteği) (`M:link-modules/dist/definitions/product-variant-inventory-item.js:5-85`) | Doğrudan aynı satır | Bizde bundle/set kavramı yok |
| Miktar alanları | `stocked_quantity`, `reserved_quantity`, `incoming_quantity`; `available = stocked - reserved` (`M:inventory/dist/utils/apply-decorators.js:13-23`) | `stock` (satılabilir), `damaged_stock` (hasarlı). "Rezerve" **türetilmiş** (ödenmiş ama SHIPPED olmamış kalemler) | `incoming_quantity` karşılığımız yok (mal kabul akışı yok — `docs/f29-envanter-sozlesmesi.md` §10) |
| Çok lokasyon | **VAR**, tam destek; sales_channel↔stock_location bağı (`link-modules/.../sales-channel-location.js:5-79`) | **YOK — bilinçli karar** (`docs/f29-envanter-sozlesmesi.md` §10: tek fiziksel havuz) | |
| Rezervasyon (sipariş → stok kilidi) | `completeCartWorkflow` **ödemeden önce** `reserveInventoryStep` (`M:core-flows/dist/cart/workflows/complete-cart.js:534`, `steps/reserve-inventory.js:24-64`); eşzamanlılık **uygulama seviyesi dağıtık kilit** (`@medusajs/locking` — Postgres advisory / Redis), satır kilidi değil | Rezervasyon **yok**; düşüm **yalnız PAID anında**, `SELECT ... FOR UPDATE` + artan id sırası + oversell'de tam iade (`B:backend/services/order_service.py:874-1033`) | Farklı ama bizimki daha güçlü sınır: gerçek satır kilidi + idempotent claim |
| Stok düşümü ne zaman | Fulfillment oluşunca `stocked_quantity` düşer, rezervasyon silinir/azalır (`M:core-flows/dist/order/workflows/create-fulfillment.js:146-192, 378-395`) | Ödeme kesinleşince `SALE` hareketi (`order_service.py:1010-1032`) | |
| İptal/iade geri verme | `deleteReservationsByLineItemsStep` (`cancel-order.js:107-109`) | `SALE_CANCEL` / `RETURN` hareketleri + fazla-geri-yükleme guard'ı (`B:backend/services/stock_ledger.py:354-399`) | |
| **Stok hareket defteri** | **YOK.** Arandı, bulunamadı — yalnız anlık `InventoryLevel` + domain event'leri; kalıcı defter entegratöre bırakılmış | **VAR** — `stock_movements`: append-only trigger, `qty_after` zincir değişmezi, `idempotency_key`, 11 hareket tipi, actor/request izi (`B:backend/models/store.py:1244-1477`, tek yazıcı `services/stock_ledger.py`) | **Bizim en büyük üstünlüğümüz** |
| Sayım (stocktake) | **YOK** | **VAR** — `StockCountSession` FSM (DRAFT→IN_PROGRESS→REVIEW→APPLIED), satır olayları, maker-checker (`B:backend/models/inventory.py`, `services/inventory_service.py`) | |
| Hasarlı stok | **YOK** | **VAR** — `StockDamageEvent`, 4 fiil (TRANSFER/RECOVERY/DISPOSAL/SUPPLIER_RETURN) (`B:backend/services/inventory_damage.py`) | |
| Defter denetimi | **YOK** | **VAR** — `verify_ledger`/`audit_products`, bulgu kodlu (CHAIN_BREAK, STOCK_MISMATCH, OPENING_*…) | |
| Düşük stok uyarısı | Yok | **VAR** — tek kaynak eşik (`B:backend/core/stock_policy.py`); liste rozeti + filtre + dashboard sayacı aynı SQL yüklemini paylaşıyor | |
| Admin envanter ekranı | Liste (Title/SKU/Reserved/In stock), filtreler (location, material, sku, boyut…), **stok düzeltme drawer'ı** (mutlak değer, rezervenin altına inemez), lokasyon yönetimi, rezervasyon listesi/oluşturma, Locations ekranı (`M:dashboard/src/routes/inventory/`, `/reservations/`, `/locations/`) | İki yüzey: **Stok hareketleri** (`B:frontend/src/components/admin/StockMovementsPanel.tsx`, `/yonetim/magaza/stok-hareketleri` — filtre + "Defteri denetle") ve **Envanter** (`/yonetim/envanter`: Genel / Sayım oturumları / Hasar olayları; `inventory.view/count/apply` izinleri) | Farklı felsefe: onlarınki "anlık durumu düzelt", bizimki "her değişimin kaydı + sayım disiplini" |

---

## 2. Bizde gerçekten eksik olanlar

### 2.1 Varyant kombinasyon üretici (kartezyen matris)
- **Ne işe yarar:** Eksen seti seçip (ör. Renk × Uç Kalınlığı) tüm kombinasyonları tek ekranda üretmek, istemediklerini işaretleyip çıkarmak, kalanların fiyat/barkod/stok'unu tablo hâlinde girmek.
- **Bizim iş modelimizde gerekli mi:** **Evet, kırtasiye için acil.** Kitapta varyant zaten yasak (`variant_service.py:80-104`), ama kalem/defter tarafında 4 renk × 3 uç = 12 kombinasyon şu an **12 kez "türet" tıklayıp 12 ayrı form doldurmak** demek.
- **İş yükü:** Orta (~2-3 gün). Backend'e toplu üretim ucu (tek transaction, kombinasyon başına barkod zorunlu) + frontend matris tablosu. Medusa'nın hatasını tekrarlamayalım: matris yeniden üretilince girilen değerler silinmemeli.

### 2.2 Çoklu ürün görseli UI'ı (+ kapak seçimi, sıralama)
- **Ne işe yarar:** Ürün başına birden çok fotoğraf, sürükle-bırak sıralama, kapak seçimi.
- **Gerekli mi:** **Evet.** Kitap/kırtasiye kataloğunda tek fotoğraf zayıf — arka kapak, iç sayfa, ambalaj gösterilemiyor.
- **İş yükü:** **Küçük (~1 gün).** Model (`ProductImage`) ve API (`store.ts:389-411`, `/store/admin/products/{id}/images` POST/DELETE) **zaten yazılmış, hiçbir ekrana bağlanmamış.** Eksik olan: `sort_order` güncelleme ucu + UI.

### 2.3 CSV export + update-mode import
- **Ne işe yarar:** Kataloğu dışa aktarıp Excel'de fiyat/stok/durum toplu düzenleyip geri yüklemek; yedek almak.
- **Gerekli mi:** **Evet.** Tek kişilik işletmede sezon başı fiyat güncellemesi tek tek formdan yapılamaz. Bugün import yalnız `created`/`skipped` üretiyor (ISBN varsa sessizce atlıyor) — **güncelleme yolu hiç yok**.
- **İş yükü:** Export küçük (~0.5 gün; `CSV_COLUMNS` tek kaynağı zaten var). Update-mode orta (~1.5 gün): eşleşme anahtarı (SKU veya barkod), hangi kolonların üzerine yazılacağı, **stok kolonunun mutlaka defter üzerinden** (`ADMIN_ADJUSTMENT`) yazılması — doğrudan `products.stock` yazmak yasak.

### 2.4 Liste üzerinde toplu işlem (bulk action)
- **Ne işe yarar:** Çoklu seçim → yayınla / gizle / sil / kategori ata.
- **Gerekli mi:** Evet, ama 2.3'ten sonra; CSV update yolu açılırsa aciliyeti düşer. Medusa'da da **yok** — "sektör standardı" argümanı geçmiyor, ihtiyaçtan eklenmeli.
- **İş yükü:** Orta (~1.5 gün). `DataTable`'a satır seçimi + toplu uç.

### 2.5 Kategori ağacı yönetimi (alt kategori UI'ı)
- **Ne işe yarar:** "Kırtasiye > Yazı Gereçleri > Tükenmez Kalem" hiyerarşisi.
- **Gerekli mi:** Evet, orta vadede. `parent_id` **modelde var** ve KDV mirası ile `is_book_category` kontrolü bu zinciri yürüyor; ama panelde üst kategori seçilemediği için hiyerarşi ancak elle DB'den kurulabiliyor — yarım kalmış özellik.
- **İş yükü:** Küçük-orta (~1 gün). Mevcut `CategoriesPanel`'e üst kategori seçici + girintili liste.

### 2.6 Mal kabul / tedarik girişi (`incoming_quantity` karşılığı)
- **Gerekli mi:** Şimdilik **hayır**. Tedarik girişi bugün `ADMIN_ADJUSTMENT` + `reason=TEDARIK` ile yapılıyor ve deftere düşüyor. `docs/f29-envanter-sozlesmesi.md` bunu bilinçli sınır olarak yazmış. Sevkiyat hacmi artınca ayrı paket.
- **İş yükü:** Büyük (~1 hafta, yeni tablo + FSM).

### 2.7 Ürün etiketi (tag) ve ürün tipi
- **Gerekli mi:** **Etiket kısmen faydalı** ("TYT", "9. sınıf", "yeni müfredat" gibi kategori-dışı çapraz gruplama); **ürün tipi gereksiz** — kategori o işi görüyor.
- **İş yükü:** Etiket ~2 gün (tablo + pivot + UI + filtre + public yüzey). Şimdilik ertelenebilir.

### 2.8 Gereksiz sayılanlar (Medusa'da var, eklememeliyiz)

| Özellik | Neden gereksiz |
|---|---|
| Çok lokasyon envanteri (`StockLocation`/`InventoryLevel`) | Tek dükkân, tek fiziksel havuz — zaten bilinçli kararla dışlanmış. Eklemek defteri ve sayımı gereksiz karmaşıklaştırır |
| Rezervasyon tablosu (ödemeden önce kilit) | Ödeme anlık (iyzico); PAID'de `FOR UPDATE` + oversell'de tam iade zaten var. Rezervasyon katmanı yeni yarış yüzeyi açar |
| Sales channel | Tek satış kanalı |
| Region / price list / çoklu para birimi | TRY tek para birimi |
| Shipping profile | Kendi filomuz + tek dış kargo kuyruğu; profil soyutlaması karşılıksız |
| `manage_inventory` / `allow_backorder` | Backorder iş modelimizde yok; "takip etme" zaten `stock IS NULL` |
| `required_quantity` (bundle/set) | Set ürünü satılacaksa ayrı SKU olarak açılır |
| Serbest metinli option başlıkları | Kapalı `VARIANT_AXES` sözlüğü kasıtlı ve daha temiz |
| `metadata` json alanı | Şemasız, denetlenemez alan |
| ProductType | Kategori karşılıyor |

---

## 3. Bizde olup Medusa'da olmayanlar (fazlalarımız)

1. **Stok hareket defteri** — `stock_movements`: append-only trigger, `qty_after` zincir değişmezi, `idempotency_key`, 11 hareket tipi, actor/request izi, tek yazıcı disiplini. Medusa'da **hiç yok**, entegratöre bırakılmış.
2. **Defter denetim ucu** — `verify_ledger`/`audit_products`, bulgu kodlu. Karşılığı yok.
3. **Sayım oturumları (F29)** — FSM + satır olayları + STALE/RESOLVED + maker-checker + idempotent APPLY.
4. **Hasarlı stok kovası** — `damaged_stock` + 4 fiilli olay defteri (Medusa'da hasar = elle stok düşürme).
5. **Otomatik + değişmez SKU** — DB trigger'ıyla üretilir, UPDATE ile değiştirilemez. Medusa'da SKU serbest metin.
6. **Kitap künyesi ve ISBN dedupe** — 9 künye alanı + import'ta ISBN ile tekilleştirme.
7. **Satır bazlı CSV hata raporu** — her satır kendi savepoint'inde; Medusa'da tek hata tüm import'u düşürür.
8. **KDV modeli** — ürün `tax_rate` + kategori `default_tax_rate` mirası (CHECK'li). Medusa'da vergi ayrı modül, ürün formunda yok.
9. **`ProductPriceHistory`** — indirim iddiasının yasal dayanağı için fiyat geçmişi.
10. **Çok satıcılı moderasyon** — `seller_type` (PLATFORM/TUTOR); eğitmen dijital ürünü `PENDING` doğar ve eğitmen kendi durumunu **hiç** değiştiremez. Medusa çekirdeğinde marketplace onayı yok.
11. **Satın-alma-gated ürün yorumu** — `ProductReview`, ürün+müşteri başına tek. Medusa'da review yok.
12. **`StockNotification`** — "stok gelince haber ver" aboneliği.
13. **`search_vector` TSVECTOR computed kolon** — title+description+author+publisher+isbn+sku tek kolonda tam metin arama.
14. **Kategori bazlı iş kuralı** — kitap kategorisinde varyant yasağı (409).
15. **Düşük stok politikası tek kaynak** — `core/stock_policy.py`; filtre, rozet ve dashboard sayacı aynı SQL yüklemini paylaşır.
16. **Kupon, iade/kısmi iade, sipariş durum geçmişi** — iade akışımız doğrudan stok defterine bağlı (`RETURN` hareketi + fazla-geri-yükleme guard'ı).

---

## 4. En acil 5 eksik (öncelik sırasıyla)

| # | Eksik | Neden acil | Tahmini iş |
|---|---|---|---|
| **1** | **Çoklu ürün görseli UI'ı** | Müşteriye dönük, doğrudan satışı etkiliyor; **model + API zaten hazır**, sadece bağlanmamış. En yüksek fayda/maliyet oranı | ~1 gün |
| **2** | **Varyant kombinasyon üretici (matris)** | Kırtasiye kataloğu büyüdükçe tek tek "türet" akışı işletilemez hâle geliyor | ~2-3 gün |
| **3** | **CSV export + update-mode import** | Toplu fiyat/stok bakımı için tek gerçekçi yol; ayrıca yedek. Stok kolonu **defter üzerinden** yazılmalı | ~2 gün |
| **4** | **Kategori ağacı UI'ı** | `parent_id` ve KDV mirası kodda var ama panelden hiyerarşi kurulamıyor — yarım kalmış özellik | ~1 gün |
| **5** | **Liste toplu işlemleri** | Yayınla/gizle/sil/kategori ata. Medusa'da da yok; 3 numara açılırsa aciliyeti düşer | ~1.5 gün |

**Gereksiz diye işaretlenenler:** çok lokasyon envanteri, rezervasyon tablosu, sales channel, region/price list, shipping profile, backorder, bundle `required_quantity`, serbest metinli option başlıkları, `metadata` json, ProductType (gerekçeler §2.8).

**Ertelenenler:** mal kabul/tedarik girişi (§2.6), ürün etiketi (§2.7).

---

## 5. Kaynaktan çıkan iki uyarı

1. **Medusa'nın varyant matrisi hatası:** option/değer her değiştiğinde tüm varyant listesi sıfırdan üretilip `form.setValue` ile eziliyor (`product-create-details-variant-section.tsx:241`) — girilen fiyat/SKU kayboluyor. §4-2'yi yazarken mevcut girdiler korunmalı.
2. **Medusa'nın import hatası:** doğrulama hatası tüm import'u düşürüyor, satır bazlı rapor yok. Bizim import'umuz bu konuda **zaten daha iyi**; update-mode eklerken savepoint disiplini bozulmamalı.
