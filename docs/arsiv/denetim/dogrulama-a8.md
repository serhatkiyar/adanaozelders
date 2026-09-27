# Doğrulama Turu — İP-A8 kapatmaları (merge kapısı)

**Doğrulayıcı:** bu kodu yazmayan bağımsız oturum · **Tarih:** 21 Ağustos 2026
**Doğrulanan:** `HEAD = 732eb48` (detached) · `main = f399526`
**Girdi:** `docs/arsiv/denetim/denetim3-kapanis.md` (14 bulgu) + `docs/arsiv/ip-a/ip-a8-rapor.md` (12 kapandı + 2 borç iddiası)
**Kural:** hiçbir şey düzeltilmedi, hiçbir commit atılmadı. Ölçüm için yapılan
geçici değişikliklerin hepsi geri alındı; `git status --porcelain` her turdan
sonra doğrulandı (§6).

> **Kapak cümlesi.** A8'in beyan ettiği sayıların **hepsini kendi aletimle
> yeniden ürettim ve hepsi tuttu** — 88 mount, 60 kontrol (eski fixture'la 39),
> 14 → 0 403 kutusu, 24 kontrol basan ekran, 1 adsız kontrol, 8 geçerlilik
> borcu, beş düğme varyantının kontrastı iki temada, 6/6 karışık tohum.
> Denetim #3'ün dört P1 bulgusunun (B-1 · B-2 · B-3 · B-5) kapandığını **kendi
> davranış sondalarımla** ölçtüm; B-6, B-8 ve B-9'u da bağımsız yeniden ürettim.
> Buna karşılık **yedi yeni bulgu** çıktı: gönder düğmesi nöbetçisinin kimliği
> tekrarlanan ifadeyi görmüyor (dokuzuncu ihlal SESSİZCE geçti — ölçtüm),
> "yedi borcun hiçbiri göç eden ekranlarda değil" iddiası **üç ekran için
> yanlış**, `MutationObserver` sözleşmesinin dayandığı sıralama garantisi yalnız
> test ortamında doğrulanmış, ve duvar saatine bağlı bekleyiş sınıfı 56 test
> dosyasında hâlâ ayakta. **Hiçbiri P1 değil. Kararım: merge edilebilir** (§8).

---

## 0. Bulguların özeti (bu turda BEN bulduklarım)

| # | Ağırlık | Bulgu | Nerede |
|---|---|---|---|
| **D-1** | **P2** | Gönder düğmesi nöbetçisinin kimliği `dosya + etiket + normalize ifade`. Aynı dosyaya **aynı ifadeyle** ikinci bir geçerlilik kapısı eklediğimde nöbetçi **8/8 yeşil** kaldı. Raporun "dokuzuncusu doğduğu gün CI kırılır" cümlesi bu şekil için doğru değil. Ham çağrı yeri **77**, kayıt **62** — aradaki 15, aynı kimliğe düşen tekrarlar. | `src/__guards__/gonderDugmesi.test.ts` · ters prova §4 |
| **D-2** | **P2** | "Yedi geçerlilik borcunun hiçbiri göç eden 21 ekranda değil" iddiası **yanlış**: `ExamSessionsManager`, `store/ProductForm` ve `PackingStationPage` `ui2/` katmanına göç etmiş ve üçü de `DERIN_KAPI` listesinde. (Kod değil, **gerekçe** yanlış; üstelik `ExamSessionsManager`'ın `!dirty` düğmesi dosyada "geçerlilik kapısı DEĞİL" notuyla yazılı — sınıflandırma da tartışmalı.) | `docs/arsiv/ip-a/ip-a8-rapor.md` §7c |
| **D-3** | **P2** | B-2'nin yanlış-pozitif emniyeti "çocuğun bekçi `useEffect`i, gözlemcinin mikrogörevinden ÖNCE koşar" varsayımına dayanıyor. Bu **RTL/`act()` altında** doğru; gerçek tarayıcıda React 18 pasif efektleri makrogörev zamanlayıcısına verir, `MutationObserver` geri çağrısı (mikrogörev) **önce** koşar. Etki yalnız geliştirmedir (üretimde dedektör derlemeden eleniyor — ölçtüm), ama "doğru yazım dev'de patlayabilir" riski gerçek tarayıcıda ölçülmemiş. | `components/admin/ui/Dialog.tsx:100-130` |
| **D-4** | **P2** | `KONTROLSUZ_EKRANLAR`'ın 64 kaydı kimlikle donduruldu ama **ölçümden türetildi** ve gerekçe kodları (40+ ekran `kosullu`) hiç doğrulanmadı. Liste yazıldığı anda zaten sessizce boşalmış bir ekran, sonsuza dek `kosullu` kalır. A8 bunu kendi risk notu #3'te yazmış; ben de bağımsız olarak aynı sonuca vardım. | `__guards__/calismaZamaniKapisi.test.tsx` |
| **D-5** | **P2** | B-4'ün sınıfı (duvar saatine bağlı bekleyiş) yalnız A8'in dokunduğu dosyalarda kapandı. Test ağacında **56 dosya** hâlâ `findBy*`/`waitFor` kullanıyor. Yapay ek yük altında (`src/` altına tek bir ağır sonda dosyası koyduğumda) `adminKataloglarGoc.acceptance` **bir kez kırmızı düştü**; temiz ağaçta 6/6 tohum yeşil. | 56 test dosyası · ölçüm §3·B-4 |
| **D-6** | **P3** | B-16'nın (iki `useUrlDurumu` örneği) **nöbetçisi yok**. Bugün yedi tüketicinin hepsi tek örnek (kendi taramam), ama ikinci örnek sessizce doğabilir. Borç yazıldı, kapı yazılmadı. | `hooks/useUrlDurumu.ts` |
| **D-7** | **P3** | Dala giren PNG/sonda yükünü kendim ölçtüm: **86 PNG · 4,7 MB** + 25 sonda dosyası. Üretim derlemesine girmiyor (doğrulandı), ama normal merge ile **`main`in geçmişine kalıcı girer**. Squash-merge ya da merge öncesi temizlik önerilir. | `docs/ip-a*/`, `frontend/scripts/probe/` |

**P1 bulunmadı.**

---

## 1. Kendi kapım (beyan edilenle yan yana)

| Kapı | A8 beyanı | **Benim ölçümüm** | Sonuç |
|---|---|---|---|
| `npx tsc --noEmit` | 0 hata | **0 hata** | tuttu |
| `npm run lint` | 0 hata, 31 uyarı | **0 hata, 31 uyarı** | tuttu |
| `npm run build` | geçti (32,97 sn) | **geçti (1 dk 14 sn)** | tuttu |
| `npx vitest run` | 148 dosya / 1704 test | **148 dosya / 1704 test, hepsi geçti (152 sn)** | tuttu |
| `index` bundle | 272,72 kB / gzip 85,15 | **272,63 kB / gzip 85,12** | tuttu |
| `--sequence.shuffle` | 20/20 yeşil (kendi tohumları) | **6/6 YEŞİL** | tuttu |

Tohumlarım A8'inkilerden ve denetim #3'ünkilerden **bağımsız** seçildi:
**9001 · 9137 · 9241 · 9349 · 9457 · 9601** — altısında da `148 passed (148)`.

> **Kendi alet kusurum, kayda geçiyor (kök CLAUDE.md §I).** İlk tohum turumu
> geçici sonda dosyalarım `src/` altındayken koşturdum. `tembelModul` nöbetçisi
> dört tohumda kırmızı düştü ve ben bunu bir an dalın kararsızlığı sandım.
> Değildi: nöbetçi test ağacını **diskten** tarıyor ve benim sondam gerekçesiz
> tembel modül yüklüyordu — yani nöbetçi doğru çalıştı, kusurlu olan benim
> ölçüm düzeneğimdi. (Aynı turda `adminKataloglarGoc.acceptance` de bir kez
> düştü; o düşüş D-5'in kanıtı olarak ayrıca yazıldı.) Sondaları ağaç dışına
> taşıyıp **temiz** tekrarladım; yukarıdaki 6/6 o temiz turun sonucudur.

---

## 2. A — Yeni çıpa gerçekten koruyor mu (zorunlu)

### 2a. Kendi ölçüm aletim

A8'in betiklerini ve mutasyon sürücüsünü **çalıştırmadım**. Kendi sondamı
yazdım: `OLCUM_TABANI`'ndaki 105 taban `.tsx`'ini propsuz mount eder, 403
metnini `AccessState`ten import etmeden **kendi elimle** sabitler, erişilebilir
ad çözümünü `test-utils/alanAdlari`ye değil **kendi yazımıma** dayandırır
(`aria-label` · `aria-labelledby` · `label[for]` · sarmalayan `<label>`), ve
oturumu iki kez kurar: bir kez gerçek izin listesiyle, bir kez denetimin bulduğu
bozuk `["*"]` fixture'ıyla.

```
### GERCEK {"taban":105,"mount":88,"kontrol":60,"red":1,"bos":0,
            "adsiz":1,"kontrolBasanSayi":24,"mountOlmayanSayi":17}
### JOKER  {"taban":105,"mount":88,"kontrol":39,"red":14,"bos":0,
            "adsiz":1,"kontrolBasanSayi":17}
```

| Ölçüm | Denetim #3 | A8 beyanı | **Benim ölçümüm** |
|---|---|---|---|
| Taban `.tsx` | 105 | 105 | **105** |
| Mount edilen ekran | 88 | 88 | **88** |
| Mount edilemeyen (gerekçeli) | 17 | 17 | **17** |
| Kontrol — eski `["*"]` fixture | **39** | 39 | **39** |
| **Kontrol — gerçek izinler** | (ölçmedi) | **60** | **60** |
| 403 basan ekran — eski fixture | **14** | 14 | **14** |
| **403 basan ekran — gerçek izinler** | — | **0** | **0** (tek istisna `AccessState.tsx`'in kendisi) |
| Boş DOM basan ekran | — | 0 | **0** |
| Kontrol basan ekran (kimlik) | — | **24** | **24** |
| Adsız kontrol | 1 | 1 | **1** (`ImageCropModal` `type=range` kaydırağı) |

**39 → 60 iddiası doğrudur ve regresyon değildir.** Fixture'ın backend
kataloğunun aynası olduğu iddiasını da ayrıca doğruladım:
`TAM_ADMIN_IZINLERI` ile `backend/core/admin_permissions.py::PERMISSION_CATALOG`
**42'ye 42, iki yönde de fark sıfır**.

Bir yan gözlem: sondamın ilk yazımı oturumu tur başında **bir kez** kuruyordu ve
gerçek izinlerle de 13 ekranda 403 okudum. Oturumu her render öncesi yeniden
kurunca sayı 0'a indi — yani ölçüm birimi "oturum tazeliğine" duyarlı. Kapı bunu
zaten doğru yapıyor (her ekran kendi `it`i, `beforeEach` her seferinde kuruyor);
kaydediyorum çünkü kapının bu ayrıntıyı bozması hâlinde ölçüm sessizce 403'e
kayar ve **çıpa bunu yakalar** (yakaladığını da ölçtüm).

### 2b. Ters provalar — çıpa gerçekten nöbet tutuyor mu

| Prova | Sonuç |
|---|---|
| Bir ekranı bilerek 403'e düşür (fixture'dan izin sil) | **kırmızı** — `["*"]` fixture'ıyla 14 ekran 403 basıyor ve 403 çıpası her birini adıyla kırar (`… ekran yerine 403 kutusu render edildi … OLCULMUS SAYILMAZ`) |
| Boş DOM bas | çıpa var (`dugumSayisi > 0`); bugün hiçbir ekran boş basmıyor — ölçtüm |
| Kimlik listesinden bir ekran çıkıp başkası girsin, sayı sabit kalsın | **kırmızı** — `KAPI_KAPSAMI`, `KONTROLSUZ_EKRANLAR` ve `kontrolBasanEkranlar` üçü de **kimlik** karşılaştırması (`toEqual` sıralı liste); toplamı sabit tutan takas mümkün değil |
| Fixture'ı eski `["*"]` hâline döndür | **kırmızı** — eski kusur artık 14 ekranda ayrı ayrı yakalanıyor |

### 2c. **Asıl soru: dördüncü "ölçümden türetilmiş eşik" burada mı?**

**Sayı düzeyinde: HAYIR.** `toplamKontrol >= 39` tamamen kaldırılmış. Kapının
bugünkü çıpalarının hiçbiri bir eşik değil; üçü de kimlik listesi
(`KAPI_KAPSAMI` 88 · `KONTROLSUZ_EKRANLAR` 64 · `CALISMA_ZAMANI_ADSIZ` 1) ve
hepsi iki yönlü karşılaştırılıyor. `uiBaseline`'daki iki tavan
(`rawButton <= 102`, `adsizKontrol <= 7`) hâlâ sayıdır ama ölçülen
**popülasyon** kimlikle çivili (`olcum.dosyalar === OLCUM_TABANI` +
`eksik/fazlaDosyalar === []`), yani B-5'in çökme yolu — "ölçüm çöker, eşik
çökmüş sayıya kalibre kalır" — kapalı.

**Kimlik düzeyinde: KISMEN EVET — D-4.** `KONTROLSUZ_EKRANLAR`'ın 64 kaydı
ölçümden üretildi: "bugün kontrol basmayan ekran" listesi. Kapı bundan sonraki
her değişimi iki yönlü yakalar, ama **listenin yazıldığı andaki** durumu
sorgulamaz. 40'tan fazla ekran `kosullu` gerekçesiyle yazılı ve bu gerekçelerin
hiçbiri bir dal testiyle doğrulanmadı. Yani "sessizce boşalmış ekran" sınıfının
**geçmişe dönük** kanıtı yok.

Bu, B-5'in tekrarı **değildir** — orada eşik çökmüş ölçüme kalibreydi ve hiçbir
şey ayırt etmiyordu; burada liste 24 ekranda gerçek bir iddia taşıyor ve iki
yönlü korunuyor. Ama aynı ailenin dördüncü üyesidir ve öyle yazılmalıdır.
A8 bunu kendi risk notu #3'te açıkça yazmış; **katılıyorum, P2, merge'i
bloklamaz.**

---

## 3. B — 14 bulgunun kapanışı (zorunlu)

Hepsi **kendi yöntemimle** sınandı; A8'in testleri çalıştırılmadı.

### B-1 · `AdminLibraries` operatör formu — **KAPANDI** (davranışla)

Gerçek ekran, gerçek DOM, gerçek yetki çözümü. Ekranı render ettim,
"Oturumlar & Operatörler" penceresini açtım, "+ Operatör"e bastım, **Ad** ve
**Şifre** alanlarına yazdım, `Escape`'e bastım:

```
### B1_ESC_ONCESI_DIALOG   2
### B1_ESC_SONRASI_DIALOG  2      ← pencere AYAKTA
### B1_ONAY_METNI          true   ← onay istemi göründü
### B1_AD_HALA_VAR         true   ← yazılan veri duruyor
```

Denetim #3'ün ölçtüğü hâl (`ESC sonrası dialog: 0`, `onay: false`) artık
üretilemiyor. **Üretimde canlı olan kusur gerçekten kapandı.**

### B-2 · Dedektör panelin sonradan değişen içeriğini görüyor mu — **KAPANDI**

A8'in geriye dönük testlerini koşmadım; **kendi sentetik kusurumu** kurdum:
bekçisiz bir `Dialog`, içinde kendi `useState`iyle sonradan alan doğuran bir
çocuk bileşen.

| Sentetik kusur | Sonuç |
|---|---|
| pencere açılışında 0 girdi | hata **yok** (doğru — susması gerekiyor) |
| tıklamayla doğan korumasız `<input>` | **yakalandı** — `"Sentetik Pencere" penceresi 1 düzenlenebilir kontrol taşıyor ama hiçbir kirli form bekçisi kaydolmadı` |
| zamanlayıcıyla (veri gelince) doğan alan | **yakalandı** |
| `hidden` sınıfıyla gizlenmiş alan | **yakalandı** (açılışta) |

Denetimin ölçtüğü "dedektöre TEK çağrı, o anda panelde 0 girdi" durumu artık yok.

**Kenar notu (D-3).** A8 yanlış-pozitif emniyetini şuna dayandırıyor: *"çocuğun
bekçi kaydı bir `useEffect`tir ve React 18'de commit sonrası SENKRON akar;
gözlemci geri çağrısı bir mikrogörevdir ve ondan SONRA koşar."* Bu cümle
**RTL/`act()` altında** doğru — benim B-1 sondamda gerçek `AdminLibraries`
penceresinde form sonradan doğdu, bekçisiyle birlikte, ve dedektör
**patlamadı**. Gerçek tarayıcıda ise React 18 pasif efektleri `scheduleCallback`
(MessageChannel = makrogörev) ile planlar; `MutationObserver` geri çağrısı
mikrogörevdir ve **önce** koşar — o sırada `korumaVar` hâlâ `false`tur. Etki
**yalnız geliştirmedir** (§5: dedektör üretim derlemesinde gövdesi boşaltılmış),
ama "doğru yazım da dev'de patlayabilir" riski gerçek tarayıcıda **ölçülmedi**.

### B-3 · İç içe ESC — **KAPANDI**

Gerçek ekranda, iki gerçek pencereyle:

```
### B3_TEMIZ_ICPENCERE  {"once":2,"sonra":1}   ← tek ESC yalnız en üsttekini kapattı
### B3_IKINCI_ESC       0                       ← ikinci ESC dıştakini kapattı
```

Korumalı iç pencere + tek ESC durumu B-1 sondasında ayrıca ölçüldü: **onay
soruluyor, dıştaki pencere ayakta.** Denetimin "2 → 0, onay yok" ölçümü
üretilemiyor.

*Üç kat iç içe pencereyi ölçmedim* (§6). Uygulama genel bir yığın
(`MODAL_YIGINI` + `lastIndexOf`) ve iki katta doğru davranıyor; üç kat için
gerekçe var, ölçüm yok.

### B-6 · `.ts` yeniden-dışavurum deliği — **KAPANDI**

Denetimin sentetik kaçağını **kendim yeniden kurdum**: `src/lib/dogKacak.tsx`
(3 ham `<button>` + 2 adsız kontrol + 1 etiketsiz `fixed inset-0` katmanı) →
`src/lib/dogBarrel.ts` (`export * from "./dogKacak"`) → ölçülen bir taban
ekranından (`admin/StockBadge.tsx`) import.

```
✗ panel ağacındaki her dosya listede yazılıdır
  → expected [ 'src/lib/dogKacak.tsx' ] to deeply equal []
```

İlk savunma hattı aşılsa bile metriklerin gördüğünü ayrıca doğruladım (kaçağı
ölçüm tabanına elle kaydettim):

```
✗ ham <button> sayısı artamaz          → expected 105 to be <= 102
✗ adsız form kontrolü artamaz           → expected 9 to be <= 7
✗ etiketsiz overlay SIFIR               → expected 1 to be +0
✗ etiketsiz overlay dosya listesi sabit → ['src/lib/dogKacak.tsx']
```

Denetimin "3 düğme + 2 adsız + 1 overlay, **50/50 nöbetçi yeşil**" ölçümünün
karşılığı bugün **dört ayrı kırmızı**. Kaçak kaldırıldı, ağaç temiz.

### B-7 · Ölü iddia — **KAPANDI** (yeni totoloji doğmadı)

A8 "adsız kontrol 1'de kaldı" diyor. Kendi ölçümüm: **1** — ve o 1 gerçek:
`ImageCropModal`'ın yakınlaştırma kaydırağı (`<input type="range">`; HTML'ini
sondam bastı). İddia artık iki parçalı ve **24 ekranda gerçekten bir şey ayırt
ediyor**; kalan 64'te totoloji olmaktan çıkıp **gerekçeli bir kayda** dönüşmüş,
ve kayıt iki yönlü korunuyor. Yeni bir totoloji doğmadı. Kaydın kendi zayıflığı
D-4'tür.

### B-8 / B-9 / B-11 · Kontrast ve `color-scheme`

**Kendi Chrome ölçümüm** (gerçek Chrome, headless, kendi sonda sayfam;
`ip_a8_kontrast.mjs` **çalıştırılmadı**). Zemin alfa kompozisyonuyla hesaplandı,
derlenmiş `dist/assets/index-*.css` kullanıldı, ölçülen metinler 14 px.

| Öğe | Açık — A8 | Açık — **ben** | Koyu — A8 | Koyu — **ben** | Eşik |
|---|---|---|---|---|---|
| Düğme `primary` | 6,29 | **6,29** | 6,29 | **6,29** | 4,5 |
| Düğme `secondary` | 10,35 | **10,35** | 14,48 | **14,48** | 4,5 |
| **Düğme `success`** | 5,48 | **5,48** | 5,48 | **5,48** | 4,5 |
| Düğme `danger` | 4,70 | **4,70** | 4,70 | **4,70** | 4,5 |
| Düğme `ghost` | 7,24 | **7,24** | 12,02 | **12,02** | 4,5 |

**On hücrenin onu da birebir tuttu. B-8 kapandı** (3,77 → 5,48). `danger`ın 4,70
ile bilinçli bırakılması kararına katılıyorum: AA eşiğini geçiyor ve gerekçe
(yıkıcı aksiyonun tek görsel işareti) bir tasarım kararıdır, bu paketin işi değil.

**B-9 — kapandı ve kök bildirimin yan etkisi YOK.** Prompt'un asıl sorusu buydu;
iki temada da ölçtüm:

| Widget | Açık tema | Koyu tema |
|---|---|---|
| `html` | `light` | `dark` |
| `<input type="date" class="input">` | `light` | `dark` |
| `<input type="number">` (çıplak) | `light` | `dark` |
| `<select>` (çıplak) | `light` | `dark` |
| `<input type="time">` (çıplak) | `light` | `dark` |

Açık temada hiçbir widget `dark` ya da `normal` okumuyor — **açık temada bozulan
bir şey yok.** Denetimin ölçtüğü `color-scheme: normal` üretilemiyor. Dokuz
widget'ı tek tek yamamak yerine kök öğeye taşıma kararı ölçümle destekleniyor:
`.input` sınıfı **taşımayan** çıplak widget'lar da kapsanıyor.

**B-11 — açık temada kapandı, koyu temayı ölçemedim.** Odak kenarlığı açık
temada `indigo-500` = **4,47:1** (beyaz zemine karşı; A8 4,27 raporlamış, aynı
mertebe — fark komşu zemin seçiminden). SC 1.4.11 eşiği 3,0 → **geçiyor**;
denetimin ölçtüğü 2,85/2,98 üretilemiyor. Koyu temada sondam `:focus` stillerini
uygulatamadı (okunan değer odaksız `slate-600`du) — **doğrulayamadım** (§6).

### B-4 · Kararsızlık — **KAPANDI, ama sınıfı kapanmadı (D-5)**

Kendi altı tohumumda (9001 · 9137 · 9241 · 9349 · 9457 · 9601) **6/6 yeşil**,
`148 passed (148)`. Denetim #3'ün gördüğü düşüşü ben de tekrarlayamadım; makinem
de A8'inki gibi hızlı (tam suite **152 sn**; denetçininki 647,8 sn), yani bu
"çürütme" değil.

**Ama bir ölçüm daha yaptım ve A8'in yapmadığı bir şeyi gösteriyor.** Kendi
sonda dosyalarım `src/` altındayken koştuğum kirli turda —yani suite'e tek bir
ağır dosya eklendiğinde— `adminKataloglarGoc.acceptance` bir tohumda kırmızı
düştü. O dosyada **17 adet** `findBy*`/`waitFor` var ve test ağacının tamamında
**56 dosya** duvar saatine bağlı bekleyiş kullanıyor. A8 reçeteyi (bekleyişi
`act` akıtmasıyla değiştirip iddiayı eşzamanlı `getBy*` yapmak) yalnız
**dokunduğu iki dosyada** uyguladı.

Yani: **B-4'ün somut örnekleri kapandı, sınıfı kapanmadı.** Yükü biraz artan
bir CI makinesi bu 56 dosyanın herhangi birinde aynı düşüşü üretebilir. Bu bir
üretim kusuru değil, ölçüm altyapısı borcudur — P2, merge'i bloklamaz, ama
"kararsızlık kapandı" cümlesi envantere böyle yazılmamalı.

### B-10 / B-12 / B-13 / B-15

| # | Sonuç | Kanıtım |
|---|---|---|
| **B-10** | **Kapandı** | Kendi AST taramam `DeliveryOrdersPage`te `trim()` içeren tek bir `disabled` bulmuyor; dosyanın `disabled` kayıtları `secim` sınıfında. |
| **B-12** | **Kapandı** | Denetimin "hiçbir test açmıyor" dediği iki `AdminLibraries` penceresini **kendi sondam** açtı (dış yönetim + iç operatör penceresi) ve ikisi de gerçek DOM davranış sınamasına girdi. |
| **B-13** | **Kapandı** | `git diff main..HEAD -- frontend/package.json`: `@medusajs/ui-preset` `devDependencies` altında. |
| **B-15** | **Kapandı** | `ClosedDays.tsx`teki yanlış yorum düzeltilmiş; `.input` sınıfının gerçekten `color-scheme` taşımadığını kaynaktan, korumanın kök öğeden geldiğini Chrome'dan doğruladım. |

### İki açık borç — katılıyor muyum

**B-16 (iki `useUrlDurumu` örneği) — KATILIYORUM, merge'i bloklamaz.**
Kendi taramam A8'i doğruluyor: yedi tüketicinin **hepsinde tek örnek**
(`AdminAuditLogsPage`, `AdminBookingsPage`, `AdminPayoutsPage`,
`CountSessionsPage`, `DamageEventsPage`, `PackagesPage`, `AdminHome` — her biri
1), yani kusur bugün canlı değil. Düzeltmenin A6c·BULGU-4'ün çözümünü yeniden
tasarlamak demek olduğu da doğru; ayrı paket kararı yerinde.
**Eksik olan şu (D-6):** borç yazıldı, **kapısı yazılmadı**. "Bir dosyada iki
`useUrlDurumu` çağrısı olamaz" tek satırlık bir kaynak nöbetçisidir ve bu turda
kurulan altı nöbetçinin en ucuzu olurdu. Kapısız borç, sessizce canlıya
dönebilen borçtur.

**B-14 (PNG + sonda dosyaları) — KATILIYORUM, ama merge ŞEKLİNE dair uyarıyla.**
Kendi ölçümüm: **86 PNG · 4,7 MB** + 25 sonda/probe dosyası; `.env` sızıntısı
**yok** (doğruladım), üretim derlemesine **girmiyor** (doğruladım). Merge'i
bloklamaz. Uyarı (D-7): bu dosyalar 29 commit'e yayılmış, yani **normal merge
ile `main`in geçmişine kalıcı girerler** ve sonradan silmek depo boyutunu geri
getirmez. "Temizlik ayrı bir commit'in işi" gerekçesi merge sonrası
**karşılıksız** kalır. Gerçekten isteniyorsa yol ikiden biridir: merge öncesi
silme + **squash-merge**, ya da bilinçli olarak hiç uğraşmamak.

---

## 4. C — 7 donmuş borç doğru mu sayıldı

**Kendi aletim:** `typescript` AST'iyle 110 taban dosyasını gezip
`<Button|button … disabled={…}>` çağrı yerlerini topladım (yorum ve dize
sayılmaz — AST, metin değil).

| Soru | Cevap |
|---|---|
| Sayı gerçekten 7 mi? | **Evet — 8 çağrı yeri / 7 ekran** (`ProductForm` iki kez). A8'in listesiyle **birebir aynı sekiz ifade**. |
| Gerçekten hiçbiri göç eden ekranlarda değil mi? | **HAYIR — D-2.** |
| Dondurma doğru mu — yenisi doğarsa yakalanıyor mu? | **Kısmen — D-1.** |

Bulduğum sekiz ifade (A8'inkiyle aynı):

```
ExamSessionsManager        <Button>  !dirty
QrScanner                  <button>  !manual.trim()
store/ProductForm          <Button>  !newTitle.trim() || !newAxis1 || createGroup.isPending
store/ProductForm          <Button>  derive.isPending || !value1.trim() || !newBarcode.trim() || …
DeliveryDriver             <button>  busy || note.trim().length < 3
DeliveryDriver             <button>  !kod.trim() || scanLabel.isPending
DeliveryRunHandover        <button>  !kod.trim() || scan.isPending
PackingStationPage         <Button>  !kod.trim()
```

### D-2 · "hiçbiri göç eden 21 ekranda değil" — yanlış

`ui2/` katmanını kullanan taban dosyalarını kendim taradım (40 dosya). Yedi
borçlu ekranın üçü o listede:

| Ekran | `ui2/`ye göç etmiş mi | `DERIN_KAPI`'da mı |
|---|---|---|
| `ExamSessionsManager` | **evet** | **evet** (A7d2 · S-3) |
| `store/ProductForm` | **evet** | **evet** (A7d2) |
| `PackingStationPage` | **evet** | **evet** (A7d3) |
| `QrScanner` | hayır | hayır |
| `DeliveryDriver` | hayır | hayır |
| `DeliveryRunHandover` | hayır | hayır |

Üstelik `ExamSessionsManager`'ın `!dirty` düğmesinin yanında dosyada şu yorum
duruyor: *"'Kaydet' DEĞİŞİKLİK YOKKEN kapalıdır ve bu bir geçerlilik kapısı
DEĞİLDİR."* Yani ya sınıflandırma yanlış (`onkosul`/`secim` olmalıydı) ya da
yorum yanlış. **Kod değil, envanter cümlesi düzeltilmeli.** P2.

### Ters prova 1 — yeni dosyada, yeni ifadeyle dokuzuncu ihlal

`admin/StockBadge.tsx`e `<button disabled={!ad.trim()}>Kaydet</button>` eklendi:

```
✗ her `disabled` çağrı yeri SINIFIYLA kayıtlıdır
  → sınıflandırılmamış disabled: expected [ Array(1) ] to deeply equal []
  Tests  1 failed | 7 passed (8)
```

**Yakalanıyor.**

### Ters prova 2 — AYNI dosyada, AYNI ifadeyle ikinci ihlal (D-1)

`PackingStationPage.tsx`te zaten `<Button … disabled={!kod.trim()}>` var. Yanına
ikinci bir `<Button disabled={!kod.trim()}>ikinci ihlal</Button>` kondu:

```
  Tests  8 passed (8)        ← SESSİZCE GEÇTİ
```

Kimlik `dosya + etiket + normalize ifade` olduğu için **tekrar eden şekil
görünmez**. Bunun ölçülebilir izi kayıtta zaten var: benim ham taramam **77**
çağrı yeri buluyor, kayıt **62** kalem tutuyor — aradaki **15** fark tam da aynı
kimliğe düşen tekrarlar.

Bu bir yalancı yeşil **değil**, dar bir kimliktir; ödünleşimi rapor kendi
gerekçesinde yazmış (satır numarası taşısaydı nöbetçi gürültülü olurdu). Ama
raporun cümlesi — *"dokuzuncusu doğduğu gün CI kırılır"* — bu şekil için
**doğru değil** ve envantere böyle yazılmamalı. P2, merge'i bloklamaz.

---

## 5. D — Merge hazırlığı

| Kontrol | Sonuç |
|---|---|
| `git rev-list --count main..HEAD` | **29 commit** |
| `git rev-list --count HEAD..main` | **0 — `main` ilerlemedi, çakışma riski yok** |
| `git diff --stat main..HEAD` | 321 dosya, +57.683 / −5.597 |
| A8 commit'inin beyan ettiği 8 üretim dosyası | **Sekizi de var, dokuzuncusu yok** — beyan tam |
| `.env` sızıntısı | **YOK** (`main..HEAD` diff'inde `.env` yolu sıfır) |
| Sonda / geçici dosya | **25** (`scripts/probe/`, `scripts/ip_a*_probe.mjs`, `docs/arsiv/ip-a/ip-a1/*sonda*.json`) — B-14 kapsamında |
| PNG yükü | **86 dosya · 4,7 MB** |
| `package.json` | 4 yeni **çalışma zamanı** bağımlılığı (`react-hook-form`, `zod`, `@medusajs/ui`, `@hookform/resolvers`) — dördü de gerçekten çalışma zamanı, `dependencies` **doğru**. `@medusajs/ui-preset` → `devDependencies` **doğru** (yalnız `tailwind.config.js`). Beyan edilmemiş bağımlılık **yok**. |

### Geliştirme-yalnız korumalar üretim derlemesinde eleniyor mu — **EVET, ölçüldü**

`dist/` içinde arandı:

* Dedektörün hata metinlerinin hiçbiri **yok**
  (`"kirli form bekçisi kaydolmadı"`, `"düzenlenebilir kontrol taşıyor"`
  → 0 eşleşme).
* `icerikKorumasiDenetle` **gövdesi boşaltılmış** hâlde derlenmiş:
  `function pc({kok:e,korumaVar:r,korumasiz:t,baslik:n}){}` — yani `GELISTIRME`
  sabiti `false`a katlanmış ve gövde ölü kod olarak elenmiş.
* `Dialog`ın `MutationObserver` efekti **yok** (`attributeFilter` dizesi
  bundle'da hiç geçmiyor). Bundle'da geçen tek `MutationObserver` bir odak
  tuzağı kütüphanesine ait (`focusin`/`focusout`) ve bu turun eklediği değil.
* `index-*.js` içinde `throw new Error` **3 adet** ve hiçbiri bu turun
  dedektörlerine ait değil.

**Bu tur boyunca eklenen `throw`ların hiçbiri üretime çıkmıyor.**

### Bundle

`index` **272,63 kB / gzip 85,12 kB** — denetim #3'ün ölçtüğü sayıyla aynı,
A8'in beyanıyla (272,72 / 85,15) aynı mertebede.

**`main`e karşı A/B ölçümünü yapamadım** (§6): `main` ayrı bir `node_modules` ve
ayrı bir derleme ister, bu da worktree dışına yazmak demekti ve tur kuralı bunu
yasaklıyor. Şu kadarı kesin: dalın dört yeni çalışma zamanı bağımlılığı
`main`de **hiç yok**, dolayısıyla bundle'ın `main`e göre büyüdüğü kesindir;
büyümenin **miktarı** bu turda ölçülmedi. (Bu, dalın ilan edilmiş amacının —
Medusa UI + `react-hook-form`/`zod` göçü — doğrudan bedelidir, gizli bir maliyet
değildir.)

---

## 6. Doğrulayamadıklarım

1. **`main`e karşı A/B bundle ölçümü** — worktree dışına yazma yasağı.
2. **Koyu temada odak göstergesi kontrastı (B-11)** — sondam koyu turda `:focus`
   stillerini uygulatamadı. A8'in "koyu tema 4,00, değişmedi" iddiası bende
   **doğrulanmadı da çürütülmedi de**.
3. **Üç kat iç içe pencerede ESC (B-3)** — iki kat ölçüldü ve doğru; üç kat
   ölçülmedi.
4. **`MutationObserver` sıralamasının gerçek tarayıcıdaki davranışı (D-3)** —
   yalnız jsdom/`act()` altında ölçüldü.
5. **Tam tarayıcı turu** — tur kutusu gereği yapılmadı; kontrast ve
   `color-scheme` dışında hiçbir ekran gerçek tarayıcıda açılmadı.
6. **Firefox / Safari** — hiç ölçülmedi (A8 da ölçmemiş).
7. **Gerçek arka uçla uçtan uca akış** — bütün ölçümler sahte adapter üzerinden;
   hiçbir istek gerçek API'ye çıkmadı, `ceyhandb`ye bağlanılmadı.
8. **Denetim #3'ün B-4 düşüşünün kendi makinesinde** tekrarı — benim makinem de
   A8'inki gibi hızlı (152 sn / 647,8 sn).
9. **`kosullu` yazan 40+ ekranın gerekçesinin doğruluğu** (D-4) — dal testleriyle
   doğrulanmadı; A8 da yapmamış.

### Çalışma ağacı

Bu turda yapılan **bütün** geçici değişiklikler geri alındı ve her adımdan sonra
doğrulandı:

```
$ git status --porcelain
?? dogrulama-prompt.md
```

(Bu rapor eklendiğinde `?? docs/arsiv/denetim/dogrulama-a8.md` de görünür — **commit
edilmedi**, tur kuralı gereği.) Değiştirilip geri alınanlar:
`components/admin/StockBadge.tsx` · `pages/admin/packing/PackingStationPage.tsx`
· `scripts/ui-baseline-sayim.mjs`. Oluşturulup silinenler:
`src/lib/dogKacak.tsx` · `src/lib/dogBarrel.ts` · `src/__dogrulama__/` (üç sonda,
ağaç dışına taşındı) · iki geçici HTML sonda sayfası · iki Chrome profil dizini.
HEAD detached kaldı, hiçbir commit atılmadı.

---

## 7. 14 bulgunun durumu

| # | Ağırlık (denetim #3) | A8 iddiası | **Benim kararım** | Kanıt türü |
|---|---|---|---|---|
| **B-1** | P1 | Kapandı | **KAPANDI** | gerçek DOM + gerçek ekran davranışı |
| **B-2** | P1 | Kapandı | **KAPANDI** (kenar notu D-3) | kendi sentetik kusurum ×4 |
| **B-3** | P1 | Kapandı | **KAPANDI** (3 kat ölçülmedi) | gerçek DOM davranışı |
| **B-4** | P1 | Kapandı | **KAPANDI** — örnekleri; **sınıfı kapanmadı** (D-5) | 6/6 bağımsız tohum + yük altında ölçüm |
| **B-5** | P1 | Kapandı | **KAPANDI** | kendi ölçüm aletim (88 / 60 / 39 / 14 → 0) |
| **B-6** | P2 | Kapandı | **KAPANDI** | kendi sentetik kaçağım, 4 ayrı kırmızı |
| **B-7** | P2 | Kapandı | **KAPANDI** (kaydın zayıflığı D-4) | kendi ölçümüm (24 gerçek iddia / 64 gerekçeli kayıt) |
| **B-8** | P1 | Kapandı | **KAPANDI** | kendi Chrome ölçümüm, 10 hücre birebir |
| **B-9** | P2 | Kapandı | **KAPANDI**, yan etki yok | kendi Chrome ölçümüm, 2 tema × 5 widget |
| **B-10** | P2 | Kapandı | **KAPANDI** | kendi AST taramam |
| **B-11** | P2 | Kapandı | **KISMEN** — açık tema kapandı (4,47); koyu tema **doğrulayamadım** | kendi Chrome ölçümüm |
| **B-12** | P2 | Kapandı | **KAPANDI** | iki pencereyi kendi sondam açtı |
| **B-13** | P3 | Kapandı | **KAPANDI** | `package.json` diff |
| **B-14** | P3 | Açık borç | **KATILIYORUM** (uyarı: merge şekli — D-7) | kendi ölçümüm: 86 PNG / 4,7 MB |
| **B-15** | P3 | Kapandı | **KAPANDI** | kaynak + Chrome |
| **B-16** | P2 | Açık borç | **KATILIYORUM** (eksik: kapı yok — D-6) | kendi taramam: 7 tüketici × 1 örnek |

**Kapanmadı diyebileceğim tek bulgu yok.** Bir tanesi kısmen (B-11 koyu tema),
o da ölçemediğim için — çürüttüğüm için değil.

---

## 8. Merge edilebilir mi?

**EVET — merge edilebilir.**

Gerekçe üç maddede:

1. **Denetim #3'ün merge'i bloklayan altı P1'inin (B-1 · B-2 · B-3 · B-4 · B-5 ·
   B-8) hepsi kapandı ve altısını da A8'in aletlerine dokunmadan, kendi
   ölçümlerimle doğruladım.** İkisi (B-1 üretimde canlı bir veri kaybıydı, B-8
   erişilebilirlik eşiği) gerçek kullanıcı zararıydı ve ikisi de gerçekten yok.
2. **Ölçümün kendisi dürüstleşti.** Kapı artık 88 ekranın 88'ini gerçekten
   render ediyor, 403 kutusu ölçüm sayılmıyor, çıpa sayıdan kimliğe geçti ve
   ben bunu bozarak (izin düşürerek, kaçak kurarak, ihlal ekleyerek) dört ayrı
   yönden kırmızıya düşürdüm.
3. **Bulduğum yedi kusurun hiçbiri üretim kodunda değil.** Beşi nöbetçi/envanter
   kalitesi (D-1, D-2, D-4, D-5, D-6), biri geliştirme deneyimi riski (D-3), biri
   depo hijyeni (D-7). Hiçbiri kullanıcıya değmiyor; üçünün gerekçesi zaten A8'in
   kendi risk notlarında yazılı.

### Merge ÖNCESİ yapılması gerekenler (bloklayıcı değil, ucuz)

Bunların hiçbiri koda dokunmuyor; ikisi cümle düzeltmesi, biri merge şekli:

1. **`docs/arsiv/ip-a/ip-a8-rapor.md` §7c'deki "hiçbiri göç eden 21 ekranda değil" cümlesi
   düzeltilsin** (D-2). Üçü göç etmiş ekranlarda. Aynı yerde
   `ExamSessionsManager`'ın `!dirty` sınıfı ya `onkosul`a alınsın ya dosyadaki
   yorum düzeltilsin — ikisi bugün birbiriyle çelişiyor.
2. **"Dokuzuncusu doğduğu gün CI kırılır" cümlesi daraltılsın** (D-1): nöbetçi
   *yeni bir (dosya, etiket, ifade) üçlüsünü* yakalar; aynı dosyada aynı ifadenin
   tekrarını yakalamaz. Ham çağrı yeri 77 / kayıt 62 farkı da rapora yazılsın.
3. **Merge şekline karar verilsin** (D-7): 4,7 MB PNG `main`in geçmişine kalıcı
   girecek. İstenmeyen buysa tek yol merge öncesi temizlik + squash-merge.

### Merge SONRASINA yazılacak borç (envantere)

| # | Borç | Öneri |
|---|---|---|
| D-3 | `MutationObserver` sıralaması gerçek tarayıcıda ölçülmedi | bir sonraki tarayıcı turunda: pencere açıkken geç doğan **doğru yazımlı** bir form dev derlemesinde açılıp patlamadığı görülsün |
| D-4 | `KONTROLSUZ_EKRANLAR`'ın 40+ `kosullu` gerekçesi doğrulanmadı | her `kosullu` ekranın bir dal testinde kontrol bastığı sınansın |
| D-5 | Duvar saatine bağlı bekleyiş 56 test dosyasında | A8'in reçetesi (`act` akıtması + eşzamanlı `getBy*`) kalan dosyalara yayılsın; nöbetçisi `beklemeButcesi`'ne bağlansın |
| D-6 | B-16'nın kapısı yok | "bir dosyada tek `useUrlDurumu` örneği" kaynak nöbetçisi (tek satır) |
| B-11 | koyu temada odak göstergesi doğrulanmadı | tarayıcı turunda gerçek `Tab` ile ölçülsün |

---

---

## 9. Bu raporun kapanışı — merge öncesi üç kalem yapıldı

Rapor teslim edildikten sonra, merge öncesi üç kalem **ayrı bir commit'te**
kapatıldı (kapsam bilinçli olarak dar tutuldu; D-3/D-4/D-5/D-6 koda
dokunulmadan borç defterine yazıldı):

| Kalem | Ne yapıldı | Kanıt |
|---|---|---|
| **D-2** | `docs/arsiv/ip-a/ip-a8-rapor.md` §7c'deki "hiçbiri göç eden 21 ekranda değil" cümlesi düzeltildi; doğrusu (üç dosya göç etmiş, göç kapsamı dosya bazlıydı ve o dosyaların bu yüzeyleri kabul testine girmemişti) yazıldı | belge diff'i |
| **D-1** | Gönder düğmesi nöbetçisinin kimliğine **çağrı sayısı** eklendi: `tabanSayimi()` artık tekilleştirmiyor, sayıyor; `ADETLER` kaydı bugünkü sekiz tekrarı dondurdu; üç yeni iddia eklendi (sayım eşitliği · kaydın sağlığı · "tekrar eden hiçbir kimlik geçerlilik borcu değil") | ters prova aşağıda |
| **D-3 · D-4 · D-5 · D-6** | Koda dokunulmadan borç defterine yazıldı: **TB-59** (`MutationObserver` sıralaması) · **TB-60** (`KONTROLSUZ_EKRANLAR` gerekçeleri) · **TB-61** (56 dosyada duvar saatine bağlı bekleyiş) · **TB-62** (B-16'nın kapısı yok). Ayrıca D-2'nin ikinci ayağı **TB-63** olarak açıldı (`ExamSessionsManager` `!dirty` sınıfı ↔ kod yorumu çelişkisi) | `docs/teknik-borc.md` |
| **D-7** | Merge şekli kararı **kullanıcıya bırakıldı** (koda dokunmaz) | — |

### D-1'in ters provası (bu commit'te kalıcı)

`PackingStationPage.tsx`te zaten `<Button … disabled={!kod.trim()}>` var.
Yanına **aynı ifadeyle** ikinci bir düğme kondu:

```
✗ her kimliğin ÇAĞRI SAYISI da dondurulmuştur (tekrar eden ihlal sessizce doğamaz)
  → expected { …(62) } to deeply equal { …(62) }
  - "src/pages/admin/packing/PackingStationPage.tsx <Button> !kod.trim()": 1,
  + "src/pages/admin/packing/PackingStationPage.tsx <Button> !kod.trim()": 2,
  Tests  1 failed | 10 passed (11)
```

Mutasyon geri alındı → **11/11 yeşil**, `git status --porcelain` temiz.
Doğrulama turunda **8/8 yeşil** kalan aynı mutasyon artık kırmızıdır ve kırmızı,
ihlali dosyası ve ifadesiyle adlandırıyor. Satır numarasına dönülmedi —
gürültü gerekçesi (`beklemeButcesi` dersi) hâlâ geçerli.

**Kapanmayan taraf, açıkça:** kimlik hâlâ *hangi satırda* olduğunu bilmiyor.
İki tekrarın biri kapanıp yerine aynı dosyada aynı ifadeyle başka bir düğme
doğarsa toplam sabit kalır ve nöbetçi susar. Bu, satır numarasız kimliğin
kalan bedeliidir ve bilinçlidir; ölçülen risk, tekrarın hepsi bugün `islem`
sınıfında olduğu için düşüktür (ayrıca üçüncü yeni iddia bunu nöbet altına
aldı: bir geçerlilik borcu tekrar etmeye başlarsa kapı kırmızı düşer).

### Kapanış kapısı

Bu commit'in kendi kapısı yeniden koşuldu. Değişen üretim kodu **yok** —
değişenler: bir nöbetçi (`+3` iddia), bir tarama aleti, iki belge, bir borç
defteri.

| Kapı | Sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run lint` | **0 hata, 31 uyarı** (devralınan `jsx-a11y`) |
| `npm run build` | **geçti** — `index` 272,63 kB / gzip 85,12 kB (**bundle bit bit aynı**: üretim kodu değişmedi) |
| `npx vitest run` | **148 dosya / 1707 test** (1704 → +3 yeni iddia) |
| `--sequence.shuffle` × 6 tohum | **6/6 yeşil** (9001 · 9137 · 9241 · 9349 · 9457 · 9601), altısında da `1707 passed` |

---

> Bu turda üç bağımsız denetimin üçü de kusur bulmuştu. Bu dördüncü tur da
> kusur buldu — **ama ilk kez hiçbiri P1 değil ve hiçbiri üretim kodunda değil.**
> Eğri doğru yönde: denetim #1/#2/#3 üretimde canlı veri kaybı bulmuştu, bu tur
> yalnız nöbetçi kalitesi ve envanter doğruluğu buluyor. Kapı çalışıyor.
