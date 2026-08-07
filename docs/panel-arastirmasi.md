# Admin Paneli Karşılaştırmalı Araştırma — Ürün ve Sipariş Ekranları

**Tarih:** 7 Ağustos 2026
**Kapsam:** Olgun e-ticaret admin panellerinin ürün listesi, sipariş listesi/detayı ve genel liste
desenlerinin ölçülmesi; bulguların Adana Özel Ders panelinin mağaza tarafıyla karşılaştırılması.
**Yöntem:** Açık kaynak panellerde **gerçek bileşen kodu** (GitHub API üzerinden, `develop`/`main`
dalları), kapalı kaynaklarda resmî dokümantasyon ve tasarım sistemi kaynak kodu.
**Kod yazılmadı, dosya değiştirilmedi.** Bu rapor tek çıktıdır.

> **Kaynak güvenilirlik sırası:** (1) okunmuş bileşen kaynağı — Medusa, Saleor, Vendure, Spree,
> Sylius, WooCommerce, Polaris; (2) resmî ürün dokümantasyonu — Shopify Help Center; (3) satıcı
> pazarlama sayfası — kitapçı yazılımları. Üçüncü sınıf kaynaklar raporda ayrıca işaretlendi.
> Doğrulayamadığım her nokta **"doğrulanamadı"** olarak yazıldı; tahmin yürütülmedi.

---

## 0. İncelenen paneller ve okunan dosyalar

| Panel | Sürüm/dal | Yığın | Okunan başlıca kaynak |
|-------|-----------|-------|------------------------|
| **Shopify Admin** | 2026 | kapalı (Polaris) | Help Center + `Shopify/polaris` `IndexFilters.tsx`, `IndexTable.tsx` |
| **Medusa Admin** | `develop` | React + TanStack Table + Radix | `product-list-table.tsx`, `use-product-table-columns.tsx`, `use-product-table-query.tsx`, `use-product-table-filters.tsx`, `date-filter.tsx`, `order-detail.tsx`, `use-order-table-columns.tsx`, `inventory-list-table.tsx`, `search/constants.ts`, `i18n/translations/en.json` |
| **Saleor Dashboard** | `main` | React + glide-data-grid + macaw-ui | `ProductListPage.tsx`, `ProductListDatagrid.tsx`, `ProductListDatagrid/datagrid.ts`, `OrderListDatagrid/datagrid.ts`, `utils/filters/storage.ts`, `hooks/useListSettings.ts`, `ProductListPage/filters.ts` |
| **Vendure Dashboard** | `master` (yeni React paneli) | React + TanStack Router/Table + shadcn/Tailwind | `_products/products.tsx`, `_orders/orders.tsx`, `framework/page/list-page.tsx` |
| **Spree** | `main` (yeni React paneli) | React + TanStack Router + shadcn/Tailwind | `tables/products.tsx`, `tables/orders.tsx`, `dashboard-core/components/table-toolbar.tsx`, `resource-table.tsx`, `search/default.tsx` |
| **WooCommerce** | `trunk` | PHP + WP list table | `class-wc-admin-list-table-products.php`, `wc-stock-functions.php` |
| **Sylius** | `2.1` | Symfony + sylius/grid | `config/grids/product.yml`, `order.yml`, `inventory.yml` |

**Kitap/yayıncılık envanteri:** Basil Bookseller Software, ShelfPerks, Candela RMS, CLZ Books —
yalnızca satıcı sayfaları bulunabildi, kaynak kod yok. Bu bölümün kanıt gücü diğerlerinden
**düşüktür** ve öyle işaretlendi.

**Vendure ve Spree önemli:** ikisi de son sürümlerinde panellerini **React + TypeScript +
TanStack + shadcn/Tailwind**'e taşıdı — yani bizim yığınımızın birebir aynısı. Bu iki panelin
çözümleri bize doğrudan uygulanabilir; Saleor'un glide-data-grid'i ya da WooCommerce'in PHP list
table'ı uygulanamaz, yalnızca *bilgi mimarisi* açısından okunur.

---

## 1. Karşılaştırma tablosu

### 1.1 Ürün listesi

| Ölçüt | Shopify | Medusa | Saleor | Vendure | Spree | WooCommerce | Sylius |
|---|---|---|---|---|---|---|---|
| **Varsayılan kolonlar (sırayla)** | Ürün (görsel+ad), Durum, Envanter, Satış kanalı, Kategori, Tür, Satıcı *(kolonlar gizlenip sıralanabilir)* | Ürün (görsel+ad), Koleksiyon, Satış kanalları, Varyantlar, Durum, ⋯ | ad, ürün tipi, açıklama, yayın durumu, güncellenme, oluşturma, fiyat, kategori, koleksiyonlar | ad, öne çıkan görsel, slug, aktif mi | ad (görsel+ad), durum, **envanter**, fiyat | onay kutusu, Görsel, Ad, SKU, **GTIN/UPC/EAN/ISBN**, Stok, Fiyat, Maliyet, Kategoriler, Etiketler, Öne çıkan, Tarih | görsel, ad, kod, ana taksonomi, aktif mi |
| **Stok adedi nasıl gösteriliyor** | Envanter kolonunda **sayı** (varyantlıysa toplam); sıralanabilir | Ürün listesinde **stok YOK** (varyant seviyesinde); ayrı Envanter ekranında düz sayı | Ürün listesinde stok kolonu **yok**; `stock` yalnız filtre anahtarı | Ürün listesinde stok kolonu **yok** | **Rozet+sayı birlikte**: "N in stock" / "Out of stock" / "On backorder" | **Rozet + parantez içinde sayı**: `In stock (12)` | Ürün grid'inde **yok**; ayrı Envanter grid'inde | 
| **Eşik ve renk kodu** | doğrulanamadı (panelde eşik rozeti belgelenmemiş; düşük stok için "envantere göre sırala" öneriliyor) | eşik yok | eşik yok | eşik yok | eşiksiz; yalnız **0 → kırmızı** (`text-destructive`), diğerleri nötr gri | **iki eşik**: `notify_no_stock_amount` (varsayılan **0**) ve `notify_low_stock_amount` (varsayılan **2**, ürün bazında ezilebilir); CSS sınıfları `instock`/`outofstock`/`onbackorder` | eşik yok |
| **Arama neyi kapsıyor** | başlık, açıklama, etiket *(SKU/barkod belgelenmemiş)* | `q` (sunucu tarafı; kapsam uçta) | serbest metin + ifade filtresi ("Search Products…") | **ad + slug + SKU** (`contains`) | `multi_search` (sunucu); SKU ayrı filtrelenebilir kolon | Kolonlar SKU ve ISBN'e göre **sıralanabilir**; WP arama başlık/içerik | **kod + çeviri.ad** (`contains`) |
| **Filtreler** | Satıcı, Etiket, Durum, Kategori, Satış kanalı, katalog türleri, Ürün tipi, Koleksiyon, Yayın hatası, Hediye kartı, Metafield | tür, etiket, satış kanalı (çoklu + kendi içinde aranabilir), tarih | kategori, koleksiyon, metadata, fiyat, ürün tipi, **stok**, kanal, ürün türü | facet değerleri (çoklu) | durum (enum), fiyat (sayı), etiket, **stokta mı (boolean)**, kategori, kanal, ürün tipi — operatörlü | kategori, ürün tipi, **stok durumu** | aktif mi, kanal, taksonomi, ana taksonomi |
| **Filtre UI'ı nerede** | Tablonun üstünde tek satır arama çubuğu + filtre hapları | Tablonun üstünde araç çubuğu; seçilenler **çip** olarak kalıyor | Tablonun üstünde "expression filter" şeridi | Araç çubuğunda faceted filter düğmeleri | Araç çubuğunda filtre popover'ı + çipler | Tablonun üstünde açılır listeler (`tablenav`) | Grid üstünde katlanır filtre paneli |
| **Sayfalama** | imleç (cursor) tabanlı, Önceki/Sonraki | **offset**, 20/sayfa, "… of … results" | **imleç (Relay)**, `hasNextPage`/`hasPreviousPage` | **offset**, `page`+`perPage` URL'de, varsayılan 10 | **offset**, `page` URL'de | numaralı (WP) | numaralı |
| **Toplu seçim / toplu işlem** | var; Polaris `promotedBulkActions` (öne çıkan) + `bulkActions` (taşma menüsü) | envanterde var (satır seçimi + "Stok seviyelerini düzenle", kısayol `i`); ürün listesinde satır seçimi yok | var: onay kutusu + **toplu silme** | var, gruplu: kanala ata/çıkar, facet ata, **çoğalt** \| sil | var: `bulk-action-bar`, seçim **sayfa başına ve geçici** | var (WP toplu işlemler) | var: toplu silme |
| **Satır içi düzenleme** | Toplu düzenleyici (ayrı ekran) | yok | Datagrid `onCellEdited` destekli; **ürün listesi `readonly`**, varyant grid'i düzenlenebilir | yok | yok | **Quick Edit** — satır altında açılan form (stok, stok durumu, backorder, düşük stok eşiği dahil) | yok |
| **Boş durum / hata** | `emptyState` prop'u | **"kayıt yok" ≠ "sonuç yok" ayrımı**: `noRecordsTitle`/"Create your first product to start selling." vs `noResultsTitle`/"Try changing the filters or search query" | boş liste bileşeni | boş liste bileşeni | ikonlu `Empty` bileşeni; tabloya özel `emptyMessage` | WP standardı | grid standardı |
| **Kayıt sayısı / tavan bildirimi** | doğrulanamadı | "N of M results" | **"{count}/{max} SKUs used"** + tavan dolunca `LimitReachedAlert` ("SKU limit reached") | toplam sayı gösteriliyor | `meta.count` → toplam | WP "N öğe" | grid sayacı |

### 1.2 Sipariş listesi ve detayı

| Ölçüt | Shopify | Medusa | Saleor | Vendure | Spree | Sylius |
|---|---|---|---|---|---|---|
| **Liste kolonları** | Sipariş no, Sipariş tarihi, Müşteri adı, Toplam, Ödeme durumu, Karşılama durumu | `display_id`, tarih, müşteri, satış kanalı, ödeme durumu, karşılama durumu, toplam, ülke | no, tarih, müşteri, ödeme, durum, net, toplam, kanal | kod, müşteri, durum, toplam, kargo *(id/createdAt/orderPlacedAt/tür/para birimi varsayılan gizli)* | no, **tarih (göreli: "2 saat önce")**, müşteri e-postası, kanal, ödeme durumu, karşılama durumu, **kalem adedi**, toplam | no, tarih, müşteri, kanal, durum, ödeme durumu, kargo durumu, toplam, para birimi |
| **Varsayılan sıralama** | doğrulanamadı | doğrulanamadı (liste bileşeninde açık default yok) | doğrulanamadı | `updatedAt` azalan | `completed_at` azalan | `number` azalan |
| **Durum filtreleri nasıl sunuluyor** | **Sekme (view)**: varsayılan `All` ve `Unfulfilled`; ek sekmeler kaydedilebilir | açılır filtre menüsü + çip | ifade filtre şeridi | faceted filter düğmesi (`State`) | araç çubuğunda enum filtresi (is / is not / is any of / is none of) | katlanır filtre panelinde `select` |
| **Tarih aralığı ve hazır ayraçlar** | **Today, Last 7 days, Last 30 days, Last 90 days, Last 12 months + Custom** | **Today, Last 7 days, Last 30 days, Last 90 days, Last 12 months + Custom** (birebir aynı) | tarih filtresi | tarih filtresi | tarih operatörleri: is / after / before / on or after / on or before | tarih aralığı (`inclusive_to`) |
| **Diğer sipariş filtreleri** | ~24 filtre: ödeme/karşılama/teslimat/iade/etiket durumları, tutar, teslimat yöntemi, adres, kalem sayısı, ağırlık, ürün, indirim kodu, kanal, risk, kart son 4 hane, etiket | bölge, satış kanalı *(ödeme/karşılama durumu filtreleri kaynakta yorum satırında — henüz aktif değil)* | doğrulanamadı | durum | no, müşteri, kanal, ödeme durumu, karşılama durumu, toplam, para birimi, etiket | durum, ürün, varyant, no, müşteri, tarih, kanal, toplam, kargo yöntemi |
| **Detay sayfası düzeni** | doğrulanamadı (Help Center bölüm düzenini saymıyor; Timeline'ın varlığı doğrulandı) | **İki kolon.** Ana: aktif düzenleme/iade/değişim blokları → Genel → Özet (kalemler) → Ödeme → Karşılama. Yan: Müşteri → Etkinlik (zaman çizelgesi) | doğrulanamadı | blok tabanlı (`PageBlock column="main"`) | doğrulanamadı | doğrulanamadı |
| **Yıkıcı aksiyon koruması** | doğrulanamadı | doğrulanamadı | doğrulanamadı | doğrulanamadı | doğrulanamadı | doğrulanamadı |

> **Yıkıcı aksiyon koruması hakkında dürüst not:** hiçbir panelde "iptal/iade butonu şu şekilde
> korunuyor" diyebileceğim bir kaynak bulamadım. Bu satırın tamamı doğrulanamadı. Bizim
> `ConfirmDialog` + zorunlu gerekçeli `ReasonDialog` desenimiz bu araştırmayla ne desteklendi ne
> çürütüldü — kendi başına savunulabilir ama "sektör standardı" diye sunulamaz.

### 1.3 Genel liste desenleri

| Ölçüt | Shopify | Medusa | Saleor | Vendure | Spree | WooCommerce | Sylius |
|---|---|---|---|---|---|---|---|
| **Kayıtlı/isimli filtre görünümü** | **Var** — "views"; filtre + kolon seçimi + kolon sırası + sıralama kaydedilir; yeniden adlandır/sil/çoğalt; yönetimi yalnız masaüstünde | yok | **Var** — `FilterPresetsSelect`; **localStorage**'da (`saveFilterTab`/`updateFilterTab`/`deleteFilterTab`) | yok | yok | yok | yok |
| **URL state — filtre paylaşılabilir mi** | doğrulanamadı | **Evet**, tüm filtreler query param (`offset`, `order`, `q`, `status`, `category_id`, `created_at`…) | Evet, `ProductListUrl*` şemasıyla | **Evet**: `page`, `perPage`, `sort`, `filters` | **Evet**: `page`, `sort`, `dir`, `search`, `filters` | Evet (`?stock_status=`, `?product_type=`) | Evet (grid query) |
| **Kolon seçimi ve kalıcılığı** | Var (gizle/göster/sırala; en soldaki kolon hariç) | yok | Var — `ColumnPicker`; `listConfig` anahtarıyla **localStorage** (kolonlar + satır sayısı) | Var — `columnVisibility` **kullanıcı ayarlarında**, `pageId` başına | Var — araç çubuğunda kolon seçici | Var (WP "Ekran Seçenekleri") | yok |
| **Sıralama tercihi hatırlanıyor mu** | **Hayır** — "Sort order isn't maintained for a particular view… resets back to the default" (görünümler dokümanı) *ancak* sipariş görünümleri dokümanı sıralamanın view'a kaydedildiğini söylüyor → **iki doküman çelişiyor, çözemedim** | URL'de kalır, kalıcı depolanmaz | URL'de | URL'de; `pageSize` kullanıcı ayarında | URL'de | URL'de | URL'de |
| **Komut paleti** | Var *(kaynak doğrulanamadı)* | **Var** — `cmdk`; kapsam: sipariş, ürün, varyant, koleksiyon, kategori, **envanter**, müşteri, promosyon, kampanya, fiyat listesi, kullanıcı, bölge… + **"command"** ve **"navigation"**; placeholder: *"Jump to or find anything…"* | doğrulanamadı | `command.tsx` bileşeni var, panel geneli palet **doğrulanamadı** | **Var** — `cmdk` + `searchRegistry`; kapsam: ürün, kategori, koleksiyon, müşteri, sipariş, promosyon | yok | yok |
| **Yoğunluk (compact/comfortable) seçici** | **bulunamadı** | bulunamadı | **görünüm** seçici var (datagrid ↔ kart döşemesi, localStorage) ama yoğunluk değil | bulunamadı | bulunamadı | bulunamadı | bulunamadı |
| **Mobil/dar ekran davranışı** | Polaris `condensed` — tablo, satır başına kart listesine dönüşür; başlık ve son kolon yapışkan | doğrulanamadı (yatay kaydırma varsayımı doğrulanmadı) | doğrulanamadı | doğrulanamadı | doğrulanamadı | WP responsive tablo | doğrulanamadı |
| **Klavye kısayolları** | Polaris `IndexFilters` kısayolları (`disableKeyboardShortcuts` ile kapatılabilir; arama/filtre tooltip'i kısayolu gösterir), `Escape` ile mod çıkışı | Palette ↓↑ gezinme, ↵ açma, "Jump to"/"Commands" bölümleri; **toplu işlemlere harf kısayolu** (envanterde `i`) | doğrulanamadı | doğrulanamadı | doğrulanamadı | yok | yok |

---

## 2. Yakınsayan desenler — sektör standardı sayılabilecekler

Aşağıdakiler **en az beş panelde aynı şekilde** çözülmüş. Bunlar tartışma konusu değil; bir liste
ekranının varsayılan davranışı sayılıyorlar.

### Y1 — Liste durumu URL'de yaşar
Medusa, Saleor, Vendure, Spree, WooCommerce, Sylius: sayfa, sıralama, arama ve **her filtre** query
param. Vendure ve Spree bunu bir çatı fonksiyonuna almış (`persistListStateToUrl`, `updateSearch`).
Sonuç: filtreli bir liste linki kopyalanıp yapıştırılabiliyor, geri tuşu çalışıyor, yer imi
konabiliyor. Kalıcı depolamaya (localStorage/kullanıcı ayarı) yalnız **kişisel tercih** gidiyor
(kolon görünürlüğü, sayfa boyutu) — **veri seçimi URL'de kalıyor**. Bu ayrım tutarlı.

### Y2 — Arama kutusu tablonun üstünde, filtreler onun yanında yatay şerit
Yedi panelin **yedisi de** filtreleri tablonun üstüne, arama kutusuyla aynı hizaya koyuyor. Sol
kenar çubuğu filtre paneli **hiçbirinde yok**. Seçilmiş filtreler çip/hap olarak arama çubuğunun
altında birikiyor (Medusa `filter-chip`, Saleor expression filter, Spree filtre çipleri, Shopify
filtre hapları).

### Y3 — Sunucu sayfalama + görünür toplam sayı
Hepsinde sayfalama sunucuda; sayfa boyutu 10–25 arası (Medusa 20, Vendure 10, bizim DataTable 25).
Toplam kayıt sayısı **her zaman** kullanıcıya gösteriliyor ("N of M results", `meta.count`).
Sessizce kesilen liste hiçbirinde yok.

### Y4 — Durum bir rozet, listede metinle birlikte
Ürün durumu (aktif/taslak/gizli) ve sipariş durumları hepsinde **renkli rozet + metin**. Renk tek
başına anlam taşımıyor; Spree `StatusBadge`, Sylius twig rozetleri, WooCommerce `<mark>` sınıfları,
Medusa `ProductStatusCell`.

### Y5 — "Kayıt yok" ile "sonuç yok" farklı ekranlar
Medusa bunu i18n seviyesinde ayırmış: liste gerçekten boşsa **"Create your first product to start
selling."**, filtre/arama sonuç vermediyse **"Try changing the filters or search query"**. Spree'nin
`Empty` bileşeni ve Sylius grid'i de bu ayrımı taşıyor. Mantık basit: ilki bir davet, ikincisi bir
düzeltme talimatı; ikisini karıştırmak kullanıcıyı "veri kayboldu" sanısına sürüklüyor.

### Y6 — Tarih filtresinde hazır ayraçlar, üstelik aynı beşli
Shopify ve Medusa **birebir aynı** ön ayarları sunuyor: `Today · Last 7 days · Last 30 days ·
Last 90 days · Last 12 months · Custom`. Spree operatör tabanlı (after/before/on or after…),
Sylius aralık. İki bağımsız panelin aynı beş ayraca varması tesadüf değil; bunlar operasyonun
gerçek soruları ("bugün ne oldu", "bu hafta", "bu ay").

### Y7 — Toplu seçim + toplu işlem çubuğu
Shopify (promoted/overflow ayrımıyla), Saleor, Vendure, Spree, WooCommerce, Sylius'te var. Spree'nin
kaynağında **önemli bir davranış kuralı** açıkça yazılı: *seçim sayfa başına ve geçicidir; kullanıcı
sayfa değiştirdiğinde, yeniden sıraladığında, filtrelediğinde veya aradığında seçim silinir* —
önceki sayfalardan kalan ID'lerin görünmeyen kayıtlar üzerinde işlem yapmasını engellemek için.

### Y8 — Sipariş detayı iki kolon: iş ana kolonda, kimlik ve tarihçe yanda
Medusa'nın kaynağında net (`TWO_COLUMN`): **ana kolon** işlem yapılacak olan (kalemler, ödeme,
karşılama, aktif iade/değişim), **yan kolon** bağlam (müşteri, zaman çizelgesi). Shopify'ın
Timeline'ı da yan/alt bağlam olarak konumlanıyor. Zaman çizelgesi hiçbirinde ana kolonun üstünde
değil — kimse tarihçeyi okumak için gelmiyor, iş yapmak için geliyor.

### Y9 — Envanter, üründen ayrı bir kavram olarak ele alınıyor
Medusa, Shopify, Sylius'te ayrı bir **Envanter ekranı** var; Saleor ve Vendure'de stok varyantın
içinde. Sebebi ortak: varyant matrisi. Ürün satırı tek bir stok sayısı gösteremiyor çünkü ürünün
tek bir stoğu yok. *(Bu bizim için geçerli değil — §4'e bakın.)*

### Y10 — Manuel stok düzeltmesi gerekçeli ve iz bırakan
Shopify: **"Set to"** (mutlak) / **"Adjust by"** (delta) ayrımı + yedi hazır gerekçe (**Correction**
varsayılan, Count, Received, Return restock, Damaged, Theft or loss, Promotion or donation);
her düzeltme *tarih + faaliyet + kim* ile geçmişe yazılıyor, 180 gün saklanıyor, ürün sayfasından
**"View adjustment history"** ile açılıyor. WooCommerce'de düzeltme Quick Edit'ten yapılıyor ve
ürün başına düşük stok eşiği taşınıyor. Medusa'da toplu stok düzenleme ayrı bir akış.

---

## 3. Ayrışan desenler — ve hangi koşulda hangisi

| Konu | Seçenek A | Seçenek B | Ayrım koşulu |
|---|---|---|---|
| **Sayfalama** | offset/numaralı (Medusa, Vendure, Spree, Woo, Sylius) | imleç/cursor (Shopify, Saleor) | Cursor, on binlerce kayıtta `OFFSET n` taramasının çöktüğü ve "eş zamanlı ekleme sayfayı kaydırıyor" sorununun görüldüğü ölçekte gerekiyor. Yeni nesil paneller (Vendure, Spree) offset'e **geri dönmüş** — sadeliği tercih etmişler. |
| **Kayıtlı görünüm nerede saklanıyor** | localStorage (Saleor) | sunucu/hesap (Shopify — cihazdan bağımsız erişilebiliyor) | Tek makineden çalışan tek yönetici → localStorage yeterli ve bedava. Vardiyalı ekip, cihaz değiştiren kullanıcı → sunucu. |
| **Kolon seçimi kalıcılığı** | localStorage (Saleor) | kullanıcı ayarı, sayfa kimliği başına (Vendure `setTableSettings(pageId, …)`) | Vendure'ünki daha temiz: her liste kendi tercihini taşıyor, tek bir global ayar nesnesi listeleri birbirine bağlamıyor. |
| **Stok gösterimi** | Rozet + sayı (Spree, WooCommerce) | Yalnız sayı (Shopify envanter, Medusa envanter) | Rozet, **taranan** bir listede işe yarıyor ("hangileri bitmiş" göz taramasıyla bulunuyor). Yalnız sayı, **karşılaştırılan** bir listede (envanter ekranı, sayım) daha okunaklı. |
| **Düşük stok eşiği** | Yapılandırılabilir, ürün bazında ezilebilir (WooCommerce: global 2, ürün başına override) | Eşik yok, "envantere göre sırala" (Shopify'ın önerdiği yol) | Eşik, **yeniden sipariş** kararı otomatikleştirilecekse gerekiyor. Sadece "en azları göreyim" isteniyorsa sıralama yetiyor. |
| **Filtre ifade dili** | Operatörlü kural kurucu (Spree: contains/equals/starts with/is set…; Sylius) | Basit çoklu seçim (Medusa, Vendure) | Operatörler, filtrelenecek alan sayısı ~10'u geçtiğinde değer kazanıyor. Altında gereksiz karmaşa. |
| **Satır içi düzenleme** | Quick Edit satır formu (WooCommerce) / düzenlenebilir hücre (Saleor varyant grid'i) | Yok — satır tıklanır, detay açılır (Medusa, Vendure, Spree, Sylius) | Satır içi düzenleme, **aynı alanı çok satırda** değiştirme işi sıksa (fiyat güncelleme turu) kazanıyor. Tekil düzeltmede detay sayfası daha güvenli. |
| **Ürün listesinde satıcı/kanal kolonu** | Var (Medusa, Saleor, Spree, Sylius) | Yok | Çok kanallı/çok satıcılı katalogda gerekli. |

---

## 4. BİZE UYMAYANLAR — kopyalanmaması gerekenler

Bu bölüm bilerek uzun. İncelenen panellerin ekran alanının kayda değer bir kısmı, **bizde karşılığı
olmayan** yapılara ayrılmış. Onların kolon düzenini olduğu gibi almak, panelimize boş kolon
doldurmak olur.

### 4.1 Varyant matrisi → **ürün listesinde stok göstermeme kararı bize uymaz**
Medusa, Saleor, Vendure ve Sylius ürün listesinde **stok göstermiyor**; Medusa "Varyantlar" kolonu
koyuyor, Sylius stoku ayrı bir Envanter grid'ine sürüyor. Sebep tek: bir üründe beden/renk başına
ayrı stok var, tek sayı yalan olurdu.

**Bizde varyant yok.** `Product.stock` tek ve doğru bir sayı. Dolayısıyla:
- Onların "ayrı envanter ekranı" mimarisi bizim için **gereksiz bir sıçrama** olur.
- Bizim için doğru referans **Spree ve WooCommerce**: stok doğrudan ürün satırında.
- Bizde zaten ayrı bir envanter alanı var (`/yonetim/envanter`) ama o **sayım ve hasar süreci**
  için — bir stok listeleme ekranı değil. Bu ayrım doğru, korunmalı.

### 4.2 Çok depo / çok konum
Shopify'ın envanter kolonları **Unavailable · Committed · Available · On hand · Incoming · Bin
name**; "Adjust by" işlemi kaynak ve hedef konum istiyor. Bunun tamamı çok depolu, rezervasyonlu
bir dünyanın kavram seti.

Bizde tek stok noktası var ve **stok ödeme anında düşüyor** (`ORDER_PAID` hareketi) — yani
"committed" (siparişe ayrılmış ama henüz düşmemiş) diye bir ara durum **yok**. Beş kolonluk envanter
tablosu bizde beş kolonun dördü boş olurdu. Tek sayı + defter doğru cevap.

### 4.3 Çok para birimi
Saleor ve Sylius sipariş listesinde ayrı **para birimi kolonu** taşıyor; Vendure `currencyCode`'u
varsayılan gizli tutuyor; Medusa `TotalCell`'e `currencyCode` geçiriyor. Bizde tek para birimi (₺)
var — kolon değil, biçimlendirici işi (`formatTL` zaten var).

### 4.4 Satış kanalı / katalog / B2B
Medusa "Sales channels", Saleor "channel", Spree "channel", Shopify "Sales channel / Region catalog
/ B2B catalog / Company location catalog" kolonları ve filtreleri taşıyor. Bizde tek satış yüzeyi
var. Bunların hiçbiri kopyalanmamalı.

### 4.5 Pazaryeri satıcı yönetimi — kısmen uyuyor, dikkatle
Bizde `seller_type` (PLATFORM/TUTOR) var ve eğitmen dijital ürün satıyor. Yani **"Satıcı" kolonu
bizde anlamlı** — ama bu, Saleor/Sylius'un *channel* kavramı değil. Zaten mevcut ürün satırımız
eğitmen adını gösteriyor. Kolonlu tabloya geçerken bu bilginin kaybolmaması gerekir; ötesine gerek
yok.

### 4.6 Backorder (ön sipariş)
WooCommerce'in üçüncü stok rozeti `On backorder`, Spree'nin `backorderable` dalı ve Vendure'ün
karşılama durumları backorder'ı birinci sınıf kabul ediyor. **Bizde stok 0 ise ürün satılamıyor** —
üçüncü bir stok durumu yok. İki durumlu kalmalı: stokta var / stokta yok. Üçüncü rozeti eklemek,
karşılığı olmayan bir vaat üretir.

### 4.7 Taslak sipariş (draft order)
Vendure ve Spree'nin sipariş listesinde "Draft order" oluşturma düğmesi var; Sylius'ta `draft`
durumu. Bizde admin sipariş oluşturmuyor; sipariş yalnız müşteri akışından doğuyor. Kapsam dışı.

### 4.8 Hediye kartı, birleşik listeleme, metafield, öznitelik kolonları
Saleor'un dinamik öznitelik kolonları (ürün özniteliği başına kolon), Shopify'ın metafield filtreleri
ve "Combined listings"i, Medusa'nın hediye kartı ayrımı — hepsi esnek şema ihtiyacından doğuyor.
Bizim kitap künyemiz **sabit ve bilinen** (ISBN, yazar, yayınevi, basım yılı, baskı, dil, kapak,
ebat, sayfa). Dinamik kolon altyapısına gerek yok; künye alanları sabit kolon olarak yeter.

### 4.9 SKU kotası / plan limiti uyarısı
Saleor'un "{count}/{max} SKUs used" ve `LimitReachedAlert`'i SaaS abonelik limitinden geliyor.
Bizde plan limiti yok. **Ama altındaki fikir bize lazım** — bkz. §6-B3: kullanıcıya *"listede kaç
kayıt olduğu ve hepsini görüp görmediği"* söylenmeli. Limit uyarısı değil, sayaç.

---

## 5. KİTAP KATALOĞUNA ÖZGÜ

> Bu bölümün kaynakları en zayıf olanlar. WooCommerce bulgusu kaynak koddan, Basil bulgusu satıcı
> sayfasından; diğerleri (ShelfPerks, Candela, CLZ) yalnızca teyit amaçlı, tek başına dayanak
> sayılmadı.

### 5.1 ISBN, genel e-ticarette olmayan biçimde birinci sınıf

WooCommerce çekirdeği ürün listesine **adı literal olarak "GTIN, UPC, EAN, or ISBN" olan bir kolon**
koyuyor (`global_unique_id`) ve bu kolonu **sıralanabilir** yapıyor
(`define_sortable_columns`: `price`, `sku`, `name`, `global_unique_id`). İncelenen yedi panelden
yalnız WooCommerce böyle bir kolon taşıyor — çünkü kitap, plak ve yayın satan mağazalar onun en
büyük kullanıcı kitlesi.

Kitapçı yazılımlarında ISBN **kimlik değil, giriş yöntemi**: Basil'in tanımı — *"Scan the 13-digit
EAN or ISBN and Basil will automatically download the title, author, publisher, publish date, and
retail price for you."* Yani ISBN, katalog kaydını **doğuran** şey.

**Bizim için sonuç:**
- ISBN kolonu ürün listesinde bulunmalı (ikinci satırda, künye satırında olabilir).
- **ISBN aranabilir olmalı** — ve bu bizde şu an mümkün değil. `Product.search_vector` yalnızca
  `title + description + author + publisher` üzerinden hesaplanıyor (`models/store.py:314-321`);
  **ISBN ve SKU vektörde yok**. Yani bir müşteri de, bir yönetici de kitabı ISBN'iyle bulamıyor.
- Aramaya yapıştırılan 13 haneli rakam dizisi **tam eşleşmeyle** ele alınmalı, trigram benzerliğine
  bırakılmamalı: ISBN'de "yakın eşleşme" diye bir şey yoktur, komşu ISBN başka bir kitaptır.
  (Bu, `search_products`'taki `norm_title % norm_q` trigram kolunun ISBN için **yanlış** olduğu
  anlamına gelir — rakam dizilerinde trigram gürültü üretir.)
- Barkod okuyucu ISBN'i klavye girdisi olarak yazar ve sonuna Enter basar. Arama kutusu bunu
  doğrudan kabul edebilmeli; ayrı bir "barkod modu" gerekmiyor.

### 5.2 Yazar ve yayınevi — bizde arka uçta var, panelde yok

`search_products` zaten `publisher`, `author`, `cover_type` için **çoklu değerli, Türkçe
normalize edilmiş** filtre destekliyor (`store_service.py:362-364, 408-419`) ve arama vektörü yazar
ile yayınevini kapsıyor. Kod yorumu bunu açıkça gerekçelendiriyor: *"kullanıcı çoğu zaman kitabın
adını değil yazarını hatırlar ('palme fizik', 'tonguç')"*.

**Bu yetenek admin panelinde hiç kullanılmıyor.** Vitrin, yöneticiden daha iyi arıyor. Yayınevi
filtresi kitapçının en sık daralttığı eksen ("Palme'de ne var, kaçı bitmiş") ve bizde uç zaten hazır.

### 5.3 Genel e-ticarette karşılığı olmayan, yayıncılıkta standart kavramlar

| Kavram | Ne demek | Bizdeki durum |
|---|---|---|
| **Baskısı tükendi (out of print)** | Yayınevi artık basmıyor — stok 0'dan **farklı** bir durum; ikmal edilemez | Bizde ayrı bir durum yok. Şu an `HIDDEN` ile karıştırılabilir. **Öneri değil, gözlem:** ileride ayrılması gerekirse `status` yerine ayrı bir alan olmalı. |
| **Yavaş dönen başlık (slow mover)** | Rafta duran, devir hızı düşük başlık — kitapçıda iade/indirim kararının girdisi | Yok. Basil bunu birinci sınıf rapor sayıyor (*"which titles are moving slowly"*). Bizde satış hareketi defterde (`SALE`) var, rapor yok. |
| **Sipariş edilmiş / yolda (on order)** | Yayınevine sipariş verilmiş ama gelmemiş adet | Yok; Shopify'daki karşılığı `Incoming`. Bizde tedarik `TEDARIK` gerekçesiyle geldiğinde tek adımda yazılıyor. Bu tek depolu ölçekte savunulabilir. |
| **Aynı ISBN, farklı durum** | İkinci el/hasarlı nüsha ayrı fiyatla | Bizde `DAMAGE_TRANSFER` hasarı **stoktan çıkarıyor**, ayrı satılabilir bir kalem üretmiyor. İkinci el satılmıyorsa doğru. |

### 5.4 Kitap kataloğu için doğru kolon seti

İncelenen panellerin kolon setlerini kitaba uyarlarsak, bizim listemize şu düşer:

```
[görsel]  Başlık                       Stok        Fiyat      Durum
          Yazar · Yayınevi · ISBN      12 adet     ₺339       Yayında
```

Yani **iki satırlı bir birincil hücre** (Medusa `ProductCell` ve Spree `name` render'ının yaptığı
şey) + stok + fiyat + durum. Künyenin geri kalanı (basım yılı, baskı, dil, kapak, ebat, sayfa)
listede değil, detayda kalmalı — zaten katlanır künye bölümümüzde duruyorlar.

---

## 6. Bizim panelimizle boşluk analizi

Sol sütun §2'deki yakınsayan desen, sağ sütun bizim ölçülmüş durumumuz.

| # | Yakınsayan desen | Bizim durumumuz |
|---|---|---|
| Y1 | Liste durumu URL'de | **Yarı var.** Kullanıcılar, Rezervasyonlar, Talepler, Şikâyetler, Denetim, Envanter/Sayımlar, Paketleme, Dağıtım hepsi `useSearchParams` kullanıyor; `parseAdminUserQuery` beyaz listeli doğrulama yapan **hazır ve test edilmiş** bir desen. **Mağaza altı sekmenin hiçbirinde yok** — alt sekme dışında tek bir query param bile taşınmıyor. |
| Y2 | Arama + filtre tablonun üstünde | **Yarı var.** Dört listede arama kutusu (Kullanıcılar, Rezervasyonlar, Talepler, Denetim) + Stok hareketlerinde SKU alanı. **Mağaza Ürünler ekranında ne arama ne filtre ne sıralama var** — panelin en çok kayıt taşıyacak listesi. |
| Y3 | Sunucu sayfalama + görünür toplam | **Kısmen ve tehlikeli biçimde eksik.** 13 listede sayfalama var. Ama `/store/admin/products` ve `/store/admin/orders` sunucuda `limit=100` ile geliyor ve istemci ne `offset` gönderiyor ne "100 kayıt gösteriliyor" diyor. **101. ürün panelde yok gibi görünüyor.** Bu, araştırmadaki hiçbir panelde bulunmayan bir davranış. |
| Y4 | Durum rozeti + metin | **Eksik.** Ürün satırı durumu **ham enum** olarak basıyor (`<span>{product.status}</span>` → "ACTIVE"), rozet değil, Türkçe değil. Sipariş satırı da ham: `{o.status} · {o.payment_status}`. Oysa panelin başka yerlerinde (`admin/ui/Badge`, `RunStatusChip`, `PACKAGE_STATUS_LABEL`) doğru desen zaten kurulu. |
| Y5 | "Kayıt yok" ≠ "sonuç yok" | **Kısmen var.** `CountSessionsPage` bunu doğru yapıyor ("Bu durumda oturum yok" / "Henüz sayım oturumu açılmadı"). Mağaza tarafında tek metin var ("Ürün yok."), zaten filtre de olmadığı için ayrım henüz gerekmiyor — ama filtre eklenince gerekecek. |
| Y6 | Tarih ön ayarları | **Yok.** Sipariş listesinde tarih filtresi hiç yok. "Bugün ne sattık" sorusu gözle tarama gerektiriyor. Dağıtım tarafında `?tarih=` ve `?gun=7\|30\|90\|180` var — desen panelde mevcut, mağazaya uğramamış. |
| Y7 | Toplu seçim + toplu işlem | **Yok.** Hiçbir admin listesinde satır seçimi yok. Toplu fiyat güncellemesi bu yüzden imkânsız: CSV içe aktarma **yalnız oluşturuyor**, mevcut ISBN görülünce satır atlanıyor (`store_service.py:654-664`). |
| Y8 | Sipariş detayı iki kolon | **Yok — sipariş detay sayfası hiç yok.** `ROUTES`'ta `adminStoreOrder(:id)` yok. Mağaza sipariş kartı kalem listesi göstermiyor. Kalemler yalnız paketleme/dağıtım kuyruğundayken görülebiliyor; teslim edilmiş, iptal edilmiş veya dijital bir siparişin içinde ne olduğunu gösteren ekran yok. |
| Y9 | Envanter ayrı kavram | **Bize uymuyor (§4.1)** — ama ilginç biçimde biz *yanlışlıkla* onların şemasına düşmüşüz: ürün satırında stok yok, stok başka ekranda. Onlarda bu bir tasarım kararı (varyant), bizde ise sadece eksik. |
| Y10 | Gerekçeli, iz bırakan stok düzeltmesi | **Var ve iyi.** Bu bizim en olgun yüzeyimiz: `ADMIN_REASON_OPTIONS` (Sayım farkı, Hasar, Kayıp, Hatalı giriş, Tedarik/mal kabul, Diğer) Shopify'ın yedilisiyle neredeyse birebir örtüşüyor; delta **sunucuda, satır kilitliyken** hesaplanıyor (istemci hedefi gönderiyor = Shopify'ın "Set to"su); defter `qty_delta` + `qty_after` + aktör + gerekçe taşıyor; append-only; ayrıca bizde onlarda olmayan bir **defter denetimi** ("Defteri denetle") var. |

### 6.1 Yakınsayan desenlere göre bizde olmayanların özeti

Mağaza ekranları (Ürünler, Kategoriler, Siparişler, İadeler, Kuponlar) **Y1, Y2, Y3, Y4, Y6, Y7,
Y8'in tamamında** sektör tabanının altında. Panelin geri kalanı (İP-4'le yenilenen DataTable'lı
beşli, F30 paketleme, dağıtım, envanter) **Y1, Y2, Y3, Y4, Y5'te tabanın üstünde veya hizasında**.

Kırılma çizgisi teknik değil, tarihsel: yeni yazılan her ekran doğru deseni almış; `AdminStore.tsx`
ilk günkü hâlinde kalmış.

---

## 7. Öneri listesi

Üç kova. Büyüklük tahminleri: **S** = tek ekran, mevcut bileşenlerle, yarım gün–bir gün ·
**M** = ekran + uç değişikliği, birkaç gün · **L** = yeni altyapı, hafta ölçeği.

### A. Sektör standardı, bizde yok, UCUZ
*(Mevcut `DataTable` + `parseAdminUserQuery`/`setQueryValue` desenine eklenir; yeni bağımlılık yok.)*

| # | Öneri | Etkilenen ekran | Büyüklük | Çözdüğü somut operasyonel soru |
|---|---|---|---|---|
| **A1** | **Ürün listesini `DataTable`'a taşı**: kolonlar `[görsel+başlık / yazar·yayınevi·ISBN] · Stok · Fiyat · Durum · ⋯`; sunucu sayfalama (`limit`/`offset` **uçta zaten var**, istemci göndermiyor); sıralanabilir Başlık/Fiyat/Stok/Eklenme | `/yonetim/magaza/urunler` | **M** | "101. ürün nerede?" · "En pahalı kitaplarım hangileri?" · Şu anda 100'den sonrası panelde **yok gibi görünüyor** |
| **A2** | **Stok kolonu: rozet + sayı** (Spree/WooCommerce deseni) — `0 → kırmızı "Tükendi"`, `1..eşik → amber "N adet"`, `> eşik → nötr "N adet"`. `ProductSearchOut`'a `stock: number \| null` eklenmeli (şu an yalnız `in_stock: boolean` var ve o da basılmıyor) | ürün listesi | **S** | **"X kitabından kaç adet var"** — bugün modal açmadan cevaplanamıyor |
| **A3** | **Stok durumu filtresi**: `?stok=tukendi\|azalan\|var`. Eşik `LOW_STOCK_THRESHOLD` olarak tek yerde (dashboard zaten `stock <= 5` kullanıyor — aynı sabite bağlanmalı) | ürün listesi | **S** | **"Stoğu bitenler hangileri"** ve **"neyi yeniden sipariş edeyim"** — ikisi de bugün cevapsız |
| **A4** | **Dashboard "Düşük stok" kartını filtreli URL'e bağla** (`ROUTES.adminStoreProducts + "?stok=azalan"`). Bugün kart filtresiz listeye gidiyor: sayıyı görüyorsun, listeyi göremiyorsun | Genel Bakış + ürün listesi | **S** *(A3'e bağlı)* | Alarm kartının işe yaraması |
| **A5** | **Ürün araması** (`q`) — uca `q` param'ı, `search_vector`'a **ISBN + SKU** eklenmesi, 13 haneli rakam dizisinin **tam eşleşmeye** yönlendirilmesi | ürün listesi + vitrin araması | **M** | "Palme fizik nerede" · barkod okutup kitabı bulmak · **bugün ISBN ile hiçbir yerde arama yapılamıyor** |
| **A6** | **Yayınevi / yazar filtresi** — `search_products` bunları **zaten destekliyor**, admin listesine bağlanması yeter | ürün listesi | **S** *(A5 ile birlikte)* | "Palme'de kaç başlık var, kaçı bitmiş" |
| **A7** | **Sipariş listesine durum filtresi** — uç `?status=` **zaten kabul ediyor**, `useAdminOrders(statusFilter)` parametreyi **zaten taşıyor**, `OrdersPanel` argümansız çağırıyor. Tek `<select>` + URL param | `/yonetim/magaza/siparisler` | **S** | "Ödenmiş ama hazırlanmamış olanlar" — bugün ekranda tek filtre kontrolü yok |
| **A8** | **Sipariş tarih ön ayarları**: `Bugün · Son 7 gün · Son 30 gün · Son 90 gün · Özel` (Shopify+Medusa'nın birebir aynı beşlisi). Uca `created_at` aralığı eklenmeli | sipariş listesi | **M** | **"Bugünün siparişleri"** — bugün gözle tarama gerektiriyor |
| **A9** | **Sipariş listesi kolonları + rozetler**: `#No · Tarih · Müşteri · Kalem · Toplam · Ödeme · Durum`. Ham enum (`PAID`, `SHIPPED`) yerine mevcut `Badge` bileşeni | sipariş listesi | **S** | "Bu sipariş hangi aşamada" — bugün İngilizce enum okunuyor |
| **A10** | **"Sonuç yok" ≠ "kayıt yok"** ayrımı — `EmptyState`'e ikinci varyant (Medusa deseni). Filtre eklenince zorunlu hâle geliyor | tüm filtreli listeler | **S** | "Ürün yok" yazısını görüp katalogun boşaldığını sanmak |
| **A11** | **Sessiz kesilmeyi bitir** — her listede toplam sayı; sayfalama yoksa "ilk N gösteriliyor" uyarısı | Mağaza 5 sekme + Hakedişler + Yetkiler + Kütüphaneler + Katalog + Hata Çözme | **S** | "Panelde göremediğim kayıt var mı" — bugün cevap sessizce "evet" |
| **A12** | **Ürün seçici** (autocomplete) — sayım oturumu ve hasar kaydında ham ID yazma yerine. A5'in araması varsa küçük iş | Envanter/Sayımlar, Envanter/Hasar | **S** *(A5'e bağlı)* | "12, 34, 56" yazarak sayım açmak; bugün yönetici ürün numarasını başka ekrandan not ediyor |

### B. Sektör standardı, bizde yok, PAHALI
*(Yeni altyapı, yeni sözleşme veya yeni tablo gerektirir.)*

| # | Öneri | Etkilenen ekran | Büyüklük | Çözdüğü somut operasyonel soru |
|---|---|---|---|---|
| **B1** | **Sipariş detay sayfası** — `/yonetim/magaza/siparisler/:id`, Medusa'nın iki kolonlu düzeni: **ana** = kalemler (görsel+başlık+adet+fiyat), ödeme özeti, teslimat/paket durumu, aksiyonlar; **yan** = müşteri + adres (maskeli), sipariş zaman çizelgesi. Uç tarafında sipariş kalemlerini + durum geçmişini veren tekil uç gerekir | yeni ekran + `store.py` | **L** | **"Müşteri arıyor, ne gönderdik?"** — bugün sipariş kuyruklardan düştüyse kalemlerini gösteren ekran yok. En büyük tekil boşluk. |
| **B2** | **Satır seçimi + toplu işlem çubuğu**, ve üstüne **toplu fiyat/durum güncelleme** ucu. Spree'nin kuralı korunmalı: seçim sayfa başına ve geçicidir, sayfa/sıra/filtre değişince silinir | ürün listesi (+ sonra sipariş, envanter) | **L** | **"Toplu fiyat güncellemesi"** — bugün imkânsız; CSV yalnız oluşturuyor, mevcut ISBN atlanıyor. Zamlı liste geldiğinde tek tek ürün açmak gerekiyor. |
| **B3** | **Kayıtlı görünümler** (isimli filtre presetleri). Ölçeğimizde **Saleor'un localStorage yolu doğru seçim** — sunucu tarafı tablo (Shopify yolu) bizim için aşırı | filtreli listeler | **M–L** | "Her sabah baktığım liste" · "stoğu biten kitaplar" görünümünü tek tıkla açmak |
| **B4** | **Kolon seçici + kalıcılık** — Vendure'ün `pageId` başına kullanıcı ayarı deseni; kolon **görünürlüğü** kalıcı depoya, **veri seçimi** URL'de kalır | DataTable'lı tüm ekranlar | **M** | "Bana ISBN ve maliyet lazım, kanal lazım değil" |
| **B5** | **Komut paleti (Ctrl/⌘+K)** — Medusa/Spree deseni: kayıt arama (ürün/sipariş/kullanıcı/kütüphane) + navigasyon + komutlar. `cmdk` yeni bağımlılık; ancak **not:** projede Görevler modülünde `TaskCommandPalette` **zaten elle yazılmış** — o desen yeniden kullanılabilir, yeni bağımlılık gerekmeyebilir | panel geneli | **L** | 36 route'lu bir panelde "şu ekrana nasıl gidiyordum" |
| **B6** | **Düşük stok eşiğinin yapılandırılabilir olması** (WooCommerce: global varsayılan + ürün bazında ezme). Bugün `5` koda gömülü | ayarlar + ürün formu | **M** | "Çok satan başlıkta eşik 5 çok geç, 20 olmalı" |
| **B7** | **Yavaş dönen başlık raporu** — kitapçıya özgü (§5.3). Satış hareketleri defterde zaten var; eksik olan sorgu ve ekran | yeni rapor ekranı | **M** | "Hangi kitaplar rafta duruyor, hangilerini iade edeyim" |

### C. Güzel ama bizim ölçeğimizde gereksiz

| # | Ne | Neden bizde gereksiz |
|---|---|---|
| **C1** | **glide-data-grid / sanallaştırılmış düzenlenebilir tablo** (Saleor) | On binlerce satırı tek ekranda tutmak için. Bizde 25'lik sayfa yeterli; ağır yeni bağımlılık, kendi tema/erişilebilirlik dünyasını getirir ve mevcut Tailwind dilimizin dışında kalır. Vendure ve Spree bilerek TanStack Table + shadcn'de kalmış. |
| **C2** | **İmleç (cursor) tabanlı sayfalama** | `OFFSET n`'in çöktüğü ölçek için. Günde onlarca sipariş, binlerce üründe offset fazlasıyla yeter — yeni nesil paneller (Vendure, Spree) zaten offset'e dönmüş. |
| **C3** | **Sonsuz kaydırma** | Hiçbir incelenen panelde yok; sayım/mutabakat işinde "kaçıncı kayıttayım" bilgisini yok eder. |
| **C4** | **Kart/döşeme ↔ tablo görünüm anahtarı** (Saleor) | Görsel kataloğu tarama için. Yönetim işimiz sayı okuma işi; ikinci bir görünüm bakım yüküdür. |
| **C5** | **Yoğunluk (compact/comfortable) seçici** | İncelenen **hiçbir** panelde kullanıcıya açık bir yoğunluk seçici bulunamadı. Sektörde bile yok; bizde hiç gerekmez. |
| **C6** | **Çok konumlu envanter kolonları** (Unavailable/Committed/On hand/Incoming) | §4.2 — tek depo, ödeme anında düşen stok. Dördü boş kolon olurdu. |
| **C7** | **Dinamik öznitelik/metafield kolonları** | §4.8 — künyemiz sabit ve bilinen. |
| **C8** | **Operatörlü filtre kural kurucusu** (Spree/Sylius: contains/starts with/is set…) | Filtrelenecek alan ~10'u geçince değer kazanıyor. Bizde ürün için 4–5 (durum, tür, stok, yayınevi, kategori), sipariş için 3–4 eksen var. Basit çoklu seçim (Medusa/Vendure yolu) doğru boy. |
| **C9** | **Backorder üçüncü stok durumu** | §4.6 — bizde stok 0 → satılamaz. Karşılığı olmayan vaat. |
| **C10** | **Taslak sipariş oluşturma** | §4.7 — admin sipariş oluşturmuyor. |

### 7.1 Bağımlılık sırası

```
A1 (DataTable'a taşı)
 ├─ A2 (stok kolonu)      ──┐
 ├─ A3 (stok filtresi)    ──┼─ A4 (dashboard kartını bağla)
 ├─ A5 (arama + ISBN/SKU) ──┼─ A6 (yayınevi/yazar filtresi)
 │                          └─ A12 (ürün seçici → sayım/hasar)
 ├─ A10 (sonuç yok/kayıt yok)
 └─ A11 (toplam sayı / kesilme uyarısı)

A7 (sipariş durum filtresi) ── A8 (tarih ön ayarları) ── A9 (kolonlar+rozetler)
                                                          └─ B1 (sipariş detayı)

B2 (toplu işlem) · B3 (kayıtlı görünüm) · B4 (kolon seçici)  → A1 tamamlandıktan sonra
```

A grubunun tamamı mevcut `DataTable`, `Badge`, `EmptyState`, `parseAdminUserQuery`/`setQueryValue`
bileşenleriyle yapılabilir. **Yeni kütüphane gerekmiyor** — TanStack Table zaten kurulu ve
`DataTable` onu kullanıyor. Tek yeni bağımlılık adayı B5'in `cmdk`'sı ve o bile, projede
`TaskCommandPalette` elle yazıldığı için tartışmalı.

---

## 8. Doğrulanamayanlar

Dürüstlük payı: aşağıdakileri bulamadım ve tahmin yürütmedim.

- Shopify sipariş **detay** sayfasının bölüm düzeni (ana kolon / yan kolon dağılımı). Help Center
  yalnız Timeline'ın varlığını doğruluyor.
- Shopify sipariş arama çubuğunun neyi eşleştirdiği (sipariş no, müşteri, e-posta, SKU, takip no).
- Shopify'da sıralamanın kayıtlı görünüme dahil olup olmadığı: **iki resmî doküman çelişiyor** —
  görünümler sayfası "sort order isn't maintained" diyor, sipariş filtreleme sayfası "views are
  created with saved filters, column choices, column order, and sort order" diyor.
- Shopify ürün listesinde düşük stok için renkli rozet/eşik olup olmadığı.
- Medusa, Saleor, Vendure, Spree'nin dar ekran davranışı (kart listesine dönüşüyor mu, yatay mı
  kayıyor).
- Saleor ve Vendure'de komut paleti olup olmadığı (Vendure'de `command.tsx` bileşeni var ama panel
  geneli bir palet olarak kullanıldığını doğrulayamadım).
- Hiçbir panelde yıkıcı aksiyonların (iptal/iade) nasıl korunduğuna dair belgelenmiş bir desen.
- Medusa ve Saleor sipariş listelerinin varsayılan sıralaması.
- Kitapçı yazılımlarının (Basil, ShelfPerks, Candela) gerçek ekran düzeni — yalnız pazarlama
  metinleri okunabildi, ekran görüntüsü veya kod yok.

---

## Kaynaklar

**Okunan kaynak kod (GitHub API):**
- [medusajs/medusa](https://github.com/medusajs/medusa) — `packages/admin/dashboard/src/` altında
  `routes/products/product-list/components/product-list-table/product-list-table.tsx`,
  `hooks/table/columns/use-product-table-columns.tsx`,
  `hooks/table/columns/use-order-table-columns.tsx`,
  `hooks/table/query/use-product-table-query.tsx`,
  `hooks/table/filters/use-product-table-filters.tsx`,
  `hooks/table/filters/use-order-table-filters.tsx`,
  `components/table/data-table/data-table-filter/date-filter.tsx`,
  `routes/orders/order-detail/order-detail.tsx`,
  `routes/inventory/inventory-list/components/inventory-list-table.tsx`,
  `routes/inventory/inventory-list/components/use-inventory-table-columns.tsx`,
  `components/search/constants.ts`, `components/search/search.tsx`,
  [`i18n/translations/en.json`](https://raw.githubusercontent.com/medusajs/medusa/develop/packages/admin/dashboard/src/i18n/translations/en.json)
- [saleor/saleor-dashboard](https://github.com/saleor/saleor-dashboard) — `src/products/components/ProductListPage/ProductListPage.tsx`,
  `ProductListPage/filters.ts`, `src/products/components/ProductListDatagrid/ProductListDatagrid.tsx`,
  `ProductListDatagrid/datagrid.ts`, `src/orders/components/OrderListDatagrid/datagrid.ts`,
  `src/components/Datagrid/Datagrid.tsx`, `src/utils/filters/storage.ts`, `src/hooks/useListSettings.ts`,
  `src/products/views/ProductList/ProductList.tsx`
- [vendure-ecommerce/vendure](https://github.com/vendure-ecommerce/vendure) — `packages/dashboard/src/app/routes/_authenticated/_products/products.tsx`,
  `_orders/orders.tsx`, `_orders/orders_.$id.tsx`, `packages/dashboard/src/lib/framework/page/list-page.tsx`
- [spree/spree](https://github.com/spree/spree) — `packages/dashboard/src/tables/products.tsx`,
  `tables/orders.tsx`, `search/default.tsx`, `packages/dashboard-core/src/components/table-toolbar.tsx`,
  `components/resource-table.tsx`
- [woocommerce/woocommerce](https://github.com/woocommerce/woocommerce) — `plugins/woocommerce/includes/admin/list-tables/class-wc-admin-list-table-products.php`,
  `plugins/woocommerce/includes/wc-stock-functions.php`
- [Sylius/Sylius](https://github.com/Sylius/Sylius) — `src/Sylius/Bundle/AdminBundle/Resources/config/grids/product.yml`,
  `order.yml`, `inventory.yml`
- [Shopify/polaris](https://github.com/Shopify/polaris) — `polaris-react/src/components/IndexFilters/IndexFilters.tsx`,
  `polaris-react/src/components/IndexTable/IndexTable.tsx`

**Resmî dokümantasyon:**
- [Medusa — Data Table component](https://docs.medusajs.com/resources/admin-components/components/data-table)
- [Shopify — Searching and filtering your lists using views](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/searching-filtering-views)
- [Shopify — Searching for products and filtering your product list](https://help.shopify.com/en/manual/products/searching-filtering)
- [Shopify — Filtering orders](https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders/filtering-orders)
- [Shopify — Searching and viewing orders](https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders/searching-orders)
- [Shopify — Viewing inventory](https://help.shopify.com/en/manual/products/inventory/adjusting-inventory/viewing-inventory)
- [Shopify — Adjusting inventory quantities](https://help.shopify.com/en/manual/products/inventory/adjusting-inventory/adjusting-inventory-quantities)
- [Shopify — Viewing inventory adjustment history](https://help.shopify.com/en/manual/products/inventory/adjusting-inventory/adjustment-history)

**Kitap/yayıncılık (düşük kanıt gücü — yalnız satıcı sayfaları):**
- [Basil Bookseller Software — Inventory](https://basilsoftware.com/inventory)
- [ShelfPerks — Bookstore OS](https://shelfperks.com/business-types/book-store)
- [Candela RMS — Bookstore software](https://www.candelarms.com/books-stationery-retail-software/)
- [CLZ Books](https://clz.com/books/book-inventory)

**Kendi kodumuzdan ölçülenler:**
`frontend/src/pages/dashboards/AdminStore.tsx` · `frontend/src/components/admin/data-table/DataTable.tsx` ·
`frontend/src/lib/adminUserQuery.ts` · `frontend/src/lib/stockMovements.ts` ·
`frontend/src/pages/admin/AdminDashboardPage.tsx` · `frontend/src/pages/admin/inventory/CountSessionsPage.tsx` ·
`frontend/src/hooks/useStore.ts` · `frontend/src/types/index.ts` ·
`backend/api/routers/store.py` · `backend/services/store_service.py` · `backend/services/order_service.py` ·
`backend/services/admin_service.py` · `backend/models/store.py`
