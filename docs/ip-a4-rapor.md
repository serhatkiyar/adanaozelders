# İP-A4 — Pilot ekran, düzenleme yüzeyi soyutlaması, odak düzeltmesi

Taban: `5b6aabe` (İP-A3c) · Dal: `feat/medusa-ui-taban`

Bu paketin çıktısı bir ekran değil, **71 dosyalık göçün deseni**. Aşağıdaki her
karar A6-A7'de tekrar tekrar uygulanacak; en önemli bölüm
[Görev 2 — düzenleme yüzeyi sözleşmesi](#görev-2--düzenleme-yüzeyi-sözleşmesi).

## Kapı (paket sonu)

| Kapı | Sonuç |
|---|---|
| `tsc -b` | temiz |
| `npm run build` | başarılı (31 s) |
| `npm run lint` | 0 hata / 32 uyarı (hepsi önceden var, yeni dosyalarda uyarı yok) |
| Vitest | **114 dosya / 1152 test** (taban: 109 / 1091 → +5 dosya, +61 test) |
| `--sequence.shuffle`, 6 seed | 6/6 yeşil (aşağıda) |
| Mutasyon provası | **19/19 yakalandı**, çalışma ağacı her seferinde bayt-bayt temiz |

---

## Görev 1 — `useModalA11y` odak sıfırlaması (TB-A3c-1)

**Kusur.** `src/hooks/useModalA11y.ts` odak/kaydırma etkisini `onClose`
bağımlılığıyla kuruyordu. Çağıran satır içi ok fonksiyonu verdiğinde
(`onClose={() => setAcik(false)}` — panelde yaygın desen) kimlik her render'da
değişir, etki sökülüp yeniden kurulur ve üç zarar doğar:

1. Odak panelin **ilk odaklanabilir öğesine** geri alınır. A3c'nin
   "gönderimde odak ilk hatalı alana taşınır" davranışı bir sonraki render'da
   iptal olur — form her tuş vuruşunda render ettiği için kullanıcı yazarken
   bile odak kayabilir.
2. Temizlik `returnFocusRef.current?.focus()` çağırdığı için odak pencerenin
   **dışına**, açan öğeye sıçrayabilir.
3. `body.style.overflow` her render'da yeniden okunup yazılır; okunan
   "önceki" değer artık kendi yazdığımız `hidden` olur.

**Düzeltme.** İşleyici bir `ref`te tutuluyor (`onCloseRef`, render sırasında
güncelleniyor) ve etkinin bağımlılık dizisinden çıkarıldı. A3c'nin pilotta
koyduğu geçici sabitleme (`DamageDialog`'daki `kapatmaRef` + `useCallback`)
**kaldırıldı**.

**Kanıt** — `src/hooks/useModalA11y.test.tsx`, 4 test, gerçek DOM
(`document.activeElement`):

| Test | Ne tutuyor |
|---|---|
| ebeveyn yeniden render edilince odağı TAŞIMAZ | ana regresyon |
| yeniden render arka plan kilidini bozmaz | 3. zarar; kapanışta `overflow` geri veriliyor |
| Esc HÂLÂ kapatır ve GÜNCEL işleyiciyi çağırır | ref'e taşımanın klasik hatası (bayat closure) |
| odak tuzağı korunur | mevcut sözleşme bozulmadı |

**Ters prova (M1).** `onCloseRef` sökülüp `onClose` bağımlılığa geri kondu →
1. test kırıldı:

```
× ebeveyn yeniden render edilince odağı TAŞIMAZ
  → yeniden render odağı sıfırladı …: expected <button> to be <input aria-label="İkinci alan">
```

Mutasyon geri alındı, dosya bayt-bayt eski hâline döndü.

**Diğer çağrı yerleri.** Hook'u kullanan beş dosya (`ui/Dialog.tsx`,
`ui/Modal.tsx`, `ImageCropModal`, `ReviewListModal`, `DamageDialog`) tam suite
ile doğrulandı: hiçbiri kırılmadı.

---

## Görev 2 — Düzenleme yüzeyi sözleşmesi

> **A7'de 70 ekran bu bölüme bakacak.**

### Sorun

Her ekran modalını kendi `useState`'iyle yönetiyor. Ölçüldü: ölçüm tabanındaki
71 dosyada **33 ayrı pencere durumu, 21 dosyada** (sayaç metriği aşağıda). Bu
desen 71 dosyaya kopyalanırsa:

- İleride rota tabanlı düzenleme yüzeylerine (`/yonetim/.../:id/duzenle`)
  geçme kararı 71 dosyayı ilgilendirir.
- Pencereye bağlı ortak davranışlar (kirli form bekçisi, odak yönetimi,
  başlık/aksiyon yerleşimi) her ekranda yeniden yazılır — ve **her ekranda ayrı
  ayrı unutulabilir**. A3a'nın bekçisi bugün yalnız pilotta bağlıydı.

### Sözleşme

`src/components/admin/ui2/duzenlemeYuzeyi.tsx` — iki parça:

```ts
// 1) Ne düzenleniyor: hedef state'i (ekran bunu TUTMAZ, sadece açar)
const yuzey = useDuzenlemeYuzeyi<TKayit, TBaglam>();

yuzey.acik      // boolean
yuzey.yeni      // hedef "yeni" mi
yuzey.kayit     // TKayit | null  (düzenlenen kayıt)
yuzey.baglam    // TBaglam | null ("yeni"ye verilen serbest ayrım)
yuzey.hedef     // ham hedef — useEffect bağımlılığı için
yuzey.ac(kayit)         // var olan kaydı düzenle
yuzey.yeniAc(baglam?)   // yeni kayıt
yuzey.kapat()           // KOŞULSUZ kapat (kaydedildi → soru yok)
```

```tsx
// 2) Kapatma isteği + içerik: pencereyi yüzey çizer
<DuzenlemeYuzeyi
  yuzey={yuzey}
  baslik={…}
  aciklama={…}
  form={form}                 // react-hook-form
  sunucuHatasi={error}        // ZORUNLU (A3c · P1-3 kuralının devamı)
  islemSuruyor={isPending}
  aksiyonlar={<Button onClick={gonder}>Kaydet</Button>}
>
  …alanlar…
</DuzenlemeYuzeyi>
```

**Yüzeyin kendi içinde topladıkları** (ekranda tekrar yazılmaz):

- `useKirliFormBekcisi` bağlanması — `etkin` yüzeyin durumundan gelir,
  `sunucuHatasi` zorunlu prop.
- `useModalA11y` (ortak `Dialog` üzerinden; Görev 1'den sonra `onClose`a satır
  içi ok fonksiyonu vermek güvenli).
- Başlık/açıklama ve **aksiyon yerleşimi** — "Vazgeç" düğmesi yüzeyin
  kendisindedir.
- Kapatma yollarının hepsi (× · ESC · dış tıklama · Vazgeç) tek noktadan
  bekçiye bağlanır.
- İşlem sürerken (`islemSuruyor`) kapatma yolları kapalıdır.

**Kullanım örneği (pilot).** Ekran tarafı:

```tsx
const yuzey = useDuzenlemeYuzeyi<never, DamageKind>();
…
<Button onClick={() => yuzey.yeniAc(k.value)}>{k.label}</Button>
…
<DamageDialog yuzey={yuzey} isPending={…} error={formHatasi} onSubmit={gonder} />
```

Başarıda: `yuzey.kapat()` (koşulsuz — veri kaydedildi).

### Router göçüne hazırlık

İçeride bugün `useState` var. Rota tabanlı yüzeylere karar verilirse **bu
dosyanın içi** değişir (`useState` → `useNavigate`/`useParams`), ekranlar
değişmez. Sözleşmenin bilinçli olarak dar tutulmasının sebebi budur: hedefin
iç temsili (state mi, URL mi) dışarı sızmaz.

### Kanıt

`ui2/duzenlemeYuzeyi.test.tsx` — 15 test, gerçek DOM. Dört kapatma yolunun her
biri için **iki** test var: kirli formda onay sorar **ve** temiz formda
doğrudan kapatır (ikincisi ters provadır — bekçi her kapatmayı engelleseydi
ilk dört test yine geçerdi).

Mutasyonlar B1-B3 (aşağıdaki tabloda) bu sözleşmenin üç ayağını da kırıp
testin yakaladığını gösteriyor.

### Bilinen sınır

Ekran `yuzey.kapat()`'ı bir yan etkiyle (WS push'u, query invalidation)
çağırırsa bekçi devreye girmez. Bu bilinçlidir: `kapat` "koşulsuz kapat"
demektir. A3c'de belgelenen P2-9'un bu katmandaki karşılığı — fark şu ki artık
**kapatma yetkisi de bu katmanda**, yani ekranın yanlışlıkla bekçiyi atlaması
için `kapat`ı açıkça çağırması gerekir.

---

## Görev 3 — Pilot ekran: `DamageEventsPage`

### Önce / sonra

| Konu | Önce | Sonra |
|---|---|---|
| Pencere durumu | `useState<DamageKind \| null>` ekranda | `useDuzenlemeYuzeyi` (`ui2/`) |
| Kirli form bekçisi | `DamageDialog` içinde elle | Yüzeyin içinden |
| Tablo | 90 satır elle yazılmış `<table>` | Ortak `DataTable` |
| Mobil | Yatay kaydırmalı tablo | **`renderMobileRow`** kartı |
| Filtre | `useState`, sayfa yenilenince kayboluyor | URL (`?urun=`) |
| Sayfalama | Ekranda elle (`sayfa` state + iki düğme) | `DataTable` + URL (`?sayfa=`, `?boyut=`) |
| Boş durum | **Tek** metin | **İki ayrı** durum + farklı çıkış |
| Hata | `ErrorState` + yeniden dene | korundu |

### 3a — `renderMobileRow` ilk kez kullanımda

`DataTable` bu prop'u destekliyordu ama **hiçbir ekranda kullanılmıyordu**.
Pilot onu kullanıma sokan ekran: mobilde satır başına okunabilir bir kart
(işlem + adet üstte, ürün/kova/neden ikinci satırda, zaman/aktör altta),
masaüstünde tablo. Test bunu DOM'da doğruluyor (`.md:hidden` kabı + içindeki
"2 adet"), mutasyon B7 prop'u kaldırınca test kırılıyor.

**Sunucu taraflı sıralama — dürüst durum.** Bu ekranda sıralama YOKTU ve
korunacak bir şey de yok: `GET /inventory/damage-events` yalnız
`product_id/limit/offset` alır ve daima `id DESC` döner
(`services/inventory_damage.py::list_damage_events`). `DataTable`'ın
sıralaması bu yüzden kolon bazında **kapatıldı** (`enableSorting: false`).
Açık bırakmak, sayfalanmış bir listede yalnız görünen 25 satırı sıralayıp
"sıraladım" demek olurdu — yanlış veriyi doğru gibi göstermek. Sunucu `sort`
parametresi kazanınca açılacak; borç aşağıda (TB-A4-1).

### 3b — Filtreler URL'de (A7 deseni)

Ortak hook: **`src/hooks/useUrlDurumu.ts`** — ekran başına yeniden yazılmaz.
Üç karar tek yerde verildi:

1. **Varsayılana eşit değer adrese yazılmaz** (`?urun=&sayfa=1&boyut=25` gibi
   bir adres paylaşılabilir olmaktan çıkar).
2. **Filtre değişince sayfa anahtarı sıfırlanır** — yamada sayfa açıkça
   verilmediyse. 3. sayfada filtre daraltıp boş ekran görmek gerçek bir
   kullanıcı hatası kaynağıdır.
3. **`push` varsayılan** (geri tuşu çalışır); serbest metin kutusuna yazarken
   `ayarla(yama, { replace: true })` ile geçmiş şişirilmez. Ayrık filtreler
   (seçim kutusu, sekme) `push` kalır.

Ayrıca `filtreliMi` — iki boş durumu ayırmak için gereken tek bilgi — ve
`temizle()`. `sayfa`/`boyut` `filtreDisi`'dir: 2. sayfada olmak "filtre
uygulanmış" değildir.

Kanıt: `useUrlDurumu.test.tsx` (10 test, gerçek `react-router` + gerçek jsdom
geçmişi) + pilot ekran testinde **gerçekten gönderilen istek**
(`product_id=5`, `offset=25`, `limit=50`) ve gerçek geri tuşu
(`window.history.back()`).

### 3c — İki ayrı boş durum

| Durum | Başlık | Çıkış |
|---|---|---|
| Filtre eşleşmedi | "Bu filtreyle kayıt bulunamadı" | **Filtreyi temizle** |
| Hiç kayıt yok | "Hasar kaydı yok" | **İlk kaydı oluştur** (yalnız `inventory.apply` varsa) |

Yetkisiz kullanıcıya "İlk kaydı oluştur" gösterilmiyor — tıklanabilir bir yalan
olurdu; ayrı test var. Hata durumunda boş durum metni hiç görünmüyor
(hata ≠ boş) ve **her sorguda "Yeniden dene"** sunuluyor (mutasyon B9).

### 3d — Ham butonlar (dürüst durum)

Pilot ekranın ham `<button>`ı **yoktu** (A2/A3c'de zaten temizlenmişti) ve
`DamageDialog`ın da yok. Yani göç bu sayıyı pilottan düşüremezdi; "düştü" diye
yazmak sahte ilerleme olurdu. Gerçek düşüş başka yerden geldi: **`DataTable`ın
sayfalama düğmeleri** (Önceki/Sonraki) ortak `Button`a geçti — odak halkası,
`disabled` opaklığı ve dokunma yüksekliği orada elle yazılmıştı. **160 → 158.**

Aynı dosyadaki diğer iki ham buton bilinçli bırakıldı: mobil satır yüzeyi
(tam genişlik, kart görünümü) ve sıralama başlığı (`<th>` içi) — ortak
`Button`ın görsel sözleşmesine girmiyorlar.

### 3e — Dokunmatik

Satır aksiyonları açık düğme olarak **bırakıldı**; üç nokta menüye geçilmedi
(prompt kararı; bu kod tabanının bilinçli tercihi).

---

## Görev 4 — Koşullu dal testi ve **maliyeti**

Kabul kriteri: *form tüm koşullu dallarıyla render edilir ve her form alanının
erişilebilir adı doğrulanır.*

`DamageDialog`ın koşullu alanları: `kova` (yalnız `SUPPLIER_RETURN`),
`aciklama` (yalnız `neden === "DIGER"`), imha onay kutusu (yalnız `DISPOSAL`).

**Uygulama.** `src/components/admin/inventory/damageDialogDallar.test.tsx` —
4 işlem × 2 neden dalı = **8 kombinasyon**, artı iki denetim testi. Her
kombinasyonda kaptaki **bütün** form kontrolleri taranıp adsız olan var mı
diye bakılıyor; alan alan `getByLabelText` yazılmıyor.

Tekrar eden kısım ortak alete taşındı: **`src/test-utils/alanAdlari.ts`** —
`erisilebilirAd`, `formKontrolleri`, `adsizKontroller`. Adlandırma kuralları
sayaçla aynı (aria-label / aria-labelledby / `htmlFor`↔`id` / sarmalayan
`<label>`; `placeholder` ve `title` **ad sayılmaz**; `hidden`/`submit`/`reset`/
`button`/`image` ölçüm dışı).

**Yanlış-yeşil korumaları** (ikisi de bu dosyada):

- Her kombinasyonda `formKontrolleri(dialog).length >= 3` — kontrol
  bulunamazsa "adsız yok" iddiası boş kümede geçerdi.
- "koşullu alanlar gerçekten AÇILIYOR" testi: dal açılmadan alan yok, açılınca
  var (ad iddiasıyla).
- "aletin kendisi çalışıyor": elde yazılmış adsız bir alan yakalanıyor
  (mutasyon B11 aleti körleştirince kırılıyor).

### Maliyet — A7'ye uygulanabilir mi? (dürüst değerlendirme)

**Evet, uygulanabilir.** Ölçüler:

| Kalem | Bu pakette |
|---|---|
| Ortak alet (bir kez yazıldı) | 96 satır — A7'de **tekrar yazılmayacak** |
| Ekran başına yazılan | ~35 satır: yüzey/prop kurulumu + dalları açan tıklamalar |
| Koşum süresi | 10 test / 0.79 s |

Ekran başına gerçek iş **dalları saymak ve açmaktır**; adlandırma denetimi
tek satır (`expect(adsizKontroller(kap)).toEqual([])`). Riskler:

1. **Dal sayısı çarpımsal.** Burada 4×2 = 8 kombinasyon manuel yazılmadı,
   döngüyle üretildi. Üç bağımsız koşulu olan bir formda 8, dördünde 16 render
   olur. Öneri: **dalları çarpma, birleştirmeye çalış** — testin amacı
   "her alan en az bir kez render edilsin", tam kartezyen çarpım değil. A7'de
   kural şu olmalı: *her koşullu alan en az bir kez açılmalı*, kombinasyon
   patlaması gerekmiyor.
2. **Formu render edilebilir kılmak** bazı ekranlarda pahalı (sağlayıcı,
   yönlendirici, mock'lanacak sorgu). Bu maliyet zaten her ekran testinde var;
   dal testi onu artırmıyor.
3. **Alet aynı-dosya sınırına sahip değil** (sayaçtan farklı olarak çalışma
   zamanında ölçüyor) — bu bir avantaj: sayaçta yanlış-negatif üreten
   "başka dosyadan gelen sarmalayıcı" burada doğru okunuyor.

**Deseni A7'den önce değiştirmeyi gerektiren bir maliyet bulunmadı.**

---

## Görev 5 — Temizlik ve kararsız testler

### 5a — Sonda artıkları (TB-A3c-2)

`frontend/damage-probe.html`, `frontend/form-probe.html`, `src/__probe__/*`
üretim ağacından **çıkarıldı**. Silinmek yerine `frontend/scripts/probe/`
altına taşındılar; gerekçe: iki sonda hâlâ gerekli — A2'nin piksel ölçümü ve
A3a'nın karanlık mod paritesi ölçümü jsdom'da yapılamaz ve sürücüleri
(`scripts/ip_a2_slot_probe.mjs`, `scripts/ip_a3a_karanlik_probe.mjs`) hâlâ
duruyor. Silmek, koşulamayan iki ölü sürücü bırakırdı.

Taşımanın kazandırdığı: `scripts/` `tsconfig`in `include: ["src"]` kapsamı
DIŞINDA ve sayaç taramasının (`allSource()`) dışında. `DamageDialogProbe`
yeni yüzey API'sine uyarlandı (taşımanın maliyeti bu oldu ve raporlanıyor).

### 5b — Kararsız iki test: **kök neden bulundu, karantina YOK**

Üretim: `--sequence.shuffle --sequence.seed=2` ile ikisi de düştü
(`ticketsPaymentGate` ve `storeVariants.acceptance`). Aynı seed ikinci
koşumda yalnız birini düşürdü — yani **sıra bağımlılığı değil**.

Düşüş biçimi ikisinde de aynı: `Unable to find role=… name …`. Yani iddia
yanlış değil, **henüz doğru değil** — `findAllBy*` beklemesi doluyor.

**Kök neden:** Testing Library'nin `asyncUtilTimeout` varsayılanı **1000 ms**
ve Vitest'in `testTimeout`undan (bu repoda 9000 ms, TB-23 ölçümüyle seçilmiş)
**tamamen bağımsız**. Her iki test de İKİ ağ sorgusu çözülene kadar bekleyen
`findAllBy*` çağrılarıdır; tam suite yük altında koşarken (114 dosya, paralel
işçiler) jsdom render + query çözümü 1 saniyeyi aşabiliyor. Düşen testin
kendi süresi 2342 ms ölçüldü. Bu, TB-23'ün kaydettiği kökün aynısıdır:
**yeşil/kırmızı sinyalinin makine yüküne bağlanması.**

**Düzeltme:** `src/test-setup.ts` → `configure({ asyncUtilTimeout: 4000 })`,
gerekçesi dosyada yazılı. Değer ölçüyle seçildi: yükte gözlenen en uzun gerçek
bekleyiş ~2.3 s; 4 s onun ~1.7 katı ve Vitest'in 9 s'lik bütçesinin altında —
gerçek bir asılma hâlâ testi düşürür, sessizce yutulmaz. Daha geniş bir değer
(ör. 8 s) gerçek bir performans regresyonunu gizlerdi.

**Doğrulama:** düzeltmeden önce seed 2 iki koşumun ikisinde de düşmüştü;
sonra aynı seed **3/3 yeşil**. Ardından altı seed:

| seed | sonuç |
|---|---|
| 2 | 114/114 ✅ |
| 7 | 114/114 ✅ |
| 11 | 114/114 ✅ |
| 13 | 114/114 ✅ |
| 21 | 114/114 ✅ |
| 42 | 114/114 ✅ |

**Karantinaya alınmadı** — gerek kalmadı.

---

## Görev 6 — Eşikler ve mutasyon provası

### Eşikler

| Ölçüm | İP-A3c | **İP-A4** | Not |
|---|---|---|---|
| ölçüm tabanı dosya | 71 | **72** | `ui2/duzenlemeYuzeyi.tsx` eklendi |
| ham `<button` | 160 | **158** | `DataTable` sayfalaması ortak `Button`a |
| adsız form kontrolü | 56 | **56** | **düşmedi** — pilot dosyalarda zaten 0'dı (aşağıda) |
| etiketsiz overlay | 5 | 5 | değişmedi |
| `ui2/` dışı Medusa importu | 0 | 0 | değişmedi |
| **ekranda yaşayan pencere durumu** | — | **33** (21 dosya) | YENİ metrik |

**Adsız kontrol neden düşmedi (sahte düşüş yazılmadı).** `DamageEventsPage` ve
`DamageDialog`ın adsız kontrol sayısı bu paketten ÖNCE de 0'dı — A2'de form
`Form.*`a geçerken, A3c'de `Form.Control` koruması eklenirken ödenmişti. Göç
sıfırdan aşağı düşüremez. Sayı A6-A7'de, henüz göç etmemiş ekranlar
(`OperatorLibrary` 7, `DeliveryDriver` 4, …) girdikçe düşecek.

**Yeni metrik: ekranda yaşayan pencere durumu.** Bir `useState` bağı, adı
`/(Dialog|Modal|Drawer|Sheet|Pencere|Yuzey|Overlay|Popover)$/` desenine uyan
bir bileşene pencere özniteliği (`open`/`acik`/`isOpen`/`visible`/`gorunur`/
`kind`/`hedef`/`yuzey`) olarak veriliyorsa sayılır; bağ başına bir kez.
Türetilmiş ifadeler de sayılır (`open={!!acik}`, `open={secili !== null}`).

İki nöbetçi birden kondu:

- **Sayı artamaz** (taban 33).
- **Dosya listesi sabittir** ve `DamageEventsPage` listede **değildir**.
  Yalnız sayıya bakmak yetmezdi: göç eden bir ekran borcunu kapatırken başka
  bir ekran yenisini ekleyebilir ve toplam sabit kalırdı.

Sayacın kendi doğruluğu ayrı dosyada (`__guards__/sayim.test.ts`, +6 test):
ters prova, yinelenen bağ, türetilmiş ifade, **pencere olmayan bileşene
verilen durum sayılmaz**, **durum olmayan değer sayılmaz**, yorum sayılmaz.

**Metriğin bilinen kaçış yolu:** pencere bileşeninin adı bu desene uymuyorsa
(ör. `<Katman görünür={acik}>`) sayaç görmez. Desen bilinçli olarak dardır —
yanlış pozitif, gerçek borcu gözden kaçırmaktan daha zararlıdır (A3c'de
parçalanmış overlay sınıfı için verilen gerekçenin aynısı). Göçte yeni bir
pencere bileşeni doğarsa desene eklenmelidir.

### Mutasyon provası — 19/19

Sürücü kullanıcının değişikliklerini silmez: dosyanın baytları yedeklenir,
mutasyon uygulanır, hedef test koşulur, yedek geri yazılır ve **SHA-256 ile
aynı olduğu doğrulanır** (`git checkout` KULLANILMAZ — kök CLAUDE.md §D).

| # | Mutasyon | Hedef | Sonuç |
|---|---|---|---|
| M1 | `onClose` bağımlılığa geri konur | `useModalA11y.test` | YAKALANDI |
| M2 | Pilota ham `<button>` eklenir | nöbetçi | YAKALANDI |
| M3 | Pilota adsız `<input>` eklenir | nöbetçi | YAKALANDI |
| M4 | Pilot ESKİ pencere desenine döner (`useState` + `kind={…}`) | nöbetçi | YAKALANDI |
| M5 | Pilota etiketsiz overlay eklenir | nöbetçi | YAKALANDI |
| M6 | Ekran doğrudan `@medusajs/ui` import eder | nöbetçi | YAKALANDI |
| M7 | Ölçüm tabanına yeni dosya girer | nöbetçi | YAKALANDI |
| B1 | Yüzeyden kirli form bekçisi sökülür | yüzey testi | YAKALANDI |
| B2 | `kapat()` de bekçiden geçirilir (koşulsuzluk bozulur) | yüzey testi | YAKALANDI |
| B3 | İşlem sürerken kapatma kapısı kaldırılır | yüzey testi | YAKALANDI |
| B4 | Filtre değişince sayfa sıfırlanmaz | URL testi | YAKALANDI |
| B5 | Her yazım `replace` (geri tuşu ölür) | URL testi | YAKALANDI |
| B6 | Varsayılan değerler de adrese yazılır | URL testi | YAKALANDI |
| B7 | `renderMobileRow` kaldırılır | pilot testi | YAKALANDI |
| B8 | İki boş durum aynı metne düşer | pilot testi | YAKALANDI |
| B9 | Hatada "Yeniden dene" sunulmaz | pilot testi | YAKALANDI |
| B10 | Koşullu alanın (`kova`) etiketi kaldırılır | dal testi | YAKALANDI |
| B11 | Adsız kontrol denetimi hep boş döner (alet körleşir) | dal testi | YAKALANDI |
| B12 | Pilot filtresi URL yerine `useState`e döner | pilot testi | YAKALANDI |

**Kendi hatam, dürüstçe:** M4'ün ilk yazımı KAÇTI — çünkü mutasyonum yalnız bir
`useState` ekliyordu, onu bir pencereye vermiyordu. Metrik "her `useState`i"
değil "pencereye verilen durumu" ölçtüğü için bu doğru davranıştı; mutasyon
gerçekçi geri kaymaya (durum + `kind={…}` prop'u) çevrildiğinde yakalandı.
Kaçan mutasyon rapor edilmeden düzeltilmedi.

Her mutasyondan sonra `git status --porcelain` ve içerik özeti kontrol edildi:
**ağaç her seferinde temiz** (`temiz` sütunu sürücü çıktısında).

---

## A7'ye taşınan desen kararları

Göçü yapacak kişinin listesi:

1. **Ekran modal `useState`i tutmaz.** `useDuzenlemeYuzeyi` + `DuzenlemeYuzeyi`
   kullan. Nöbetçi hem sayıyı hem dosya listesini tutuyor; göç eden her ekran
   listeden çıkmalı.
2. **Kirli form bekçisini ekranda yazma.** Yüzeyin içinden geliyor;
   `sunucuHatasi` zorunlu prop (hata takibi yoksa `HATA_TAKIBI_YOK`).
3. **"Vazgeç" düğmesini ekranda yazma.** Yüzeyin kendisinde. Gönder düğmesi
   `aksiyonlar`a gider.
4. **Başarıda `yuzey.kapat()`** (koşulsuz). Kullanıcı kaynaklı kapatmayı asla
   `kapat` ile yapma — yüzeyin çizdiği yollar zaten bekçiden geçiyor.
5. **Filtreler `useUrlDurumu` ile URL'e.** Serbest metin için
   `{ replace: true }`, ayrık filtreler için varsayılan `push`. `sayfa`/`boyut`
   `filtreDisi`'dir.
6. **İki boş durumu ayır.** `filtreliMi` bunun için var. Çıkışlar farklı:
   "Filtreyi temizle" ↔ "İlk kaydı oluştur" (ve ikincisi yetki ister).
7. **Her sorguda `ErrorState` + "Yeniden dene".** Hata ≠ boş ekran.
8. **Tablo `DataTable`da**, mobil için `renderMobileRow` yaz. Sunucu sıralama
   desteklemiyorsa kolonda `enableSorting: false` — çalışmayan bir sıralama
   kontrolü göstermek yalandır.
9. **Her form için koşullu dal testi**: `test-utils/alanAdlari.ts`'i kullan,
   *her koşullu alan en az bir kez* açılsın (kartezyen çarpım gerekmiyor).
10. **Gönder düğmesi geçerlilik yüzünden kapanmaz** (A3c kararı, değişmedi).
11. **Ekran dosyası `@medusajs/ui`'den doğrudan import etmez** (değişmedi).
12. **Eşiği düşürürken ölç, tahmin etme.** Düşmeyen bir sayıyı düşmüş gibi
    yazma; gerekçesini yaz.

---

## Bilinen sınırlar ve yeni borç

**TB-A4-1 · Hasar olayları listesinde sunucu taraflı sıralama yok.**
`GET /inventory/damage-events` yalnız `id DESC` döner. `DataTable`ın sıralama
yeteneği bu ekranda kapalı. Açmak için uçta bir `sort` parametresi (+ servis +
test) gerekir; bu paketin (frontend) kapsamı dışında bırakıldı.

**TB-A4-2 · Pencere durumu metriğinin ad deseni.** Yukarıda anlatıldı: desene
uymayan bir pencere bileşeni sayaçtan kaçar. Göçte yeni pencere bileşeni
doğarsa `PENCERE_BILESENI` güncellenmeli.

**TB-A4-3 · Sonda sayfaları bakım gerektiriyor.** `scripts/probe/*` üretim
ağacının dışında ama `tsc` de görmediği için API değişikliklerinde **sessizce
bozulurlar** (bu pakette `DamageDialog` prop'ları değişince elle uyarlandı).
Bir sonraki kırılmada karar: ya bir tip kapısı ekle ya sil.

**Sınır · `DamageDialog.test.tsx` sahte yüzey kullanıyor.** Diyalog birim
testinde yüzey elle kurulmuş bir nesnedir (`kapat` doğrudan casus). İddiaların
hiçbiri değişmedi; gerçek `useDuzenlemeYuzeyi` ekran kabul testinde koşuyor.

**Sınır · `inventoryScreens.acceptance.test.tsx` değiştirilmedi** (sözleşme).
Göçün yeni davranışları ayrı dosyada (`damageEventsPilot.test.tsx`).

**Sınır · Gerçek tarayıcı turu yapılmadı.** Bu pakette değişen görsel yüzey
mobil kart düzeni ve sayfalama düğmeleridir; ikisi de jsdom'da davranışsal
olarak doğrulandı ama **piksel/kırılma** açısından ölçülmedi. A7'de göç eden
ekranlar biriktiğinde bir Chrome turu gerekir.

---

## Bitiş kontrolü

- [x] `useModalA11y` odağı her render'da sıfırlamıyor; ters provası var; mevcut çağrı yerleri bozulmadı
- [x] Düzenleme yüzeyi soyutlaması `ui2/` altında; pilot ekranda modal `useState`i yok
- [x] Kirli form bekçisi soyutlamanın içinden bağlanıyor, ekranda tekrar yazılmıyor
- [x] Tablo ortak `DataTable`da; `renderMobileRow` kullanımda; sunucu sıralaması yok — durum dürüstçe raporlandı
- [x] Filtreler URL'de; filtreli adresle açılış, geri tuşu ve gerçek istek testlerle doğrulandı
- [x] Filtre-boş ile kayıt-yok iki ayrı boş durum; her sorguda "Yeniden dene"
- [x] `DamageDialog`ın her koşullu dalı render edilip her alanın erişilebilir adı doğrulandı
- [x] Sonda artıkları üretim ağacından çıkarıldı
- [x] Kararsız iki test: **kök neden bulundu ve düzeltildi**; 6 seed raporlandı
- [x] Eşikler yeni gerçek değerlerde ve mutasyonla kırıldı (19/19)
- [x] `ui2/` dışında `@medusajs/ui` import eden dosya: 0
- [x] Pilot ekran ve `ui2/` dışında ekran dosyası değişmedi (değişenler: pilot + `ui2/` + `DataTable` + `useModalA11y` + sayaç/nöbetçi/test/sonda dosyaları)
