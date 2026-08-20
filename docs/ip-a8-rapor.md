# İP-A8 — Denetim #3 düzeltmeleri (merge kapısı)

**Taban:** `57f8584` (A7d5) · dal `feat/medusa-ui-taban`
**Girdi:** `docs/denetim3-kapanis.md` (bu commit'e dahil edildi)
**Tarih:** 20 Ağustos 2026

> **Kapak cümlesi.** Denetimin en pahalı bulgusu tek tek kusurlar değil, **üç
> koruma mekanizmasının aynı anda kör olmasıydı** ve kökü tekti: *bir
> nöbetçinin eşiği, koruduğu ölçümden türetilmişse o ölçümü koruyamaz.* Kapı
> onarıldıktan sonra ölçülen kontrol sayısı **39 → 60**'a çıktı, kaynak
> nöbetçisinin gördüğü pencere sayısı **4 → 8**'e, ve yeni kurulan gönder
> düğmesi nöbetçisi kilitli kararın **yedi ihlalini daha** görünür etti.
> **Bunların hiçbiri regresyon değil**; ölçümün dürüstleşmesidir ve §7'de
> ayrı ayrı yazılıdır. Kendi ürettiğim **üç alet kusuru** da bulundu,
> düzeltildi ve gerekçesiyle yazıldı (§10a-2, §10b).

---

## 0. Bulgu bulgu sonuç

| # | Ağırlık | Yeniden ürettim mi | Sonuç |
|---|---|---|---|
| **B-5** | P1 | **Evet** — 88 mount, `["*"]` ile 39 kontrol / 14 ekran 403; gerçek izinlerle 60 | **Kapandı.** Fixture gerçek izin listesi; kapı artık 403'ü render saymıyor, yalancı-yeşil çıpası sayıdan KİMLİĞE geçti. |
| **B-7** | P2 | **Evet** — düzeltme sonrası bile 88 ekranın **64'ünde** totoloji | **Kapandı.** İddia iki parçalı: ya kontrol render edilir ya `KONTROLSUZ_EKRANLAR`'da gerekçesiyle yazılıdır. |
| **B-6** | P2 | **Evet** — sentetik kaçak (3 düğme + 2 adsız + 1 overlay) **55/55 nöbetçiden geçti** | **Kapandı.** Kapanış `.ts` kenarlarından geçiyor, `.ts`i ölçmüyor. Aynı kaçak artık yakalanıyor. |
| **B-1** | P1 | **Evet** — panelde 4 girdi, ESC → 0 dialog, onay yok | **Kapandı.** Operatör formu kendi korumalı penceresine çıktı; ilk kabul testi yazıldı (10 test). |
| **B-2** | P1 | **Evet** — dedektöre TEK çağrı, o anda panelde 0 girdi | **Kapandı.** `MutationObserver` panel alt ağacını izliyor; hata render sırasında fırlatılıyor (hata sınırı sözleşmesi korunuyor). |
| **B-3** | P1 | **Evet** — iç içe 2 pencere, tek ESC → 0 pencere, onay yok | **Kapandı.** `useModalA11y`de modal yığını; klavyeyi yalnız en üstteki pencere işliyor. |
| **B-4** | P1 | **Kısmen** — düşüş bu makinede tekrarlanmadı, **kökü sayıyla üretildi** (§5) | **Kapandı.** İki testin ölçülen süresi 4.459/3.886 ms; ikisi de kaynağında küçültüldü. R7 duvar saatinden tamamen koparıldı. 20/20 tohum yeşil. |
| **B-8** | P1 | **Evet** — gerçek Chrome, `success` **3,77** iki temada | **Kapandı.** `emerald-700` → **5,48**. Tüm variant × tema tablosu §6'da. |
| **B-9** | P2 | **Evet** — beş widget `color-scheme: normal` | **Kapandı.** Kök öğede tek bildirim; onuncu widget otomatik kapsanır. |
| **B-10** | P2 | Evet (kaynak) | **Kapandı** + panel geneli nöbetçi kuruldu; nöbetçi **7 ihlal daha** buldu (§7c). |
| **B-11** | P2 | **Evet** — açık temada odak kenarlığı **2,85** | **Kapandı.** `indigo-500` → **4,27**. |
| **B-13** | P3 | Evet | **Kapandı.** `@medusajs/ui-preset` → `devDependencies`. |
| **B-15** | P3 | Evet | **Kapandı.** Yanlış yorum düzeltildi; B-9'un kökü olduğu yazıldı. |
| **B-12** | P2 | Evet | **Kapandı.** O iki pencereyi açan kabul testi artık var. |
| **B-16** | P2 | Hayır (canlı değil) | **Açık borç** — §8'de gerekçesiyle. |
| **B-14** | P3 | Evet | **Açık borç** — §8. |

---

## 1. Görev 1 — kapı 88 ekranı gerçekten ölçüyor (B-5)

### 1a. Yeniden üretim

Kapının mount yolunu birebir kullanan geçici bir sonda, 110 taban `.tsx`sini
iki kez render etti:

```
A8-B5 mount edilen: 88   toplamKontrol ['*']: 39   gercek: 60   403 basan: 14
```

Denetimin sayıları **birebir** çıktı. Farkın dosya bazlı dökümü de aynı:
`CouponsPanel` 0→6, `ProductsPanel` 0→4, `AdminStore` 0→4, `ClosedDays` 0→2,
`DeliveryCouriersPage` 0→2, `DeliveryTodayPage` 1→2, `CategoriesPanel`/
`OrdersPanel` 0→1.

### 1b. Hangi düzeltme doğru — ve neden

İki seçenek vardı: (a) `adminAreaAccess`e joker eklemek, (b) fixture'ın gerçek
izin listesini vermesi. **(b) seçildi ve gerekçesi ölçülebilir:** backend
hiçbir yerde `"*"` üretmez — `core/admin_permissions.py::PERMISSION_CATALOG`
kapalı bir kod kümesidir, `/auth/me` her zaman açık liste döndürür ve
`schemas/user.py` varsayılanı `[]`'dir. Jokeri kabul etmek, üretimde HİÇ
oluşmayan bir durumu test yolunda meşrulaştırmak, yani fixture ile üretim
arasındaki sapmayı kapatmak yerine **kalıcılaştırmak** olurdu.

Liste `src/test-utils/adminIzinleri.ts`te (`TAM_ADMIN_IZINLERI`, 42 kod).

### 1c. Yalancı-yeşil kapısı: sayı → kimlik

Eski çıpa `expect(toplamKontrol).toBeGreaterThanOrEqual(39)` idi ve **39,
kapının kendi bozuk fixture'ıyla ölçülmüş sayının ta kendisiydi.** Yerine üç
bağımsız çıpa kondu, ekran başına:

1. **403 kutusu render sayılmaz.** `kontrolOlcumu` artık `erisimReddedildi`
   döndürüyor ve metin `AccessState`ten tek kaynaktan geliyor
   (`ERISIM_REDDEDILDI_BASLIK`) — iki kopya ayrışırsa kapı sessizce körleşirdi.
   Tek meşru istisna `AccessState.tsx`in kendisi ve o da `ERISIM_KUTUSU_BEKLENEN`
   listesinde **isimle** duruyor.
2. **Boş DOM render sayılmaz** (`dugumSayisi > 0`).
3. **Kontrol basan ekranların KİMLİĞİ sabit** (aşağıda, B-7).

`toplamKontrol` sayacı tamamen kaldırıldı.

### 1d. Kapının kendi bulduğu ÜÇÜNCÜ sınıf

Yeni 403 çıpası ilk koşumunda **iki ekran daha** yakaladı:
`AdminHome` ve `AdminSectionPage`. Sebep izin değil **fixture şekli**: ikisi de
propsuz mount ediliyor, `section` `undefined` kalıyor, izin alanı
`SECTION_AREA[undefined]` → `undefined` oluyor ve ekran 403 basıyordu. Yani
kapı bu ikisini de "ölçüyor" görünüyordu.

`KAPI_DISI`'na park etmek yanlış olurdu — oranın ters provası "propsuz mount
EDİLEMİYOR" der, bunlar ediliyor. Üçüncü bir kayıt açıldı: `ZORUNLU_PROPLAR`
(bugün iki dosya, `{ section: "listings" }`), iki yönlü korunuyor ve prop
verilen ekran diğerleriyle **aynı iddialara** tabi.

### 1e. Ters prova

```
$ (fixture'dan libraries.view + libraries.manage silindi)
✗ src/pages/dashboards/AdminLibraries.tsx: ekran yerine 403 kutusu render edildi
  … OLCULMUS SAYILMAZ.: expected true to be false
  Tests  1 failed | 109 passed (110)

$ (izin geri verildi)
  Tests  110 passed (110)
$ git status --porcelain   → başlangıçtaki hâli
```

Mutasyon sürücüsünde de kalıcı: **B1**.

---

## 2. Görev 2 — ölü iddia ve sayaç deliği

### 2a. B-7 — üçüncü ölü iddia

Görev 1'den **sonra** ölçüldü: `expect(o.adsiz).toBe(0)` hâlâ **88 ekranın
64'ünde** totolojiydi (denetim düzeltme öncesi 71 demişti; 14 ekran gerçekten
render edilince yedisi kontrol basmaya başladı).

İddia yeniden kuruldu ve artık **iki parçalı**:

* ekran ya en az bir kontrol render eder — o zaman `adsiz` iddiası gerçekten
  bir şey ayırt eder;
* ya da `KONTROLSUZ_EKRANLAR`'da **gerekçe koduyla** yazılıdır
  (`sunum` · `kabuk` · `pencere-kabugu` · `kosullu`; bugün 64 kayıt).

İki yön de kırar: listedeki bir ekran kontrol basmaya başlarsa da, listede
olmayan bir ekran susarsa da kapı kırmızıdır. Kapanış nöbetçisi ayrıca
"kontrol basan ekranların kimliği" (24 ekran) ile eşitliği doğrular — biri
susup biri konuşarak toplamı sabit tutamazlar.

**Ters prova:** mutasyon **B2** — `CouponsPanel` kontrol basmayı bırakınca
kapı kırmızı düşüyor (`HIC kontrol yok — "adsiz kontrol 0" iddiasi totoloji`).
Eski kapı bunu **göremezdi**.

### 2b. Dördüncüsü var mı — arandı, YOK

Sıfıra inen bütün eşiklerin iddiaları tek tek sınandı. Bir iddia ancak
**ölçülen popülasyon boşsa** ölüdür; her biri için popülasyon ve ayırt etme
gücü ayrı ayrı ölçüldü:

| İddia | Popülasyon | Ayırt ediyor mu | Kanıt |
|---|---|---|---|
| `rawButton <= 102` | 110 dosya | evet | mutasyon A1 |
| `adsizKontrol <= 7` | 110 dosya | evet | mutasyon A2 |
| `modalDurumu === 0` | 110 dosya | evet | mutasyon A3 |
| `unlabeledOverlays === 0` + `overlayOffenders` | 110 dosya | evet | mutasyon A4 |
| `eksikDosyalar/fazlaDosyalar === []` | 110 dosya + disk | evet | mutasyon C1 |
| `tsHamButonlari() === []` | tüm `.ts` ağacı | evet — doğrudan çağrıyla ölçüldü: `createElement("button")` ve `React.createElement("button")` ikisi de `rawButton = 1` veriyor | §2b sondası |
| `medusaDirectImports === []` | tüm ağaç | evet — gerçek import `true`, yorum/dize `false` | §2b sondası |
| `korumasizPencere.bulgular === []` | 110 dosya (bugün 8 `belirsiz` üretiyor → tarama koşuyor) | evet | mutasyon E1/E2/E3 |
| `beklemeButcesi.sizinti/ezme === []` | tüm test ağacı | evet | dosyanın kendi ters provaları |
| kapı: `kesisim === []`, `KAPI_DISI ⊂ taban` | 110/17 kayıt | evet | mevcut ters provalar |

**Dördüncü ölü iddia bulunamadı.** İki tanesi (`tsHamButonlari`,
`medusaDirectImports`) sonuç kümesi boş olduğu için ilk bakışta şüpheliydi;
ikisi de doğrudan çağrıyla sınandı ve ayırt ettikleri gösterildi.

### 2c. B-6 — `.ts` yeniden-dışavurum deliği

**Yeniden üretim.** Denetçinin sentetik kaçağı birebir kuruldu:
`src/lib/a8Kacak.tsx` (3 ham `<button>` + 2 adsız kontrol + 1 etiketsiz
overlay) → `src/lib/a8Barrel.ts` (`export * from "./a8Kacak"`) → ölçülen bir
ekranın import'u.

```
$ npx vitest run src/__guards__/{uiBaseline,sayim,mB.kacis,korumasizPencere}
  Tests  55 passed (55)        ← kaçak GEÇTİ
```

**Düzeltme.** `ithalYolunuCoz` artık `.ts` ve `/index.ts` de çözüyor;
`ulasilanModuller` `.ts` kenarlarından **geçiyor** ama `.ts`i sonuca
**katmıyor** (JSX taşıyamaz, ölçüm hedefi değildir). Böylece kapsam kapanıyor
ve taban `api/`/`hooks/`/`lib/` katmanıyla şişmiyor: **110 dosya, `fazla` = 0,
`eksik` = 0** — hiç değişmedi.

**Ters prova.** Aynı kaçakla:

```
  → expected [ 'src/lib/a8Kacak.tsx' ] to deeply equal []
  Tests  1 failed | 54 passed (55)
```

Kaçak kaldırılınca 55/55 yeşil, `git status --porcelain` temiz. Mutasyon
sürücüsünde kalıcı: **C1**.

---

## 3. Görev 3 — B-1, B-2 ve kaynak nöbetçisinin üç kör noktası

### 3a. B-1 — operatör formu (üretimde canlıydı)

Kusurun kökü A7d1'de yazılmış bir **gerekçe hatasıydı**: "bir
`DuzenlemePenceresi` tek korumalı içerik taşır, o hak oturum yönetimine
ayrılmıştır." Oysa oturum yönetiminin bekçisi kendi **iç** penceresine
kaydoluyor; dış pencerenin bekçi defteri **her zaman boştu**. Yani ayrılmış hak
hiç kullanılmıyordu ve dört alan (ad · soyad · e-posta · **şifre**) korumasızdı.

**Düzeltme sözleşmeyi eğmiyor, kullanıyor:** operatör formu kendi
`DuzenlemePenceresi`ne çıktı (`ekleYuzeyi`), `Form.*` + `zod` + `react-hook-form`
ile yazıldı ve `useYuzeyKirliFormBekcisi` **içerik bileşeninde** çağrılıyor
(A7d1 · SK-3'ün keskin kenarı). Dış pencere artık düzenlenebilir kontrol
taşımıyor — kabul testi bunu ayrıca ölçüyor.

Yan kazanç (kilitli karar): gönder düğmesi geçerlilikle kapanmıyor, doğrulama
`toast` yerine **alanda** görünüyor, gönderimde odak ilk hatalı alana taşınıyor.

### 3b. B-2 — dedektör panel içeriğini izliyor

`Dialog`ın denetimi bağımlılıksız bir `useEffect`teydi ve A7d4 bunu "her
render'da koşuyor" diye savunmuştu. Doğrusu: **`Dialog`ın KENDİ render'ında**
koşuyordu; çocuk kendi `useState`ini değiştirince `Dialog` yeniden render
edilmiyor ve denetim bir daha hiç çalışmıyordu.

Artık panel alt ağacı `MutationObserver` ile izleniyor
(`childList` + `subtree` + `disabled/readonly/type/contenteditable`
öznitelikleri). Hata gözlemci geri çağrısından **doğrudan fırlatılmıyor** —
orası React'in dışıdır ve hata sınırına ulaşmaz; duruma yazılıp **render
sırasında** fırlatılıyor, böylece mevcut sözleşme (hata sınırı yakalar, test
okur) aynen korunuyor. Gözlemci yalnız `import.meta.env.DEV` altında kuruluyor.

Yanlış pozitif riski ölçüldü: çocuğun bekçi kaydı bir `useEffect`tir ve React
18'de commit sonrası senkron akar; gözlemci geri çağrısı bir mikrogörevdir ve
ondan **sonra** koşar. "Form açıldı ama bekçisi henüz kaydolmadı" durumu
oluşmuyor — bunun testi de var (`B-1'in DOĞRU yazımı … GEÇER`).

### 3c. Kaynak nöbetçisinin üç kör noktası

Üçü de doğrudan çağrıyla **yeniden üretildi** (denetimin ölçümüyle aynı):

```
1) korumasiz={false}        -> bulgular: 0  belirsiz: 0
2) degiskene alinmis icerik -> bulgular: 0  belirsiz: 0
3) ayni dosyada 2. pencere  -> bulgular: 0  belirsiz: 0
```

Düzeltme sonrası:

```
1) korumasiz={false}        -> bulgular: 1  belirsiz: 0
2) degiskene alinmis icerik -> bulgular: 1  belirsiz: 0
3) ayni dosyada 2. pencere  -> bulgular: 0  belirsiz: 2   (sebep=atfedilemez-bekci)
```

* **(1)** `korumasiz` beyanının **değeri** okunuyor. `{false}` ve dinamik değer
  beyan sayılmaz (güvenli taraf taramaktır).
* **(2)** Aynı dosyadaki JSX değişkenleri çözülüp pencerenin içine **satır içi**
  alınıyor (çevrim koruması var).
* **(3)** Bekçi bayrağı artık dosya kapsamlı DEĞİL: bekçi ancak dosyada **tek
  pencere** varsa ona atfedilebilir. Birden çok pencerede kontrol taşıyan
  pencereler `belirsiz`e düşüyor (`sebep: "atfedilemez-bekci"`) — **sessizce
  temiz yazılmıyor** ve nöbetçinin kimlik listesi onları kırmızı yapıyor.

Aşırı sıkılaşma da ölçüldü: bekçili **tek pencereli** dosya hâlâ geçiyor
(ayrı test). Üçünün mutasyon provası: **E1 · E2 · E3**.

### 3d. Geriye dönük sınama — dördü de yakalanıyor

`korumasizIcerik.test.tsx` (12 test) dört kusurun **düzeltilmemiş hâllerini**
sentetik olarak kuruyor:

| Kusur | Şekli | Sonuç |
|---|---|---|
| **SK-4** (A7d2 · `ProductForm`) | pencere bir dosyada, alanlar başka dosyada | **yakalanıyor** ("Ürünü düzenle", "2 düzenlenebilir kontrol") |
| **SK-7** (A7d3 · `ReasonDialog`) | kendi `Dialog`ı + `textarea`, bekçi yok | **yakalanıyor** ("Sipariş iptali") |
| **SK-9** (A7d4 · `AdminAccessPage`) | rol penceresi: kod + ad + açıklama + izin kutusu | **yakalanıyor** ("Rol tanımı", "4 düzenlenebilir kontrol") |
| **B-1** (A8 · `AdminLibraries`) | pencere açıldığında 0 girdi; form SONRADAN doğuyor | **yakalanıyor** ("Oturumlar & Operatörler", "4 düzenlenebilir kontrol") |

B-1 sınaması ayrıca **iki aşamalı**: pencere açıldığı anda dedektör haklı
olarak susuyor (`hatalar` boş), "+ Operatör"e basılıp dört alan doğunca
patlıyor. Eski dedektörle bu test **kırmızı düşüyor** (mutasyon D2:
`expected [] to have a length of 1`).

Bu sınıf dört kez canlı çıktı ve dördü de elle bulundu. **Beşincisini artık
dedektör bulur** — ve bulamayacağı yazımın ne olduğu §9'da yazılı.

---

## 4. Görev 4 — iç içe ESC (B-3)

`useModalA11y` her açık pencere için `document`e ayrı bir `keydown` dinleyicisi
ekliyordu; yığın yoktu. İki pencere açıkken tek ESC **ikisinin de**
`onClose`unu çağırıyor, dıştaki (bekçi defteri boş) anında kapanıyor ve içteki
**korumalı** formun onay istemi daha görünmeden sökülüyordu.

Sözleşme `ui2/` katmanında değil **`useModalA11y`de** kuruldu ve gerekçesi
yazılı: ESC'i dinleyen katman burasıdır ve panelin dışındaki tüketici modalları
da (harita, kırpma, paylaş) aynı kancayı kullanır. Ekran başına çözülseydi her
yeni iç içe yüzeyde yeniden unutulabilirdi.

**Kural:** klavye olayını yalnız yığının **en üstündeki** pencere işler (ESC ve
Tab tuzağı birlikte). ESC en içteki pencereyi kapatır; kapanan pencere
korumalıysa onayı o pencerenin kendi `onClose`u (bekçi) sorar.

**Ters prova** (`adminKutuphaneOperator.acceptance.test.tsx`, 3 test):

| | Eski | Yeni |
|---|---|---|
| iç içe 2 pencere + tek ESC | 2 → **0** | 2 → **1** |
| kirli iç pencere + ESC | onay YOK, dıştaki de kapanıyor | **onay görünüyor**, dıştaki ayakta |
| art arda iki ESC | — | 2 → 1 → 0 (içten dışa) |

Yığın kontrolü sökülünce **5 test kırmızı** (mutasyon D3).

---

## 5. Görev 5 — kararsızlık (B-4)

### 5a. Yeniden üretim: düşüş HAYIR, kök EVET

Denetçinin beş kırmızı tohumu (7001 · 7059 · 7103 · 7137 · 7171) bu makinede
**yeşil** koştu. Bu bir çürütme değil: denetçinin suite'i 647,8 sn, benimki
~300 sn — yani makinesi yaklaşık **iki kat yavaş**. Düşüşü tekrarlamak yerine
**kökü sayıyla üretmeyi** seçtim.

Tam suite yükü altında test başına süre ölçüldü (`--reporter=json`):

| Test | Ölçülen süre | 9.000 ms'ye oran |
|---|---|---|
| `adminRezervasyonFiltre > SIRALAMA iki anahtarı TEK adımda…` | **4.459 ms** | %50 |
| `adminRezervasyonFiltre > SAYFA değişince filtre korunur` | **3.886 ms** | %43 |
| `calismaZamaniKapisi > KAPI_DISI … LibrariesMap` | **5.928 ms** | **%66** |
| aynı dosyanın diğer 12 testi | ≤ 1.604 ms | — |

İki kat yavaş bir makinede 4.459 → ~8.9 sn ve 3.886 → ~7.8 sn. **Denetçinin
gördüğü 9.000 ms aşımı budur.** Kusur bir yarış değil, ölçünün makine hızına
bağlı olmasıdır.

### 5b. `adminRezervasyonFiltre` — kaynağında küçültüldü

İki testin ikisi de 30 kayıtlık bir liste kuruyor ve **sayfa boyutu
varsayılanda (25)** kaldığı için masaüstü tablosunda 25 satır + mobil kartlarda
25 kart basıyordu. Oysa `limit` bir URL parametresidir (`filtreDisi`de yazılı,
filtre sayılmaz) ve sınanan davranışlar — sayfa değişince filtrenin korunması,
sıralamanın iki anahtarı tek adımda yazması — **sayfa boyutundan bağımsızdır**.

`?limit=5` verildi. Bütçe büyütülmedi, **ölçüm küçültüldü**. Testlerin
iddiaları harfi harfine aynı kaldı.

### 5c. `R7` — AK-8 yanlış teşhis miydi?

**Hayır, eksik teşhisti.** A7d5 rota hedeflerini statik import ederek tembel
modülün **çözümlenme maliyetini** kaldırdı; ama `React.lazy` her hâlükârda en
az bir mikrogörev geciktirir ve `findByRole` bunu **duvar saatiyle** bekler
(1000 ms). Üstelik `render(<App/>)`ın kendi maliyeti de aynı bütçeden ödeniyor.
Yani iddia hâlâ "makine yeterince hızlı mı" sorusuna bağlıydı.

Düzeltme bütçeyi büyütmüyor, **bekleyişi ortadan kaldırıyor**: tembel sınır
`act` ile akıtılıyor ve iddia eşzamanlı `getByRole` oluyor. `getBy*`ın zaman
aşımı yoktur — bu düğüm artık duvar saatinden **tamamen bağımsızdır**.

Nöbetçilik gücü korunuyor: `App.tsx`e `/ogren/kelime-kartlari` rotası geri
konunca test **26 ms'de** kırmızı düşüyor (eskiden 1000 ms bekleyip düşerdi).

### 5d. Denetimin göstermediği ÜÇÜNCÜ üye

`calismaZamaniKapisi`in `LibrariesMap` testi **5.928 ms** ile suite'in en yavaş
tek testiydi ve 9.000 ms'ye A7d5'in kapattığı ikisinden **daha yakındı**.
Denetimin tohumları onu göstermedi. Sebep bekleme değil **modül yükü**:
`LibrariesMap`/`DeliveryRouteMap`/`MapGate` üçü de `react-leaflet` + `leaflet` +
üç PNG varlığı çekiyor ve fatura, `it.each` sırası karışık tohumda değiştiği
için hangi testin önce koştuğuna göre yer değiştiriyordu. Çözüm A7d3/A7d5'in
aynısı: maliyet statik import ile **toplama evresine** taşındı.

### 5e. Kendi yazdığım testte aynı sınıfı tekrarladım

Yeni kabul testi (`adminKutuphaneOperator`) tek başına yeşilken **tam suite
altında kırmızı düştü**: `Unable to find role="button" and name "Oturumlar &
Operatörler"`. Sebep aynı: `findBy*`in 1000 ms'lik bütçesi paralel yük altında
ekranın ilk render'ı + sorgunun çözülmesi için yetmiyordu.

Bütçe büyütülmedi. Dosyadaki **bütün** `findBy*`/`waitFor` çağrıları
`act` içinde makrogörev akıtmasına çevrildi ve iddialar eşzamanlı `getBy*`
oldu (dosyada `waitFor` sayısı: **0**). Bu, §5c'nin aynı reçetesidir.

> Bunu bir başarısızlık olarak değil **ölçüm olarak** yazıyorum (kök
> CLAUDE.md §I): sınıf o kadar yaygın ki, sınıfı düzelten pakette bile bir kez
> daha üretildi.

### 5f. 20 tohum

`--sequence.shuffle` × **20 tohum**; denetçinin 12'si (7001…7171) **dahil**,
sekiz yeni tohum (8101 · 8203 · 8307 · 8419 · 8521 · 8623 · 8731 · 8837)
eklendi.

Sonuç §10'daki kapı tablosunda.

---

## 6. Görev 6 — kontrast ve tema

Ölçüm **gerçek Chrome** (headless, `--force-device-scale-factor=1`) + ham CDP.
Alet: `frontend/scripts/ip_a8_kontrast.mjs` + `scripts/probe/a8-probe.html`.
Sonda hiçbir sunucuya bağlanmaz; **canlı `ceyhandb`ye bağlanılmadı**. Ham çıktı
`docs/ip-a8/kontrast.json`, ekran görüntüleri `docs/ip-a8/kontrast-*.png`.
Tur sonunda vite (5199) ve CDP (9281) portları kapatıldı; Chrome profili silindi.

Zemin **alfa kompozisyonuyla** hesaplanıyor (koyu temanın saydam rozetleri için
şart; A7d4 · AK-3'ün sınıfı). Eşik 4,5 — ölçülen metinlerin hepsi 12–14 px,
büyük metin muafiyeti hiçbirinde geçerli değil.

### 6a. Tüm variant × iki tema (B-8)

| Öğe | Açık tema | Koyu tema | Eşik | Sonuç |
|---|---|---|---|---|
| Düğme `primary` (beyaz / indigo-600) | **6,29** | **6,29** | 4,5 | geçer |
| Düğme `secondary` | **10,35** | **14,48** | 4,5 | geçer |
| **Düğme `success`** (beyaz / **emerald-700**) | **5,48** | **5,48** | 4,5 | **düzeltildi** (önce 3,77) |
| Düğme `danger` (beyaz / rose-600) | **4,70** | **4,70** | 4,5 | geçer (marj 0,20) |
| Düğme `ghost` | **7,24** | **12,02** | 4,5 | geçer |
| Rozet `neutral` | 9,45 | 9,85 | 4,5 | geçer |
| Rozet `info` | 7,07 | 7,61 | 4,5 | geçer |
| Rozet `success` | 5,21 | 9,30 | 4,5 | geçer |
| Rozet `warning` | 6,84 | 9,66 | 4,5 | geçer |
| Rozet `danger` | 5,72 | 8,21 | 4,5 | geçer |

**Eşik altı kalan: 0.**

**`danger` (4,70) hakkında karar.** Denetim "aynı turda gözden geçirilsin"
demişti; gözden geçirildi ve **bilinçli olarak bırakıldı**. AA eşiğini geçiyor.
A6c'nin hata metnini `rose-600`dan koyulaştırma kararı farklı bir gerekçeye
dayanıyordu: hata metni 12 px, kırmızı üzerine kırmızı okunurluk bağlamı ve
"hatayı kaçırma" maliyeti. Düğme metni 14 px, beyaz üzerine dolu zemin ve
`danger` varyantı panelde yıkıcı aksiyonun **tek görsel işareti** — daha koyu
bir kırmızı onu `neutral`e yaklaştırır. Ölçüm rapora yazıldı; değiştirmek bir
tasarım kararıdır ve bu paketin işi değildir.

### 6b. Odak göstergesi (B-11)

Gerçek `Tab` tuşuyla, `:focus-visible` aktifken, geçiş (`transition`) bitene
kadar beklenerek ölçüldü — ilk turda geçiş **arası** bir renk okundu ve
sürücüye 800 ms'lik yerleşme beklemesi eklendi.

| Öğe | Tema | Önce | Sonra | Eşik (SC 1.4.11) |
|---|---|---|---|---|
| `.input` odak kenarlığı | açık | `indigo-400` → **2,85** | `indigo-500` → **4,27** | 3,0 |
| `.input` odak kenarlığı | koyu | `indigo-500` → 4,00 | 4,00 | 3,0 |

### 6c. Yerel widget şeması (B-9 / SK-6)

Dokuz widget'ı tek tek yamamak **onuncusunu davet ederdi**. Düzeltme kök öğeye
taşındı:

```css
html      { color-scheme: light; }
html.dark { color-scheme: dark;  }
```

Tarayıcının kendi çizdiği her parça (tarih/saat seçici takvimi, `number`
okları, `select` açılır listesi, kaydırma çubuğu, otomatik doldurma katmanı)
bunu miras alır. Gerçek Chrome ölçümü — `.input` sınıflı ve **çıplak** widget'lar
ayrı ayrı:

| Widget | Açık tema | Koyu tema | Düzeltme geri alınınca |
|---|---|---|---|
| `<input type="date" class="input">` | `light` | **`dark`** | `normal` |
| `<input type="number" class="input">` | `light` | **`dark`** | `normal` |
| `<input type="time">` (çıplak) | `light` | **`dark`** | `normal` |
| `<input type="datetime-local">` (çıplak) | `light` | **`dark`** | `normal` |
| `<select>` (çıplak) | `light` | **`dark`** | `normal` |

Nöbetçi: `src/__guards__/renkSemasi.test.ts` — kaynak sözleşmesi (düşük güçlü,
§C) ve **yorumu kural sanmadığı** ayrıca sınanıyor; davranış kanıtı yukarıdaki
Chrome ölçümüdür. Mutasyon **F1**.

`ClosedDays.tsx:110`daki yanlış yorum (B-15) düzeltildi ve B-9'un kökü olduğu
yazıldı.

---

## 7. Görev 7 — eşikler, yeni borç, kapanış

### 7a. Eski/yeni sayı tablosu

| Ölçüm | Eski | **Yeni** | Farkın sebebi |
|---|---|---|---|
| Kaynak: ham `<button>` | 102 | **102** | — |
| Kaynak: adsız kontrol | 7 | **7** | — |
| Kaynak: ekranda pencere durumu | 0 | **0** | `toBe(0)` **sıfırda kaldı** |
| Kaynak: etiketsiz overlay | 0 | **0** | `toBe(0)` **sıfırda kaldı** |
| Ölçüm tabanı dosya sayısı | 110 | **110** | `.ts` kapanışı taban şişirmedi |
| Kapıda mount edilen ekran | 88 | **88** | — |
| **Kapıda 403 basan ekran** | 14 (ölçülmüyordu) | **0** | B-5 · fixture gerçek izin listesi |
| **Kapıda render edilen kontrol** | 39 | **60** | **14 ekran ilk kez gerçekten render edildi** |
| Kapıda adsız kontrol | 1 | **1** | değişmedi (`ImageCropModal` kaydırağı) |
| Kontrol basan ekran (kimlik) | yoktu | **24** | yeni çıpa (B-7) |
| Kontrolsüz ekran kaydı | yoktu | **64** | yeni kayıt (B-7) |
| Zorunlu prop kaydı | yoktu | **2** | §1d |
| **Kaynak nöbetçisi: `belirsiz` pencere** | 4 | **8** | dosya kapsamlı bekçi bayrağı kalktı (+3) · B-1'in yeni penceresi (+1) |
| Kaynak nöbetçisi: `bulgular` | 0 | **0** | — |
| **`disabled` düğme kaydı** | yoktu | **62 kimlik / 77 ham çağrı yeri** (8 çağrı yeri açık borç, 7 ekran) | yeni nöbetçi (B-10); sayı kimliğe doğrulama turunda eklendi (D-1) |
| Suite | 145 dosya / 1676 test | **148 dosya / 1704 test** | +3 dosya, +28 test |

### 7b. **Yükselen sayı REGRESYON DEĞİLDİR**

Bu bölüm altı ay sonra "A8'de borç patladı" diye okunmasın diye yazılıyor.

* **39 → 60 kontrol**: yeni borç doğmadı. 14 ekran daha önce ekran yerine bir
  hata kutusu render ediyordu; artık gerçek içerikleri ölçülüyor. Bu 21 kontrol
  **hep vardı**, ölçüm onları görmüyordu. Üstelik adsız kontrol sayısı **1'de
  kaldı** — yani ilk kez ölçülen 14 ekran hiç yeni erişilebilirlik borcu
  getirmedi.
* **4 → 8 belirsiz pencere**: üçü ortak katmanda (`ConfirmDialog` ×2,
  `duzenlemeYuzeyi`) ve **hepsi zaten oradaydı**; dosya kapsamlı `bekciVar`
  bayrağı onları görünmez kılıyordu. Dördüncüsü B-1'in düzeltmesiyle doğan yeni
  (ve korumalı) penceredir. `bulgular` yine 0.
* **0 → 62 `disabled` kaydı**: hiçbiri yeni kod değil; nöbetçi yeni.

### 7c. Yeni nöbetçinin bulduğu YENİ BORÇ (7 kalem)

Gönder düğmesi nöbetçisi kurulurken kilitli kararın **yedi ihlali daha**
görünür oldu.

> **DÜZELTME (bağımsız doğrulama turu · D-1/D-2, 21 Ağustos 2026).** Bu
> paragrafın ilk hâli "hiçbiri göç eden 21 ekranda değil; hepsi kapsam dışı
> yüzeylerde" diyordu. **Yanlıştı ve ölçülerek çürütüldü:** yedi ekranın üçü
> —`ExamSessionsManager`, `store/ProductForm`, `PackingStationPage`— `ui2/`
> katmanına göç etmiş dosyalardır ve üçü de `calismaZamaniKapisi`'nin
> `DERIN_KAPI` listesinde yazılıdır. Doğrusu şudur: **göç eden dosyalarda da
> ihlal var; göç kapsamı dosya bazlıydı ve o dosyaların bu YÜZEYLERİ (varyant
> paneli, barkod okutma kutusu, satır içi özet kaydı) hiçbir dalganın kabul
> testine girmemişti.** Kapatılmama gerekçesi (aşağıda) değişmiyor; değişen
> yalnız borcun nerede durduğu.
>
> İkinci düzeltme aynı turdan: `ExamSessionsManager`'ın `!dirty` düğmesi
> `gecerlilik-borc` sınıfına yazılmıştı, oysa dosyada yanı başında *"'Kaydet'
> DEĞİŞİKLİK YOKKEN kapalıdır ve bu bir geçerlilik kapısı DEĞİLDİR"* yazıyor.
> Sınıflandırma ile kod yorumu bugün çelişiyor. Sınıf **bilinçli olarak
> `gecerlilik-borc`ta bırakıldı** (güvenli taraf: borç saymak, aklamaktan
> ucuzdur) ve çelişki merge sonrasına borç olarak yazıldı — kapatılırken ikisi
> birlikte kararlaştırılmalı.

| Yer | İfade |
|---|---|
| `ExamSessionsManager` | `!dirty` |
| `QrScanner` | `!manual.trim()` |
| `store/ProductForm` (varyant grubu) | `!newTitle.trim() \|\| !newAxis1 \|\| …` |
| `store/ProductForm` (varyant türet) | `… \|\| !value1.trim() \|\| !newBarcode.trim() \|\| …` |
| `DeliveryDriver` (etiket okut) | `!kod.trim() \|\| scanLabel.isPending` |
| `DeliveryDriver` (yönetici teslimi notu) | `busy \|\| note.trim().length < 3` |
| `DeliveryRunHandover` | `!kod.trim() \|\| scan.isPending` |
| `PackingStationPage` | `!kod.trim()` |

*(Sekiz satır, yedi ekran — `ProductForm` iki kez.)*

**Kapatılmadı ve gerekçesi:** bu paket denetim #3'ün bulgularını kapatmak için
kuruldu; bu sekiz çağrı yerinin ikisi saha ekranı (mobil, tarayıcı turu ister),
ikisi barkod okutma akışı, ikisi varyant formu — her biri kendi kabul testini
ve tarayıcı turunu gerektirir. Kapsamı buradan genişletmek, kapatılan on iki
bulgunun doğrulama kalitesini düşürürdü.

**Sessiz kalamazlar:** hepsi `gonderDugmesi.test.ts`te `gecerlilik-borc`
etiketiyle isimle yazılı ve kimlik listesi dondurulmuş — **dokuzuncusu doğduğu
gün CI kırılır**.

> **DÜZELTME (doğrulama turu · D-1).** Bu vaat ilk yazımında **eksikti** ve
> ters provayla çürütüldü: kimlik `dosya + etiket + normalize ifade` idi ve
> tarama `new Set` ile tekilleştiriyordu, yani aynı dosyaya **aynı ifadeyle**
> eklenen ikinci bir geçerlilik kapısı nöbetçiye hiç görünmüyordu
> (`PackingStationPage`e ikinci bir `<Button disabled={!kod.trim()}>` konuldu,
> dosya **8/8 yeşil** kaldı). Vaat yalnız ihlalin ŞEKLİ yeniyse doğruydu.
>
> Kapatıldı: kimliğe **çağrı sayısı** eklendi (`tabanSayimi` artık
> tekilleştirmiyor, sayıyor; `ADETLER` kaydı tekrarları dondurdu). Aynı
> mutasyon şimdi kırmızı düşüyor (`… <Button> !kod.trim(): 1` → `2`). Satır
> numarasına dönülmedi; gürültü gerekçesi hâlâ geçerli. Ölçülen fark: **62
> benzersiz kimlik / 77 ham çağrı yeri**, tekrarların hepsi `islem` sınıfında.

### 7d. Kilitli kararlar — hâlâ tutuluyor mu

| Karar | Bu paketteki etkisi |
|---|---|
| Ekranlar `@medusajs/ui`yi doğrudan import etmez | dokunulmadı; nöbetçi yeşil |
| Medusa `DataTable` alınmıyor | dokunulmadı |
| Gönder düğmesi geçerlilikle kapanmaz | **B-10 kapandı** + panel geneli nöbetçi kuruldu |
| Satır aksiyonları açık düğme | dokunulmadı |
| Kart `<button>`a sarılmaz | dokunulmadı |
| Filtreler URL'de | `adminRezervasyonFiltre` testinde `limit` **URL'den** verildi — kararın kendisini kullanıyor |
| Ekranlarda modal `useState`i yaşamaz | `AdminLibraries`ten bir `useState` daha çıktı (`acik`); metrik 0'da |

---

## 8. Açık kalan borç (kapatılmadı, gerekçesiyle)

| # | Borç | Neden kapatılmadı |
|---|---|---|
| **B-16** | Aynı sayfada iki `useUrlDurumu` örneği aynı olayda yazarsa birincinin yazdığı kayboluyor | **Bugün canlı değil** (yedi tüketicinin hepsinde tek örnek). Düzeltme `bekleyenRef`i hook örneğinden **modül düzeyine** taşımak demektir ve bu, A6c·BULGU-4'ün çözümünü yeniden tasarlamaktır — ayrı paket. Envantere bu satırla girdi. |
| **B-14** | Dala ~5,2 MB PNG + sonda dosyası | Bu paket **68 KB** daha ekliyor (2 PNG + JSON) ve o da kontrast iddiasının kanıtı. Temizlik ayrı bir commit'in işi; `.env` sızıntısı yok, üretim derlemesine girmiyor. |
| §7c | Kilitli kararın 8 açık ihlali | Yukarıda gerekçesiyle; nöbetçiye kayıtlı. |
| — | `DeliveryDriver` 4 adsız kontrol (kapsam dışı saha ekranı) | A7d4'ten devralındı, `CALISMA_ZAMANI_ADSIZ`/kaynak tabanında isimle yazılı. |

---

## 9. Doğrulayamadıklarım / dedektörün kalan sınırı

1. **B-4'ün düşüşünü kendi makinemde tekrarlayamadım.** Kökü süre ölçümüyle
   ürettim (§5a) ve düzelttim; ama "artık düşmez"in kanıtı benim 20 tohumumdur,
   denetçinin makinesinde koşulmuş değildir.
2. **Firefox / Safari.** Kontrast ve `color-scheme` yalnız Chrome'da ölçüldü.
   `color-scheme` kök bildirimi standarttır ve tarayıcılar arası taşınması
   beklenir, ama ölçülmedi.
3. **Gerçek arka uçla uçtan uca akış.** Bütün ölçümler sahte adapter/sonda
   sayfası üzerinden; hiçbir istek gerçek API'ye çıkmadı.
4. **Ekran okuyucu ile gerçek deneme.** Rol/ad/odak ölçümleri DOM ve accname
   düzeyinde kaldı.
5. **`main`e karşı A/B bundle ölçümü** yapılmadı; bu paket bundle'a anlamlı bir
   şey eklemiyor (`vite build` 32,97 sn, `index` 272,72 kB / gzip 85,15 kB —
   denetimin ölçtüğü 272,63 kB ile aynı mertebede).
6. **Dedektörün kalan kör noktası — açıkça yazıyorum.** Çalışma zamanı katmanı
   artık panel içeriğini izliyor, ama hâlâ **açılmayan bir pencereyi göremez**.
   Kaynak nöbetçisi o deliği kapatıyor ve artık aynı dosyadaki ikinci pencereyi
   de görüyor; yine de **çapraz dosyalı içerik** hakkında karar veremiyor
   (`belirsiz`, bugün 8 kayıt). İkisinin kesişimi bugün boş değil ama sıfır da
   değil: `DuzenlemePenceresi` etiketinden **başka bir adla** (takma ad,
   `React.createElement`) kurulmuş bir pencere iki katmana da görünmez. Bugün
   böyle bir yazım yok.

---

## 10. Kapı

| Kapı | Sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run lint` | **0 hata, 31 uyarı** (hepsi devralınan `jsx-a11y`) |
| `npm run build` | **geçti** (32,97 sn) |
| `npx vitest run` | **148 dosya / 1704 test — hepsi geçti** |
| `npx vitest run --sequence.shuffle` × **20 tohum** | **20/20 yeşil** |
| `node scripts/ip_a8_mutasyon.mjs` | **15/15 yakalandı**, ağaç başlangıçtaki hâlinde |
| `node scripts/ip_a8_kontrast.mjs` | **eşik altı kalan: 0** |
| `node scripts/korumasiz-pencere.mjs` | bulgular **0**, belirsiz **8** (isimle kayıtlı) |
| `node scripts/gonder-dugmesi.mjs` | **62 kimlik / 77 ham çağrı yeri**, 8'i açık borç (isimle ve adediyle kayıtlı) |

### 10a. 20 tohum

Denetçinin 12 tohumu (7001 · 7013 · 7027 · 7041 · 7059 · 7077 · 7091 · 7103 ·
7119 · 7137 · 7153 · 7171) + sekiz yeni tohum (8101 · 8203 · 8307 · 8419 ·
8521 · 8623 · 8731 · 8837).

**Sonuç: 20/20 YEŞİL.**

*(İlk 20 tohumluk koşum Görev 5 düzeltmelerinden sonra, ikinci 20 tohumluk
koşum paketin son hâlinde yapıldı; ikisi de 20/20.)*

### 10a-2. Kapının kendi koştuğu dizin — üçüncü alet kusuru

Son kapı turunda tam suite **111 dosya kırmızı** döndü ve sebep davranış
değildi: kabuk depo köküne kaymıştı ve `npx vitest` oradan koşuyordu.
Ama kırmızıyı üreten şey bu paketin kendi yeni nöbetçisiydi ve **gerçek bir
kusurdu**: `renkSemasi.test.ts` CSS'i `join(process.cwd(), "src/index.css")`
ile okuyordu, yani **koştuğu dizine bağlıydı**.

İkinci deneme daha kötüydü ve ölçülmeseydi fark edilmezdi:
`import CSS from "@/index.css?raw"` — Vite'in CSS işleyicisi devreye giriyor ve
vitest ortamında **boş dize** dönüyor (`LEN 0`). O hâliyle nöbetçi hata
vermeden **yalancı bir kaynak** üzerinde çalışırdı; `KURALLAR` boş olduğu için
iddia da kırmızı düşerdi ama sebebi hiç okunmazdı.

Üçüncü ve kalan hâl: dosya aday yollarda ARANIR (`src/index.css` ve
`frontend/src/index.css`, dört seviye yukarı) ve bulunamazsa **açıkça patlar**
(`index.css bulunamadi — nobetci olcemedi`). İki dizinden de doğrulandı.

**Bu, bu turda bulduğum üçüncü alet kusuru** ve üçü de aynı sınıftan: nöbetçi,
ölçtüğü şeyden değil koştuğu ortamdan etkileniyordu (diğer ikisi: mutasyon
A3 ve D1, §10b).

### 10b. Mutasyon provası — 15/15

Sürücü `frontend/scripts/ip_a8_mutasyon.mjs`. `git checkout --` **kullanmaz**;
ham baytlar bellekte tutulur ve aynen geri yazılır (CRLF korunur), başta ve
sonda `git status --porcelain` karşılaştırılır, mutasyondan **önce** hedef
testlerin yeşil olduğu doğrulanır.

| # | Mutasyon | Hedef nöbetçi | Sonuç |
|---|---|---|---|
| A1 | taban ekranına ham `<button>` | `rawButton <= 102` | ✓ |
| A2 | taban ekranına adsız kontrol | `adsizKontrol <= 7` | ✓ |
| A3 | pencere durumu (`useState` → `open`) | `modalDurumu === 0` | ✓ |
| A4 | etiketsiz `fixed inset-0` katmanı | `unlabeledOverlays === 0` | ✓ |
| B1 | fixture'dan izin düşürme → 403 | kapı · 403 çıpası | ✓ |
| B2 | kontrol basan ekranı susturma | kapı · kontrol kimliği | ✓ |
| C1 | `.ts` barreli üzerinden kaçak | import kapanışı | ✓ |
| D1 | operatör formunun bekçisini sökme | dedektör + kabul testi | ✓ |
| D2 | dedektörün içerik gözlemcisini sökme | geriye dönük sınama | ✓ |
| D3 | ESC yığınını sökme | iç içe ESC kabul testi | ✓ |
| E1 | `korumasiz` değerini okumama | kaynak nöbetçisi | ✓ |
| E2 | değişken içeriği çözmeme | kaynak nöbetçisi | ✓ |
| E3 | bekçi bayrağını dosya kapsamlı yapma | kaynak nöbetçisi | ✓ |
| F1 | kök `color-scheme` bildirimini silme | şema nöbetçisi | ✓ |
| F2 | gönder düğmesini geçerlilikle kapatma | gönder nöbetçisi | ✓ |

**İki mutasyon ilk yazımda kusurluydu ve kusurlu olan nöbetçi değil
mutasyondu** (kök CLAUDE.md §I gereği kayda geçiyor):

* **A3'ün ilk hâli** pencereye bağlanmayan çıplak bir `useState` ekliyordu.
  Metrik "`useState` var mı" değil "**bir durum pencerenin `open`ına akıyor
  mu**" sorusudur (A6b · Görev 4, sabit nokta hesabı) — yani nöbetçi haklı
  olarak sustu. Mutasyon `<Dialog open={…}>`a bağlanacak biçimde düzeltildi.
* **D1'in ilk hâli** bekçiye `pencereSiz: true` ekliyordu. O beyan yalnız
  beyansız-sağlayıcısız çağrının `throw`unu susturur, **bildirimi kesmez**
  (A7d2 · SK-3 tablosu: "sağlayıcı var + beyan var → geçer"). Mutasyon kancayı
  tamamen sökecek biçimde düzeltildi — B-1'in birebir şekli.

---

## 11. Denetime notlar — en riskli gördüğüm yerler

Kendi düzeltmelerimin en zayıf noktalarını sırayla yazıyorum:

1. **`MutationObserver`un maliyeti ve kapsamı (B-2).** Yalnız `DEV` altında
   kuruluyor ve `attributeFilter` ile daraltıldı, ama **her açık pencerede bir
   gözlemci** demek. Çok satırlı bir listeyi canlı güncelleyen bir pencerede
   geliştirme deneyimi yavaşlayabilir; ölçmedim. Ayrıca hata durumdan render
   sırasında fırlatılıyor: bir hata sınırı olmayan ağaçta bu, pencerenin
   **uygulamayı düşürmesi** demektir — geliştirmede istenen davranış budur ama
   üretimde `icerikKorumasiDenetle` zaten hiçbir şey yapmıyor, yani riskin
   üretim tarafı yok. **Bakılacak yer:** `Dialog.tsx`teki gözlemci efektinin
   bağımlılık dizisi (`korumaVarMi` kimliği `useCallback` ile sabit
   varsayılıyor; `DuzenlemePenceresi`de öyle, ama `DuzenlemeYuzeyi`de
   `KORUMA_VAR` sabiti).

2. **Modal yığınının modül düzeyinde olması (B-3).** `MODAL_YIGINI` bir modül
   değişkeni. Aynı testte iki ayrı React ağacı açılırsa (RTL'de mümkün) ya da
   bir pencere `unmount` yerine ağaçtan **atılırsa** temizlik efekti koşmaz ve
   yığında ölü kimlik kalır — o durumda ESC hiçbir pencereyi kapatmaz.
   Testlerde görülmedi; `cleanup` her testte koşuyor. **Bakılacak yer:**
   `useModalA11y`nin temizlik dalı ve `lastIndexOf` kullanımı.

3. **`KONTROLSUZ_EKRANLAR`'ın 64 kaydı (B-7).** Kayıt kimlikle sabit ve iki
   yönlü korunuyor, ama **gerekçe kodları elle** verildi (`kosullu` sınıfı 40+
   ekranı kapsıyor). Bir ekran gerçekten boşalırsa da sınıfı `kosullu` kalır ve
   fark edilmez. Daha güçlüsü, `kosullu` yazan her ekranın bir dal testinde
   kontrol bastığını doğrulamaktı; yapılmadı.

4. **Kaynak nöbetçisinin `pencereSayisi <= 1` kuralı (Görev 3).** Bu bir
   *sezgi*: "dosyada tek pencere varsa bekçi ona aittir." Bir dosyada tek
   pencere + **başka bir bileşenin** bekçisi varsa hâlâ yanlış aklar. Doğrusu
   bekçiyi çağıran fonksiyonla pencerenin `children`ı arasında bağ kurmaktı;
   kaynaktan güvenilir biçimde çıkarılamadığı için yapılmadı ve çalışma zamanı
   katmanına bırakıldı.

5. **`adminRezervasyonFiltre`de `limit=5` (B-4).** Testin ölçtüğü davranış sayfa
   boyutundan bağımsız, ama artık **varsayılan sayfa boyutuyla** koşan bir
   iddia kalmadı; 25 satırlık bir sayfada doğacak bir yerleşim/performans
   kusurunu bu dosya görmez.

6. **`act` akıtmasının tur sayısı (§5c, §5e).** `akit(3)` üç makrogörev turu
   demek ve bu bir **ölçüm değil seçim**. Sahte adapter anında çözüldüğü için
   bugün fazlasıyla yetiyor; ileride bir ekran zincirleme sorgu yaparsa
   sessizce yetmeyebilir ve kırmızı, "tur sayısı az" yerine "buton yok" diye
   okunur.

7. **`ZORUNLU_PROPLAR` (§1d).** İki kayıtlık küçük bir kapı, ama **bir kaçış
   yolu**: mount edilebilen ama 403 basan bir ekrana prop vermek yerine
   `ERISIM_KUTUSU_BEKLENEN`'e yazmak da mümkündü ve o, ekranı ölçümden
   çıkarırdı. Bugün orada yalnız `AccessState.tsx` var; ikinci bir giriş
   şüpheyle karşılanmalı.

---

## 12. Değişen dosyalar

**Üretim kodu (8):** `components/admin/AccessState.tsx` ·
`components/admin/ui/Button.tsx` · `components/admin/ui/Dialog.tsx` ·
`components/admin/delivery/ClosedDays.tsx` · `hooks/useModalA11y.ts` ·
`index.css` · `pages/admin/delivery/DeliveryOrdersPage.tsx` ·
`pages/dashboards/AdminLibraries.tsx`

**Nöbetçi / alet (7):** `scripts/ui-baseline-sayim.mjs` ·
`scripts/korumasiz-pencere.mjs` · `scripts/gonder-dugmesi.mjs` (yeni) ·
`scripts/ip_a8_mutasyon.mjs` (yeni) · `scripts/ip_a8_kontrast.mjs` (yeni) ·
`scripts/probe/A8Probe.tsx` + `a8-probe.html` (yeni)

**Test (7):** `__guards__/calismaZamaniKapisi.test.tsx` ·
`__guards__/kapiOlcumu.tsx` · `__guards__/korumasizPencere.test.ts` ·
`__guards__/tembelModul.test.ts` · `__guards__/gonderDugmesi.test.ts` (yeni) ·
`__guards__/renkSemasi.test.ts` (yeni) ·
`pages/dashboards/adminKutuphaneOperator.acceptance.test.tsx` (yeni) ·
`components/admin/ui2/korumasizIcerik.test.tsx` ·
`pages/admin/adminRezervasyonFiltre.acceptance.test.tsx` ·
`flashcardsKaldirildi.test.tsx`

**Fixture (1):** `test-utils/adminIzinleri.ts` (yeni)

**Bağımlılık (1):** `package.json` — `@medusajs/ui-preset` → `devDependencies`

**Belge:** `docs/denetim3-kapanis.md` (denetim raporu) · `docs/ip-a8-rapor.md` ·
`docs/ip-a8/` (kontrast ölçümü + iki ekran görüntüsü, 68 KB)
