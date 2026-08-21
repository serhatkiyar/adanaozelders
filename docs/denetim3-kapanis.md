# Bağımsız Denetim #3 — kapanış denetimi (İP-A7d1 … A7d5)

**Denetçi:** bu kodu yazmayan bağımsız oturum · **Tarih:** 20 Ağustos 2026
**Denetlenen:** `HEAD = 57f8584` (detached), `main = f399526`
**Kural:** hiçbir şey düzeltilmedi, hiçbir commit atılmadı. Ölçüm için yapılan
geçici değişikliklerin hepsi geri alındı ve `git status --porcelain` ile
doğrulandı (§11).

> **Kapak cümlesi.** Kapılar (tsc · build · lint · tam suite) benim de
> makinemde geçiyor ve beyan edilen dört sayının dördü de bağımsız yöntemle
> doğrulandı. Buna rağmen **merge edilebilir değil**: göçün kapatmak için
> kurulduğu kusur sınıfı (kirli formun sormadan silinmesi) panelde **iki ayrı
> yoldan hâlâ canlı**, çalışma zamanı dedektörü sanıldığından çok daha dar bir
> pencereden bakıyor, çalışma zamanı kapısı 88 ekranın 14'ünü **403 kutusu**
> hâlinde ölçüyor ve A7d5'in "12 tohumda yeşil" iddiası benim 12 tohumumda
> **kırmızı** düşüyor. Ayrıntı §1'de; sıralı yapılacaklar listesi §10'da.

---

## 0. Bulguların özeti

| # | Ağırlık | Bulgu | Nerede |
|---|---|---|---|
| **B-1** | **P1** | `AdminLibraries` "Oturumlar & Operatörler" penceresinde operatör hesabı formu (ad/soyad/e-posta/**şifre**) kirli form bekçisine hiç bağlı değil; ESC yazılanı sormadan siler. SK-4/7/9 sınıfı, **üretimde canlı**. | `src/pages/dashboards/AdminLibraries.tsx:320-410` |
| **B-2** | **P1** | Çalışma zamanı dedektörü paneli **yalnız `Dialog`un kendi render'ında** görüyor. Çocuk bileşenin kendi durumuyla sonradan beliren alanlar (katlanır bölüm, sekme, veri gelince basılan form) dedektöre **hiç görünmüyor**. B-1'in kaçma sebebi budur. | `src/components/admin/ui/Dialog.tsx:69-77` |
| **B-3** | **P1** | İç içe pencerede **tek ESC iki pencereyi birden kapatıyor** ve içteki KORUMALI formun onayı hiç sorulmadan yok oluyor. "İç içe ESC yığını yok" bilinen sınırı, erişilebilirlik konforu değil **sessiz veri kaybı**. | `src/hooks/useModalA11y.ts:96-100` |
| **B-4** | **P1** | Tam suite `--sequence.shuffle` altında **benim 12 tohumumda kırmızı düşüyor** (A7d5 aynı kapıyı kendi 12 tohumuyla 12/12 yeşil raporlamıştı). Düşenlerin biri, A7d5'in AK-8 olarak kapattığını bildirdiği testin ta kendisi. | §6 |
| **B-5** | **P1** | Çalışma zamanı kapısı, "doğruluk kaynağı" ilan edilen katman, kendi oturum fixture'ı (`admin_permissions: ["*"]`) yüzünden 88 ekranın **14'ünü 403 kutusu** olarak ölçüyor; ölçülen kontrol sayısı 60 yerine **39**. Yalancı-yeşil kapısı (`toplamKontrol >= 39`) tam da çökmüş sayıya kalibre. | `src/__guards__/calismaZamaniKapisi.test.tsx` |
| **B-6** | **P2** | Sayacın **altıncı** kusuru: import kapanışı `.ts`te durduğu için, `src/lib/*.ts` gibi bir **yeniden-dışavuran (`export … from`) `.ts` dosyası üzerinden** ulaşılan `.tsx` bileşeni dört metriğin dördüne de görünmez. Sentetik kaçak ile kanıtlandı: 3 ham düğme + 2 adsız kontrol + 1 etiketsiz overlay, **50/50 nöbetçi yeşil**. | `frontend/scripts/ui-baseline-sayim.mjs:320-390` |
| **B-7** | **P2** | Üçüncü "sıfırda ölen iddia": çalışma zamanı kapısındaki ekran başına `expect(o.adsiz).toBe(0)` iddiası, **88 ekranın 71'inde** hiç kontrol render edilmediği için totolojidir. | `calismaZamaniKapisi.test.tsx` |
| **B-8** | **P1** | Kontrast: `Button variant="success"` (emerald-600 + beyaz) **3,77:1** — 14 px metin, AA eşiği 4,5. Her iki temada da eşik altı, 10 gerçek çağrı yeri. Kendi Chrome ölçümüm. | `src/components/admin/ui/Button.tsx:17` |
| **B-9** | **P2** | SK-6 (koyu temada yerel widget şeması) **kapanmadı**: taban ağacında `Form.Control` dışında ve `dark:[color-scheme:dark]` taşımayan **9 yerel widget** var; üçü `.input w-auto` yazımlı tarih süzgeci. Chrome'da `color-scheme: normal` ölçüldü. | §3 |
| **B-10** | **P2** | Kilitli karar ihlali: `DeliveryOrdersPage`'in "Kargola" düğmesi **geçerlilikle kapanıyor** (`disabled={!tracking.trim()}`), hata slotu yok. | `src/pages/admin/delivery/DeliveryOrdersPage.tsx:314` |
| **B-11** | **P2** | Açık temada `.input` odak göstergesi **eşik altı**: halka indigo-100 → **1,23:1**, kenarlık indigo-400 → **2,98:1** (WCAG 2.1 SC 1.4.11 = 3:1). Koyu temada kenarlık 4,0:1 ile geçiyor. | `src/index.css:36` |
| **B-12** | **P2** | N2'nin cevabı: dört "belirsiz" pencerenin **ikisini (her ikisi de `AdminLibraries`) hiçbir test açmıyor**. Yani o iki pencerede güvence **sıfır katmandan** geliyor — geliştiricinin "emin değilim" dediği yer gerçekten kusurluydu (B-1). | §4 |
| **B-13** | **P3** | `@medusajs/ui-preset` yalnız `tailwind.config.js`de kullanılıyor (derleme zamanı) ama `dependencies` altında. `devDependencies`e ait. | `frontend/package.json:13` |
| **B-14** | **P3** | Dala ~5,2 MB PNG ekran görüntüsü ve 14 sonda dosyası girdi (`docs/ip-a7d*/`, `frontend/scripts/probe/`). `.env` sızıntısı YOK, üretim derlemesine sızmıyor. | §7 |
| **B-16** | **P2** | Aynı sayfada iki `useUrlDurumu` örneği aynı olayda yazarsa **birincinin yazdığı sessizce kayboluyor** (A6c·BULGU-4 çözümü hook örneği başına). Bugün canlı değil (her ekranda tek örnek), nöbetçisi yok. | `src/hooks/useUrlDurumu.ts:150-175` |
| **B-15** | **P3** | `ClosedDays.tsx:110`daki yorum yanlış: "ortak `.input` sınıfı `color-scheme`i zaten taşıyor" — taşımıyor (`src/index.css`). Davranış doğru (koruma `Form.Control`dan geliyor), **gerekçe yanlış** ve B-9'un kök sebebi bu yanlış inanç. | `src/components/admin/delivery/ClosedDays.tsx:110` |

---

## 1. P1 bulguları — kanıtla

### B-1 · `AdminLibraries` operatör formu korumasız (SK-4/7/9 sınıfı, CANLI)

**Bulgu.** `AdminLibraries`in "Oturumlar & Operatörler" penceresi
(`DuzenlemePenceresi yuzey={yonetim}`) iki bölüm taşır: `OperatorsManager` ve
`ExamSessionsManager`. `OperatorsManager` dört alanlı bir hesap açma formudur
(ad · soyad · e-posta · **şifre**) ve dosyada kirli form bekçisinin
**bilerek kurulmadığı** yazılıdır:

```
src/pages/dashboards/AdminLibraries.tsx:331
  // Not: burada kirli form bekçisi KURULMAZ. Bu form pencerenin kendi formu
  // değil, pencere içindeki bir bölümün satır içi formudur; `DuzenlemePenceresi`
  // tek bir korumalı içerik taşıyabilir (İP-A6c · BULGU-5) ve o hak aynı
  // pencerede yaşayan oturum yönetimine ayrılmıştır.
```

Gerekçedeki varsayım da yanlış: "o hak … oturum yönetimine ayrılmıştır" denen
bekçi, `ExamSessionsManager`ın **kendi iç penceresine** (`SessionEditorPenceresi`
→ ayrı bir `DuzenlemePenceresi`) kaydolur, dış pencereye değil. Yani dış
pencerenin bekçi defteri **her zaman boştur**.

**Kanıt (davranış, gerçek DOM).** Geçici sonda (`sk10.audit.test.tsx`,
silindi) ekranı gerçek izinlerle render etti, pencereyi açtı, "+ Operatör"
bölümünü açtı, iki alana yazdı ve ESC'e bastı:

```
DENETIM3 · panel input sayisi: 4
DENETIM3 · panel input adlari: operator-first_name,operator-last_name,operator-email,operator-password
DENETIM3 · ESC sonrası açık dialog sayısı: 0
DENETIM3 · onay metni var mı: false
```

**Etki.** Yönetici bir kütüphaneye operatör hesabı açarken yanlışlıkla ESC'e
basar ya da dışarı tıklarsa dört alanın tamamı — şifre dahil — **sorulmadan
gider**. Bu, İP-A7 boyunca üç kez üretimde bulunan (SK-4, SK-7, SK-9) kusur
sınıfının **dördüncü canlı örneğidir** ve kapanış paketinden sonra da ayakta.

### B-2 · Çalışma zamanı dedektörü pencereyi yalnız kendi render'ında görüyor

**Bulgu.** `ui/Dialog` denetimi bağımlılık dizisi olmayan bir `useEffect`te
çalıştırır ve rapor bunu "her render'da koşuyor, yani kayıt tazedir" diye
savunur (A7d4 · N1). Doğru olan şu: **`Dialog`un KENDİ render'ında** koşar.
Pencerenin içindeki bir çocuk kendi `useState`ini değiştirdiğinde `Dialog`
yeniden render edilmez ve denetim **bir daha hiç çalışmaz**.

**Kanıt.** `icerikKorumasiDenetle` `vi.mock` ile sarıldı ve B-1 senaryosu
tekrarlandı; dedektöre yapılan **tek** çağrı kaydedildi:

```
DENETIM3 · denetle cagrilari: [{"baslik":"Kütüphane A","korumaVar":false,"girdi":0}]
```

Pencere açıldığı anda panelde 0 girdi vardı (operatör bölümü kapalıydı);
"+ Operatör"e basıldığında panelde 4 girdi belirdi ama dedektör **bir daha
çağrılmadı**, dolayısıyla geliştirmede `throw` etmedi.

**Etki.** Dedektörün kapsamı, raporda yazılandan çok daha dardır: yalnız
"pencere açıldığı anda zaten basılı olan" alanları görür. Aşağıdaki yazımların
hiçbirini göremez:

* katlanır/"+ ekle" bölümünde beliren form (B-1 tam olarak bu),
* sekmeli pencerede ikinci sekmenin formu,
* çocuğun **kendi** sorgusu geldiğinde basılan alanlar (raporun N1 notunda
  "alanlar veri geldikten SONRA basılabilir" diye özellikle sayılan durum),
* kısaca: içeriği çocuk durumu belirleyen her pencere.

A7d4'ün "tam suite'te sıfır bulgu ama panelde canlı kusur vardı" ölçümü, o
kusurun *sebebini* "o pencereyi açan test yok" diye teşhis etmişti. Teşhis
eksik: pencereyi açan bir test olsa **bile** bu sınıf yakalanmaz.

### B-3 · İç içe pencerede tek ESC korumayı devre dışı bırakıyor

**Bulgu.** `useModalA11y` her açık pencere için `document`e ayrı bir `keydown`
dinleyicisi ekler; yığın yok, `stopPropagation` yok. İki pencere açıkken ESC
**ikisinin de** `onClose`unu çağırır. Dıştaki pencerenin bekçi defteri boşsa
(B-1'de olduğu gibi) dıştaki **anında** kapanır ve içteki korumalı formun onay
istemi (Medusa `usePrompt`) daha görünmeden sökülür.

**Kanıt (davranış).** `AdminLibraries` → "Oturumlar & Operatörler" → "+ Oturum"
(iç pencere: `SessionEditorIcerik`, `useYuzeyKirliFormBekcisi` KAYITLI) →
başlık alanına yaz → **tek** ESC:

```
DENETIM3 · ic pencere acildiktan sonra dialog sayisi: 2
DENETIM3 · baslik alani bulundu mu: true
DENETIM3 · ESC sonrasi dialog sayisi: 0
DENETIM3 · onay metni: false
```

**Etki.** Kirli form koruması — bu göçün kapatmak için kurulduğu dört davranış
eksiğinden biri — **iç içe her pencerede geçersiz**. Panelde bugün en az iki
iç içe yüzey var (`AdminLibraries` yönetim penceresi içindeki oturum editörü ve
oturum iptali onayı). Bilinen sınırlar listesi bunu "iç içe ESC yığını yok"
diye erişilebilirlik başlığı altında sayıyor; gerçek etkisi **veri kaybıdır**
ve kapanış envanterinde bu adla geçmiyor.

### B-5 · Çalışma zamanı kapısı ekranların %16'sını 403 kutusu olarak ölçüyor

**Bulgu.** `calismaZamaniKapisi.test.tsx` oturumu şöyle kuruyor:

```
user: { id: 1, role_id: 1, admin_permissions: ["*"] }
```

`lib/adminAccess.ts` joker kabul etmez (`permissions.includes("libraries.manage")`).
`useAdminAreaAccess` kullanan 17 taban ekranı bu fixture'la `canView === false`
döner ve ekran yerine **"Bu alan için yetkiniz yok"** kutusunu render eder.

**Kanıt (bağımsız ölçüm, aynı mount yolu).** 110 taban `.tsx` dosyası iki kez
render edildi — bir kez kapının fixture'ıyla, bir kez gerçek izin listesiyle:

```
DENETIM3 SIFIR KONTROL ekran sayisi ([*] ile): 71 / 88
DENETIM3 TOPLAM kontrol  ['*']=39  gercek=60
DENETIM3 ['*'] ile 403 basan ekran sayisi = 14
```

Ekran bazında fark (13 dosya): `CouponsPanel` 0→6, `ProductsPanel` 0→4,
`AdminStore` 0→4, `ClosedDays` 0→2, `DeliveryCouriersPage` 0→2,
`DeliveryTodayPage` 1→2, `CategoriesPanel`/`OrdersPanel` 0→1 …

**Etki (üç katmanlı).**

1. Kapının kendi yalancı-yeşil koruması `toplamKontrol >= 39` — yani **çökmüş
   sayının ta kendisi**. Kapsam bugünkü hâlinden daha da daralsa bile eşik
   uzun süre geçmeye devam eder.
2. `expect(o.adsiz).toBe(0)` iddiası bu 14 ekranda 403 kutusunu ölçüyor;
   ekranın gerçek formları hiç render edilmiyor.
3. "88 ekranın hepsi her CI koşumunda render ediliyor" beyanı doğru ama
   **ölçülen şey 74 ekran + 14 hata kutusu**.

Bu, projenin iki kez öğrendiğini yazdığı dersin üçüncü tekrarıdır: sayı
sabitlendi, **ölçülen şey** değişti.

---

## 2. Kendi ölçtüğüm sayılar (beyanla yan yana)

**Yöntem farkı bilinçli.** Geliştiricinin sayacı TypeScript AST'i yürüyor. Ben
aynı dosyaları **esbuild ile derledim** (`loader: "tsx"`, `jsx: "automatic"`) ve
üretilen `jsx("button", …)` / `jsxs("input", …)` çağrılarını saydım. Yorum ve
dize bu yolda derleme sırasında elenir, JSX etiketi bir dize argümanına döner —
yani sayacın dört kez tökezlediği sınıfların (regex, yorum, sarmalayıcı,
`Form.Control` vekili) hiçbiri bu yöntemde yoktur.

| Ölçüm | Beyan (A7d4/A7d5) | **Benim ölçümüm** | Yöntemim | Fark |
|---|---|---|---|---|
| Ölçüm tabanı dosya sayısı | 110 | **110** | liste + diskten doğrulama | yok |
| Ham `<button>` (taban) | 102 | **102** | esbuild → `jsx("button"` sayımı | yok |
| Adsız form kontrolü (kaynak) | 7 | **7** | sayacın kendisi (§2b) | yok |
| Ekranda yaşayan pencere durumu | 0 | **0** | sayacın kendisi | yok |
| Etiketsiz overlay | 0 | **0** | sayacın kendisi | yok |
| Kapıda mount edilen ekran | 88 | **88** | bağımsız mount döngüsü | yok |
| Kapıda render edilen kontrol | ≥39 (eşik), "bugün 39" | **39** (kapı fixture'ı) · **60** (gerçek izinler) | bağımsız mount + DOM sayımı | **B-5** |
| Suite | 145 dosya / 1676 test | **145 dosya / 1676 test, 1676 geçti** | `vitest run --reporter=json` | yok |
| `tsc --noEmit` | 0 hata | **0 hata** | — | yok |
| `eslint src` | 0 hata / 31 uyarı | **0 hata / 31 uyarı** | — | yok |
| `vite build` | geçiyor | **geçiyor (2 dk 11 sn)** | — | yok |
| Toplam test süresi | 309,7 sn | **647,8 sn** (dosya sürelerinin toplamı) | JSON raporu | makine farkı |

**Beyan edilen dört eşiğin dördü de doğru.** Sayaç, dört kez bozulmuş olmasına
rağmen bugün doğru sayıyor; altıncı kusuru (B-6) sayının kendisini değil
**kapsamını** ilgilendiriyor.

### 2b. Adsız kontrolün çalışma zamanı doğrulaması

Görev, adsız kontrolün **çalışma zamanı erişilebilir ad hesabıyla** ölçülmesini
istiyor. İki ayrı ölçüm yapıldı:

1. **Projenin kendi ad çözücüsüyle** (`test-utils/alanAdlari`), ama kapının
   fixture'ı yerine **gerçek izinlerle**: 110 taban dosyasının mount
   edilebilen 88'inde **60 kontrol, 0 adsız**.
2. **Gerçek accname motoruyla** (`dom-accessibility-api` →
   `computeAccessibleName`, `@testing-library/dom`un kendi bağımlılığı):
   sonuç §2c'de.

Not: projenin çözücüsü accname'den **daha katıdır** (`title` ve `placeholder`ı
bilerek ad saymaz), yani gerçek motorun daha az "adsız" bulması beklenir; bu
yönde bir fark bulgu değildir, ters yönde bir fark bulgudur.

**"Kalan 7 gerçekten kapsam dışı üç dosyada mı?"** Evet, ama gerekçelerin
ağırlığı eşit değil:

| Dosya | Kalan | Gerekçe | Denetçi değerlendirmesi |
|---|---|---|---|
| `pages/DeliveryDriver.tsx` | 4 | "panel değil, saha ekranı" | **Kabul edilebilir değil ama merge'i bloklamaz.** Dosya `OLCUM_TABANI`'nda, kapıda mount ediliyor, `EK_TABAN_DOSYALARI`'na *bilerek* eklenmiş (A3c) — yani "ölçüyorum ama kapsam dışı" diyor. Borç isimle yazılı olduğu için sessiz değil. |
| `components/PersonalizeModal.tsx` | 2 | paylaşılan widget | kabul |
| `components/ImageCropModal.tsx` | 1 | paylaşılan widget (`type=range` yakınlaştırma) | kabul |

Üçü de gerçekten göç dalgalarının kapsamı dışında ve üçü de kapanış
envanterinde isimle yazılı. **Bu kalemde beyanla ölçüm örtüşüyor.**

---

## 3. Kontrast ölçümleri — kendi aletim, gerçek Chrome

**Alet.** Kendi CDP sürücüm (ham WebSocket, `Runtime.evaluate`) + kendi sonda
sayfam (`denetim3-probe.html`, arka uca bağlanmaz, gerçek `Form.*` / `Button` /
`Badge` bileşenlerini ve gerçek `.input` sınıfını render eder). Chrome
149.0.7827.197 headless, `--force-device-scale-factor=1`.

**A7d4'ün AK-3 kusuruna karşı özel önlem:** hata metni **`role="alert"` öğesinin
kendisi seçilerek** ölçülür ve ölçülen düğümün metni raporlanır — yanlış öğede
ölçme ihtimali kapatıldı. Zemin, opak bir katman bulunana kadar ağaçta yukarı
yürünerek **alfa kompozisyonuyla** hesaplanır (koyu temanın `bg-*/15` rozetleri
için şart).

**Eşik:** 4,5 (12–18 px metin). Büyük metin muafiyeti (≥24 px, ya da ≥18,66 px
+ bold) hiçbir ölçümde geçerli değildi — panelde ölçülen metinlerin hepsi
12–18 px.

### 3a. Açık tema

| Öğe | Ön plan | Zemin | Oran | Sonuç |
|---|---|---|---|---|
| **Hata mesajı (`role="alert"`, 12 px)** | `rose-700` rgb(190,18,60) | beyaz | **6,29** | geçer |
| Etiket (`Form.Label`, 14 px) | rgb(51,65,85) | beyaz | 10,35 | geçer |
| Yardım metni (`Form.Hint`, 14 px) | rgb(100,116,139) | beyaz | 4,76 | geçer |
| Pencere açıklaması (14 px) | rgb(100,116,139) | beyaz | 4,76 | geçer |
| Sayfa ikincil metni (14 px) | rgb(100,116,139) | `slate-50` | **4,55** | geçer (marj 0,05) |
| Girdi metni | rgb(15,23,42) | beyaz | 17,85 | geçer |
| Düğme `primary` | beyaz | `indigo-600` | 6,29 | geçer |
| Düğme `secondary` | rgb(51,65,85) | beyaz | 10,35 | geçer |
| **Düğme `success`** | beyaz | `emerald-600` | **3,77** | **KALIR (B-8)** |
| Düğme `danger` | beyaz | `rose-600` | **4,70** | geçer (marj 0,20) |
| Düğme `ghost` | rgb(71,85,105) | beyaz | 7,58 | geçer |
| Rozet `neutral` / `info` / `success` / `warning` / `danger` | — | — | 9,45 · 7,07 · 5,21 · 6,84 · 5,72 | hepsi geçer |

### 3b. Koyu tema

| Öğe | Ön plan | Zemin | Oran | Sonuç |
|---|---|---|---|---|
| **Hata mesajı (`role="alert"`, 12 px)** | `rose-400` rgb(251,113,133) | `slate-900` | **6,63** | geçer |
| Etiket | rgb(226,232,240) | `slate-900` | 14,48 | geçer |
| Yardım metni | rgb(148,163,184) | `slate-900` | 6,96 | geçer |
| Girdi metni | beyaz | `slate-900` | 17,85 | geçer |
| Düğme `primary` | beyaz | `indigo-600` | 6,29 | geçer |
| Düğme `secondary` | rgb(226,232,240) | `slate-900` | 14,48 | geçer |
| **Düğme `success`** | beyaz | `emerald-600` | **3,77** | **KALIR (B-8)** |
| Düğme `danger` | beyaz | `rose-600` | 4,70 | geçer |
| Düğme `ghost` | rgb(203,213,225) | `slate-900` | 12,02 | geçer |
| Rozet `neutral` / `info` / `success` / `warning` / `danger` (alfa kompozisyonlu) | — | — | 9,85 · 7,63 · 9,26 · 9,65 · 8,20 | hepsi geçer |

**A6c'nin iddiası doğrulandı.** `rose-600 → rose-700` değişikliğinin "4,70 →
6,29" iddiası benim ölçümümde birebir çıkıyor (6,29) ve bu kez **gerçekten
hata öğesi üzerinde** ölçüldü. Koyu temanın 6,63'ü de doğru. Yani A7d4'ün AK-3
kusuru raporu yanlış yapmış olsa da **sonuç doğruydu**.

**Ama zincirin gözden kaçırdığı yer düğme.** Aynı paket hata metnini `rose-600`
(4,70) diye "AA eşiğinin yalnız 0,20 üstünde" bulup koyulaştırırken, `danger`
düğmesi aynı `rose-600`'ü aynı 4,70 ile taşımaya devam ediyor ve `success`
düğmesi **eşiğin altında**. Beş düğme varyantından ölçülen dördü rapor edilmiş
gibi görünmüyor; hiçbir tur raporunda düğme metni kontrast sayısı yok.

### 3c. Odak halkası (gerçek Tab tuşuyla, `:focus-visible` aktif)

| Öğe | Tema | Gösterge | Oran | Sonuç |
|---|---|---|---|---|
| `Button` (tüm varyantlar) | açık | `indigo-500` 2 px halka + 2 px beyaz ofset | **4,47** | geçer (3:1) |
| `Button` (tüm varyantlar) | koyu | `indigo-500` 2 px halka + `slate-950` ofset | **4,40** | geçer |
| `.input` | açık | halka `indigo-100` | **1,23** | **kalır** |
| `.input` | açık | kenarlık `slate-200 → indigo-400` | **2,98** | **kalır (B-11)** |
| `.input` | koyu | halka `rgba(99,102,241,.2)` | ~1,27 | kalır |
| `.input` | koyu | kenarlık `slate-600 → indigo-500` | **4,00** | geçer |

Yani **açık temada bir metin kutusuna klavyeyle geldiğinizde gösterge 3:1'in
altında**; koyu temada kenarlık kurtarıyor. Düğmelerin halkası iki temada da
sağlam.

### 3d. Koyu temada yerel `number`/`time`/`datetime-local` denetimleri (SK-6)

Chrome'da `getComputedStyle(...).colorScheme` okundu:

| Yazım | Ölçülen `color-scheme` (koyu tema) |
|---|---|
| `<input type="number">` **`Form.Control` içinde** | `dark` ✓ |
| `<input type="time">` **`Form.Control` içinde** | `dark` ✓ |
| `<input type="date" className="input w-auto">` **`Form.Control` dışında** | **`normal`** ✗ |
| `<input type="number" className="input">` **`Form.Control` dışında** | **`normal`** ✗ |

A6c/A7d2 düzeltmesi `Form.Control` yolunda **gerçekten çalışıyor**. Ama koruma
yalnız o yoldan geliyor: ortak `.input` sınıfı `color-scheme` taşımıyor
(`src/index.css:36`), buna rağmen `ClosedDays.tsx:110`daki yorum taşıdığını
söylüyor (B-15).

**Taban ağacının taraması** (kendi AST aletim: `Form.Control` atası yok **ve**
`className`de `color-scheme` yok):

```
KORUMASIZ YEREL WIDGET: 9
  src/components/ExamSessionsManager.tsx:657 type=number
  src/components/ExamSessionsManager.tsx:669 type=number
  src/components/PersonalizeModal.tsx:316   type=date
  src/pages/admin/AdminAuditLogsPage.tsx:239 type=number  class="input"
  src/pages/admin/delivery/DeliveryBoardPage.tsx:275 type=date class="input w-auto"
  src/pages/admin/delivery/DeliveryRunsPage.tsx:85   type=date class="input w-auto"
  src/pages/admin/delivery/DeliveryTodayPage.tsx:254 type=date class="input w-auto"
  src/pages/dashboards/OperatorLibrary.tsx:311 type=number class="input"
  src/pages/dashboards/OperatorLibrary.tsx:324 type=number class="input"
```

SK-6 kapanış envanterinde "kapatıldı, dedektörü tarayıcı turu" diye yazılı;
**dokuz yerde açık** (B-9).

---

## 4. P2 — dedektörlerin kapsamı: hâlâ dışarıda kalan sınıflar

### 4a. Kaynak nöbetçisinin göremedikleri (`korumasiz-pencere.mjs`)

Raporun beyanı: "yalnız TEK DOSYA içini görür". Doğru ama eksik. Kaynağı
okuyup dört ek kör nokta buldum; ilk üçü **sessizce temiz** yazar (`belirsiz`
listesine bile düşmez):

1. **Dosya kapsamlı bekçi bayrağı.** `bekciVar` dosyada **herhangi bir** bekçi
   kancası çağrısı görürse `return { bulgular: [], belirsiz: [] }` — o dosyadaki
   **bütün** pencereler taranmadan geçer. Bir dosyada iki pencere varsa ve biri
   korumalıysa, ikincisi görünmez. (`scripts/korumasiz-pencere.mjs:112`)
2. **Değişkene alınmış içerik.** `const govde = <input …/>; <Dialog>{govde}</Dialog>`
   — küçük harfli bir JSX ifadesi ne "kontrol" ne "bileşen" sayılır; pencere
   ne bulguya ne belirsize düşer, **sessizce temiz** olur.
3. **`korumasiz` beyanının DEĞERİ okunmuyor.** `ozellik(n, "korumasiz")`
   özniteliğin varlığına bakar; `<Dialog korumasiz={false}>` de taramayı
   atlatır. (Tip düzeyinde `korumasiz?: true` olduğu için `tsc` bunu yakalar —
   ama nöbetçi yakalamaz.)
4. **Etiket adı sabit listede.** `Dialog` / `DuzenlemePenceresi` dışındaki her
   yazım (takma adla import, `ui.Dialog` gibi nitelikli ad, `React.createElement`)
   görünmez.

İlk üçü doğrudan dedektörü çağırarak ölçüldü — üçü de **sessizce temiz**, hatta
`belirsiz` bile olmuyor:

```
korumasiz={false}            -> bulgular: 0  belirsiz: 0
degiskene alinmis icerik     -> bulgular: 0  belirsiz: 0
ayni dosyada ikinci pencere  -> bulgular: 0  belirsiz: 0
```

(Üçüncüsü: bir dosyada bir korumalı + bir korumasız pencere.)

### 4b. Çalışma zamanı katmanının göremedikleri

**B-2** (çocuk durumuyla sonradan beliren içerik) bu listenin en önemlisi ve
tek başına dedektörün kapsamını ciddi biçimde daraltıyor. Buna ek olarak:

* **Hiçbir testte açılmayan pencereler.** Sayısını çıkardım: dört "belirsiz"
  pencerenin **ikisi** (her ikisi de `AdminLibraries`) hiçbir testte
  açılmıyor — `grep -rn "Oturumlar & Operatörler\|Ödeme Bilgileri" src --include=*.test.tsx`
  **boş** döner ve `AdminLibraries`e değen tek nöbetçi (`calismaZamaniKapisi`)
  onu 403 kutusu olarak render ediyor (B-5). Bu, geliştiricinin N2'de sorduğu
  sorunun cevabıdır: **hayır, iki pencerede hiçbir katman nöbet tutmuyor** —
  ve tam da orada canlı bir kusur duruyor (B-1).
* **`ui/Dialog`tan geçmeyen overlay.** Denetim `Dialog`ta yaşıyor; `role="dialog"`
  taşıyan ama `Dialog` kullanmayan elle yazılmış bir katman `unlabeledOverlays`
  nöbetçisini de geçer (o nöbetçi `role`/`aria-modal` **varlığına** bakar),
  dedektöre de görünmez. Bugün böyle bir yazım YOK; ama iki nöbetçinin
  kesişimi bunu tutmuyor.

### 4c. Üçüncü sentetik kusur — ikisinin de kaçırdığı yazım

Görevin istediği: "ikisinin de kaçırdığı bir yazım bulabiliyor musun?"
**Evet, ve sentetik değil: B-1 tam olarak odur.** Yazım şudur —

```
<DuzenlemePenceresi yuzey={y} baslik="…">
  <BolumA />      {/* içinde katlanır bir form; bekçi YOK */}
  <BolumB />      {/* kendi İÇ penceresini kurar, bekçisini ONA kaydeder */}
</DuzenlemePenceresi>
```

* **Kaynak nöbetçisi:** `BolumA`/`BolumB` büyük harfli → `belirsiz`, sessiz.
* **Çalışma zamanı:** pencere açıldığı anda `BolumA`nın formu kapalı → panelde
  0 girdi → denetim geçer; form açılınca `Dialog` yeniden render edilmediği
  için denetim **bir daha koşmaz** (B-2).

Yani sınıfın dedektörü iki katmanlı olmasına rağmen **bu yazımda iki kör
noktanın kesişimi boş değil**; ikisi birden kaçırıyor.

### 4d. `Form.Control` korumasının dal kapsamı

`Form.Control`un adsız alan koruması yalnız render edildiğinde ateşlenir; dal
testi (`DERIN_KAPI`) bunu kapatıyor. Ölçtüm:

* `DERIN_KAPI` listesi: **31 dosya**.
* `Form.Field/Item/Control/Label` kullanan üretim dosyası: **23**.
* İkisinin farkı — `Form.*` kullanıp `DERIN_KAPI`'da **olmayan** dört dosya:

| Dosya | Durum |
|---|---|
| `components/admin/ui/ConfirmDialog.tsx` | ortak katman; `gerekcePenceresi.test.tsx` (17 test) dallarını açıyor — **kapalı** |
| `components/admin/ui2/duzenlemeYuzeyi.tsx` | ortak katman; kendi testleri var — **kapalı** |
| `components/admin/inventory/DamageDialog.tsx` | kendi kabul testi var — **kapalı** |
| **`pages/dashboards/AdminLibraries.tsx`** | **hiçbir dal testi yok, sığ kapı onu 403 kutusu olarak render ediyor (B-5), pencerelerini hiçbir test açmıyor (B-12)** |

Yani dal kapsamı beyan edildiği kadar geniş — **tek gerçek boşluk
`AdminLibraries`**, ve canlı kusur (B-1) tam orada. Bu bir tesadüf değil:
kapsam boşluğu ile kusurun yeri birebir çakışıyor.

---

## 5. Sözleşme ve göç kalitesi

### 5a. Kilitli kararlar — her biri kendi yöntemimle

| Karar | Yöntemim | Sonuç |
|---|---|---|
| Ekranlar `@medusajs/ui`yi doğrudan import etmez | tüm ağaçta `grep -rn "@medusajs/ui" src \| grep -v "/admin/ui2/"` | **boş — tutuluyor** |
| Medusa `DataTable`ı alınmıyor | `ui2/` içinde yalnız `I18nProvider`, `Table`, `usePrompt` import ediliyor; `DataTable` yok | **tutuluyor** |
| Gönder düğmesi geçerlilikle kapanmaz | `disabled=` taşıyan tüm düğmelerin elle taranması (25 çağrı yeri) | **BİR İHLAL — B-10** |
| Satır aksiyonları açık düğme | `renderMobileRow` + satır aksiyonu yazımları okundu; iç içe interaktif öğe taraması §5c | tutuluyor |
| Kart `<button>`a sarılmaz | 88 ekranın gerçek DOM'unda `button button, button a, a button, a a` taraması (§5c) | tutuluyor |
| Filtreler URL'de | `useUrlDurumu` kullanan 7 ekran; hiçbirinde `useState` tabanlı filtre kalmamış | tutuluyor |
| Ekranlarda modal `useState`i yok | sayaç: `modalDurumu = 0`, `modalDurumDosyalari = []` | tutuluyor |

**B-10 ayrıntısı.** `src/pages/admin/delivery/DeliveryOrdersPage.tsx:298-317`
satır içi bir form: `<input className="input w-32" aria-label="…takip numarası">`
ve yanında `<Button … disabled={!(trackingByOrder[o.order_id] ?? "").trim()}>Kargola</Button>`.
Hata slotu yok, `Form.*` yok. Kullanıcı boş bırakırsa düğme sessizce kapalı
kalır — kilitli kararın ("kullanıcı basar, hata alanda görünür") tam tersi.
Bu ekran hiçbir göç dalgasının kapsamına girmedi; yani karar 21 ekranda
uygulandı ama **panelin tamamında geçerli bir nöbetçisi yok** (sözleşme yalnız
gözden geçirmeyle korunuyor).

Karşılaştırma için, meşru sayılan `disabled` kullanımları da tarandı:
`CountSessionDetailPage:481` ve `PackingStationPage:516` (`engeller.length > 0`)
engelleri ekranda **listeliyor** (`:498-505`), `PackagesPage:366` seçim
yokluğu, `DeliveryBoardPage:285`/`DeliveryTodayPage:292` işlenecek kayıt
yokluğu, sayfalama okları sınır. Bunların hiçbiri "form geçerliliği" değil.

### 5b. Örneklem denetimi — dört ekranın sözleşme dışına çıkılarak incelenmesi

| Ekran | Ne denendi | Sonuç |
|---|---|---|
| `AdminLibraries` | aynı sayfada iki düzenleme yüzeyi + iç içe pencere + onay beklerken kapanma | **iki P1 (B-1, B-3)** |
| `DeliveryOrdersPage` | satır içi form, gönder düğmesi, hata yüzeyi | **bir P2 (B-10)** |
| `ClosedDays` / delivery süzgeçleri | koyu temada yerel tarih widget'ı | **bir P2 (B-9) + yanlış yorum (B-15)** |
| `useUrlDurumu` tüketicileri | aynı olayda çoklu yazım · Türkçe karakter · iki tablo | §5d |

Önceki iki denetimin "beş denemede beş kusur" oranı bu turda da bozulmadı:
**dört denemede dört kusur.**

### 5c. İç içe interaktif öğe taraması (gerçek DOM, 88 ekran)

Bkz. §6c: **0 bulgu**.

### 5d. `useUrlDurumu` kenar durumları — **B-16 (P2)**

Dört senaryo denendi; ikisi rapor edilmeye değer.

**(a) Aynı sayfada İKİ tablo, aynı olayda iki yazım → BİRİNCİSİ KAYBOLUYOR.**
A6c · BULGU-4'ün çözümü (`bekleyenRef`) **hook örneği başına** tutuluyor.
İki ayrı `useUrlDurumu` örneği aynı olayda yazarsa ikincisi, birincinin
yazdığını göremeyen bayat `params` üzerinden yeni adresi kuruyor ve birincinin
anahtarlarını **siliyor**:

```
<button onClick={() => { a.ayarla({ aq: "alfa" }); b.ayarla({ bq: "beta" }); }}>
DENETIM3-URL iki tablo sonrasi adres: ?bq=beta        ← `aq=alfa` YOK
```

Bugün **canlı değil**: `useUrlDurumu` kullanan 7 ekranın hepsinde tek örnek var
(`AdminHome`, `PackagesPage`, `DamageEventsPage`, `CountSessionsPage`,
`AdminPayoutsPage`, `AdminBookingsPage`, `AdminAuditLogsPage`). Ama sözleşme
"A7'de 70 ekranda tekrarlanacak" diye yazılmış bir ortak katmanın içinde ve
"aynı sayfada iki tablo" sıradan bir istek. Bir nöbetçisi de yok.

**(b) Türkçe karakter / `+` / `%` / virgül gidiş-dönüşü — SAĞLAM.**

```
yazılan : "Şişli Güncelleme + %50"  ·  "a,b,ç"
adres   : ?q=%C5%9Ei%C5%9Fli+G%C3%BCncelleme+%2B+%2550&secim=a%2Cb%2C%C3%A7
okunan  : Şişli Güncelleme + %50 | a,b,ç
```

**(c) Dizi / çoklu seçim:** `UrlDeger = string | number` — çoklu değer tipte
YOK; ekranın elle birleştirmesi gerekir. Bir kusur değil ama envanterde
"desteklenmiyor" diye yazılı da değil.

---

## 6. Kapılar ve 12 karışık tohum

### 6a. Sıralı kapı (temiz ağaç, `main`den bağımsız kurulum)

| Kapı | Benim sonucum |
|---|---|
| `npm ci` | temiz kurulum |
| `npx tsc --noEmit` | **0 hata** |
| `npm run lint` | **0 hata, 31 uyarı** (hepsi `jsx-a11y/no-autofocus` ve `no-noninteractive-element-interactions`; hiçbiri değişen dosyada değil) |
| `npm run build` | **geçti**, 2 dk 11 sn |
| `npx vitest run` | **145 dosya / 1676 test — 1676 geçti** |

### 6b. `--sequence.shuffle` × 12 tohum — **B-4**

Geliştiricininkinden **farklı** 12 tohum kullandım (7001 · 7013 · 7027 · 7041 ·
7059 · 7077 · 7091 · 7103 · 7119 · 7137 · 7153 · 7171). A7d5 kendi 12 tohumuyla
(5001…5171) **12/12 yeşil** raporlamıştı.

| Tohum | Sonuç | Düşen test |
|---|---|---|
| 7001 | **KIRMIZI** | `flashcardsKaldirildi > R7 … 404 sayfası` · `adminRezervasyonFiltre > SIRALAMA iki anahtarı TEK adımda…` (9000 ms aşımı) |
| 7013 | yeşil | — |
| 7027 | yeşil | — |
| 7041 | yeşil | — |
| 7059 | **KIRMIZI** | `examOturumlariGoc > S-1 … oturum iptali ONAY penceresi` · `adminRezervasyonFiltre > SIRALAMA…` |
| 7077 | yeşil | — |
| 7091 | yeşil | — |
| 7103 | **KIRMIZI** | `adminRezervasyonFiltre > SIRALAMA…` |
| 7119 | yeşil | — |
| 7137 | **KIRMIZI** | `flashcardsKaldirildi > R7 … 404 sayfası` |
| 7153 | yeşil | — |
| 7171 | **KIRMIZI** | `adminRezervasyonFiltre > … sunucu hatasında … Yeniden dene çıkar` |

**Sonuç: 12 tohumun 5'i KIRMIZI** (7001 · 7059 · 7103 · 7137 · 7171).
İki tohum (7027, 7041) ilk turda benim geçici sonda dosyam ağaçtayken
koşmuştu; ikisi de temiz ağaçta **baştan** koşuldu ve yeşil geldi — yani
yukarıdaki beş kırmızının hiçbiri benim dosyalarımdan kaynaklanmıyor.

**Ne anlama geliyor.**

1. **A7d5'in "12/12 yeşil" kapısı bir örneklemdi, kanıt değildi** — ve bunu
   raporun kendisi §2b'de sayıyla anlatmıştı (1/12'lik bir kusur altı tohumda
   %40 olasılıkla görünmez). Aynı mantık on iki tohum için de geçerlidir;
   başka bir on ikili tohum kümesi başka üyeleri gösterir. Benimki gösterdi.
2. **`adminRezervasyonFiltre` sınıfın kaçırılmış bir üyesi.** Beş tohumun
   dördünde bu dosya düştü; ikisi 9000 ms'lik test bütçesinin aşımı.
   Testin yapısı A7d5'in AK-2/AK-2b'de kapattığı ikisiyle **aynı**: 30 kayıtlı
   liste + arka arkaya `findAllByText` ve `waitFor` çağrıları, hiçbirinde
   ölçülmüş çağrı yeri bütçesi yok (`adminRezervasyonFiltre.acceptance.test.tsx:267-285`).
   Sızıntı (AK-1) kalkınca görünür hâle gelen borcun **üçüncüsü** bu dosyaydı;
   A7d5'in tohumları onu göstermedi.
3. **`flashcardsKaldirildi > R7` HÂLÂ kararsız.** A7d5 bunu AK-8 olarak
   raporladı, sebebini `App`in `React.lazy` rotalarına bağladı ve rota
   hedeflerini statik import ederek "kaynağında düzeltti" (§5a-2). İki tohumda
   (7001, 7137) aynı test yine düşüyor: **düzeltme yetmemiş.**
4. Kapının kendisi de bir kez doğru çalıştı: kendi geçici sonda dosyamın içine
   yazdığım `{ timeout: 20000 }` çağrı yeri bütçesini `beklemeButcesi` nöbetçisi
   anında yakaladı (`expected […11] to deeply equal […10]`). **Bu nöbetçi
   gerçekten nöbet tutuyor** — bağımsız, kazara bir ters provadır.

### 6c. İç içe interaktif öğe (88 ekranın gerçek DOM'u)

```
DENETIM3-ICICE bulgu: 0
```

`button button`, `button a`, `a button`, `a a` — hiçbiri yok. "Kart `<button>`a
sarılmaz" ve "satır aksiyonları açık düğme" kararları **tutuluyor**.

### 6d. Gerçek accname motoruyla adsız kontrol

`dom-accessibility-api`nin `computeAccessibleName`i ile, gerçek izinlerle,
110 taban `.tsx`sinin mount edilebilen 88'i:

```
DENETIM3-ACC toplam kontrol: 60  adsiz: 1
DENETIM3-ACC ADSIZ: src/components/ImageCropModal.tsx :: <input type="range" …>
```

Tek adsız kontrol, `CALISMA_ZAMANI_ADSIZ` tabanında **isimle yazılı olan**
yakınlaştırma kaydırağıdır. Yani "göç edilebilir yüzeyde 0" beyanı, projenin
kendi çözücüsüyle değil **gerçek accname motoruyla** da doğrulanıyor.

İki sayı arasındaki farkı (kaynak 7 ↔ çalışma zamanı 1) bir çelişki sanmayın:
kaynak sayacı **yazılanı**, bu ölçüm **varsayılan render'da basılanı** sayar.
Aradaki 6 kontrol, varsayılan render'da açılmayan dallarda (`DeliveryDriver`
saha akışı, `PersonalizeModal` sekmeleri) yaşıyor.

### 6e. Ters provalar (kendi sürücümle — patch/geri-al/`git status`)

Görev, geliştiricinin mutasyon sürücüsünü çalıştırmayı yasaklıyor; her
mutasyon elle uygulandı, hedef nöbetçi koşuldu, dosya yedekten geri yüklendi ve
`git status --porcelain` ile ağacın başlangıç durumuna döndüğü doğrulandı.

| # | Mutasyon | Hedef nöbetçi | Sonuç |
|---|---|---|---|
| D3-M0 | (kazara) bir test dosyasına `{ timeout: 20000 }` çağrı yeri bütçesi girdi | `beklemeButcesi` envanteri | **YAKALANDI** (`expected […11] to deeply equal […10]`) |
| D3-M1 | Taban ekranına bir ham `<button>` | `rawButton <= 102` | **YAKALANDI** (`expected 103 to be less than or equal to 102`) |
| D3-M2 | Taban ekranına etiketsiz `fixed inset-0` katmanı | `unlabeledOverlays === 0` + `overlayOffenders` | **YAKALANDI** (2 test) |
| D3-M4 | `KAPI_KAPSAMI`'ndan bir ekran çıkarıldı | kapı kimliği (iki yön) | **YAKALANDI** (2 test) |
| D3-M5 | Mount edilebilen ekran `KAPI_DISI`'na park edildi | `KAPI_DISI` gerekçe ters provası | **YAKALANDI** |
| D3-M6 | `store/ProductForm`un kirli form bekçisi kaldırıldı (**SK-4 regresyonu**) | çalışma zamanı dedektörü + kabul testleri | **YAKALANDI** (5 test, 2 dosya) |

**6/6 yakalandı.** Nöbetçilerin duyarlılığında sorun yok; sorun **kapsamda**
(B-1 … B-7).

### 6f. P3'ün sorusu — sürücü değişikliği geçmiş provaları geçersiz kılar mı

Yeni sürücünün eklediği şey "yeşil taban kapısı"dır: mutasyon uygulanmadan
önce suite'in yeşil olduğunu doğrular. Eski sürücüde bu yoktu, yani **taban
zaten kırmızıyken uygulanan bir mutasyon "YAKALANDI" görünürdü.**

Bugünkü ölçüm bu riski daraltıyor ama sıfırlamıyor:

* **Sıralı** koşumda taban bugün yeşil (§6a) — geçmiş provaların çoğu sıralı
  koşuldu, dolayısıyla büyük ihtimalle geçerli.
* **Ama** §6b'nin gösterdiği gibi taban **karışık sırada 12'de 5 kırmızı**.
  Bir prova, ağaçta başka bir yarım değişiklik varken ya da kararsız bir
  dosyanın kırmızı olduğu bir anda koşulduysa hâlâ yanıltıcı olabilirdi.
* Yukarıdaki altı prova (D3-M0…M6) **kendi sürücümle, yeşil sıralı taban
  üzerinde** koşuldu ve altısı da yakalandı; yani en azından bu altı
  nöbetçinin geçerliliği bugün bağımsız olarak sabittir. Geçmişin tamamının
  yeniden koşulması **yapılmadı** (§9).

---

## 7. Merge hazırlığı

### 7a. Dal ↔ `main`

```
main       = f399526d7c9fd79addac961d1b6f916248fbf525
HEAD       = 57f8584a20ab1c2eabfcb0d660709624a62653dc
merge-base = f399526d7c9fd79addac961d1b6f916248fbf525   ← main'in KENDİSİ
dal commit sayısı = 28
```

`main`, dal ayrıldığından beri **hiç ilerlememiş**: merge-base `main`'in ucuna
eşit. Yani **çakışma riski sıfır**, birleştirme fast-forward olabilir.

### 7b. Değişen dosya kümesi

`git diff --stat main..HEAD` → **303 dosya, +53.306 / −5.549**. Dağılım
beyanla uyumlu (ekran dosyaları, `ui2/`, nöbetçiler, betikler, docs). Beyan
edilmeyen bir alan bulamadım. Not: değişikliğin büyük kısmı **belge ve ekran
görüntüsü**; kaynak kodu payı çok daha küçük.

### 7c. Bağımlılıklar

`package.json`a giren beş paket: `@medusajs/ui`, `@medusajs/ui-preset`,
`@hookform/resolvers`, `react-hook-form`, `zod` — **hepsi `dependencies`**.

* Dördü doğru yerde (çalışma zamanı).
* **`@medusajs/ui-preset` yanlış yerde (B-13):** yalnız `tailwind.config.js`de
  `presets: [medusaPreset]` olarak kullanılıyor, yani derleme zamanı aracı.
  `devDependencies`e ait. Zararı üretim `npm ci --omit=dev` kurulumunda
  gereksiz indirme; işlevsel risk yok.
* Beyan edilmemiş bağımlılık **yok**; `package-lock.json` değişimi bu beş
  paketin geçişli ağacıyla (Radix, `@dnd-kit`, `tslib` …) açıklanıyor.

### 7d. Bundle

`vite build` çıktısı (2 dk 11 sn, `dist/` 7,4 MB, `dist/assets` 3,2 MB):

| Chunk | Boyut | gzip | Not |
|---|---|---|---|
| `index-*.js` | 272,63 kB | 85,14 kB | uygulama çekirdeği |
| `vendor-*.js` | 181,20 kB | 59,43 kB | React + router |
| `mapTiles-*.js` | 153,80 kB | 45,02 kB | Leaflet (dal öncesi de vardı) |
| **`ConfirmDialog-*.js`** | **122,16 kB** | **40,95 kB** | **@medusajs/ui + Radix — bu dalın getirdiği** |
| `schemas-*.js` | 68,54 kB | 18,45 kB | zod + şemalar — bu dalın getirdiği |
| `index-*.css` | 209,90 kB | — | Tailwind + Medusa preset |

`ConfirmDialog` chunk'ı, `ui2/` üzerinden Medusa'ya bağlanan her ekranın
yüklediği ortak parça: **~41 kB gzip yeni ağ maliyeti** ve panelde pencere açan
hemen her ekran onu çekiyor. `schemas` +18 kB gzip. Kaba toplam **~60 kB gzip**
ek yük; kabul edilebilir sayılabilir ama **`main`'e karşı gerçek A/B derleme
yapılmadı** (§9'daki doğrulanamayanlar).

### 7e. Geliştirme-yalnız korumalar üretimde eleniyor mu — **evet, ölçtüm**

`dist/assets/*.js` içinde arandı:

| Aranan | Sonuç |
|---|---|
| `icerikKorumasi` `throw` metni ("… kirli form bekçisi kaydolmadı") | **yok** ✓ |
| `Form.Item`/`Form.Control` geliştirme hatalarının metinleri | **yok** ✓ |
| `HENÜZ YAZILMADI` (A7d5'in kaldırdığı ölü dallar) | **yok** ✓ |
| `console.error` | 15 çağrı — **hepsi kütüphane kodu** (Radix `aria-hidden`, React Router, zustand persist) ya da uygulamanın gerçek hata sınırı (`"Yakalanmamış UI hatası:"`, WS parse) |

`import.meta.env.DEV` kapısı üretim derlemesinde gerçekten ölü kod eliyor.
Kalan tek iz `pencereSiz` gibi **prop adları** (birkaç yüz bayt), davranış
değil.

### 7f. Dala sızanlar

* `.env` / gizli dosya: **yok**.
* **~5,2 MB PNG** ekran görüntüsü (`docs/ip-a1 … ip-a7d4`, 60+ dosya) — depo
  ağırlığı; üretime çıkmaz.
* **14 sonda dosyası** (`frontend/scripts/probe/*.tsx|html`) ve 10 tarayıcı
  turu betiği (`frontend/scripts/ip_a*.mjs`). Üretim derlemesine girmiyor
  (`dist/` içinde yalnız `index.html`), ama `npm run dev` sırasında
  `/scripts/probe/*.html` adresleri **servis edilebilir** durumda. Üretimde
  dev sunucu koşmadığı için risk yok; yine de bu dosyaların yeri `frontend/`
  değil (B-14).

### 7g. Testlerin süresi ve CI anlamı

Benim makinemde (16 mantıksal çekirdek) tam suite dosya sürelerinin toplamı
**647,8 sn**, duvar saati **~10 dk**. A7d5'in raporladığı 309,7 sn'lik toplam
benim ölçümümün yarısı — makine farkı, çelişki değil. **CI anlamı:** her
`--sequence.shuffle` koşumu ~10 dk; §6'daki kararsızlık göz önüne alındığında
CI'da tek sıralı koşum yeterli bir kapı **değildir**.

---

## 8. Bilinen ve kabul edilmiş sınırların değerlendirmesi (P4)

Kapanış envanteri bu sınırları "kabul edildi" diye yazıyor. Denetçi
değerlendirmem:

| Sınır | Envanterdeki yeri | Benim değerlendirmem |
|---|---|---|
| **İç içe ESC yığını yok** | erişilebilirlik konforu | **YANLIŞ SINIFLANDIRILMIŞ — merge öncesi kapatılmalı.** Ölçtüm (B-3): tek ESC, iç içe penceredeki KORUMALI formun onayını hiç sormadan yok ediyor. Bu bir konfor değil, göçün kapatmayı hedeflediği veri kaybı sınıfının ta kendisi. Asgari düzeltme küçük: `useModalA11y`in ESC işleyicisi yalnız **en üstteki** panele uygulanmalı (açık pencere yığını) ya da `event.defaultPrevented` kontrolü yapmalı. |
| **`useBlocker` yok** (rota gezinmesi kirli formu koruyamıyor) | bilinçli borç | **Kabul edilebilir.** `gezinmeBekcisi` sekme kapatmayı (`beforeunload`) kapsıyor; uygulama içi gezinme kullanıcının kendi tıklamasıyla olur ve pencere kapatma yolları korumalı. Etki dar, düzeltme ayrı bir paket işi. |
| **Tarayıcı geri tuşu kapatılamıyor** | bilinçli borç | **Kabul edilebilir.** Geri tuşu bilinçli bir kullanıcı hareketidir ve filtreler URL'de yaşadığı için beklenen davranıştır. |
| **Kontrast/`color-scheme` yalnız Chrome'da ölçüldü** | bilinçli borç | **Kabul edilebilir**, ama B-9 gösteriyor ki asıl sorun tarayıcı çeşitliliği değil, **Chrome'da bile dokuz yerin ölçülmemiş olması**. |
| **`OperatorLibrary` `Form.*`a geçmedi** | bilinçli kapsam kararı | **Kabul edilebilir.** Alan adları ve hata görünürlüğü çözülmüş; doğrulama sunucuda. |
| **`--taban` verilmezse kırmızı matris yanıltıcı** | alet tuzağı | **Kabul edilebilir** (reddediyor, sessiz geçmiyor) ama belgede kalmalı. |

---

## 9. Doğrulayamadıklarım

Dürüstlük kaydı — aşağıdakiler ölçülmedi, dolayısıyla bu rapor onlar hakkında
bir şey **iddia etmiyor**:

1. **`main`e karşı gerçek A/B bundle derlemesi.** `main`in `node_modules`ı ayrı
   bir kurulum ister ve görev "bu worktree dışına yazma" diyor. §7d'deki
   maliyet chunk kimliğinden **türetilmiş bir tahmindir** (~60 kB gzip), ölçüm
   değil.
2. **Firefox / Safari.** Kontrast ve `color-scheme` yalnız Chrome 149'da
   ölçüldü. Yerel widget'ları başka motorlar farklı çizer.
3. **Gerçek arka uçla uçtan uca akış.** Bütün ölçümler sahte adapter/sonda
   sayfası üzerinden yapıldı; hiçbir isteği gerçek API'ye çıkarmadım.
4. **Geçmiş paketlerin mutasyon provalarının tamamının yeniden koşulması**
   (P3). Altı temsilî prova kendi sürücümle koşuldu ve altısı da yakalandı;
   A1–A7d3'ün tüm kayıtları yeniden üretilmedi.
5. **12'den fazla tohum.** Beş kırmızı tohum bulundu; kararsızlığın gerçek
   oranı (ve `adminRezervasyonFiltre` dışındaki üyelerinin tam listesi) için
   daha büyük bir örneklem gerekir. §6b'nin gösterdiği şey "kararsızlık VAR",
   "kararsızlık şu kadardır" değil.
6. **B-1 ve B-3'ün üretimde kaç kez yaşandığı.** Kod yolu kanıtlandı; saha
   telemetrisi yok.
7. **Ekran okuyucu ile gerçek deneme.** Rol/ad/odak ölçümleri DOM ve accname
   düzeyinde kaldı; NVDA/VoiceOver ile duyulan çıktı denenmedi.
8. **`korumasiz` beyanının gerçek bir kullanımda doğru davrandığı** (raporun
   N3'ü). Panelde hâlâ tek bir çağrı yeri yok.
9. **Performans/bellek.** Suite süresini ölçtüm, uygulamanın çalışma zamanı
   performansını ölçmedim.

---

## 10. Merge edilebilir mi?

### Hayır — bu hâliyle merge edilmemeli.

Gerekçe tek cümleyle: **bu göç dört davranış eksiğini kapatmak için yapıldı;
biri (kirli formun sormadan silinmesi) panelde iki ayrı yoldan hâlâ canlı, ve
o kusuru bulması gereken iki katmanlı dedektörün ikisi de o yolları
göremiyor.** Kapıların yeşil olması bunu değiştirmiyor; nitekim kapılar
kusurun kendisini üreten pakette de yeşildi.

Bunu bir başarısızlık raporu olarak okumayın: dört eşiğin dördü doğru, altı
ters provanın altısı yakalandı, `rose-700` düzeltmesi gerçekten doğru, iç içe
`<button>` sıfır, gerçek accname motoru "0 adsız" diyor. Sorun **duyarlılık**
değil **kapsam**: ölçülen yerlerde ölçüm sağlam; ölçülmeyen yerler ölçülmemiş
olduğunu söylemiyor.

### Merge öncesi yapılması gerekenler — sıralı

1. **B-1'i kapat.** `AdminLibraries`in "Oturumlar & Operatörler" penceresinde
   operatör formunu koru. En temizi operatör hesabı formunu **kendi
   penceresine** almak ("bir `DuzenlemePenceresi` bir korumalı içerik taşır"
   kuralı zaten bunu söylüyor); alternatifi bölümü `Form.*`a taşıyıp bekçiyi
   dış pencereye kaydetmek ve oturum editörünü ayrı bir yüzeye çıkarmak.
   Yanına **pencereyi açan bir kabul testi** yaz — bugün yok.
2. **B-3'ü kapat.** ESC yalnız en üstteki pencereye uygulansın. Ters prova:
   iç içe pencerede kirli form + ESC → **dıştaki pencere KAPANMAMALI**, onay
   görünmeli.
3. **B-2'yi kapat.** Çalışma zamanı denetimi `Dialog`un render'ına değil
   panelin **içeriğine** bağlansın: `MutationObserver` ile panel alt ağacını
   izle, ya da denetimi `IcerikKorumasiCtx` sağlayıcısında her bekçi
   kaydında/çözülmesinde tetikle. Ters prova: pencereyi aç (0 girdi) → çocuk
   durumuyla form aç → dedektör **patlamalı**.
4. **B-5'i kapat.** Kapının oturum fixture'ı gerçek izin listesini kullansın
   (`["*"]` yerine). Sonra `toplamKontrol` tabanı **yeniden ölçülüp** yazılsın
   (bugünkü gerçek değeri 60) ve 14 ekranın gerçek içeriği ilk kez ölçülsün —
   bu adım yeni borç ortaya çıkarabilir, bu **istenen** sonuçtur.
5. **B-4'ü kapat.** `adminRezervasyonFiltre.acceptance.test.tsx`in düşen
   testlerine ölçülmüş çağrı yeri bütçesi ver (A7d5'in AK-2/AK-2b'de
   yaptığının aynısı) ve `flashcardsKaldirildi > R7`nin **neden hâlâ kararsız
   olduğunu** ölç — AK-8'in düzeltmesi yetmemiş. Sonra 12 tohumu **iki farklı
   tohum kümesiyle** koştur.
6. **B-8'i kapat.** `Button variant="success"` metnini AA'ya çıkar
   (`emerald-700` + beyaz ≈ 5,0; ya da koyu metin). Aynı turda `danger`
   varyantının 4,70'i de gözden geçirilsin — hata metninde aynı 4,70
   "yetersiz" sayılmıştı.
7. **B-9'u kapat.** Dokuz yerel widget'a `dark:[color-scheme:dark]` ver; daha
   iyisi `.input` sınıfına eklenip tek kaynak yapılsın (ClosedDays'in
   yorumunun zaten doğru sandığı şey budur) ve bir nöbetçi yazılsın
   (`Form.Control` dışındaki korumasız yerel widget = 0).

### Merge'i bloklamayan ama kapatılmalı (P2)

8. B-6 — import kapanışının `.ts` yeniden-dışavurum deliği; kapanış `.ts`
   dosyalarının `export … from` hedeflerini de izlemeli.
9. B-7 — kapıdaki totolojik iddia; ekran başına "en az bir kontrol render
   edildi" ya da açık bir "bu ekranda kontrol beklenmiyor" kimliği.
10. B-10 — `DeliveryOrdersPage` gönder düğmesi + kilitli karar için bir
    nöbetçi.
11. B-11 — açık temada `.input` odak göstergesi 2,98 → ≥3,0.
12. B-16 — `useUrlDurumu` çoklu örnek yazımı; en azından envantere yazılsın.

### Not

`main` dal ayrıldığından beri ilerlememiş (§7a), yani bu düzeltmeler çakışma
riski olmadan aynı dalda yapılabilir. Düzeltmelerden sonra 1–7 maddelerinin
her biri için ayrı bir ters prova beklenmelidir; "kapı yeşil" bu turda üç kez
yanıltıcı oldu.

---

## 11. Kullandığım aletler ve temizlik

Hepsi bu denetim için yazıldı; geliştiricinin sayacı, mutasyon sürücüsü ve
tarayıcı sondaları **çalıştırılmadı**.

| Alet | Ne yapar | Yöntem farkı |
|---|---|---|
| `denetci-sayim.mjs` | ham düğme / kontrol sayımı | esbuild derlemesi + `jsx("etiket"` sayımı (AST yürüyüşü DEĞİL) |
| `kapiKapsami.audit.test.tsx` | 110 ekranı iki ayrı izin kümesiyle mount eder | kapının kendi fixture'ından bağımsız |
| `accname.audit.test.tsx` | `dom-accessibility-api` ile erişilebilir ad | projenin kendi çözücüsü DEĞİL |
| `icIceButon.audit.test.tsx` | gerçek DOM'da iç içe interaktif öğe | — |
| `sk10` / `dedektor` / `ic.audit.test.tsx` | B-1, B-2, B-3 davranış sondaları | `vi.mock` ile dedektör çağrılarının kaydı |
| `sk6.mjs` | `Form.Control` dışı yerel widget taraması | TS AST, ata zinciriyle |
| `kontrast.mjs` + `odak2.mjs` + `Probe.tsx` | Chrome + ham CDP kontrast/odak ölçümü | kendi WebSocket sürücüm; hata metni **`role="alert"` öğesinde** ölçülür, zemin alfa kompozisyonlu |
| `shuffle.sh` | 12 karışık tohum | geliştiricininkinden farklı tohumlar (7001–7171) |
| elle patch/geri-al | 6 ters prova | `git status --porcelain` ile her adımda doğrulandı |

**Temizlik.** Bütün geçici dosyalar (`frontend/src/__denetim3__/`,
`frontend/denetim3-probe.html`, sentetik kaçak dosyaları, altı mutasyon
yaması) silindi ya da yedekten geri yüklendi. Kapanışta:

```
$ git status --porcelain
?? denetim3-prompt.md
?? docs/denetim3-kapanis.md

$ git diff --stat HEAD
(boş)
```

HEAD hâlâ `57f8584`'te detached; hiçbir commit atılmadı.
