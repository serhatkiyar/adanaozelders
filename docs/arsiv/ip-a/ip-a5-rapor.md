# İP-A5 — `AdminStore.tsx` bölme (davranış değişmez)

Taban: `44765c7` (İP-A4) · Dal: `feat/medusa-ui-taban`

`AdminStore.tsx` 2216 satırdı; panelin en büyük tek dosyası ve adsız kontrol
borcunun en yoğun noktasıydı (26 kalem). Bu paket onu **böldü**, **göç etmedi**.

## Kapı (paket sonu)

| Kapı | Öncesi | Sonrası |
|---|---|---|
| `tsc --noEmit` | temiz | temiz |
| `npm run build` | başarılı (42.6 s) | başarılı (30.9 s) |
| `npm run lint` | 0 hata / 32 uyarı | 0 hata / 32 uyarı (yeni dosyalarda **0**) |
| Vitest | 114 dosya / 1152 test ✅ | **115 dosya / 1160 test** ✅ |
| `--sequence.shuffle`, 6 seed | — | 6/6 yeşil (aşağıda) |
| Mutasyon provası | — | **8/8 yakalandı**, ağaç her seferinde bayt-bayt temiz |

Test artışının tamamı bu paketin EKLEDİĞİ nöbetçidir: +1 dosya / +5 test
davranış sondası, +3 test sayacın kendi nöbetçisi. **Mevcut hiçbir test
değişmedi** (tek istisna, aşağıda tek tek gerekçelendirilen ölçüm tabanı
listeleri).

---

## Görev 0 — Bölme öncesi taban

Ölçüm `44765c7` HEAD'inde, hiçbir dosyaya dokunulmadan alındı.

| Ölçüm | Değer |
|---|---|
| ölçüm tabanı dosya sayısı | 72 |
| ham `<button` | 158 |
| adsız form kontrolü | 56 (ölçülen toplam kontrol 167) |
| etiketsiz overlay | 5 |
| ekranda yaşayan pencere durumu | 33 (sayaç düzeltilmeden önce — bkz. Görev 3a) |
| `ui2/` dışı Medusa importu | 0 |

`AdminStore.tsx`in TEK BAŞINA taşıdığı pay:

| Ölçüm | AdminStore.tsx |
|---|---|
| ham `<button` | **28** (tabanın %17,7'si) |
| ölçülen form kontrolü | 48 |
| adsız form kontrolü | **26** (tabanın %46,4'ü) |
| etiketsiz overlay | 1 (`EditProductModal`) |
| pencere durumu adı | 4 (`decision`, `deleting`, `iadeSiparisi`, `teslimSiparisi`) |

### Dosyaya dokunan testler (öncesi)

| Dosya | Test |
|---|---|
| `adminStorePanel.acceptance.test.tsx` | ürün listesi/DataTable, sunucu sayfalama, sıralama, stok rozeti, filtreler |
| `adminStoreVariants.acceptance.test.tsx` | varyant grubu, eksen sözlüğü, türetme |
| `adminStoreLabels.acceptance.test.tsx` | ürün türü etiketi, künye bölümü davranışı |
| `adminStoreDigitalGate.acceptance.test.tsx` | dijital ürün bayrağı (fail-closed) |
| `adminStoreCategoryTax.acceptance.test.tsx` | kategori KDV ön-doldurma/ezme |
| `adminSafetyStates.acceptance.test.tsx` | yıkıcı aksiyon onay sözleşmesi, hata≠boş durum |
| `__guards__/uiBaseline.test.ts` · `__guards__/sayim.test.ts` | nöbetçi eşikleri |

Hepsi `AdminStore` **varsayılan dışa aktarımını** import ediyor; bölme bu
yüzeyi değiştirmediği için hiçbiri düzenlenmedi.

### Bundle (öncesi)

`dist/assets/AdminStore-BQ77MQKd.js` — **61 193 bayt** (gzip 16,93 kB).
Toplam varlık sayısı: **209**.

---

## Görev 1 — Dosya haritası

> **A6 bu bölümü okuyacak.** Satır numaraları bölme ÖNCESİ dosyaya aittir.

| Satır | Bildirim | Ne yapar | Nereye gitti |
|---|---|---|---|
| 1–85 | import bloğu | 70+ sembol, altı bölümün hepsine karışık | bölümlere dağıtıldı |
| 86–93 | `type SubTab` | altı sekmenin birliği | **kaldı** |
| 95–96 | `ALAN_BASLIGI` | select üstü küçük başlık sınıfı | `ProductForm.tsx` (tek kullanıcı) |
| 98–105 | `STORE_ROUTES` | sekme → rota | **kaldı** |
| 107–116 | `TAB_AREA` | sekme → backend izin alanı | **kaldı** |
| 118–170 | `AdminStore` | sekme çubuğu + panel seçimi | **kaldı** (düzenleyici) |
| 174–374 | `ProductsPanel` | ürün listesi, DataTable, kolonlar, URL durumu | `store/ProductsPanel.tsx` |
| 376–453 | `UrunFiltreCubugu` | arama/stok/yayınevi/yazar şeridi | `store/ProductsPanel.tsx` |
| 455–475 | `UrunHucresi` | görsel + başlık + künye | `store/ProductsPanel.tsx` |
| 477–489 | `URUN_DURUM_ETIKETI`, `UrunDurumRozeti` | durum rozeti | `store/ProductsPanel.tsx` |
| 491–884 | `ProductForm` | **394 satır** — oluşturma + düzenleme formu | `store/ProductForm.tsx` |
| 886–1089 | `VariantMembershipFields` | varyant grubu/eksen/kardeşler | `store/ProductForm.tsx` |
| 1091–1193 | `DeriveVariantForm` | "bu üründen varyant türet" | `store/ProductForm.tsx` |
| 1195–1281 | `UrunAksiyonlari` | satır aksiyonları + silme onayı | `store/ProductsPanel.tsx` |
| 1283–1326 | `EditProductModal` | ham overlay + form + stok defteri | `store/EditProductModal.tsx` |
| 1330–1423 | `BulkImportPanel` | CSV şablonu + içe aktarma | `store/BulkImportPanel.tsx` |
| 1427–1503 | `CategoriesPanel` | kategori ekle/sil | `store/CategoriesPanel.tsx` |
| 1505–1600 | `KategoriKdvRozeti` | satır içi varsayılan KDV düzenleme | `store/CategoriesPanel.tsx` |
| 1604–1870 | `OrdersPanel` | sipariş tablosu, kargola/teslim/iade | `store/OrdersPanel.tsx` |
| 1872–1887 | `ShipButton` | takip no + Kargola | `store/OrdersPanel.tsx` |
| 1891–1895 | `RETURN_STATUS_LABELS` | iade durum sözlüğü | `store/ReturnsPanel.tsx` |
| 1897–2036 | `ReturnsPanel` | iade kuyruğu, onayla/reddet | `store/ReturnsPanel.tsx` |
| 2040–2048 | `EMPTY_COUPON` | boş kupon formu | `store/CouponsPanel.tsx` |
| 2050–2216 | `CouponsPanel` | kupon oluştur/listele/sil | `store/CouponsPanel.tsx` |

Kalan satırlar yalnız boş satırlar ve altı bölüm başlığı yorumu
(`/* ── Ürünler ── */` gibi); her biri yeni dosyanın kendi doküman başlığıyla
karşılandı. Kaybolan üretim satırı **yoktur** — bu satır satır doğrulandı
(aşağıda).

### Paylaşılan durum — kritik nokta

**Bölümler arasında paylaşılan hiçbir React durumu yok.** Ölçüldü, varsayılmadı:

| Zemin | Kim kullanıyor | Bölmede ne oldu |
|---|---|---|
| `useSearchParams` (URL) | `ProductsPanel` (arama/filtre/sayfa), `OrdersPanel` (durum) | ikisi de kendi `useSearchParams`'ını çağırıyor — panel başına bağımsız, prop yok |
| React Query önbelleği | hepsi (`useInvalidateAdminStore`) | hook zaten paylaşımlı, dosya sınırından etkilenmez |
| `useAdminAreaAccess(alan)` | her panel kendi alanı için | panel başına bağımsız |
| `useAuthStore` izinleri | yalnız düzenleyici (sekme çubuğu) | düzenleyicide kaldı |
| `ALAN_BASLIGI` | yalnız `ProductForm` | onunla taşındı |

**Karar: prop geçirme YOK, durum yukarı taşıma YOK.** Gerekçe: durum yukarı
taşımak (ör. arama taslağını düzenleyiciye çıkarmak) her tuş vuruşunda ALTI
panelin ebeveynini render ettirirdi; prop geçirmek ise bugün var olmayan bir
bağımlılığı uydururdu. Panellerin tek ortak zemini zaten URL ve sorgu
önbelleği — ikisi de dosya sınırından bağımsız çalışır.

`ProductForm` ile `EditProductModal` arasındaki tek gerçek bağ prop
sözleşmesidir (`mode`/`initial`/`onDone`) ve aynen korundu.

### Bölme planı (haritadan türetildi)

`src/components/admin/store/` altında sekiz dosya:

| Dosya | Satır | İçerik |
|---|---|---|
| `ProductForm.tsx` | 740 | form + varyant üyeliği + türetme (en büyük tek parça) |
| `ProductsPanel.tsx` | 444 | liste + filtre çubuğu + hücreler + satır aksiyonları |
| `OrdersPanel.tsx` | 311 | sipariş tablosu + `ShipButton` |
| `CouponsPanel.tsx` | 195 | kupon oluştur/listele |
| `CategoriesPanel.tsx` | 188 | kategori + KDV rozeti |
| `ReturnsPanel.tsx` | 159 | iade kuyruğu |
| `BulkImportPanel.tsx` | 104 | CSV |
| `EditProductModal.tsx` | 59 | ham overlay (A6'nın hedefi) |
| `pages/dashboards/AdminStore.tsx` | **106** | yalnız düzenleyici |

Neden `components/admin/store/`: sayaç `components/admin/**` ağacını zaten
tarıyor, yani yeni dosyalar ölçüm tabanına **kendiliğinden** girdi. Ekranı
`pages/dashboards/` altında bir alt klasöre bölseydim dosyalar ölçüm dışında
kalırdı (`walk` orada yalnız `Admin*.tsx` kalıbını alıyor) ve borç sessizce
ölçümden kaçardı — denetimin P1-4'te tarif ettiği tuzağın tam kendisi.

`EditProductModal` kendi dosyasına ayrıldı: nöbetçinin "etiketsiz overlay"
listesindeki beş kalemden biri odur ve A6 onu tek dosyada bulacak.

---

## Görev 2 — Bölme

**Hiçbir JSX değişmedi.** Bu iddia denetlenebilir biçimde kanıtlandı: bölme
elle değil, satır aralıklarını **bayt bayt kopyalayan** bir betikle yapıldı ve
sonuç `git show HEAD:...AdminStore.tsx` ile satır satır karşılaştırıldı:

```
AYNI  ProductForm.tsx      (3 blok)     AYNI  CategoriesPanel.tsx  (2 blok)
AYNI  EditProductModal.tsx (1 blok)     AYNI  OrdersPanel.tsx      (2 blok)
AYNI  BulkImportPanel.tsx  (1 blok)     AYNI  ReturnsPanel.tsx     (2 blok)
AYNI  ProductsPanel.tsx    (5 blok)     AYNI  CouponsPanel.tsx     (2 blok)
AYNI  AdminStore.tsx       (düzenleyici gövdesi)
```

Kopyaya izin verilen **tek** fark, taşınan üst düzey bildirime eklenen
`export ` önekidir. Ham `<button>`ler `Button`a çevrilmedi, etiket
eklenmedi, sınıf düzeltilmedi, `EditProductModal` ortak `Dialog`a
taşınmadı — hepsi A6'nın işi.

Ayrıca orijinal dosyanın **her satırı** hesaba katıldı: yeni bir yere gitmeyen
boş olmayan satırlar yalnız (a) import bloğu (bölümlere dağıtıldı), (b)
`ALAN_BASLIGI` (tek kullanıcısıyla taşındı) ve (c) altı bölüm başlığı yorumu
(`/* ── Ürünler ── */` …). Üretim kodu satırı düşmedi.

Bölmenin gerektirdiği tek elle düzeltme: `CouponsPanel` `getErrorDetail`
kullanıyordu ve otomatik başlık bunu atlamıştı — import eklendi (tsc yakaladı).

### Ölçüm tabanı listesinin güncellenmesi

`__guards__/uiBaseline.test.ts` içindeki iki isim listesi ve sayaçtaki overlay
listesi güncellendi. Üçünün de değişmesi **zorunluydu**; aksi hâlde nöbetçi
kırılırdı (istenen davranış):

1. **`OLCUM_TABANI`** — sekiz yeni dosya eklendi (72 → **80** dosya).
   Eklenmeseydi 26 adsız kontrol + 28 ham buton + 1 overlay ölçümde
   görünmeye devam eder ama liste testi kırılırdı.
2. **`MODAL_DURUM_DOSYALARI`** — `AdminStore.tsx` çıktı, beş bölüm dosyası
   girdi (`ProductsPanel`, `CategoriesPanel`, `OrdersPanel`, `ReturnsPanel`,
   `CouponsPanel`).
3. **`UNLABELED_OVERLAY_FILES`** (sayaç betiği) — `AdminStore.tsx` yerine
   `store/EditProductModal.tsx`. Overlay sayısı değişmedi (5), yalnız
   hangi dosyada durduğu değişti.

---

## Görev 3 — Bölmenin mekanik olduğunun kanıtı

### 3a — Nöbetçi sayıları

| Ölçüm | Öncesi | Sonrası | Değişim |
|---|---|---|---|
| ham `<button` | **158** | **158** | — |
| adsız form kontrolü | **56** | **56** | — |
| etiketsiz overlay | **5** | **5** | — |
| ekranda yaşayan pencere durumu | **35**\* | **35** | — |
| ölçülen toplam form kontrolü | 167 | 167 | — |
| `ui2/` dışı Medusa importu | 0 | 0 | — |
| ölçüm tabanı dosya sayısı | 72 | 80 | +8 (bölme) |

\* Yıldızlı satır bu paketin **tek gerçek sayı değişikliğidir** ve borçtan
değil, **sayacın kendisinden** geliyor. Tek tek:

> **Pencere durumu 33 → 35: sayaç düzeltildi, borç artmadı.**
>
> Metriğin yazılı sözleşmesi "bağ başına bir kez"di (İP-A4 raporu). Uygulama
> ise dosya başına bir `Set<ad>` tutuyordu; yani **aynı dosyadaki iki ayrı
> bileşenin aynı adlı iki bağı TEK bağ sayılıyordu**. `AdminStore.tsx`te üç
> ayrı `deleting` bağı vardı (ürün satırı, kategori satırı, kupon satırı) ve
> ikisi görünmüyordu.
>
> Bölme bu kusuru görünür etti: üç bağ üç ayrı dosyaya gidince **aynı JSX**
> için sayaç 33 yerine 35 diyecekti. Yani ölçüm aleti, ölçtüğü şeyin dosyalara
> nasıl dağıldığına bağlıydı — bu paketin varlık sebebiyle doğrudan çelişir.
>
> Sayaç artık bağı ADIYLA değil **bildirim yeriyle** ayırt ediyor (sözlüksel
> kapsam: kullanım yerindeki ad, ataları arasındaki en içteki eşleşen
> `useState` bağına çözülür). Düzeltilmiş sayaçla ölçüm bölmeden **önce de
> sonra da 35**. Eşik 33 → 35'e çekildi; yön ("artamaz") ve hedef (0)
> değişmedi.
>
> Alternatif — sayacı düzeltmeden eşiği 35'e çekmek — de aynı sayıyı verirdi
> ama metrik dosya sınırına duyarlı kalır, her bölmede eşik bir kez daha
> tırmanırdı.

Sayacın yeni davranışı üç yeni testle sabitlendi (`sayim.test.ts`, mevcut 26
test değiştirilmedi): aynı dosyada iki ayrı bileşenin aynı adlı bağı **iki**
sayılır · aynı bileşenin tek bağı iki pencerede geçse **bir** sayılır · iç içe
fonksiyonda kullanılan dış bağ hâlâ çözülür (`cell: () => <XDialog open={acik}/>`).
İlk test eski sayaçla kırmızıdır — düzeltmenin ters provası budur.

**Dosya dağılımı** (toplamlar sabit, yer değişti):

| Dosya | ham buton | kontrol | adsız | overlay | pencere durumu |
|---|---|---|---|---|---|
| `ProductForm.tsx` | 7 | 31 | **17** | — | — |
| `ProductsPanel.tsx` | 5 | 5 | 0 | — | `deleting` |
| `CategoriesPanel.tsx` | 5 | 2 | 1 | — | `deleting` |
| `CouponsPanel.tsx` | 3 | 6 | **6** | — | `deleting` |
| `OrdersPanel.tsx` | 3 | 2 | 1 | — | `iadeSiparisi`, `teslimSiparisi` |
| `BulkImportPanel.tsx` | 2 | 1 | 1 | — | — |
| `ReturnsPanel.tsx` | 2 | 1 | 0 | — | `decision` |
| `EditProductModal.tsx` | 1 | 0 | 0 | **1** | — |
| `AdminStore.tsx` (düzenleyici) | **0** | 0 | 0 | 0 | — |
| **toplam** | **28** | **48** | **26** | **1** | **5 bağ** |

Bölme öncesi `AdminStore.tsx`in tek başına taşıdığı sayılarla birebir aynı.
Düzenleyicide **sıfır** borç kaldı.

### 3b — Testler

| | Öncesi | Sonrası |
|---|---|---|
| test dosyası | 114 | 115 (+1: davranış sondası) |
| test | 1152 | 1160 (+5 sonda, +3 sayaç nöbetçisi) |
| sonuç | tümü yeşil | tümü yeşil |
| **değiştirilen mevcut test** | — | **0** |

Ölçüm tabanı listeleri (`OLCUM_TABANI`, `MODAL_DURUM_DOSYALARI`,
`UNLABELED_OVERLAY_FILES`) ve pencere durumu eşiği güncellendi; ikisi de bir
davranış iddiası değil, nöbetçinin zeminidir ve paketin görev tanımında
güncellenmesi zaten isteniyordu. Bir davranış testinin **tek satırı**
değişmedi.

### 3c — Bundle

| | Öncesi | Sonrası | Fark |
|---|---|---|---|
| `AdminStore` chunk | `AdminStore-BQ77MQKd.js` · 61 193 B | `AdminStore-CgfXh3qt.js` · 61 205 B | **+12 B (%0,02)** |
| gzip | 16,93 kB | 17,08 kB | +0,15 kB |
| toplam varlık sayısı | 209 | 209 | — |
| başka chunk değişimi | — | — | **yok** (dosya adı diff'i tek satır) |

Sekiz yeni modülün tamamı **aynı lazy chunk'ta** kaldı: yeni chunk doğmadı,
mevcut sınırlar kaymadı, ortak parçalar `DataTable`/`index` chunk'larına
sızmadı. +12 bayt, modül sınırı başına düşen sarmalayıcı maliyetidir.
Sayfanın ilk yüklenme davranışı değişmedi.

### 3d — Davranış sondası

`src/pages/dashboards/adminStoreBolme.acceptance.test.tsx` — **bölmeden ÖNCE**
yazıldı, önce yeşil koştu, bölme sırasında ağ görevi gördü.

Neden gerekliydi: mevcut altı kabul testi ekranın İÇ davranışlarını sıkı
tutuyor ama hepsi ekranı doğrudan tek bir alt-rotada render ediyor. Hiçbiri
**sekmeler arası geçişi** ve **pencerelerin açılıp kapanmasını** aynı oturumda
sürmüyordu — yani bölmenin kırabileceği tek şey (düzenleyici ↔ bölüm bağı)
kapsam dışıydı.

| Sonda | Ne sürüyor | Öncesi | Sonrası |
|---|---|---|---|
| S-1 | altı sekmede gerçek `NavLink` gezinmesi; her sekme kendi panelini basıyor | ✅ | ✅ |
| S-1b | izinsiz sekme çubuğa hiç girmiyor | ✅ | ✅ |
| S-2 | onay penceresi aç/kapa; vazgeçince DELETE gitmiyor | ✅ | ✅ |
| S-3 | düzenleme penceresi aç/kapa; detay isteği gidiyor, form doluyor | ✅ | ✅ |
| S-4 | liste `limit`/`offset` ile sunucudan geliyor, iki satır da basılıyor | ✅ | ✅ |

Sonda "element var mı" testi değildir: her düğümde ya gerçekten gönderilen
istek ya da DOM'da görünen sonuç okunur.

---

## Görev 4 — Eşikler ve mutasyon provası

Sürücü `git checkout --` KULLANMAZ: her mutasyon bellekteki orijinal
baytlarla geri alınır, geri alma SHA-256 ile doğrulanır ve
`git status --porcelain` başta/sonda karşılaştırılır.

### Nöbetçi eşikleri — 5/5

| # | Mutasyon (gerçek JSX) | Kıran iddia | Sonuç |
|---|---|---|---|
| M1 | `CouponsPanel`e ham `<button>` eklendi | ham `<button` ≤ 158 | **YAKALANDI** |
| M2 | `CategoriesPanel`e etiketsiz `<input>` eklendi | adsız kontrol ≤ 56 | **YAKALANDI** |
| M3 | `ReturnsPanel`e yeni `useState` + `<ConfirmDialog open={…}>` | pencere durumu ≤ 35 | **YAKALANDI** |
| M4 | `CouponsPanel`e `fixed inset-0` overlay eklendi | etiketsiz overlay ≤ 5 **ve** ihlalci listesi | **YAKALANDI** |
| M5 | `ProductForm.tsx` **ölçüm tabanı listesinden çıkarıldı** | taban dosya listesi sabittir | **YAKALANDI** |

### Özellikle sınanan: liste tek başına yeterli koruma mu?

Görevin sorusu: *"bir bölümü ölçüm tabanı listesinden çıkarmak eşiği düşürüyor
mu?"* Ölçülen cevap iki katmanlı ve **raporlanması gereken bir zayıflık
içeriyor**:

1. **Listeden çıkarmak eşiği DÜŞÜRMEZ** (M5). Liste ölçümün kaynağı değil,
   kimlik denetimidir; dosya `components/admin/**` ağacında durduğu sürece
   sayılmaya devam eder. Test yalnız "liste ile gerçek küme ayrıştı" der.
2. **Dosyayı ölçüm ağacının DIŞINA taşımak eşikleri gerçekten düşürür.**
   Ölçüldü: `ProductForm.tsx` `src/pages/kacis/` altına taşındığında

   | Ölçüm | Normal | Kaçıştan sonra |
   |---|---|---|
   | ham `<button` | 158 | **151** |
   | adsız form kontrolü | 56 | **39** |

   ve **dört eşiğin dördü de geçmeye devam etti**. Kaçışı yakalayan TEK şey
   isimle sabitlenmiş dosya listesi oldu (`dosyalar` ≠ `OLCUM_TABANI`).

**Sonuç:** eşikler tek başına bir taşımaya karşı kör; koruma tamamen İP-A3c'de
eklenen isim listesine dayanıyor. Liste bilinçsizce "yeşile boyanırsa" (dosya
silinmiş sanılıp çıkarılırsa) nöbetçi susar. Bu, listenin neden elle ve
gerekçeyle güncellenmesi gerektiğinin somut kanıtıdır — İP-A6/A7'de her liste
değişikliği raporda gerekçelendirilmelidir.

### Davranış sondası — 3/3

| # | Mutasyon | Sonuç |
|---|---|---|
| P1 | düzenleyicide "kategoriler" sekmesi `ProductsPanel`e bağlandı | **YAKALANDI** (S-1) |
| P2 | `EditProductModal` hiç render edilmiyor (`{false && editing && …}`) | **YAKALANDI** (S-3) |
| P3 | "Sil" onay penceresini atlayıp doğrudan siliyor | **YAKALANDI** (S-2) |

Sekiz mutasyonun sekizi de yakalandı; her turdan sonra çalışma ağacı
bayt-bayt başlangıç durumuna döndü (`AGAC AYNI MI: True`).

### Kararsızlık kapısı

`--sequence.shuffle` ile altı seed: **6/6 yeşil** (seed 2, 7, 11, 13, 21, 42).

---

## Değişen her şey — tek tek

| Değişen | Neden |
|---|---|
| pencere durumu eşiği 33 → 35 | sayaç kusuru düzeltildi (3a); borç artmadı, aynı JSX doğru sayıldı |
| `OLCUM_TABANI` +8 dosya | bölme; eklenmezse borç ölçümden kaçardı |
| `MODAL_DURUM_DOSYALARI`: `AdminStore.tsx` → 5 bölüm dosyası | pencere durumları yeni dosyalarda yaşıyor |
| `UNLABELED_OVERLAY_FILES`: `AdminStore.tsx` → `store/EditProductModal.tsx` | overlay yeni dosyasına taşındı, sayısı değişmedi |
| `sayim.test.ts` +3 test | düzeltilmiş sayacın nöbetçisi (mevcut 26 test dokunulmadı) |
| yeni sonda dosyası +5 test | bölmenin ağı (3d) |
| `CouponsPanel.tsx` +1 import satırı | `getErrorDetail` bölme sırasında import listesinden düştü, tsc yakaladı |
| bundle +12 bayt | modül sınırı sarmalayıcısı |

**Bunların dışında hiçbir şey değişmedi:** JSX düğümü, sınıf adı, etiket,
davranış, mevcut test, chunk sınırı, lint uyarı sayısı.

---

## A6'ya notlar

Dosyayı satır satır okuyan tek kişi bu paketti; aşağıdakiler **görüldü ama
bilinçli olarak dokunulmadı**.

### 1. `EditProductModal` — ortak `Dialog` kullanmıyor

`store/EditProductModal.tsx`, 59 satır. Kendi `createPortal` + `fixed inset-0`
katmanını kuruyor; `role="dialog"` ve `aria-modal` YOK, `useModalA11y` YOK
(odak tuzağı, Esc, arka plan kilidi yok), kapatma yalnız arkaplan tıklaması ve
sağ üstteki `aria-label="Kapat"` düğmesiyle. Nöbetçinin beş etiketsiz
overlay'inden biri budur. **A6'nın en net hedefi:** `admin/ui/Dialog`a (ya da
`ui2/duzenlemeYuzeyi`ne) taşımak hem overlay sayısını 5 → 4'e indirir hem de
A4'te yazılan odak sözleşmesini bu ekrana getirir. Tek dosyada, 59 satırda.

### 2. 26 adsız kontrolün nerede toplandığı

**17'si `ProductForm.tsx`'te** — ve tamamı aynı desende: `placeholder`
etiket yerine kullanılıyor.

```jsx
<input value={title} onChange={…} placeholder="Ürün adı" className="input sm:col-span-2" />
```

`placeholder` erişilebilir ad değildir (sayaç bunu bilinçli olarak borç
sayıyor, `sayim.test.ts` sabitliyor). Yoğunlaşma noktaları: künye bölümü
(yazar/yayınevi/ISBN/sayfa/ebat/yıl/baskı/dil/kapak — **9 alan arka arkaya**,
satır 340–348) ve fiyat/eski fiyat/stok üçlüsü. Bunların `Form.Field` +
`Form.Label`a çevrilmesi tek başına tabanı **56 → 39**'a indirir.

**6'sı `CouponsPanel.tsx`'te** — altı alanlık kupon ızgarası
(`KOD`/tür/değer/min sepet/maks kullanım/kişi başı), hepsi `placeholder`la
adlandırılmış ve **yerel `inputCls` sabitini** kullanıyor (ortak `.input`
sınıfını bile kullanmıyor). Küçük ve kendi içinde kapalı: A6 için iyi bir
ikinci pilot.

Kalan 3: `BulkImportPanel` (dosya seçici), `CategoriesPanel` (kategori adı),
`OrdersPanel` (`ShipButton` takip no).

**Zaten adlandırılmış olanlar** bozulmasın: `ProductForm`da `aria-label`
taşıyan alanlar var (KDV oranı, Kategori) ve `VariantMembershipFields`in
tamamı `aria-label`lı — 31 kontrolden yalnız 17'sinin borç olmasının sebebi
bu. `UrunFiltreCubugu`nun dördü de `<label>` sarmalayıcısı içinde (borç 0).

### 3. Tekrar eden desenler

| Desen | Nerede | A6 için anlamı |
|---|---|---|
| `className="input"` ham `<input>` | `ProductForm` (çoğu), `CategoriesPanel`, `VariantMembershipFields` | tek `Form.Field` sarmalayıcısı hepsini kapatır |
| yerel `inputCls` sabiti | `CouponsPanel` | ortak sınıfa bile bağlı değil; göçte tamamen silinir |
| `<label className="…">Başlık<input/></label>` | `UrunFiltreCubugu` (4), `OrdersPanel` (1), `ReturnsPanel` (1) | zaten erişilebilir; göçte davranış korunmalı, sayı düşmez |
| `<span className={ALAN_BASLIGI}>` + `<select>` | `ProductForm` (3) | `Form.Label`ın doğal karşılığı |
| ham `<button type="button" className="rounded-lg bg-slate-900 …">` | 8 dosyanın 8'inde, 28 kez | `admin/ui/Button` zaten var; birebir eşlenir |
| katlanır bölüm başlığı (`<button>` + döner ok `<svg>`) | `ProductForm` ×2 (künye, varyant) | ortak bir "katlanır bölüm" parçası çıkarılabilir |
| `ConfirmDialog` + `ReasonDialog` | 5 dosyada 6 kullanım | ortak bileşen; A4 yüzeyine geçiş adayı |

### 4. `ProductForm` hâlâ 740 satır

Bölünen en büyük parça bu ve **tek başına** hâlâ panelin ikinci büyük dosyası.
İçinde 24 `useState`, iki `useEffect` (kategori→KDV ön-doldurma ve kitap
kategorisi→künye açma) ve mutasyon içinde yaşayan bir doğrulama zinciri var.
A6 bunu `Form.*`a taşırken üç ayrı karar verecek: (a) 24 durumu tek form
nesnesine mi indirir, (b) KDV ön-doldurma efektini korur mu (kullanıcının elle
yazdığı değeri ezmeme kuralı testlerle sabit — `adminStoreCategoryTax`), (c)
stok gerekçesi bloğunu (`stokDegisti`) koşullu alan olarak mı tutar.
**Bu pakette hiçbiri değerlendirilmedi** — bölme mekanikti.

### 5. Üç ayrı `deleting`

Ürün, kategori ve kupon silme onayları aynı adı taşıyan üç ayrı durumdur.
Bölmeden önce sayaç bunu tek bağ sanıyordu (3a). A6'da üçü de aynı düzenleme
yüzeyi soyutlamasına (`ui2/duzenlemeYuzeyi`) geçerse metrik 35 → 30 iner ve bu
GERÇEK bir düşüş olur.

### 6. Dokunulmayan bilinen kusur

`OrdersPanel`de sipariş listesinin sayfalaması **yok**; `DataTable`
`page={1} pageSize={siparisler.length}` ile besleniyor ve kesilme yalnız bir
uyarı şeridiyle bildiriliyor (kodda gerekçesi yazılı). Bu bir A6 işi değil,
ayrı bir kapsam — ama bölerken görüldüğü için kayda geçiyor.

---

## Kalan borç

**TB-A5-1 · Eşikler ölçüm ağacından çıkarmaya karşı kör.** Görev 4'te ölçüldü:
ölçülen bir dosya `components/admin/**` / `pages/admin/**` ağacının dışına
taşınırsa dört eşiğin dördü de geçmeye devam eder (`ProductForm.tsx` denemesi:
ham buton 158 → 151, adsız kontrol 56 → 39, hepsi yeşil). Kaçışı yakalayan tek
şey isimle sabitlenmiş `OLCUM_TABANI` listesidir. Yani koruma "listenin
bilinçli güncellenmesi" varsayımına dayanıyor; liste refleksle yeşile
boyanırsa nöbetçi susar. **Sonraki adım:** taban dosya kümesini yalnız dizin
yürüyüşünden değil, `App.tsx` rota ağacından da türetip ikisini karşılaştırmak
(panelde render edilen ama ölçülmeyen dosya = ihlal). Kapsam: İP-A7 sonrası,
göç bittiğinde.

**TB-A5-2 · `OrdersPanel` listesi sayfalanmıyor.** `DataTable`
`page={1} pageSize={siparisler.length}` ile besleniyor; kesilme yalnız uyarı
şeridiyle bildiriliyor (`E-5` nöbetçisi bu şeridi koruyor). Bölme sırasında
görüldü, dokunulmadı — mekanik paketin kapsamı değil. Sayfalama geldiği gün
uyarı şeridi KALKMALI.
