# İP-A7d3 — Göç dalgası 3: on ekran

**Taban:** `c03484b` (A7d2) · branch `feat/medusa-ui-taban`
**Girdi:** `docs/arsiv/ip-a/ip-a7d2-rapor.md`, `docs/arsiv/ip-a/ip-a7d1-rapor.md`, `docs/arsiv/ip-a/ip-a6b-rapor.md`

---

## Özet

| | |
|---|---|
| Göç eden ekran | **10** |
| **Sözleşme kusuru** | **2** — ikisi de ORTAK KATMANDA, ikisi de **13 çağrı yerinde canlıydı** |
| Ortak katmanda eksik (kusur değil, sınır) | **0** (ikinci dalga üst üste) |
| Ekran regresyonu | **0** |
| Kasıtlı davranış değişikliği | **8** |
| Yeni test | **120** (suite 1378 → 1498) |
| Eşik | **3'ü düştü, biri sıfırda kaldı**: 130→**104** · 26→**7** · 20→**9** · 0→**0** |
| Mutasyon provası | **14/14 yakalandı** |
| Gerçek tarayıcı | 10 ekran · 24 ekran görüntüsü · 24 kapı · hepsi geçti |
| Bekleme bütçesi | **yedinci çağrı yeri AÇILMADI** — üç zaman aşımı da kaynağında düzeltildi |
| Kapsam istisnası | **2** (`MapPicker`, `ConfirmDialog`/`ReasonDialog`) — ikisi de aşağıda, ana metinde |

---

## Görev 1 — Kalan borcun haritası

> **Bu raporun en önemli bölümü.** Seçim buradan türetildi, tahminden değil.

Ölçüm: `frontend/scripts/ui-baseline-sayim.mjs` (109 dosyalık isimle sabit taban).
Dalga başındaki toplam **130 ham `<button>` · 26 adsız kontrol · 20 pencere
durumu · 0 etiketsiz overlay**.

### 1a. Borç 109 dosyaya EŞİT DAĞILMAMIŞ

Dalga başında **57 dosyanın borcu sıfırdı**; kalan 52 dosya bütün borcu
taşıyordu. Yoğunluk şöyleydi (b=ham düğme, a=adsız kontrol, m=pencere durumu):

| Dosya | b | a | m | Not |
|---|---|---|---|---|
| `pages/DeliveryDriver.tsx` | **19** | 4 | 0 | saha/mobil ekran |
| `pages/dashboards/AdminHome.tsx` | **12** | 2 | 2 | üç bölümlü karma pano |
| `components/MapPicker.tsx` | 9 | 1 | 0 | paylaşılan widget |
| `components/PersonalizeModal.tsx` | 7 | 2 | 0 | paylaşılan widget |
| `components/ImageCropModal.tsx` | 6 | 1 | 0 | paylaşılan widget |
| `pages/admin/delivery/DeliveryRunDetailPage.tsx` | 5 | 0 | 1 | sürükle-bırak |
| `pages/dashboards/OperatorLibrary.tsx` | 4 | **7** | 0 | **en büyük adsız kalem** |
| `components/LibraryPayoutForm.tsx` | 1 | **5** | 0 | IBAN/TCKN — para+PII |
| `pages/dashboards/OperatorHome.tsx` | 3 | 3 | 0 | şifre paneli |
| `pages/dashboards/OperatorSessions.tsx` | 3 | 1 | 0 | elle bilet kodu |
| `pages/admin/inventory/CountSessionDetailPage.tsx` | 0 | 0 | **3** | **en yoğun pencere kalemi** |
| `pages/admin/packing/PackingStationPage.tsx` | 0 | 0 | **3** | **en yoğun pencere kalemi** |
| `pages/admin/delivery/DeliveryTodayPage.tsx` | 0 | 0 | 2 | |
| 3'er ham düğmeli sekiz dosya | 24 | 0 | 0 | başlık/bildirim/paylaş bileşenleri |
| 1–2'lik uzun kuyruk (~26 dosya) | ~38 | 0 | ~8 | |

**Adsız kontrolün 26'sının 25'i ALTI dosyadaydı**: `OperatorLibrary` 7,
`LibraryPayoutForm` 5, `DeliveryDriver` 4, `OperatorHome` 3,
`PersonalizeModal` 2, `AdminHome` 2 (+ `MapPicker`, `ImageCropModal`,
`OperatorSessions` birer). Yani bu metrik **birkaç dosyayı almadan anlamlı
biçimde düşmüyordu** — dalganın seçimini en çok belirleyen gözlem budur.

**Pencere durumunun 20'si 14 dosyaya yayılıydı** ve yalnız ikisi 3'er bağ
taşıyordu; kalanı 1–2'lik uzun kuyruktu.

### 1b. Hangi dosyalar zaten göç etmişti

Dalga başında `ui2/` sözleşmesini kullanan ekranlar: `AdminStore` ailesi
(A6), `AdminLibraries` · `LibraryEditorModal` · `AdminAuditLogsPage` ·
`AdminBookingsPage` (A7d1), `ExamSessionsManager` · `AdminExamCatalogs` ·
`AdminPayoutsPage` · `PackagesPage` · `CourierManager` ·
`DeliveryVehiclesPage` (A7d2). Toplam 17 dosya; hiçbiri bu dalgada yeniden
ele alınmadı.

### 1c. Ekran OLMAYAN dosyalar

Taban yalnız ekranları değil, ekranların import grafiğini de kapsıyor
(A6b · Görev 3). Bunlardan **göç gerektirmeyenler**:

* **Baskı katmanları** — `PackageLabel`, `PackingLabelSheet`, `LabelSheet`.
  Overlay sayacında zaten `PRINT_LAYERS` ile ayrılıyorlar; `ov` sütunundaki 4
  buradan gelir ve **borç değildir** (nöbetçi bunları saymaz, eşik 0'dır).
* **Paylaşılan widget'lar** — `MapPicker` (harita tuvali), `ImageCropModal`
  (kırpma tuvali), `PersonalizeModal` (tema/pano tercihleri). Kendi tasarım
  sözleşmeleri var; form göçünün konusu değiller.
* **Salt görünüm/kabuk** — `DashboardShell`, `DashboardHeader`, `AdminLayout`,
  `NotificationsBell`, `ShareButton`, `CapacityStrip`, `Badge`, `Button`,
  `Dialog`, `DataTable`. Bunların ham düğmeleri kendi bileşen içi
  denetimleridir (sayfalama okları, kapatma ×'i, bildirim zili).

### 1d. Haritanın söylediği: kapanış ne kadar uzakta

Bu dalgadan **sonraki** durum (ölçülmüş, tahmin değil):

| Ölçüm | Dalga öncesi | **Dalga sonrası** | Kalanın nerede olduğu |
|---|---|---|---|
| ham `<button` | 130 | **104** | 41'i üç widget + saha ekranında; 63'ü 1–3'lük uzun kuyrukta |
| adsız kontrol | 26 | **7** | **tamamı** üç dosyada: `DeliveryDriver` 4, `PersonalizeModal` 2, `ImageCropModal` 1 |
| pencere durumu | 20 | **9** | 8 dosyaya yayılmış, hiçbiri 2'den fazla değil |
| etiketsiz overlay | 0 | **0** | — |

Kapanış değerlendirmesi raporun sonunda.

---

## Görev 2 — Ekran seçimi

**On ekran.** Ölçüt bu dalgada **borç yoğunluğu**; ama tek boyutlu seçilmedi:
üç ekran daha önce göç etmemiş bir yazım getiriyor ve SK-4 sınıfı ayrıca
arandı.

| # | Ekran | Neden bu |
|---|---|---|
| 1 | `components/LibraryPayoutForm.tsx` | Adsız kontrolün **ikinci en büyük kalemi** (5) ve `CALISMA_ZAMANI_ADSIZ` tabanında isimle yazılı gerçek borç. IBAN + TCKN → para ve PII. |
| 2 | `pages/admin/AdminReportsPage.tsx` | **SK-4 sınıfı adayı**: pencerede 2000 karakterlik moderasyon notu + "yorumu yayından kaldır" kutusu, bekçi yok. Ekranın hiç kabul testi yoktu. |
| 3 | `pages/admin/inventory/CountSessionsPage.tsx` | Dört borç bir arada: pencere durumu + SK-4 adayı + **kilitli karar ihlali** (`disabled={!gecerli}`) + elle liste/sayfalama/`useSearchParams`. |
| 4 | `pages/admin/inventory/CountSessionDetailPage.tsx` | **En yoğun pencere kalemi** (3 bağ) ve **YENİ YAZIM: satır başına ayrı form**. Ayrıca iki kilitli karar ihlali. |
| 5 | `pages/admin/packing/PackingStationPage.tsx` | Diğer **en yoğun pencere kalemi** (3 bağ). Çok adımlı akış: pencereler akışın ORTASINDA açılıyor. |
| 6 | `pages/admin/delivery/DeliveryRunDetailPage.tsx` | 5 ham düğme + 1 pencere; **YENİ YAZIM: sürükle-bırak sıralama**. A7d2'nin dalga 3 için adıyla önerdiği ekran. |
| 7 | `pages/dashboards/OperatorLibrary.tsx` | **Adsız kontrolün en büyük kalemi** (7). **YENİ YAZIM:** yedi bölümlü satır içi düzenleme + `type="time"` ızgarası. |
| 8 | `pages/dashboards/OperatorHome.tsx` | 3 ham düğme + 3 adsız kontrol; üçü de **şifre alanı** (içeriği gizli olduğu için toast'la doğrulama iki kat körleştirici). |
| 9 | `pages/dashboards/OperatorSessions.tsx` | 3 ham düğme + elle bilet kodu kutusu — QR **yedek yolu**; adsız kalması tam da yedek yola düşen kullanıcıyı yalnız bırakıyordu. |
| 10 | `pages/dashboards/AdminHome.tsx` | **Ham düğmenin panel içindeki en büyük tek kalemi** (12) + 2 adsız + 2 pencere. |

### Kapsam kararı: operatör paneli üçlüsü (7-8-9)

A7d2 bu üçlüyü *"ayrı sahip ve ayrı kabul matrisi; karıştırmak iki paketin
ölçümünü de bulandırırdı"* diye elemişti. Bu dalgada **alındılar** ve gerekçe
haritadadır: kalan 26 adsız kontrolün **11'i** bu üç dosyadaydı; üçünü de
almadan metrik anlamlı biçimde düşmüyordu.

A7d2'nin endişesi ölçümün bulanması değil, **kabul matrisinin karışması**ydı;
bu yüzden yeni iddialar İP-14'ün mevcut testlerine dokunmadan
`operatorPanel.acceptance.test.tsx`in SONUNA kendi bölümünde yazıldı ve
İP-14'ün 24 testinin hiçbiri değişmedi.

### SK-4 sınıfı için ayrıca arama (görev tanımının zorunlu adımı)

`throw` bu sınıfı yakalamaz (olmayan çağrının beyanı da olmaz), dolayısıyla
taban **elle** tarandı: "pencere kuran + form alanı taşıyan + bekçiyi hiç
çağırmayan" dosyalar.

| Aday | Sonuç |
|---|---|
| **`components/admin/ui/ConfirmDialog.tsx` → `ReasonDialog`** | **GERÇEK — SK-7. Ortak katmanda ve 13 çağrı yerinde canlı.** Aşağıda. |
| `pages/admin/AdminReportsPage.tsx` | **GERÇEK** — dalgaya alındı (2). |
| `pages/admin/inventory/CountSessionsPage.tsx` | **GERÇEK** — dalgaya alındı (3). |
| `pages/admin/AdminAccessPage.tsx` | GERÇEK ama kapsam dışı (rol kodu/ad/açıklama + izin kutuları). Dalga 4'e yazıldı. |
| `pages/admin/inventory/CountSessionDetailPage.tsx` | Kısmen: iki penceresi `ReasonDialog`, biri salt-okunur onay. SK-7 ile kapandı. |
| `components/PersonalizeModal.tsx` · `ImageCropModal.tsx` | Widget; form değil (tercih anahtarları / kırpma tuvali). |
| `pages/admin/AdminAuditLogsPage.tsx` · `AdminLibraries.tsx` | Yanlış pozitif: pencereleri salt-okunur ya da zaten bekçili. |

### Elenen adaylar

| Aday | Neden elendi |
|---|---|
| `pages/DeliveryDriver.tsx` (19b + 4a) | Kalan tek büyük kalem ve **bilerek** bırakıldı: saha/mobil ekran, panel tasarım dilinde değil (tam ekran, tek elle kullanım, kamera, OTP). Panel sözleşmesini oraya taşımak bir GÖÇ değil bir yeniden tasarım kararıdır. |
| `MapPicker` · `PersonalizeModal` · `ImageCropModal` (22b) | Paylaşılan widget'lar; kendi tasarım sözleşmeleri var. (`MapPicker`ın **adsız arama kutusu** yine de kapatıldı — aşağıda, kapsam istisnası 1.) |
| `DeliveryTodayPage` (2m) · `DeliveryBoardPage` · `ReturnQueuePage` · `AdminSettingsPage` … | 1–2'lik uzun kuyruk; on ekranlık tavanı zorlamadan dalga 4'e bırakıldı. |
| `AdminAccessPage` (SK-4 adayı) | Onuncu sıra için `AdminHome` ile yarıştı ve kaybetti: `AdminHome` 12 ham düğme + 2 adsız + 2 pencere getiriyor, `AdminAccessPage` yalnız 1 pencere. |
| Baskı katmanları | Ekran değil; nöbetçi zaten ayırıyor. |

---

## Görev 3 — Kırmızı matris (implementasyondan ÖNCE)

Ölçüm sürücüsü bu pakette yazıldı: `frontend/scripts/kirmizi-olcum.mjs`.
Üretim dosyalarını dalga tabanına (`--taban c03484b`) geçici olarak geri alır,
testleri koşar, sonra **ham baytları** geri yazar; başta ve sonda
`git status --porcelain` eşitliğini doğrular (`git checkout --` KULLANMAZ).

| Dosya | Toplam | Tabana karşı KIRMIZI |
|---|---|---|
| `components/admin/ui/gerekcePenceresi.test.tsx` (ortak katman) | 17 | **9** |
| `components/kutuphaneOdemeGoc.acceptance.test.tsx` | 12 | **10** |
| `pages/admin/adminSikayetGoc.acceptance.test.tsx` | 19 | **3** |
| `pages/admin/inventory/sayimOturumlariGoc.acceptance.test.tsx` | 19 | **10** |
| `pages/admin/inventory/sayimDetayiGoc.acceptance.test.tsx` | 17 | **5** |
| `pages/admin/delivery/turDetayiGoc.acceptance.test.tsx` | 14 | **1** |
| `packingLabel.acceptance` · A7d3 bölümü (5 yeni) | 5 | **5** |
| `operatorPanel.acceptance` · A7d3 bölümü (10 yeni) | 10 | **9** |
| `adminTutorApproval.acceptance` · A7d3 bölümü (7 yeni) | 7 | **2** |
| **Toplam** | **120** | **54** |

### Düşük kırmızı sayılarının dürüst açıklaması

* **`turDetayiGoc` 14/1.** Bu ekranın borcu neredeyse tamamen YAPISALDI
  (5 ham düğme + 1 pencere durumu) ve o borcu ölçen şey davranış testi değil
  **sayaçtır**. Tek kırmızı, göçte eklenen `aria-expanded`tir. Kalan 13 test
  "göç bunları kırmamalı" sınıfındandır ve ekranın hiç davranış testi
  olmadığı için yine de değerlidir — ama bu paketin *ilerlemesinin* kanıtı
  eşik testi ve mutasyon **A7D3-3**'tür, bu dosya değil.
* **`adminSikayetGoc` 19/3, `adminTutorApproval` 7/2.** Aynı sebep: bu iki
  ekranın alanları zaten adlıydı ve `AdminReportsPage` zaten `DataTable` +
  URL süzgeci kullanıyordu. Kırmızıya dönen şey yalnız SK-4/SK-7 sınıfı
  koruma ve `aria-pressed`/adres süzgeci kararlarıydı.
* **`packingLabel` A7d3 bölümü 5/5 — AMA ölçüm İKİ KEZ yapıldı ve ilki
  YANILTICIYDI.** İlk ölçümde yalnız `PackingStationPage` tabana geri
  alındı ve **beş testin beşi de yeşil çıktı**. Sebep: koruma o ekranda değil
  ORTAK KATMANDA (`ReasonDialog`) ve o dosya geri alınmamıştı. İkinci ölçüm
  ikisini birden geri aldı ve beşi de kırmızıya döndü. Bu, "kırmızı matris"
  ölçümünün **hangi dosyaları geri aldığına** bağlı olduğunun somut kaydıdır;
  ortak katmanda düzeltilen bir kusurda ekran dosyasını tek başına geri almak
  yanlış cevap verir.

### "Hiç koşmadı" durumu — kırmızıdan AYRI raporlanır

Beş test **yanlış sebeple** kırmızı düştü ve düzeltilmeden sayılmadı:

1. `gerekcePenceresi` · "kirli formda ESC" — onay penceresi açılınca alanın
   değerini `getByRole` ile okumaya çalışıyordu. Medusa'nın onay penceresi
   MODALDIR ve arkadaki ağacı erişilebilirlik ağacından gizler; alan DOM'da
   dururken rol sorgusuyla bulunamıyordu. İddia "metin duruyor mu"ya
   sabitlendi (`querySelector`).
2. `gerekcePenceresi` · "onayı onaylayınca kapanır" — onay düğmesinin adı
   "Değişiklikleri sil" sanılmıştı; gerçek ad `promptTr.confirmText` = "Çık".
3. `adminSikayetGoc` · dört test — sahte sunucu `{items,total}` dönüyordu ama
   uç DÜZ DİZİ + `x-total-count` başlığı döndürüyor; ayrıca süzgeçler axios
   `params`ında taşınıyor ve ham `config.url`de görünmüyordu.
4. `sayimOturumlariGoc` · "adresteki süzgeç isteğe konur" — aynı `params`
   tuzağı. **Bunun ikizi bir YALANCI YEŞİL üretmişti**: "uydurma değer
   ELENİR" testi, sorgu hiç birleştirilmediği için `drop_table` içermeyen bir
   URL'e bakıyordu ve bozuk kod da geçerdi. Serileştirici eklendi.
5. `operatorPanel` A7d3 bölümü · beş test — yanlış uç adresi
   (`/library-exams/operators/me` yerine `/library-operators/me`) ve yanlış
   olanak slug'ı (`WIFI` yerine `wifi`). Dosyanın kendi `temelUclar()`
   yardımcısına geçildi.

### Zorunlu ikili — her ekranda

| Ekran | Kirli formda kapatma sorar | Tüm koşullu dallar + alan adları |
|---|---|---|
| `LibraryPayoutForm` | pencere yok → **`beforeunload` çift yönlü** (Ö-4) | ✔ Ö-1 (dört durum dalı) |
| `AdminReportsPage` | ✔ Ş-2 | ✔ Ş-3 (dört dal) |
| `CountSessionsPage` | ✔ S-1 | ✔ S-2 (üç kapsam dalı) |
| `CountSessionDetailPage` | ✔ D-2 (gerekçe penceresi) | ✔ D-4 (beş FSM dalı) |
| `PackingStationPage` | ✔ üç pencerenin ÜÇÜNDE de + temiz ters prova | dallar `packingScreens`te |
| `DeliveryRunDetailPage` | **uygulanmaz** — penceresi `ConfirmDialog`, içinde yazılan bir şey YOK. Yerine pencerenin ortak yüzeyden geldiği ölçülür (T-3). | ✔ T-4 (üç dal) |
| `OperatorLibrary` | pencere yok (satır içi bölümler) | ✔ adres + saat + olanak + salt-okunur dalları |
| `OperatorHome` | pencere yok → **`beforeunload` çift yönlü** | ✔ açık/kapalı dal |
| `OperatorSessions` | pencere yok | ✔ |
| `AdminHome` | ✔ red gerekçesi penceresi + temiz ters prova | ✔ onay kuyruğu dalı |

Dallar **kartezyen çarpılmadı**; kural "her koşullu alan en az bir kez".

---

## Görev 4 — Göç, ekran ekran

Onu **ayrı ayrı** yeşile alındı; her adımda ilgili suite yeniden koşuldu.

### (1) `LibraryPayoutForm`

| | Önce | Sonra |
|---|---|---|
| Beş alan | `placeholder` etiket yerine | `Form.Item`/`Label`/`Control`/`ErrorMessage` |
| Doğrulama | dört `toast.error`, ilkinde `return` | `zod` + alan başına mesaj, odak ilk hatalı alana |
| IBAN | `if (!/^TR\d{24}$/…) return toast` | şemada; boşluk kırpma + büyük harf gönderimde |
| Kirli form | koruma YOK | `pencereSiz: true` beyanıyla bekçi (rota + sekme) |
| Gönder düğmesi | ham `<button>` | ortak `Button` |

`pencereSiz` beyanı **koşulsuz** yazıldı ve bu bilinçlidir: bileşen hem satır
içi (`Balance`, `Settings`) hem pencere içinde (`AdminLibraries`in ödeme
yüzeyi) yaşıyor. Beyan pencereli kullanımda zararsızdır (A7d2 · SK-3 tablosu)
ve `ProductForm`daki gibi `mode`dan türetilemez — bu bileşen nerede olduğunu
bilmiyor ve bilmemeli.

### (2) `AdminReportsPage`

Pencere durumu → `useDuzenlemeYuzeyi`; `Dialog` → `DuzenlemePenceresi` +
bekçili içerik; not alanı ve gizleme kutusu `Form.Field`e; gönder düğmesi
açık; 422 notun altına, alana düşmeyen hata pencere içinde şeride.

### (3) `CountSessionsPage`

| | Önce | Sonra |
|---|---|---|
| Liste | elle `<ul>` + elle sayfalama | ortak `DataTable` + `renderMobileRow` |
| Filtre/sayfa | elle `useSearchParams` + elle `delete("sayfa")` | `useUrlDurumu` + **enum beyaz listesi** |
| Gönder düğmesi | `disabled={!gecerli}` | açık; hata İLGİLİ alanda (`superRefine`) |
| Boş durum | tek metin | ikiye ayrıldı + "Süzgeci temizle" çıkış yolu |
| Satır | `<Link>` sarmalı `<li>` | satır tıklaması + **kod hâlâ gerçek `<a href>`** |

Kodun bağlantı kalması bilinçli: orta tuş / "yeni sekmede aç" yalnız `<a href>`
ile çalışır ve `DataTable` etkileşimli kaynaktan gelen tıklamayı zaten yutmaz.

### (4) `CountSessionDetailPage` — **yeni yazım: satır başına form**

Üç pencere durumu yüzeye taşındı. Satırdaki sayım alanı `useState` +
`disabled={!gecerli}` idi; `react-hook-form` + `zod`a geçti, düğme açık kaldı,
hata alanın altına indi. Sunucudan gelen tazeleme `setValue` ile değil
**`reset`** ile yansıtılıyor — `setValue` alanı KİRLİ bırakır ve kullanıcı
hiçbir şey yazmamışken bekçiyi uyandırırdı (test: D-1'in son maddesi).

"Ürün ekle" kutusu geçersiz girdide **sessizce hiçbir şey yapmıyordu**
(`if (!idler.length) return;`). Sessiz `return` bir doğrulama değil,
gizlenmiş bir hatadır; şemaya çevrildi.

### (5) `PackingStationPage`

Üç `useState` → üç ayrı `useDuzenlemeYuzeyi`. Yüzeylerin ayrı olması
bilinçli: aynı anda yalnız biri açık olabilir ama hedefleri farklı türdendir
(satır / satır / paketin kendisi) ve tek birleşik yüzey hangi pencerenin hangi
hedefe ait olduğunu tipten silerdi.

### (6) `DeliveryRunDetailPage` — **yeni yazım: sürükle-bırak sıralama**

Beş ham düğme ortak `Button`a; `cancelOpen` yüzeye. Sıralama oklarının
`aria-label`ları **aynen korundu**: sürükle-bırak dokunmatikte çalışmadığı
için o üç düğme sıralamanın tek klavye/dokunma yoludur ve adları
sözleşmedir. "Haritayı göster/gizle" düğmesine `aria-expanded` eklendi.

### (7) `OperatorLibrary` — **yeni yazım: yedi bölümlü satır içi düzenleme**

Beş adres kutusu `placeholder`dan görünür etikete; on dört saat kutusundan
ikisi `aria-label` aldı (desen `LibraryEditorModal`den, A7d1); `SaveRow` ve
bölüm aç/kapa düğmeleri ortak `Button`a (`aria-expanded` + bölüm adını taşıyan
`aria-label`).

> **Kapsam kararı, açıkça:** bu ekranın YEDİ kardeş bölümü aynı yerel-durum
> idiomunu kullanıyor ve altısında alanlar zaten `<label>` sarmalı. Tek bölümü
> `Form.*`a çevirmek aynı ekranda İKİ ayrı form yazımı üretirdi. Etiketleme
> dosyanın kendi desenine uygun yapıldı; `Form.*`a tam geçiş dalga 4'e yazıldı.

Ayrıca saat kutuları **`dark:[color-scheme:dark]`** aldı — SK-6'nın bu
dalgada bulunan ikinci örneği (aşağıda).

### (8) `OperatorHome`

`PasswordPanel` üç şifre alanı `Form.*`a, doğrulama toast'tan alana, iki ham
düğme `Button`a (`aria-expanded` ile). Sunucu 422'si için **alan adı eşlemesi**
verildi (`current_password → current`, `new_password → next`) — eşleme olmadan
mesaj genel kanala düşerdi.

### (9) `OperatorSessions`

Elle bilet kodu kutusuna `sr-only` etiket (harita/kamera kabuğunda görünür
etiket yer kaplıyor); üç ham düğme `Button`a.

### (10) `AdminHome`

On iki ham düğmenin **on biri** `Button`a; iki pencere durumu yüzeye; iki red
notu alanı etiketlendi. Ad değişikliği kuyruğunun süzgeci `useState`ten
**adrese** taşındı (beyaz listeyle) ve süzgeç çipleri `aria-pressed` aldı.

---

## Kusur sınıflandırması — dört kategori, AYRI AYRI sayılmış

### A. Sözleşme kusurları — **2**

> İkisi de aynı dosyada, ikisi de ORTAK KATMANDA ve ikisi de **13 çağrı
> yerinde üretimde canlıydı**.

**SK-7 · `ReasonDialog` kirli form bekçisini HİÇ çağırmıyordu (ÜRETİMDE CANLI).**
Bileşen kendi `Dialog`ını kuruyor ve içinde 2000 karaktere kadar metin alan bir
`textarea` taşıyor. ×/ESC/dış tıklama yazılan gerekçeyi **sormadan** siliyordu.
A7d2'nin `ProductForm`da bulduğu SK-4 sınıfının aynısı; farkı ekran değil
**paylaşılan katman** olması. Çağrı yerleri (13) çoğunlukla geri alınamaz
kararların gerekçe alanıdır: sipariş iptali, iade reddi, eğitmen başvurusu
reddi, sayım oturumu iptali, paketten vazgeçme, kütüphane reddi, ayar bayrağı
değişimi. Mutasyon: **A7D3-5**.

**SK-8 · Aynı bileşende gönder düğmesi geçerlilikle kapanıyordu.**
`disabled={trimmed.length < minLength || asildi}` — kilitli kararın açık
ihlali. `AdminPayoutsPage`te (A7d2) aynı ihlal tek ekranı ilgilendiriyordu;
burada on üç çağrı yerini birden. Gerekçe zorunluyken boş bırakan kullanıcı
düğmeden NEDEN basamadığını göremiyordu. Mutasyon: **A7D3-6**.

Düzeltme ikisini birden kapatır ve **çağrı yeri sözleşmesini değiştirmez**:
`open`/`onClose` API'si korundu, pencerenin ihtiyaç duyduğu
`DuzenlemeYuzeyiKapisi` bileşenin İÇİNDE türetiliyor, içerik ayrı bir
bileşende bekçiyi çağırıyor (SK-3'ün gereği). On üç dosyanın hiçbiri
değişmedi.

> **Yan kazanç (aynı düzeltmede ölçüldü):** eski yazımda sayaç
> (`0/2000`) sarmalayıcı `<label>`ın İÇİNDEYDİ ve alanın erişilebilir adına
> karışıyordu — ekran okuyucu alanı `"İptal gerekçesi 0/2000"` diye
> okuyordu. Sayaç `Form.Label`ın dışına alındı.

### B. Ortak katmanda eksik (kusur değil, göçü engelleyen sınır) — **0**

**İkinci dalga üst üste sıfır.** On ekranın hiçbiri "bunu ortak katman
yapamıyor" demedi; üçüncü bir `Dialog` genişliğine, yeni bir yüzey türüne ya
da `Form.*`a yeni bir alan tipine gerek olmadı. `DuzenlemePenceresi`nin
`yuzey` sözleşmesi, `open`/`onClose` API'li eski bir bileşenin (`ReasonDialog`)
İÇİNDEN türetilebilecek kadar dardı — bu, A7d1'de sözleşmeyi bilerek dar
tutma kararının beklenmedik bir getirisi.

### C. Ekran regresyonu — **0**

A7d2'nin C-1'i (satır içi formlarda odak `<body>`ye düşüyordu) bu dalgada
tekrarlamadı: yeni yazılan altı formun altısında da odak `onInvalid`
argümanından veriliyor ve gerçek tarayıcı turu ölçtü (`aria-invalid="true"`,
açık ve koyu temada).

### D. Kasıtlı davranış değişiklikleri — **8**

| # | Değişiklik | Neden |
|---|---|---|
| 1 | Doğrulama toast → alan (6 form) | A2'den beri yazılı sözleşme. |
| 2 | Üç gönder düğmesi geçerlilikle kapanmıyor (`ReasonDialog`, `CountSessionsPage`, satır sayımı) | Kilitli kararın açık ihlalleriydi. |
| 3 | Ad değişikliği süzgeci adrese taşındı | "Filtreler URL'de"; paylaşılan bağlantı hep "Bekleyen"e düşüyordu. |
| 4 | Sayım listesi boş durumu ikiye ayrıldı | "Süzgeç eşleşmedi" bir talimat, "hiç oturum yok" bir davet. |
| 5 | "Ürün ekle" sessiz `return`ü kalktı | Sessiz `return` doğrulama değil, gizlenmiş hata. |
| 6 | İki süzgeç/seçim çipine `aria-pressed` eklendi | Seçili çip ekran okuyucuda seçilmemişten ayırt edilemiyordu. |
| 7 | Harita arama kutusuna ad verildi | Aşağıda, kapsam istisnası 1. |
| 8 | Saat kutularına `dark:[color-scheme:dark]` | SK-6'nın ikinci örneği (aşağıda). |

Ayrıca **beş mevcut test bilinçli güncellendi:**

* `inventoryScreens.acceptance` (6 iddia): sayım listesi ortak `DataTable`a
  geçti ve bileşen masaüstü satırını + mobil kartı BİRLİKTE basıyor. İddialar
  `getAllByText` + **tam sayı** (`toHaveLength(2)`) oldu; sayı gevşetilmedi
  (`length > 0` yazmak, satır iki kez basılsa da geçerdi).
* `adminTutorApproval` (2 iddia) ve `packingLabel` (1 iddia): SK-8'in
  mekanizma değişimi. İddia GEVŞETİLMEDİ, güçlendirildi — "istek gitmedi"nin
  yanına "kullanıcı sebebi gördü" (`aria-invalid` + odak) eklendi.
* `kutuphaneEditoruDalAdlari` (3 iddia): aşağıda, "kendini haber veren filtre".

### Yanlış çıkan hipotezler (dürüstlük kaydı)

1. **"`PackingStationPage`in göçü davranış testiyle kanıtlanamaz, çünkü beş
   yeni test tabana karşı yeşil çıkıyor."** Yanlış — ölçüm hatasıydı: sürücü
   yalnız ekran dosyasını geri alıyordu, korumanın yaşadığı ORTAK KATMAN
   dosyası tabanda değildi. İkisi birden geri alınınca beşi de kırmızıya
   döndü. Ders: ortak katmanda düzeltilen bir kusurun kırmızı matrisi,
   ekran dosyasını tek başına geri alarak ölçülemez.
2. **"Kırmızı matris paket commit edildikten sonra da ölçülebilir."** Yanlış:
   sürücü `HEAD`e geri alıyordu ve commit'ten sonra HEAD zaten göç etmiş
   hâlidir — ölçüm "hiç kırmızı yok" diyordu. Sürücüye `--taban <ref>` eklendi
   ve varsayılanın neden yanıltıcı olabileceği dosyanın içine yazıldı.
3. **"`AdminHome`u almak başka ekranları da sürükler"** (A7d2'nin eleme
   gerekçesi). Yanlış: on iki ham düğmenin, iki adsız kontrolün ve iki pencere
   durumunun tamamı ekranın KENDİ üç bölümündeydi; hiçbir başka dosya
   değişmedi.
4. **"jsdom'da `fireEvent.dragStart` gerçek sürüklemeyi taklit eder."**
   Yanlış: jsdom `DataTransfer`ı uygulamıyor; işleyici yakalanmamış bir
   `TypeError` fırlatıyordu. Test YEŞİL kalıyordu (hata olaydan sonra atılır)
   ve yalnız karışık tohum koşumu "2 unhandled error" diye görünür etti.
   Üretim kodu gevşetilmedi (`?.`) — testin olayı doğru taklit etmesi
   sağlandı.

### Kapsam istisnaları — ANA METİNDE

**İstisna 1 · `components/MapPicker.tsx` (dalganın on ekranından biri DEĞİL).**
Adres arama kutusunun `aria-label`i eklendi (tek satır). Gerekçe: A7d2'nin
kapanış notu bunu **adıyla dalga 3'e bırakmıştı** ve borç üç ayrı testte
"bilinen istisna" filtresiyle taşınıyordu; filtre kaldırılmadan
`OperatorLibrary`nin dal testi "adsız kontrol yok" diyemiyordu. Alternatif,
üç ekranın kabul testinde bir affı bir dalga daha sürdürmekti.

**İstisna 2 · `components/admin/ui/ConfirmDialog.tsx` (SK-7 + SK-8).**
On ekranın hiçbiri değil; ORTAK KATMAN. Gerekçe canlı veri kaybıdır ve
etkilenen 13 çağrı yerinin çoğu geri alınamaz kararlardır. Alternatif,
bilinen bir veri kaybını bir dalga daha üretimde bırakmak ve dalga 4'te on üç
ekrana ayrı ayrı kopyalamaktı. `ConfirmDialog`ın kendisi (gerekçesiz onay)
**değişmedi** ve neden değişmediği dosyaya yazıldı: içinde yazılan bir şey
yok, bekçi orada anlamsız bir soru üretirdi.

### Kendini haber veren filtre — kayda değer

A7d1, `MapPicker`ın adsız kutusunu üç dal testinde bir filtreyle affetmiş ama
yanına bir **ters prova** koymuştu: *"bilinen istisna GERÇEKTEN render
ediliyor mu"* (`toBe(1)`). Borç bu dalgada kapanınca o ters prova
kendiliğinden kırıldı ve mesajı tam olarak şuydu: **"bilinen istisna listesi
bayatladı"**. Filtre sessizce affetmeye devam etmedi; borç kapandığı gün haber
verdi. Yerine "kutu HÂLÂ render ediliyor ve artık ADLI" iddiası kondu — yoksa
"0 adsız", kutu hiç basılmadığı için de doğru olabilirdi.

---

## Görev 5 — Bekleme bütçesi: **yedinci çağrı yeri AÇILMADI**

A7d2 *"yedinci çağrı yeri doğarsa varsayılanın kendisi sorgulanmalı"* diye
yazmıştı. Bu dalga suite'i 133 → 139 dosyaya, 1378 → 1498 teste çıkardı ve
**üç zaman aşımı üretti**. Yedinci çağrı yeri eklenmedi; önce ÖLÇÜLDÜ.

### Ölçüm 1 — süre dağılımı (tam suite, JSON reporter)

| Eşik | Test sayısı | Oran |
|---|---|---|
| > 5000 ms | 3 | %0,2 |
| > 3000 ms | 12 | %0,8 |
| > 2000 ms | 23 | %1,5 |
| > 1000 ms | 94 | %6,3 |
| **> 800 ms** | **130** | **%8,7** |
| > 500 ms | 226 | %15,1 |

En yavaş üç test: `calismaZamaniKapisi` 9,9 sn (68 ekranı mount ediyor),
`operatorPanel` B-1 6,3 sn, `calismaZamaniKapisi` kapsam testi 5,3 sn.

**Bu sayılar TEST süresidir, tek bir `findBy*` beklemesi değil** — yani
"1000 ms'lik `asyncUtilTimeout`a değen sorgu sayısı" bunun bir ALT KÜMESİDİR.
Ölçüm tavanı verir, tabanı değil.

### Ölçüm 2 — üç zaman aşımının GERÇEK sebebi

Üçü de aynı sınıftan çıktı ve hiçbiri sorgu yavaşlığı değildi:

| Dosya | Düşen test | Sebep |
|---|---|---|
| `PackageLabel.test` | dosyanın İLK testi | ekranı `import.meta.glob` ile TEMBEL yüklüyor; A7d3'te `admin/ui` demeti `ui2` üzerinden `@medusajs/ui`ye bağlandı ve maliyet ilk testin İÇİNDE ödeniyor |
| `ip19Filo.acceptance` | D-13 (dosyanın ilk testi) | aynı — `await import("./DeliveryTodayPage")` |
| `PackingLabelSheet.test` | dosyanın İLK testi | aynı |

Üçü de **bütçe büyütülmeden** düzeltildi: ağır modül test dosyasında statik
import edildi (`import "@/components/admin/ui2/duzenlemeYuzeyi"`), maliyet
TOPLAMA (collect) evresine geçti — orada test bütçesi yoktur. Aynı ilaç
tembel yükleyen kalan iki dosyaya da (`courierHandover`, `operatorBalance`) ve
`calismaZamaniKapisi`ya önlem olarak uygulandı.

Sonuç: çağrı yeri sayısı **6 → 6** (değişmedi). Suite %9 büyüdü, bütçe
büyümedi.

### Öneri: **global varsayılan YÜKSELTİLMEMELİ**

Gerekçe üç maddeli:

1. **Tail'in sebebi sorgu değil, modül yükleme.** Bu pakette üç kez ölçüldü
   ve üçünde de kaynağında düzeltilebildi. Varsayılanı yükseltmek bu sınıfı
   düzeltmez, GİZLER — ve gizlendiğinde bir sonraki dalga aynı maliyeti yeni
   dosyalara taşır.
2. **Bedeli somut.** `asyncUtilTimeout` 1000 → 5000 ms yapılırsa, tek bir
   `findBy*` çağrısında **4 saniyeye kadar** gerçek bir performans
   regresyonu sessizce geçer. Panel ekranlarının kabul testleri tipik olarak
   3–6 ardışık `findBy*` çağırır; yani bir ekranın gerçekten **12–24 saniye**
   yavaşlaması hiçbir testi kırmaz. İP-A6b bu yüzden global ayarı bilerek
   KALDIRMIŞTI (BULGU-10) ve o karar hâlâ doğrudur.
3. **Mevcut altı çağrı yeri dürüst.** Hepsi dosya başında ölçümüyle birlikte
   yazılı ve hepsi 4000 ms — yani "bu dosya yük altında sınıra değiyor"
   bilgisi KAYITLI kalıyor. Global bir ayar bu bilgiyi siler.

**Karar gerektiren nokta (uygulanmadı, soruluyor):** `calismaZamaniKapisi`nin
9,9 saniyelik testi 68 ekranı tek testte mount ediyor ve `testTimeout`un
(9000 ms) üstünde; şu an yalnız **kendi dosyasının** bütçesiyle ayakta. Bu
testi ekran başına parçalamak mı (139 → ~200 dosya, paralellik artar) yoksa
olduğu gibi bırakmak mı doğru — ölçüm elimde ama karar ürün sahibinin:
parçalamak suite dosya sayısını %45 artırır ve bu paketin ölçtüğü modül
yükleme maliyetini yeni dosyalara dağıtır.

---

## Görev 6 — Gerçek tarayıcı turu

Sonda: `frontend/scripts/ip_a7d3_tur.mjs` + `scripts/probe/A7d3Probe.tsx`
(Chrome + CDP, headless). Ölçüm: `docs/arsiv/ip-a/ip-a7d3/tur-olcum.json`,
**24 ekran görüntüsü** aynı klasörde.

**Canlı `ceyhandb`ye bağlanılmadı**; sonda axios adapter'ını kendi sahte
sunucusuyla değiştirir, veriler uydurmadır ve gerçek kişisel veri içermez.
**Tur bitince vite sunucusu kapatıldı** — port 5199 ve CDP portu 9293 ayrı
ayrı doğrulandı (ikisi de KAPALI).

### Hangi ekrana hangi tur ve NEDEN

Tur maliyeti ekran sayısıyla doğrusal arttığı için derinlik ayrıldı.
Ölçüt: **ekran daha önce görülmemiş bir yazım mı getiriyor?**

| Ekran | Tur | Gerekçe |
|---|---|---|
| `sayim-detayi` | **TAM** (2 tema × 2 genişlik + 4 etkileşim ölçümü) | YENİ YAZIM: satır başına form. `type="number"` satır İÇİNDE — koyu tema `color-scheme` sınavının yeni bağlamı. |
| `tur-detayi` | **TAM** | YENİ YAZIM: sürükle-bırak. Sıralama okları dokunmatikte TEK erişim yolu → dokunma hedefi ölçülmeli. |
| `operator-kutuphanem` | **TAM** | YENİ YAZIM: yedi bölümlü satır içi düzenleme + `type="time"` ızgarası. **SK-6'nın bu dalgada bulunan ikinci örneği tam burada.** |
| `sayim-listesi` · `sikayetler` · `istasyon` · `odeme` · `admin-home` · `operator-panel` · `operator-oturumlar` | **KISA** (mobil 380 + koyu) | Deseni tekrar eden ekranlar: liste + pencere + form, hepsi A7d1/A7d2'de tam turdan geçmiş yazımlar. |

### Ölçülenler

**Mobil (380 px) ve masaüstü (1280 px).** On ekranın onunda da, iki temada da
**yatay taşma YOK** (`tasmaPiksel: 0`) ve **iç içe `<button>` 0**.

| Ekran | en küçük dokunma hedefi |
|---|---|
| `odeme` | 40 px |
| sekiz ekran | 36 px |
| `operator-kutuphanem` | **28 px** |

`operator-kutuphanem`in 28 px'i olanak seçim çipidir (`py-1.5` + `text-xs`).
WCAG 2.2 SC 2.5.8'in 24×24 asgarisini geçiyor ama **panelin en küçüğü**;
bilinen sınır olarak kayda geçiyor, bu pakette değiştirilmedi.

**Koyu temada yerel widget şeması (SK-6 sınıfı — GERÇEK BULGU).**
A6c'nin düzeltmesi ortak `.input` sınıfına yazılmıştı. Bu dalga o sınıfı
KULLANMAYAN iki `type="time"` kutusu buldu (`OperatorLibrary`nin saat
ızgarası, kendi `className`i var) — koyu panelin üstüne beyaz saat ikonu
çiziliyordu. Düzeltmeden sonra ölçüm:

* saat ızgarası: **14 kutunun 14'ü** `color-scheme: dark`, **14'ünün de
  erişilebilir adı gün adını taşıyor** (`"Pazartesi açılış saati"` …);
* sayım detayı: üç `type="number"` kutusunun üçü de `dark`.

**Odak tuzağı (gerçek klavye).** "Yeni sayım" düğmesi odaklanıp `Enter` ile
pencere açıldı: 14 `Tab` boyunca odak **pencereden çıkmadı**, `Shift+Tab`
pencere içinde kaldı, `Escape` kapattı ve **odak açan düğmeye iade edildi**.

**Kirli formda kapatma (gerçek klavye) — iki ayrı yüzeyde.**
`Not` alanına yazıldı, `Escape`: onay penceresi açıldı ve editör ayakta kaldı.
Ayrıca **SK-7'nin gerçek tarayıcı kanıtı**: `İptal gerekçesi` alanına yazıldı,
`Escape` → "Kaydedilmemiş değişiklikler var".

**Gönderim → odak + kontrast.** Satır sayım alanına `12.5` yazılıp
"Kaydet": odak `Sayılan miktar — Satılabilir (ürün #101)` alanında,
`aria-invalid="true"`, **pencere DIŞINDA** (satır içi form — A7d2'nin C-1
regresyonunun tekrar etmediğinin kanıtı).

| Tema | Hata rengi | Kontrast | Eşik |
|---|---|---|---|
| açık | `rgb(190,18,60)` | **6,29** | 4,5 |
| koyu | `rgb(251,113,133)` | **6,63** | 4,5 |

**Sürükle-bırak sıralama, gerçek mobil ekranda (380 px).** Üç durak için
**6 ok düğmesi** basılıyor, adları sıra numarasını taşıyor, en küçük dokunma
hedefi 36 px, `draggable="true"` kap sayısı 3.

Sondanın **24 kapısı** var; tur **hepsi geçerek** bitti (`dusenKapilar` yok).

---

## Görev 7 — Eşikler

| Ölçüm | A7d2 (eski) | **A7d3 (yeni)** | Fark |
|---|---|---|---|
| ham `<button` | 130 | **104** | **−26** |
| adsız form kontrolü (kaynak) | 26 | **7** | **−19** |
| ekranda yaşayan pencere durumu | 20 | **9** | **−11** |
| etiketsiz overlay | 0 | **0** (`toBe(0)`) | 0 — **sıfırda kaldı** |
| ölçüm tabanı dosya sayısı | 109 | 109 | 0 (kimlik listesi) |

**Overlay `toBe(0)` bir tavan değil TABANDIR** ve on ekranlık bir dalga
boyunca bir tane bile doğmadı.

### Ham düğme neden −26 (öngörü −28'di)

`OperatorLibrary` ve `AdminHome`da **birer** ham `<button>` bilerek kaldı ve
ikisi de aynı aileden: `aria-pressed` taşıyan SEÇİM DURUMLARI (olanak rozeti,
süzgeç çipi), aksiyon değil — `AdminStore`un katlanır başlığı,
`PackagesPage`in durum çipleri ve `AdminPayoutsPage`in sekme şeridiyle aynı
istisna. **Sayı düşmedi ama borç azaldı**: ikisine de eksik olan
`aria-pressed` eklendi, yani seçili çip artık ekran okuyucuda görünüyor.
Bunu "−28" diye yazmak sahte ilerleme olurdu.

### Kalan borcun nerede olduğu

* **ham `<button` 104:** 41'i dört dosyada (`DeliveryDriver` 19, `MapPicker`
  9, `PersonalizeModal` 7, `ImageCropModal` 6) — biri saha ekranı, üçü
  paylaşılan widget. Kalan 63'ü 1–3'lük uzun kuyrukta (kabuk bileşenleri,
  bildirim zili, paylaş düğmesi, sayfalama okları).
* **adsız kontrol 7:** **tamamı** kapsam dışı üç dosyada —
  `DeliveryDriver` 4, `PersonalizeModal` 2, `ImageCropModal` 1. Panelin
  göç edilebilir yüzeyinde **sıfır** adsız kontrol kaldı.
* **pencere durumu 9:** sekiz dosyaya yayılmış, en yoğunu 2
  (`DeliveryTodayPage`).

### Çalışma zamanı kapısının kimlik listesi

* `KAPI_KAPSAMI` (sığ kapı) **değişmedi**: on ekranın onu da zaten içindeydi.
* `DERIN_KAPI`ya **on dosya girdi** (her birinin koşullu dalları kendi kabul
  dosyasında render edilip alan adları doğrulanıyor).
* `CALISMA_ZAMANI_ADSIZ` tabanı **7 → 1**: `LibraryPayoutForm` (5) ve
  `MapPicker` (1) çıktı. Bu liste **kimlikle** sabit olduğu için borcun
  kapanması testi KIRDI ve düşüşü raporlattı — doğru davranış.
* İki yönlü koruma sağlam: `KAPI_KAPSAMI ∪ KAPI_DISI = taban` ve kesişimin
  boş olduğu testleri yeşil.

### Mutasyon provası — **14/14 yakalandı**

Sürücü: ortak `backend/scripts/mutation_drill.py` (`git checkout` kullanmaz,
ham baytları bellekte tutar, her mutasyondan sonra HEAD + `git status
--porcelain` eşitliğini doğrular, CRLF korunur). Paket **önce commit edildi**,
prova temiz ağaçta koşuldu; çalışma ağacı başta ve sonda aynıydı.

| # | Mutasyon | Kırılan |
|---|---|---|
| A7D3-1 | ham `<button>` geri kondu (104→105) | eşik testi |
| A7D3-2 | adsız form kontrolü eklendi (7→8) | kaynak eşiği **+ çalışma zamanı kapısı** |
| A7D3-3 | pencere durumu ekrana geri taşındı (9→10) | sayı eşiği + dosya listesi |
| A7D3-4 | etiketsiz overlay geri kondu (0→1) | sayı eşiği + dosya listesi |
| A7D3-5 | **SK-7**: gerekçe penceresinin bekçisi kaldırıldı | `gerekcePenceresi` + `sayimDetayiGoc` |
| A7D3-6 | **SK-8**: onay düğmesi yine geçerlilikle kapanıyor | `gerekcePenceresi` + `adminTutorApproval` |
| A7D3-7 | "Oturumu aç" yine geçerlilikle kapanıyor | `sayimOturumlariGoc` |
| A7D3-8 | ürün ekleme yine SESSİZ `return` yapıyor | `sayimDetayiGoc` |
| A7D3-9 | ödeme formunun kirli form bekçisi kaldırıldı | `kutuphaneOdemeGoc` |
| A7D3-10 | saat kutularının erişilebilir adı geri alındı | `operatorPanel` + eşik |
| A7D3-11 | ad değişikliği süzgeci yine `useState`te | `adminTutorApproval` |
| A7D3-12 | harita arama kutusunun adı geri alındı | `kutuphaneEditoru` + eşik + kapı |
| A7D3-13 | şikâyet penceresinin bekçisi kaldırıldı | `adminSikayetGoc` |
| A7D3-14 | sürükle-bırak yeni sırayı sunucuya yazmıyor | `turDetayiGoc` |

**A7D3-3 ilk yazımında YAKALANMADI** — ve sebep A7d2'nin A7D2-3'üyle
aynı sınıftı ama aynı hata değildi. İlk yazım `AdminReportsPage`e bir
`useState` koyup onu `DuzenlemePenceresi`nin `yuzey` prop'una spread ediyordu;
sayaç `open={…}` arıyor ve `DuzenlemePenceresi` `open` almıyor — yani mutasyon
metriğin ölçtüğü şeyi hiç üretmemişti. Mutasyon, gerçekten eski deseni
kuracak şekilde yeniden yazıldı (`DeliveryRunDetailPage`te `useState` +
`ConfirmDialog open={cancelOpen}`) ve yakalandı. Kayda geçiyor çünkü
"yakalanmadı" sonucunu testin kusuru sanmak yine kolay bir hataydı.

---

## Kapı

| Kapı | Sonuç |
|---|---|
| `tsc -b` | temiz |
| `npm run build` | başarılı (22,5 sn) |
| `npm run lint` | **0 hata**, 31 uyarı (hepsi bu paketin dışında; A7d2 tabanıyla aynı) |
| Tam suite | **1498/1498**, 139 dosya, ~86 sn |
| Karışık tohum | **6 tohum yeşil** (3001·3013·3027·3041·3055·3069), unhandled error yok |
| Mutasyon | **14/14** |
| Gerçek tarayıcı | 24 kapı geçti, vite + CDP portları kapatıldı ve doğrulandı |

### Test türleri (dürüst sınıflandırma)

| Tür | Sayı |
|---|---|
| Gerçek DOM + gerçek axios örneği (kabul) | 103 |
| Gerçek DOM (ortak bileşen sözleşmesi) | 17 (`gerekcePenceresi`) |
| Gerçek tarayıcı (Chrome + CDP) | 1 tur · 10 ekran · 24 ekran görüntüsü · 24 kapı |
| Kaynak/AST sözleşmesi (nöbetçi eşikleri) | mevcut testler, eşikleri güncellendi |

Snapshot yok, "import oldu" testi yok, "render oldu" testi yok.

---

## Kapanış değerlendirmesi — dalga 4 gerekiyor mu?

### Sayılar üç dalga boyunca

| | Dalga 1 (3 ekran) | Dalga 2 (6 ekran) | **Dalga 3 (10 ekran)** |
|---|---|---|---|
| Sözleşme kusuru | 3 | 4 | **2** |
| Ekran başına kusur | 1,00 | 0,67 | **0,20** |
| Ortak katman eksiği | 1 | 0 | **0** |
| Ekran regresyonu | 0 | 1 | **0** |
| Kusurun bulunduğu yer | ekranlar | ekranlar + ortak katmanın kenarları | **yalnız ortak katman** |

**Eğri düşüyor ve niteliği de değişti.** Dalga 3'ün iki kusuru da tek bir
paylaşılan bileşendeydi; on ekranın **hiçbiri** kendi başına yeni bir sözleşme
kusuru üretmedi. Bu, sözleşmenin oturduğunun en güçlü göstergesidir: kalan
risk artık "her ekranda ne çıkacak" değil, "hangi paylaşılan bileşen henüz
taranmadı".

### Cevap: **evet, ama küçük — dalga 4 için 4–6 ekran ve farklı bir ölçüt**

Kalan borç artık *ekran göçüyle* kapanmıyor. Üç kalem var:

**(a) Sıfırlanabilir — 4–6 ekranlık son dalga.**
Kalan 9 pencere durumu 8 dosyaya yayılmış ve hepsi 1–2'lik: `AdminAccessPage`
(SK-4 adayı, henüz kapanmadı), `AdminDemandsPage`, `AdminSettingsPage`,
`DeliveryBoardPage`, `DeliveryTodayPage` (2), `ReturnQueuePage`,
`AdminOperationsPage`, `ClosedDays`. Bunlar mekanik göçlerdir; **ekran başına
bir ya da iki bağ** demektir ve on ekranlık bir dalga gerektirmez.
Bu dalgayla birlikte pencere durumu metriği **sıfırlanabilir**.

Ayrıca `OperatorLibrary`nin `Form.*`a tam geçişi (bu pakette kapsam kararıyla
ertelendi) o dalgaya yazılmalı.

**(b) Sıfırlanamayan kalemler — ve NEDEN kalıyorlar.**

| Kalem | Sayı | Neden kalıyor |
|---|---|---|
| `DeliveryDriver` | 19b + 4a | **Panel değil, saha ekranı.** Tam ekran, tek elle kullanım, kamera, OTP, offline dayanıklılık. Panel sözleşmesini oraya taşımak göç değil yeniden tasarımdır ve kendi kabul matrisini ister. |
| `MapPicker` · `PersonalizeModal` · `ImageCropModal` | 22b + 3a | **Paylaşılan widget'lar**, ekran değil. Ham düğmeleri kendi tuvallerinin denetimleridir (yakınlaştırma, katman seçimi, kırpma tutamağı) ve ortak `Button`ın dolgu/gölge dili oraya uymuyor. |
| Kabuk/görünüm bileşenleri | ~30b | `DashboardShell`, `AdminLayout`, `NotificationsBell`, `ShareButton`, `DataTable`, `Dialog`, `Button`in kendisi… Bunların ham düğmeleri **bileşenin kendi iç denetimleridir**; ortak `Button`a çevirmek döngüsel olur ya da anlamsız. |
| `aria-pressed` seçim çipleri | 5b | Dört dalgadır tutarlı biçimde bilinçli istisna: aksiyon değil seçim durumu. |

Yani ham düğme metriği **sıfıra inmeyecek** ve inmemeli. Doğru kapanış hedefi
sıfır değil, **"kalanın her biri isimle ve gerekçesiyle yazılı"** olmasıdır —
bu rapor ve `uiBaseline.test.ts`in yorumları o listeyi tutuyor.

**(c) Dalga 4'ün asıl işi ekran değil: PAYLAŞILAN BİLEŞEN TARAMASI.**
Bu dalganın iki kusuru da ortak katmandaydı ve ikisi de **elle arayarak**
bulundu. `DuzenlemePenceresi` hâlâ "içeriğim korumasız" diyemiyor (A7d2'nin
bilinen sınırı 7). Dalga 4'ün en yüksek getirili işi bu dedektörü yazmaktır:
pencere `formsuz` beyanı verir, beyansız + form taşıyan içerik geliştirmede
patlar — SK-3'ün aynası. O dedektör olsaydı SK-7 elle aranmaz, CI'da
kendiliğinden görünürdü.

---

## Bilinen sınırlar

1. **`MapPicker` ve `ConfirmDialog` kapsam dışıydı ve yine de değişti.**
   Gerekçeleri ana metinde (kapsam istisnaları 1 ve 2).
2. **`OperatorLibrary` yalnız etiketlendi, `Form.*`a geçmedi.** Yedi kardeş
   bölümün altısı aynı yerel-durum idiomunda; tek bölümü çevirmek aynı ekranda
   iki form yazımı üretirdi. Alan adları ve hata görünürlüğü çözüldü, ama
   doğrulama hâlâ sunucuya bırakılıyor.
3. **Kontrast ve `color-scheme` yalnız Chrome'da ölçüldü.** Firefox/Safari
   yerel widget'ları farklı çizebilir.
4. **`DuzenlemePenceresi` hâlâ "içeriğim korumasız" diyemiyor** (A7d2'nin
   sınırı 7, kapanmadı). SK-7 tek tek düzeltildi; otomatik dedektör dalga 4'e.
5. **`useUrlDurumu`nun "aynı olayda iki yazım" yolu (A6c · BULGU-4) bu pakette
   de yeni bir yazımla sınanmadı** — `CountSessionsPage`in çoklu yazımı tek
   `ayarla` çağrısında birleşiyor. A7d1'den beri devam eden aynı sınır.
6. **Sürücünün frontend tarafında yeşil taban kapısı ölçüm yapmıyor**
   (mevcut sınır, TB-45). Taban elle doğrulandı: tam suite 1498/1498 + 6
   karışık tohum.
7. **`calismaZamaniKapisi`nin 9,9 saniyelik tek testi** `testTimeout`un
   (9000 ms) üstünde ve yalnız kendi dosya bütçesiyle ayakta. Parçalama
   kararı Görev 5'te soruldu, uygulanmadı.
8. **Kırmızı matris ölçümü `--taban` verilmezse yanıltıcıdır** (commit sonrası
   HEAD zaten göç etmiş hâlidir). Sürücüye seçenek eklendi ve tuzak dosyanın
   içine yazıldı, ama varsayılan hâlâ `HEAD`.
9. **`operator-kutuphanem`in 28 px'lik olanak çipi** panelin en küçük dokunma
   hedefi. WCAG 2.2 asgarisini (24 px) geçiyor; büyütülmedi.
