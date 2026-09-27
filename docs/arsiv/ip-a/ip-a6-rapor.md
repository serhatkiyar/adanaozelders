# İP-A6 — `AdminStore` göçü + göç deseninin tamamlanması

Taban: `546715d` (İP-A5) · Dal: `feat/medusa-ui-taban`

İP-A5 `AdminStore.tsx`i sekiz bölüme böldü ve hiçbir davranış değiştirmedi.
Bu paket göçü yaptı: ekranın **26 adsız kontrolünün tamamı**, ham
düğmelerinin çoğu, etiketsiz overlay'i ve ekranda yaşayan pencere
durumlarının hepsi kapandı. Ama asıl çıktı ekran değil, **A7'nin 21 ekranda
21 kez uygulayacağı desen**.

## Kapı (paket sonu)

| Kapı | Öncesi | Sonrası |
|---|---|---|
| `tsc --noEmit` | temiz | temiz |
| `npm run lint` | 0 hata / 32 uyarı | **0 hata / 32 uyarı** (yeni dosyalarda 0) |
| `npm run build` | başarılı | başarılı (9,6 s) |
| Vitest | 115 dosya / 1160 test ✅ | **117 dosya / 1183 test** ✅ |
| `--sequence.shuffle`, 6 seed | — | **6/6 yeşil** (2, 7, 11, 13, 21, 42) |
| Mutasyon provası | — | **17/17 yakalandı**, ağaç her turda bayt-bayt temiz |

Test artışı: +2 dosya (`gezinmeBekcisi.test.tsx` 8 test,
`adminStoreDalAdlari.acceptance.test.tsx` 13 test), +2 test nöbetçinin kendi
sözleşmesinden (tek "taban listesi sabittir" testi üç yönlü teste bölündü).

## Nöbetçi sayıları — hepsi DÜŞTÜ

| Ölçüm | İP-A5 | İP-A6 | Değişim |
|---|---|---|---|
| ham `<button` | 158 | **131** | **−27** |
| erişilebilir adı olmayan form kontrolü | 56 | **30** | **−26** |
| ekranda yaşayan pencere durumu | 35 | **29** | **−6** |
| `role="dialog"`/`aria-modal` taşımayan overlay | 5 | **4** | **−1** |
| ölçülen toplam form kontrolü (teşhis) | 167 | 158 | −9 |
| ölçüm tabanı dosya sayısı | 80 | 82 | +2 (yeni `ui2/` dosyaları) |
| `ui2/` dışı Medusa importu | 0 | 0 | — |

`store/` ağacında artık **sıfır** adsız kontrol ve **sıfır** ekran-sahipli
pencere durumu var.

---

## Görev 1 — TB-A5-1: ölçüm kaçışı kapatıldı

### Sorun (A5'in ölçtüğü)

Taban dosya listesi (`OLCUM_TABANI`) İP-A3c'de eklenmişti ama yalnız bir
**kimlik denetimiydi**: sayım dizin yürüyüşünden geliyordu, liste sonucun
aynı olduğunu doğruluyordu. A5 kaçışı ölçtü: `ProductForm.tsx`
`src/pages/kacis/` altına taşındığında ham buton 158 → 151, adsız kontrol
56 → 39 düştü ve **dört eşiğin dördü de geçmeye devam etti**.

A7'de 21 ekran göç edecek; dosya hareketi normal iş akışı olacak.

### Yapılan

Yön tersine çevrildi. Liste `scripts/ui-baseline-sayim.mjs`e taşındı ve
**ölçümün kaynağı** oldu (`tabanDurumu()`):

- `olculen` = listede olan **ve** diskte duran dosyalar,
- `eksikDosyalar` = listede yazılı, diskte yok,
- `fazlaDosyalar` = ağaçta var, listede yok.

Nöbetçideki tek "liste sabittir" testi **üç** teste bölündü ve ilki artık
eksik dosyayı isimle bağırıyor.

### Ters prova (gerçekten koşturuldu)

`ProductForm.tsx` → `src/pages/kacis/ProductForm.tsx` taşındı:

```
KACIS SONRASI -> rawButton 151  adsizKontrol 39
                 eksikDosyalar ["src/components/admin/store/ProductForm.tsx"]

× ölçüm tabanı listesindeki HER dosya diskte durur (kaçış kapısı)
    → expected [ Array(1) ] to deeply equal []
× ölçülen dosya kümesi listenin TA KENDİSİDİR
    → expected [ …(79) ] to deeply equal [ …(80) ]
Tests  2 failed | 8 passed
```

Geri alındıktan sonra `git status --porcelain` başlangıçla **birebir aynı**,
10/10 yeşil. Aynı kaçış mutasyon sürücüsünde de kalıcılaştı (B1) ve iki
kardeşiyle birlikte sınandı: listeden çıkarma (B2), listelenmemiş yeni dosya
ekleme (B3). Üçü de yakalanıyor.

> **Not (sayaç geçmişi).** Sayaç bugüne kadar dört kez yanlış ölçtü (regex,
> sarmalayıcı körlüğü, `Form.Control` vekili, dosya dağılımına bağlı `Set`).
> Bu paket beşinci bir körlüğü daha ölçtü ve **kapatmadı, raporladı** —
> aşağıda "C9 bulgusu".

---

## Görev 2 — Sıralama deseni

**Sunucu taraflı sıralama `ProductsPanel`de VAR.** Kontrol edildi:

| Parça | Durum |
|---|---|
| `manualSorting: true` | var (`DataTable`, İP-A2'den) |
| sıralama URL'de | var (`sirala`/`yon`, `lib/storeProductQuery`) |
| görsel gösterge | var (`SortIndicator` ▲▼↕) |
| sunucuya gerçekten gidiyor mu | kanıtlı (`adminStorePanel` → "Fiyat başlığına tıklayınca sort DEĞERİ … price'a döner") |

`OrdersPanel`de sıralama **yok** (liste sayfalanmıyor da — TB-A5-2).

### Bulunan kusur: gösterge ekran okuyucuya görünmüyordu

Ok işareti `aria-hidden`, `<th>`de ise hiçbir durum yoktu. Yani sıralı
kolonun hangisi olduğu ve yönü **yalnız görerek** anlaşılıyordu. A7'de bu
desen 21 kez kopyalanacaktı.

`DataTable`e `aria-sort` eklendi: sıralı kolon `ascending`/`descending`,
sıralanabilir ama sırasız kolon `none`, sıralanamayan kolon hiçbir şey demez.
Davranış testi D-5, mutasyon provası C10.

> `useUrlDurumu` (A4'ün kancası) burada KULLANILMADI: `ProductsPanel`in
> URL sözleşmesi `lib/storeProductQuery`de zaten beyaz listeli ve
> `parseUrunSorgusu`/`urunSorgusundanIstek` çifti alan adlarını sunucu
> adlarına eşliyor. `useUrlDurumu` genel bir sözlük tutuyor; bu ekranda onu
> kullanmak beyaz liste güvencesini (bilinmeyen değer sessizce düşer)
> kaybettirirdi. **A7 için kural:** sıralaması/filtresi ŞEMALI olan ekran
> kendi `*Query` modülünü tutar, olmayan ekran `useUrlDurumu` kullanır.

---

## Görev 3 — Rota gezinmesinde kirli form uyarısı

### Sözleşme

İki uç, birbirini tanımıyor:

| Uç | Kim çağırır | Ne yapar |
|---|---|---|
| `useGezinmeKorumasi(korumali)` | `useKirliFormBekcisi` (yani her form) | "şu an kaybedilecek veri var" der |
| `GezinmeBaglantisi` | kenar çubuğu + mağaza sekme çubuğu | tıklamayı karşılar, gerekirse onay sorar |

**Ekranların yazacağı kod sıfır satır.** Kayıt `useKirliFormBekcisi`nin
içinde kurulur; `DuzenlemeYuzeyi` ve `DuzenlemePenceresi` onu zaten çağırır.
Bu, İP-A3c'de `sunucuHatasi`nın varsayılan değeriyle yaşanan hatanın tekrarını
engellemek için bilinçli: ekran başına tekrarlanan bir kayıt, ekran başına
unutulabilirdi. Testi de var (G6: form dosyasında `useGezinmeKorumasi` adı
hiç geçmiyor, koruma yine çalışıyor).

### Neden `useBlocker` değil

Proje klasik `<BrowserRouter>` + `<Routes>` (126 rota); `useBlocker` data
router ister ve bu mimaride hata fırlatır. Router göçüne karar verilirse
**`gezinmeBekcisi.tsx`in içi** değişir, ekranlar ve `useKirliFormBekcisi`
sözleşmesi aynı kalır.

### Neden bağlam (context) değil, modül düzeyi kayıt

Kayıt bir React bağlamında tutulsaydı, her tuş vuruşunda sağlayıcının
altındaki her şey (kenar çubuğu + aktif ekran + tablo) yeniden render
edilirdi. Gezinme bileşenlerinin bu bilgiye render sırasında ihtiyacı yok;
yalnız tıklama anında okuyorlar. Yan kazanç: sağlayıcı yok → `App.tsx`
değişmedi, testlerde sarmalayıcı gerekmiyor.

### Ölçülen ve düzeltilen regresyon (bundle)

İlk yazım Medusa'nın `usePrompt`unu kullanıyordu. `AdminSidebar` bu modülü
statik import ettiği için **Medusa `AlertDialog` + Radix (72 kB / 23 kB gzip)
her yönetim sayfasının ilk yüküne girdi** — build çıktısında ölçüldü:

```
AdminLayout-*.js  →  from"./gezinmeBekcisi-DTHeORYb.js"   (72 160 B)
```

Onay penceresi panelin kendi `ConfirmDialog`una çevrildi (aynı görsel dil,
`admin/ui` içinde zaten var). Sonuç:

```
gezinmeBekcisi chunk:  72 160 B  →  1 469 B   (gzip 23,07 → 0,78 kB)
```

Pencere durumu bu katmanda da `useState` ile değil `useDuzenlemeYuzeyi` ile
tutuluyor — göçün ekranlara dayattığı kuralın `ui2/` karşılığı.

### Bilinen sınırlar (yazılı)

1. **Tarayıcının geri/ileri tuşu bu mimaride KAPATILAMAZ.** `popstate` ancak
   gezinme gerçekleştikten sonra ateşlenir; iptal etmenin tek yolu
   `history.pushState` ile geri itmektir ve bu, kullanıcının geçmişini bozar.
2. **Kapsam kenar çubuğu ve ana gezinmedir.** İçerik alanındaki bir `<Link>`
   (tablo satırından detaya gitmek) bu bileşenden geçmez — bilinçli: her
   `Link`i bugün sarmak, dokunulmaması gereken 21 ekranı değiştirmekti.
3. **Programatik `navigate()`** geçmez ve geçmemeli: orada veri zaten
   kaydedilmiştir.
4. Yeni sekmede açan tıklama (Ctrl/⌘/orta tuş/`target`) onay sormaz — mevcut
   sayfa sökülmüyor; sormak uyarıyı önemsizleştirirdi (test G7).

---

## Görev 4 — Göç, bölüm bölüm

Sekiz bölümün her biri **ayrı ayrı** yeşile alındı; her adımdan sonra
`tsc` + ilgili kabul testleri koşturuldu.

### 4a · Form alanları

| Bölüm | Öncesi | Sonrası |
|---|---|---|
| `ProductForm` | 17 adsız kontrol, `placeholder` = etiket | **0**; her alan `Form.Item`+`Form.Label`+`Form.Control` |
| `CouponsPanel` | 6 adsız, yerel `inputCls` sabiti | **0**; `inputCls` SİLİNDİ, ortak `.input` |
| `CategoriesPanel` | 1 adsız ("Kategori adı") | **0** |
| `BulkImportPanel` | 1 adsız (dosya seçici) | **0** |
| `OrdersPanel` | 1 adsız (takip no) | **0** |

`ProductForm`da 24 ayrı `useState` tek bir `react-hook-form` + zod şemasına
indi (`lib/storeProductForm.ts`); `CouponsPanel` için `lib/storeCouponForm.ts`.
Kural artık **tek kaynakta**: aynı şema hem alan hatasını hem sunucu gövdesini
üretiyor.

A5'in üç sorusunun cevabı:

- **(a) 24 durum tek nesneye indi mi?** Evet — `react-hook-form`. Gerekçe:
  eski hâlde gönder düğmesinin kapısı (`!title || !price || !taxPercent`) ile
  hata metinleri **iki ayrı doğruluk kaynağıydı** ve saparlar (İP-A3c'nin
  pilotta ölçtüğü kusur).
- **(b) KDV ön-doldurma efekti korundu mu?** Evet, davranışı birebir; yalnız
  `autoTaxPercent` `useState`ten `useRef`e alındı (eski kod `setState`
  callback'inin İÇİNDEN başka bir `setState` çağırıyordu).
- **(c) Stok gerekçesi bloğu koşullu mu kaldı?** Evet — hem `stokDegisti` hem
  `requiresNote` koşulları korundu; ikisi de dal testinde açılıyor.

**Placeholder politikası (A7 kuralı):** placeholder yalnız **ek bilgi**
taşıdığında kalır (`ör. 20 x 27 cm · A4`, `ör. 1. Basım`). Etiketi tekrar eden
placeholder silinir — kutunun içinde ve üstünde aynı kelimeyi iki kez yazmak
gürültüdür.

### 4b · `EditProductModal`

Kendi `createPortal` + `fixed inset-0` katmanını kuruyordu; `role="dialog"`,
`aria-modal`, odak tuzağı, ESC ve arka plan kilidi **yoktu**. Artık
`ui2/duzenlemeYuzeyi`nin yeni `DuzenlemePenceresi`ni kullanıyor.

**Etiketsiz overlay 5 → 4.** ✅

`DuzenlemePenceresi` bu pakette doğdu, çünkü A4'ün `DuzenlemeYuzeyi`si formu
DIŞARIDAN alıyor (pilotta alanlar yüzeyle aynı dosyada). `ProductForm` ise 25
alanıyla hem satır içi (oluşturma) hem pencere içinde (düzenleme) kullanılıyor;
formu pencereye çıkarmak satır içi kullanımı da pencereye bağlardı. Yeni yüzey
bu ikinci deseni karşılıyor: pencereyi ve kapatma yollarını yüzey çizer, formu
içerik yönetir, ikisi `useYuzeyKirliFormBekcisi` üzerinden buluşur. Sağlayıcı
yoksa (satır içi kullanım) hiçbir şey değişmez.

### 4c · Ham düğmeler

28 → **1**. Kalan tek ham `<button>` `ProductForm`un katlanır bölüm başlığı
(`KatlanirBaslik`) ve **bilinçlidir**: bir aksiyon değil, `aria-expanded`
taşıyan bir açma/kapama denetimi; ortak `Button`ın dolgu/gölge varyantları
oraya uymuyor. Kararın kendisi A7'ye devrediliyor (aşağıdaki desen listesi).

Satır aksiyonları **açık düğme kaldı** — üç nokta menüye geçilmedi (kalıcı
kural).

### 4d · Pencere durumu

Altı bağ ekrandan çıktı:

| Dosya | Bağ | Nereye |
|---|---|---|
| `ProductsPanel` | `editing`, `deleting` | `useDuzenlemeYuzeyi` ×2 |
| `CategoriesPanel` | `deleting` | `useDuzenlemeYuzeyi` |
| `CouponsPanel` | `deleting` | `useDuzenlemeYuzeyi` |
| `OrdersPanel` | `teslimSiparisi`, `iadeSiparisi` | `useDuzenlemeYuzeyi` ×2 |
| `ReturnsPanel` | `decision` | `useDuzenlemeYuzeyi` |

**35 → 29.** A5'in öngörüsü −5'ti; ölçülen −6 (öngörüde `editing`
sayılmamıştı).

`CategoriesPanel`in `KategoriKdvRozeti`ndeki `editing` **taşınmadı**: bir
pencere açmıyor, satır içinde iki gösterim arasında geçiş yapıyor. Sayaç da
onu zaten saymıyordu.

### 4e · Tablolar

`ProductsPanel` zaten ortak `DataTable`daydı (boş durum ayrımı ve "Yeniden
dene" dahil). `OrdersPanel`e `renderMobileRow` eklendi — mobilde yedi kolonlu
tablo yatay kaydırmaya düşüyor ve satır aksiyonları ekranın dışında kalıyordu.

---

## Görev 4 · Çıkan regresyonlar — tek tek, sınıflandırılmış

A2'de tek bir form göç etti ve iki gerçek regresyon çıktı. Burada sekiz bölüm
göç etti; çıkanlar:

| # | Ne | Sınıf | Ne yapıldı |
|---|---|---|---|
| R1 | `Form.Label`ın `optional` işareti erişilebilir ada **boşluksuz** yapışıyor: ad `"Yazar(opsiyonel)"`, ekran okuyucu "Yazaropsiyonel" okuyor. `ml-1` yalnız GÖRSEL aralık veriyordu. | **GERÇEK ÜRETİM HATASI** (İP-A2'den beri var, İP-A4 pilotunda da vardı) | `ui2/form.tsx`te boşluk metne alındı. Testle bulundu: `getByLabelText("Yazar (opsiyonel)")` bulamadı. |
| R2 | `DataTable` sıralama göstergesi ekran okuyucuya görünmüyor (`aria-sort` yok). | **GERÇEK ÜRETİM HATASI** (İP-A2'den beri) | `aria-sort` eklendi; test D-5, mutasyon C10. |
| R3 | Gezinme bekçisi Medusa `AlertDialog`unu her yönetim sayfasının ilk yüküne soktu (+72 kB / 23 kB gzip). | **BU PAKETİN ÜRETTİĞİ REGRESYON** | `ConfirmDialog`a çevrildi; chunk 72 160 → 1 469 B. |
| R4 | `useDuzenlemeYuzeyi`yi gezinme bekçisinden kullanmak import DÖNGÜSÜ üretti (`duzenlemeYuzeyi → kirliFormBekcisi → gezinmeBekcisi → duzenlemeYuzeyi`). | **BU PAKETİN ÜRETTİĞİ** | Durum kancası `ui2/yuzeyDurumu.ts`ye ayrıldı; `duzenlemeYuzeyi` yeniden dışa aktarıyor, çağrı yerleri etkilenmedi. |
| R5 | `ProductForm` göçünde stok açıklaması alanı koşulsuz render ediliyordu (eskiden yalnız "Diğer" gerekçesinde). | **KASITSIZ DAVRANIŞ DEĞİŞİKLİĞİ** | Üretim kodunda geri alındı (`requiresNote` koşulu); dal testi D-2 sabitliyor. |
| R6 | Dal testinde defter uçları `/store/admin/products` kuralına yakalanıp `StockLedgerPanel`i `problems.map` üzerinde patlattı. | **TEST KUSURU** (üretim kodu sağlam) | Sahte sunucu kural sırası düzeltildi ve gerekçesi teste yazıldı. |
| R7 | Mutasyon sürücüsünün desenleri CRLF dosyalarda sessizce eşleşmiyor, mutasyon uygulanmadan "yakalanmadı" diye okunuyordu (ilk koşuda 3 kalem). | **ARAÇ KUSURU** (yalancı kırmızı) | `degistir()` satır sonu bağımsız yapıldı; uygulanamayan mutasyon artık AÇIKÇA raporlanıyor. |

### Kasıtlı değişiklikler (test güncellendi, gerekçesiyle)

| Ne | Neden | Etkilenen |
|---|---|---|
| `placeholder` sorguları → `getByLabelText` | Etiket artık gerçek; placeholder ya silindi ya ek bilgiye indi. Testin **daha güçlü** hâli: erişilebilir adı sorguluyor. | 4 dosya, ~20 satır |
| `getByLabelText("Kategori")` → `/^Kategori/` | Alan gerçekten opsiyonel; etiket "Kategori (opsiyonel)". | `adminStore{CategoryTax,Labels,Variants}` |
| Barkodsuz varyant kaydı: toast → **alan hatası** | İP-A2 hata yönlendirme sözleşmesi: alan doğrulama hatası genel kanala gitmez. Asıl iddia (**istek gitmez**) korundu ve güçlendirildi (`aria-invalid` + `aria-describedby` metni + "toast'a SIZMADI"). | `adminStoreVariants` V-3 |
| `renderMobileRow` sorgu daraltması | jsdom CSS uygulamadığı için tablo VE mobil kartlar aynı anda DOM'da. Davranış değişikliği değil, ölçüm ortamının sınırı; sorgular masaüstü tablosuna daraltıldı — iddia aynı. | 5 iddia, 3 dosya |

**Hiçbir davranış testi zayıflatılmadı.** Yukarıdaki dördü de ya aynı iddiayı
daha güçlü bir sorguyla kuruyor ya da yeni sözleşmeyi yazıyor.

---

## Görev 5 — Dal testi ve ölçülen maliyeti

`src/pages/dashboards/adminStoreDalAdlari.acceptance.test.tsx` — göç eden her
formun **tüm koşullu dalları** render edilip her kontrolün erişilebilir adı
doğrulanıyor (`test-utils/alanAdlari`).

### Açılan dallar (kartezyen çarpma YOK)

| Test | Açılan dallar |
|---|---|
| D-1a | oluşturma (tür seçici) · fiziksel (stok alanı) · künye açık (9 alan) · varyant açık · "yeni grup" satırı (3 alan) |
| D-1b | dijital ürün → stok alanı kalkar |
| D-1c | kitap kategorisi → künye kendiliğinden açılır, varyant bölümü HİÇ render edilmez |
| D-2a | düzenleme (durum seçici) · stok değişti → gerekçe · "Diğer" → açıklama |
| D-2b | gruplu ürün → barkod/eksen1/eksen2/sıra · "varyant türet" (3 alan) |
| D-3 | kupon (6) · kategori + satır içi KDV · CSV seçici · sipariş filtresi + takip no · iade kutucuğu |

### Testin kendi yalancı-yeşil kapısı

`adlarDogru(enAz)` **iki** iddia kuruyor: (1) adsız kontrol yok, (2) en az
`enAz` kadar kontrol gerçekten render edildi. İkincisi olmadan, dal hiç
açılmamışsa boş kap "adsız yok" diye sessizce geçerdi.

### Ölçülen maliyet — 21 ekrana uygulanabilir mi?

| Ölçüt | Değer |
|---|---|
| dosya toplam | 488 satır |
| bunun **paylaşılan** kısmı (sahte sunucu + fixture + yardımcı) | ~200 satır, ekran başına **bir kez** yazılır |
| `ProductForm` (en dallı form, 25 alan, 6 koşullu dal) | 5 test / ~120 satır / **1,84 s** |
| diğer beş bölüm birlikte | 5 test / ~70 satır / **0,45 s** |
| dosyanın tamamı (13 test, sıralama ve odak testleri dahil) | **2,61 s** |

**A4'ün tahmini: ekran başına ~35 satır, 0,79 s. Ölçülen: `AdminStore` gibi
ALTI formu olan bir ekran için ~190 satır ve 2,3 s.** Yani form başına ~32
satır / ~0,38 s — tahminle aynı büyüklük sırasında.

**21 ekrana uygulanabilir: evet.** Kaba tahmin: +700–800 satır test, +8–15 s
suite süresi. Bugünkü 1183 testlik suite ~90 s koşuyor; %10-15'lik bir artış.
Şart: harness paylaşımı (her ekran kendi sahte sunucusunu sıfırdan yazmasın).

---

## Görev 6 — Eşikler ve mutasyon

### Yeni eşikler (hepsi yeni GERÇEK değere sabitlendi)

| Eşik | Eski | Yeni | Düşüşün kaynağı |
|---|---|---|---|
| ham `<button` | 158 | **131** | 27 düğme ortak `Button`a |
| adsız form kontrolü | 56 | **30** | 26 alan `Form.*`a |
| ekranda pencere durumu | 35 | **29** | 6 bağ düzenleme yüzeyine |
| etiketsiz overlay | 5 | **4** | `EditProductModal` ortak yüzeye |

**Düşmeyen yok** — dördü de düştü ve dördü de gerçek. Sahte düşüş
yazılmadı: `store/` dosyalarının hiçbiri ölçüm dışına taşınmadı, aksine ölçüm
tabanına **iki yeni dosya eklendi** (`gezinmeBekcisi.tsx`, `yuzeyDurumu.ts`).

### Mutasyon provası — 17/17

Sürücü: `frontend/scripts/ip_a6_mutasyon.mjs` (`git checkout --` KULLANMAZ;
ham baytlar bellekte tutulur, `git status --porcelain` başta/sonda
karşılaştırılır; dosya taşıma mutasyonunda dosya geri taşınır ve oluşturulan
dizin silinir).

```
Taban: 3 hedef kümesinin hepsi YEŞİL.

✓ A1 · ham <button> eklenirse (eşik 131)
✓ A2 · etiketsiz form kontrolü eklenirse (eşik 30)
✓ A3 · ekranda pencere durumu geri gelirse (eşik 29)
✓ A4 · etiketsiz overlay geri gelirse (eşik 4)
✓ B1 · KAÇIŞ: ölçülen dosya ağacın DIŞINA taşınırsa
✓ B2 · KAÇIŞ: dosya taban listesinden çıkarılırsa
✓ B3 · KAÇIŞ: listelenmemiş yeni panel dosyası eklenirse
✓ C1 · rota gezinmesi: kirli form kaydı kurulmazsa
✓ C2 · rota gezinmesi: form sökülünce kayıt temizlenmezse
✓ C3 · dal testi: koşullu bir alanın etiketi kaldırılırsa
✓ C4 · gönder kapısı geri konursa (düğme geçerlilikte kapanırsa)
✓ C5 · odak ilk hatalı alana taşınmazsa
✓ C6 · katlanmış bölüm hata varken AÇILMAZSA
✓ C7 · geçersiz veri sunucuya GİDERSE (handleSubmit kapısı kesilirse)
✓ C8 · düzenleme penceresi ortak yüzeyden çıkarılırsa (ham overlay'e döner)
✓ C9 · BULGU: etiket kalkınca SAYAÇ görmez, DAL TESTİ görür
✓ C10 · sıralama göstergesi ekran okuyucudan gizlenirse

Çalışma ağacı başlangıçtaki hâline döndü.
```

### C9 bulgusu — sayacın beşinci körlüğü (kapatılmadı, ölçüldü)

`CategoriesPanel`den `<Form.Label>Kategori adı</Form.Label>` silindi ve sayaç
ölçüldü:

```
ETIKET SILINDIKTEN SONRA sayac: adsiz 30 | kontrolToplam 158     ← DEĞİŞMEDİ
```

Sebep: sayaç `Form.Control`u bir **sarmalayıcı** sayıyor ve içindeki kontrolü
koşulsuz "adlandırılmış" kabul ediyor. Etiketin gerçekten var olup olmadığını
statik olarak ölçemez.

İP-A3c bu vekili "inşa yoluyla doğru" yapmıştı (`Form.Label` bağlam dışında
`throw`, `Form.Control` id'yi DOM'a indirmeyen çocuğu bildirir) — ama
`Form.Label`ın **hiç yazılmaması** o korumaların hiçbirini tetiklemiyor.

**Kapatan tek şey dal testidir** ve mutasyon bunu kanıtlıyor: aynı mutasyon
nöbetçiden geçiyor, dal testinden geçmiyor. A4'ün "dal testi zorunlu" kararının
canlı gerekçesi budur ve A7'de gevşetilemez.

---

## A7'ye desen kararları

A5'in "yedi tekrar eden desen" notundan çıkanlar:

| # | Desen | Karar | Gerekçe |
|---|---|---|---|
| 1 | `className="input"` ham `<input>` | **Ortak katmana alındı** → `Form.Item`+`Form.Label`+`Form.Control` | Tek sarmalayıcı 26 borcun tamamını kapattı |
| 2 | Yerel `inputCls` sabiti (`CouponsPanel`) | **Silindi** | Ortak `.input` sınıfına devretti; kopyalanacak bir şey kalmadı |
| 3 | `<label>Başlık<input/></label>` (`UrunFiltreCubugu` 4, `OrdersPanel` 1, `ReturnsPanel` 1) | **Kısmen** — `OrdersPanel` `Form.Item`e geçti, filtre çubuğu bırakıldı | Zaten erişilebilirdi; sayı düşmüyor. Filtre çubuğunu göç ettirmek 0 borç kapatıp 4 test riski üretirdi |
| 4 | `<span className={ALAN_BASLIGI}>` + `<select>` | **`Form.Label`a çevrildi**; `ALAN_BASLIGI` sabiti silindi | Doğal karşılığı |
| 5 | Ham `<button className="rounded-lg bg-slate-900…">` (8 dosyada 28 kez) | **`Button`a çevrildi** (27/28) | Birebir eşlendi |
| 6 | Katlanır bölüm başlığı (`<button>` + döner ok) | **Yerel `KatlanirBaslik` bileşenine çıkarıldı, `ui2/`ye ALINMADI** | Tek ekranda iki kullanım var; ikinci bir ekranda görülene kadar ortak katmana çıkarmak erken soyutlama olur. **A7 kuralı: üçüncü kullanımda `ui2/`ye taşı.** Sayaçta ham `<button>` olarak görünmeye devam ediyor — gizlenmedi |
| 7 | `ConfirmDialog` + `ReasonDialog` (5 dosyada 6 kullanım) | **Bileşen aynı kaldı, DURUMU `useDuzenlemeYuzeyi`ye geçti** | Bileşenler zaten ortak ve erişilebilir; borç durumun ekranda yaşamasıydı |

### A7'nin 21 ekranda tekrarlayacağı reçete

1. **Şema önce.** Form kuralları `lib/<ekran>Form.ts`e; bağlama bağlı kural
   varsa şema bir **fabrika** olur (`urunFormSemasi(baglam)`).
2. **Gövde üretimi şemayla aynı dosyada.** Oluşturma ve güncelleme AYRI
   fonksiyon — tek fonksiyon iki gövdeyi de üretirse dönüş tipi birleşik olur
   ve çağıran taraf `as` ile kendi tipini uydurur.
3. **Her alan** `Form.Item` + `Form.Label` + `Form.Control`. Placeholder yalnız
   ek bilgi taşıyorsa kalır.
4. **Gönder düğmesi geçerlilikte kapanmaz.** `shouldFocusError: false` +
   kendi `GORSEL_SIRA`nla ilk hataya odaklan. **Katlanır bölüm varsa önce
   AÇ, sonra odakla** (odak hedefi bir tur state'te bekletilir).
5. **Sunucu hatası** `sunucuHatasiniUygula` ile alanlara; beyaz liste + alan
   eşlemesi zorunlu; alana düşmeyen kısım şeritte.
6. **Pencere durumu** `useDuzenlemeYuzeyi` (import: `ui2/yuzeyDurumu` — Medusa
   çekmez). Formu kendi yöneten içerik varsa `DuzenlemePenceresi` +
   `useYuzeyKirliFormBekcisi`.
7. **Dal testi zorunlu.** Her koşullu alan en az bir kez; `adlarDogru(enAz)`
   ile testin kendi yalancı-yeşil kapısı.
8. **Sıralaması olan liste**: `manualSorting` + URL durumu + `aria-sort`
   (`DataTable` üçünü de veriyor; kolonlara `accessorFn` koymayı unutma).
9. **Ölçüm tabanı listesine** yeni dosyaları ekle — nöbetçi zaten zorlayacak.

---

## Bilinen sınırlar ve kalan borç

**TB-A6-1 · `AdminStore` sayfası artık Medusa `AlertDialog` chunk'ını
yüklüyor.** `EditProductModal` → `DuzenlemePenceresi` → `useKirliFormBekcisi`
→ `usePrompt`. Ölçülen: mağaza ekranı `duzenlemeYuzeyi` chunk'ını da çekiyor
(115,92 kB / 38,77 kB gzip). Bu chunk zaten vardı (envanter pilotu
kullanıyordu) ve paylaşımlı, ama mağaza sayfası önce çekmiyordu.
**Sonraki adım:** `kirliFormBekcisi`nin onay penceresini de panelin kendi
`ConfirmDialog`una çevirmek — Görev 3'te gezinme bekçisi için yapıldı ve
72 kB kazandırdı. Kapsam: A7'nin ilk paketi (pilotun testlerine dokunur).

**TB-A6-2 · Sayaç, yazılmamış `Form.Label`ı göremiyor.** C9'da ölçüldü ve
yukarıda anlatıldı. Kapatan tek şey dal testi. **Sonraki adım:** ya bunu
kalıcı kabul edip A7'de dal testini kapı yapmak (öneri), ya da sayacın
`Form.Control` affını "kardeşinde `Form.Label` VAR mı" koşuluna bağlamak.
İkincisi `Form.Label`ı başka bir bileşenin içine koyan meşru yazımları
yanlış-pozitif yapar.

**TB-A6-3 · `AdminStore` chunk'ı %9,3 büyüdü** (61 193 → 66 880 B; gzip
16,93 → 19,00 kB). Kaynak: `react-hook-form` + `zodResolver` + iki yeni şema.
İkisi de bundle'da zaten vardı (envanter pilotu), yeni olan bu chunk'a
girmesi. Kabul edilebilir sayıldı: kazanç 26 erişilebilirlik borcu +
kaydedilmemiş veri koruması.

**TB-A5-2 (devralındı, kapanmadı) · `OrdersPanel` sayfalanmıyor.**
`DataTable` `page={1}`/`pageSize={siparisler.length}` ile besleniyor; kesilme
uyarı şeridiyle bildiriliyor. Sunucu tarafı `limit`/`offset` + `X-Total-Count`
gerekiyor, ayrı kapsam. Sayfalama geldiği gün uyarı şeridi KALKMALI.

**Doğrulanmamış nokta:** bu paketin hiçbir adımı **gerçek tarayıcıda**
sürülmedi. Vitest + jsdom, `renderMobileRow`un mobil/masaüstü ayrımını,
odak tuzağının gerçek `Tab` davranışını ve `aria-sort`un ekran okuyucudaki
duyurusunu ölçemez. Kök CLAUDE.md §F'ye göre bunlar gerçek tarayıcı ister;
A7 öncesi bir Chrome duman turu önerilir.

---

## Değişen her şey — tek tek

| Değişen | Neden |
|---|---|
| `scripts/ui-baseline-sayim.mjs` | taban listesi ölçümün kaynağı oldu (Görev 1); +2 dosya |
| `src/__guards__/uiBaseline.test.ts` | dört eşik yeni değere; liste testi üçe bölündü; pencere/overlay listelerinden `store/*` çıktı |
| `components/admin/data-table/DataTable.tsx` | `aria-sort` (Görev 2 / R2) |
| `components/admin/layout/AdminSidebar.tsx` | `NavLink` → `GezinmeBaglantisi` (Görev 3) |
| `pages/dashboards/AdminStore.tsx` | sekme çubuğunda aynısı |
| `components/admin/store/*` (8 dosya) | göç (Görev 4) |
| `components/admin/ui2/form.tsx` | `(opsiyonel)` boşluğu (R1) |
| `components/admin/ui2/kirliFormBekcisi.tsx` | gezinme kaydı bağlandı; kapsam notu güncellendi |
| `components/admin/ui2/duzenlemeYuzeyi.tsx` | durum kancası ayrıldı; `DuzenlemePenceresi` eklendi |
| `components/admin/ui2/medusa-tr.tsx` | gezinme onayı metinleri |
| **yeni** `ui2/gezinmeBekcisi.tsx` + testi | Görev 3 |
| **yeni** `ui2/yuzeyDurumu.ts` | döngü kırma (R4) |
| **yeni** `lib/storeProductForm.ts`, `lib/storeCouponForm.ts` | form kuralları |
| **yeni** `adminStoreDalAdlari.acceptance.test.tsx` | Görev 5 + Görev 2 + gönder kapısı |
| **yeni** `scripts/ip_a6_mutasyon.mjs` | Görev 6 |
| 7 kabul testi dosyası | etiket sorguları + üç kasıtlı sözleşme değişikliği (yukarıda tablo) |

**Kapsam dışı hiçbir ekran dosyası değişmedi.** `AdminStore.tsx`, `store/*`
ve `ui2/*` dışında dokunulanlar: nöbetçi aracı, nöbetçi testi, paylaşılan
`DataTable` (Görev 2) ve `AdminSidebar` (Görev 3'ün açıkça istediği kapsam) —
dördü de ekran değil.
