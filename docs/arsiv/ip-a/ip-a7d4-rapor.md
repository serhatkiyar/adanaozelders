# İP-A7d4 — Kapanış dalgası: dedektör, kalan ekranlar, alet onarımı

**Taban:** `9c7df05` (A7d3) · branch `feat/medusa-ui-taban`
**Paket commit'i:** `b4d73e0` · rapor commit'i bu belgeyle
**Girdi:** `docs/arsiv/ip-a/ip-a7d3-rapor.md`, `docs/arsiv/ip-a/ip-a7d2-rapor.md`, `docs/arsiv/ip-a/ip-a6b-rapor.md`

---

## Özet

| | |
|---|---|
| **Dedektör** | iki katmanlı yazıldı (çalışma zamanı + kaynak); **üçüncü canlı kusuru CI buldu** |
| **Sözleşme kusuru** | **1** — SK-9, `AdminAccessPage`, üretimde canlıydı |
| Ekran regresyonu | 0 |
| Ortak katman eksiği | 0 (üçüncü dalga üst üste) |
| Kasıtlı davranış değişikliği | 6 |
| **Alet kusuru (kendi ürettiğim)** | **3** — hepsi bulundu, düzeltildi, ters provası yapıldı |
| Göç eden ekran | **6** |
| Yeni test | **156** (suite 1498 → 1656; parçalama +114/−1 net etki dahil) |
| Eşik | **ikisi düştü, ikisi sabit**: 104→**102** · 7→**7** · 9→**2** · 0→**0** |
| Mutasyon provası | **13/13 yakalandı** (ilk turda 11/13 — ikisi düzeltildi, aşağıda) |
| Gerçek tarayıcı | 6 ekran · 17 ekran görüntüsü · **30 kapı** · hepsi geçti |
| Karışık tohum | **6 tohum yeşil** — ama **ilk üçü KIRMIZI düştü** ve gerçek bir kusur buldu |

> **Bu paketin en önemli tek cümlesi:** dedektör yazıldı, tam suite koşuldu ve
> **hiçbir şey yakalamadı** — oysa o anda panelde canlı bir SK-4 sınıfı kusur
> duruyordu. Sebep, dedektörün sınırıydı: çalışma zamanı yalnız RENDER EDİLEN
> pencereyi görür ve o pencereyi açan bir test yoktu. Kusuru ikinci katman
> (kaynak taraması) buldu. "Dedektör var" ile "kusur CI'da görünür" aynı şey
> değil; bu paket bunu ölçtü.

---

## Görev 1 — "İçeriğim korumasız" dedektörü

### 1a. Yakalanacak sınıf ve neden mevcut nöbetçiler yetmiyor

Bir düzenleme yüzeyi kullanıcı verisi tutuyor ama kirli form bekçisine **hiç**
bağlanmamış → ×/ESC/dış tıklama yazılanı sormadan siliyor.

| | Nerede | Etki | Nasıl bulundu |
|---|---|---|---|
| **SK-4** (A7d2) | `store/ProductForm` | 25 alanlık ürün formu | **elle** |
| **SK-7** (A7d3) | `ui/ConfirmDialog → ReasonDialog` | 13 çağrı yeri | **elle** |
| **SK-9** (bu paket) | `pages/admin/AdminAccessPage` | rol kodu + adı + açıklaması + izin kutuları | **nöbetçi** |

A7d2'nin `pencereSiz` `throw`'u bu sınıfı yakalayamaz: o beyan
`useYuzeyKirliFormBekcisi` **çağrıldığında** denetlenir, buradaki kusur ise
kancanın hiç çağrılmamasıdır. Olmayan çağrının beyanı olmaz.

### 1b. Karar: İKİ katman, ve gerekçesi ölçüldü

Görev tanımı "çalışma zamanı mı statik mi, gerekçesini yaz" diyordu. Cevap
**ikisi de** ve gerekçe tahmin değil, bu pakette yapılan bir ölçüm:

**Çalışma zamanı (birincil).** `ui/Dialog` panelin **tek overlay boğazıdır**
(`etiketsiz overlay = 0` nöbetçisi bunu ayrıca tutuyor). Dialog, render
sonrası kendi panelinde düzenlenebilir kontrol arar; bulur **ve** hiçbir bekçi
kaydolmamışsa geliştirmede patlar.

* **Kusur çapraz dosyalıdır.** SK-4'te pencere `EditProductModal`, alanlar
  `ProductForm`daydı. Tek dosyaya bakan bir tarayıcı pencereyi "içinde alan
  yok" diye temiz sayardı. Çalışma zamanı ikisini birlikte görür — kullanıcı da
  birlikte görür.
* Aynı gerekçeyle A6b `adsız kontrol` kapısını kaynaktan çalışma zamanına
  taşımıştı (BULGU-1).

Sözleşme, bu turda beş kez işe yarayan desenin altıncısı — **sessiz varsayılan
→ açık beyan**:

| Panelde girdi | Bekçi kaydı | Beyan (`korumasiz`) | Sonuç |
|---|---|---|---|
| var | var | yok | geçer — doğru yazım |
| var | yok | **yok** | **geliştirmede `throw`** |
| var | yok | var | geçer — beyan edilmiş meşru kullanım |
| yok | yok | yok | geçer — onay/salt-okunur pencere |

**Kaynak taraması (ikincil) — ve neden ZORUNLU olduğu ölçüldü.**
Çalışma zamanı dedektörü yazıldıktan sonra tam suite koşuldu: **1507 testte
hiçbir şey yakalanmadı.** Aynı anda `AdminAccessPage` üretimde korumasız bir
rol formu taşıyordu. Sebep A3c'nin `Form.Control` sınırının aynısıdır:
**yalnız render edilen yüzey görülür** ve o pencereyi açan bir test yoktu.

`__guards__/korumasizPencere.test.ts` bu deliği kapatır: kaynağa bakar, render
gerektirmez, ölçüm tabanındaki **her** pencereyi görür. Kendi sınırı da açıkça
yazılı (CLAUDE.md §C — kaynak sözleşmesi DÜŞÜK GÜÇLÜDÜR): yalnız tek dosya
içini görür, SK-4'ü göremezdi.

**İkisi birbirinin kör noktasını kapatıyor; hiçbiri tek başına yeterli değil.**
Rapor bunu böyle yazıyor ve hiçbir yerde "kusur sınıfı kapandı" denmiyor.

Kaynak taraması, karar veremediği durumu **sessizce temiz saymaz**: pencere
JSX'inde büyük harfli bir bileşen varsa (alanlar başka dosyada olabilir) bulgu
`belirsiz` listesine düşer ve o liste de **kimlikle sabittir**.

Bugünkü tarama sonucu:

```
KORUMASIZ PENCERE: 0
BELİRSİZ (alanlar başka dosyada olabilir): 4
  EditProductModal:44   <DuzenlemePenceresi> [ProductForm, StockLedgerPanel]
  AdminAuditLogsPage:101 <DuzenlemePenceresi> [DetailRow, Badge, JsonBlock]
  AdminLibraries:247    <DuzenlemePenceresi> [OperatorsManager, ExamSessionsManager]
  AdminLibraries:262    <DuzenlemePenceresi> [LibraryPayoutForm]
```

Dördünün de korumasının nerede olduğu test dosyasında satır satır yazılı.

### 1c. Üç yönlü (aslında dört yönlü) ters prova

`src/components/admin/ui2/korumasizIcerik.test.tsx` — 9 test, hepsi gerçek DOM.

| Yön | İddia | Sonuç |
|---|---|---|
| (1) | girdi taşıyan + beyansız + bekçisiz pencere | **YAKALANIR** |
| (2) | aynı pencere `korumasiz` beyanıyla | GEÇER |
| (3) | bekçili pencere beyansız | GEÇER |
| **(4)** | **girdisiz pencere beyansız** | **GEÇER** |
| (4b) | yalnız `disabled`/`readonly` kontrol taşıyan pencere | GEÇER |

**Dördüncü yön görev tanımında yoktu ve testin kendisi için kritik.** Onsuz
"dedektör her pencerede patlıyor" ile "dedektör doğru pencerede patlıyor"
ayırt edilemezdi — panelde onay penceresi (`ConfirmDialog`) çok ve hepsi meşru
biçimde bekçisiz.

Ayrıca girdi sondası ayrı sınandı: `hidden`/`submit`/`button` girdi sayılmaz,
`text`/`checkbox`/`select`/`textarea`/`contenteditable` sayılır, `readonly`
sayılmaz.

### 1d. Geriye dönük sınama — SK-4 ve SK-7

İkisi de **düzeltilmeden önceki hâlleriyle sentetik olarak** yeniden üretildi
ve dedektöre verildi:

| | Yeniden üretilen şekil | Sonuç |
|---|---|---|
| **SK-7** | kendi `Dialog`ını kuran, 2000 karakterlik `textarea` taşıyan, bekçisiz `ReasonDialog` | **YAKALANDI** (mesaj pencereyi adıyla söylüyor: "Sipariş iptali") |
| **SK-4** | `DuzenlemePenceresi` içinde, kancayı hiç çağırmayan ayrı bir `ProductForm` bileşeni | **YAKALANDI** — ve bu **çapraz dosyalı** hâliyle yakalandı |

Sentetik olmaları bilinçli: gerçek dosyalar düzeltildi, geri almak bu paketin
dışındaki testleri kırardı. Dedektörün gördüğü şey zaten **şekildir** (pencere
+ girdi + kayıtsızlık), dosya adı değil.

SK-4 sınamasında mesajın "2 düzenlenebilir kontrol" dediği ayrıca iddia
ediliyor: 25 alanlık gerçek formda o sayı 25 yazar ve etkinin büyüklüğünü
gösterir.

### 1e. Dedektörün ürettiği ilk gerçek bulgu — SK-9

**`AdminAccessPage` yönetici rolü penceresi kirli form bekçisine hiç
bağlanmamıştı (ÜRETİMDE CANLI).** Pencere rol kodu, rol adı, 500 karakterlik
açıklama ve gruplanmış izin kutularını taşıyor; ×/ESC/dış tıklama hepsini
sormadan siliyordu — bir **yetki tanımının** ortasında.

İkincil bulgu (aynı ekranda): doğrulama tarayıcının `required`/`pattern`
özniteliklerine bırakılmıştı. Hata mesajı tarayıcı diline ve baloncuğuna
bağlıydı, ekran okuyucuya `aria-invalid` olarak inmiyordu, alan başına gerekçe
yazılamıyordu. `zod` + `Form.*`a geçti.

Mutasyon: **A7D4-9** (bekçi kaldırıldı → `adminYetkiGoc` kırmızı) ve
**A7D4-8** (statik tarama ham `<Dialog>`ı taramayı bırakıyor → nöbetçi
kırmızı).

---

## Görev 2 — Kırmızı matris sürücüsünün onarımı

### 2a. Kusur

A7d3 dürüstçe raporladı: `PackingStationPage`in beş testi tabana karşı
**yeşil** çıktı. İlk okuma "bu testler göçü kanıtlamıyor" oldu; yanlıştı.
Testlerin doğruladığı koruma o ekranda değil ORTAK KATMANDAYDI ve o dosya geri
alınmamıştı.

Yani sürücü **"kırmızı değil"** diyordu. Söylemesi gereken şuydu: **"bu ölçüm
eksik — testin dokunduğu değişmiş dosyaların hepsini geri almadım."**

### 2b. Onarım

1. **Kapsam denetimi.** Sürücü her test dosyasının modül grafiğini çıkarır
   (`.ts` + `.tsx`, `@/` takma adı, dinamik `import()` ve `import.meta.glob`
   dahil), tabandan bu yana değişmiş dosyalarla kesiştirir ve geri
   ALINMAYANLARI bulur. Böyle bir dosya varsa geçen testler **YEŞİL değil
   BELİRSİZ** sayılır, eksik dosyalar isimle yazılır, çıkış kodu **4** olur.
2. **`--otomatik`.** Geri alınacak kümeyi sürücü kendi türetir: testin modül
   grafiğindeki, tabandan bu yana değişmiş her üretim dosyası. "Hangi
   dosyalarda yaşıyor" sorusunu insana sormaz.

Modül grafiği AST ile değil desenle çıkarılıyor ve **gerekçesi dosyaya
yazıldı**: bu bir nöbetçi değil ölçüm aracıdır ve hata yönü güvenli taraftadır
— yorumdaki bir yol yanlışlıkla grafiğe girerse en kötü ihtimalle ölçüm
"belirsiz" işaretlenir; sessiz yeşil üretmez.

### 2c. Yalancı yeşilin artık üretilemediğinin kanıtı

A7d3'ün senaryosu **birebir yeniden koşuldu**:

```
$ node scripts/kirmizi-olcum.mjs --taban c03484b \
    --uretim src/pages/admin/packing/PackingStationPage.tsx \
    --test   src/pages/admin/packing/packingLabel.acceptance.test.tsx

testin modül grafiği: 44 dosya
tabandan bu yana değişmiş + grafikte olan: 4
  KAPSANMAYAN   src/components/admin/ui/ConfirmDialog.tsx
  KAPSANMAYAN   src/components/admin/ui/Dialog.tsx
  KAPSANMAYAN   src/components/admin/ui2/duzenlemeYuzeyi.tsx
  geri alınacak src/pages/admin/packing/PackingStationPage.tsx

KIRMIZI  0
BELİRSİZ 38
!! ÖLÇÜM EKSİK — geçen testler YEŞİL SAYILAMAZ.
   Düzeltme: --otomatik kullan ya da bu dosyaları --uretim'e ekle.
```

Eski sürücü burada "hiçbir test kırmızı değil" derdi. Yeni sürücü **eksik
dosyayı adıyla söylüyor** ve `ConfirmDialog.tsx` listenin başında.

`--otomatik` ile aynı ölçüm:

```
tabandan bu yana değişmiş + grafikte olan: 4  (dördü de geri alınacak)
KIRMIZI  5
  × ... ELLE DOĞRULA penceresinde kirli formda kapatma ÖNCE SORAR
  × ... GERİ AL penceresinde kirli formda kapatma ÖNCE SORAR
  × ... PAKETTEN VAZGEÇ penceresinde kirli formda kapatma ÖNCE SORAR
  × ... gerekçe ZORUNLUYKEN boş gönderim istek ÜRETMEZ (SK-8)
  × ... sınır üstü gerekçe GÖNDERİLEMEZ
YEŞİL   33
```

### 2d. Sürücünün bulunan sınırı (dürüstlük kaydı)

`--otomatik`, **diskten okuyan** nöbetçilerde çalışmaz. `korumasizPencere.test.ts`
üretim dosyalarını `import` etmez, `readFileSync` ile okur; modül grafiğinde
görünmezler ve sürücü haklı olarak "geri alınacak dosya yok — ölçüm hiçbir şey
kanıtlamaz" diyerek **reddeder**. Bu doğru davranıştır (sessiz yeşil yerine
açık ret), ama o testin kırmızı matrisi elle ölçülmelidir:

```
$ node scripts/kirmizi-olcum.mjs --taban HEAD \
    --uretim src/pages/admin/AdminAccessPage.tsx \
    --test   src/__guards__/korumasizPencere.test.ts
KIRMIZI  1
  × İP-A7d4 · korumasız pencere nöbetçisi ölçüm tabanında korumasız pencere YOK
```

### 2e. Bu paketin kırmızı matrisi (onarılmış sürücüyle, `--taban HEAD`, göç ÖNCESİ)

| Dosya | Toplam | Tabana karşı KIRMIZI |
|---|---|---|
| `ui2/korumasizIcerik.test.tsx` (dedektör) | 9 | **3** |
| `__guards__/korumasizPencere.test.ts` (nöbetçi) | 10 | **1** (elle ölçüldü) |
| `pages/admin/adminYetkiGoc.acceptance` | 21 | **6** |
| `pages/admin/dalga4Pencereleri.acceptance` | 11 | **1** |
| `pages/admin/delivery/ip19Filo.acceptance` · A7d4 bölümü | 4 | **0** |
| **Toplam** | **55** | **11** |

#### Düşük kırmızı sayılarının dürüst açıklaması

* **`ip19Filo` A7d4 bölümü 4/0.** Dört iddianın dördü de göçten ÖNCE de
  doğruydu: o iki ekranın penceresini zaten ortak `ConfirmDialog` çiziyordu ve
  göç `useState`i yüzeye taşımaktan ibaretti — **gözlemlenebilir davranışı
  değiştirmeyen** bir dönüşüm. Bu dosyanın değeri "göç bunları kırmadı"dır;
  ilerlemenin kanıtı eşik testi ve mutasyon **A7D4-3**'tür, bu dosya değil.
  Aynı sınıf A7d3'te `turDetayiGoc` 14/1 olarak raporlanmıştı.
* **`dalga4Pencereleri` 11/1.** Aynı sebep, artı bir istisna: tek kırmızı
  `ClosedDays`in **kilitli karar ihlali**dir (`disabled={!newDay}`), yani
  gerçekten davranış değiştiren tek madde.
* **`korumasizIcerik` 9/3.** Altı test dedektörün YANLIŞ yerde patlamadığını
  ölçüyor; dedektör yokken bunlar zaten geçiyordu. Üç kırmızı asıl iddiadır
  (yakalama + SK-4 + SK-7 geriye dönük).

---

## Görev 3 — `calismaZamaniKapisi` parçalandı

### 3a. Yapılan

88 ekranı tek `it` içinde mount eden test, **ekran başına ayrı teste** bölündü
(`it.each`). Aynı şey `KAPI_DISI` ters provası için de yapıldı (17 dosya → 17
test). Dosya **7 testten 114 teste** çıktı, sonra kapanış nöbetçileri kancaya
taşınınca **110 test + 2 kanca** oldu.

**Dosya başına `testTimeout` ezmesi KALKTI** (`120000` ve `60000`). Bu, dosyanın
`vitest.config.ts`teki "dosya başına testTimeout ezmesi YAPILMAZ" kuralının tek
istisnası olmasını sona erdiriyor.

### 3b. Önce/sonra süre

| Ölçüm | Önce | Sonra |
|---|---|---|
| Tek dosya (yalnız kendi, boşta makine) | 11,40 sn · 7 test · en yavaş **4190 ms** | 10,67 sn · 114 test · en yavaş **622 ms** |
| En yavaş testin `testTimeout`a oranı | 4190/9000 (dosya ezmesiyle 120000) | **622/9000** |
| Tam suite | 107,3 sn · 143 dosya · 1507 test | **104,7 sn** · 143 dosya · 1660 test |

Süre artışı beklenmişti; **olmadı**. Tam suite %10 daha çok test koşarken 2,6
sn kısaldı (ölçüm gürültüsü içinde: eşdeğer). Asıl kazanç süre değil teşhis:
bir ekran düştüğünde kırmızı artık **o ekranın adını** taşıyor.

### 3c. İki yönlü kimlik koruması — ve ters provası

Parçalama iki yeni sessiz daralma yolu açar; ikisi de kapatıldı:

| Yön | Nöbetçi | Mutasyon | Sonuç |
|---|---|---|---|
| listede olup ölçülmeyen | `olculenEkranlar` kimliği `KAPI_KAPSAMI`ya eşit mi | **A7D4-10** (`kapsanan.slice(0, 5)`) | **YAKALANDI** |
| kapsanıp listede olmayan | `kapı kapsamı KİMLİKLE sabittir` (mevcut) | A7D4-2 (yeni dosya borcu) | YAKALANDI |
| adsız kontrol tabanından sessiz düşüş | ekran başına `toBe(beklenen ?? 0)` | **A7D4-11** (kayıt silindi) | **YAKALANDI** |
| bayat kayıt (kapsam dışı dosya listede) | `CALISMA_ZAMANI_ADSIZ ⊆ kapsanan` | — | (yeni eklendi) |
| kapı boşa koşuyor | `toplamKontrol >= 39` | — | (korundu) |

### 3d. **Parçalamanın ürettiği GERÇEK KUSUR — karışık tohum buldu**

İlk yazımda üç kapanış nöbetçisi birer `it` idi ve **"dosya içindeki testler
bildirim sırasında koşar"** varsayımına dayanıyordu.

Varsayım yanlıştı. `--sequence.shuffle` dosya **içindeki** testleri de
karıştırıyor. Tohum **4001, 4013 ve 4027'de üçü birden kırmızı düştü**: sayaçlar
henüz doldurulmamışken koştular.

Bu, bu paketin kendi kapısında ürettiği gerçek bir kusurdur ve **normal
koşumda görünmüyordu** — yalnız karışık tohum turu gördü. (Hafızadaki kural
burada da doğrulandı: "CI'da düşüp yerelde geçen test flaky değil, zamanlama
penceresi kanıtıdır.")

Düzeltme: üç nöbetçi `afterAll`a taşındı. `afterAll` sıradan bağımsızdır.
Düzeltmeden sonra **6 tohumun 6'sı yeşil**.

Bu düzeltme ayrıca bir **alet kusurunu** görünür etti (aşağıda, 6c).

---

## Görev 4 — Kalan ekranlar

### 4a. Haritanın kendi doğrulaması

A7d3 "kalan pencere durumu küçük" demişti; harita yeniden ölçüldü:

| Dosya | pencere durumu | pencerenin türü | girdi taşıyor mu |
|---|---|---|---|
| `AdminAccessPage` | 1 | **ham `Dialog` + form** | **EVET → SK-9** |
| `DeliveryTodayPage` | 2 | `ConfirmDialog` ×2 | hayır |
| `ClosedDays` | 1 | `ConfirmDialog` | hayır (girdiler satır içi formda) |
| `DeliveryBoardPage` | 1 | `ConfirmDialog` | hayır |
| `AdminOperationsPage` | 1 | `ConfirmDialog` | hayır |
| `AdminSettingsPage` | 1 | `ReasonDialog` | evet — ama SK-7 ile **zaten korumalı** |
| `AdminDemandsPage` | 1 | `ReasonDialog` | evet — SK-7 ile korumalı |
| `ReturnQueuePage` | 1 | `ReasonDialog` | evet — SK-7 ile korumalı |

**Seçim bu haritadan türetildi, tahminden değil**: altı ekran alındı, ikisi
bilinçli bırakıldı. Kapsam görev tanımında dört ile altı ekrandı ve altısı da
alındı; kalan iki bağ aynı mekanik dönüşümdür ve metriği **sıfırlar** — ama o,
kapsamı genişletmek olurdu ve karar ürün sahibinindir.

Öncelik sırası görev tanımına uygun: pencere durumu **9 → 2**, ham buton
**104 → 102**.

### 4b. Ekran ekran önce/sonra

#### (1) `AdminAccessPage` — **SK-9, tek gerçek kusur**

| | Önce | Sonra |
|---|---|---|
| Pencere durumu | `useState<RoleDraft \| null>` | `useDuzenlemeYuzeyi` |
| Pencere | ham `Dialog` | `DuzenlemePenceresi` + bekçili içerik |
| Kirli form | **koruma YOK — veri sormadan gidiyordu** | bekçi + onay |
| Doğrulama | tarayıcı `required`/`pattern`/`minLength` | `zod` + alan başına mesaj |
| Alanlar | ham `<label><span>…` | `Form.Item`/`Label`/`Control`/`ErrorMessage` |
| Odak | yok | `onInvalid`ta ilk hatalı alana |
| Sunucu 422 | genel `toast` | alanın altına (`code`/`name`/`description`) |
| Alana düşmeyen hata | `toast` | pencere İÇİNDE `role="alert"` şeridi |
| İzin kutuları | `setDraft` ile elle | `Form` durumu — **kutu işaretlemek de kirletir** |

Son satır önemsiz değil: bir rolün asıl içeriği izin kümesidir. On kutu
işaretleyip yanlışlıkla ESC'e basan yönetici eskiden hepsini kaybederdi; testi
ayrıca yazıldı (Y-2) ve gerçek tarayıcıda ölçüldü (T4).

İçerik `key={rol?.id ?? "yeni"}` ile kuruluyor: `key` olmadan bir rolden
diğerine geçerken `useForm`un varsayılanları taşınırdı.

#### (2) `ClosedDays` — **ikinci kilitli karar ihlali**

| | Önce | Sonra |
|---|---|---|
| `seedOpen` | `useState` | `useDuzenlemeYuzeyi` |
| "Günü kapat" | **`disabled={!newDay}`** | **açık**; hata alanın altında |
| İki alan | `useState` + görünür `<span>` etiket | `Form.Field` + `Form.Label`/`ErrorMessage` |
| Sunucu hatası | yalnız `toast` | önce alana, kalanı `toast` |
| "yeniden aç" ikonu | ham `<button>` | ortak `Button` (aria-label korundu) |
| Kirli form | yok | `pencereSiz: true` beyanıyla bekçi (rota + sekme) |

`disabled={!newDay}` kilitli kararın açık ihlaliydi: gün seçmeden basan
kullanıcı düğmenin **neden** ölü olduğunu göremiyordu.

#### (3)-(6) `AdminOperationsPage` · `AdminSettingsPage` · `DeliveryBoardPage` · `DeliveryTodayPage`

Dördü de aynı mekanik dönüşüm: ekranda yaşayan `useState` → yüzeyin hedefi.
Pencere metinleri artık `yuzey.kayit`tan besleniyor. `AdminOperationsPage`in
"Yeniden dene" ham `<button>`u ortak `Button`a geçti (ikinci ham düğme).

`DeliveryTodayPage` iki bağ taşıyordu (istisna kuyruğu + günü optimize et);
ikisi de ayrı yüzeylere taşındı — tek birleşik yüzey hangi pencerenin hangi
hedefe ait olduğunu tipten silerdi (A7d3'ün `PackingStationPage` kararı).

### 4c. Zorunlu ikili — ekran ekran

| Ekran | Kirli formda kapatma önce sorar | Tüm koşullu dallar + alan adları |
|---|---|---|
| `AdminAccessPage` | ✔ Y-2 (metin **ve** izin kutusu) | ✔ Y-3 (yeni/düzenleme dalları, `adsizKontroller = []`) |
| `ClosedDays` | pencere onay penceresidir → **pencere ortak yüzeyden** (D4-1) + satır içi forma `pencereSiz` bekçi | ✔ D4-1 (yönetici formu / salt-okunur dal) |
| `AdminSettingsPage` | ✔ D4-3 (gerekçe alanı gerçek metin taşıyor) | ✔ D4-3 (yönetme izni var/yok dalı) |
| `AdminOperationsPage` | **uygulanmaz** — onay penceresi, içinde yazılan yok → D4-2 pencerenin ortak yüzeyden geldiğini ölçer | mevcut `adminOperations.acceptance` (dört dal) |
| `DeliveryTodayPage` | **uygulanmaz** (aynı) → `ip19Filo` A7d4 bölümü | ✔ `ip19Filo` (istisna kuyruğu + tur listesi dalları) |
| `DeliveryBoardPage` | **uygulanmaz** (aynı) → `ip19Filo` A7d4 bölümü | ✔ `ip19Filo` (havuz + tur dalları) |

"Uygulanmaz" gevşetme değil: `ConfirmDialog`ta yazılan bir şey yoktur ve bekçi
orada anlamsız bir soru üretirdi — A7d3'ün `ConfirmDialog` kararı, A7d3'ün
`DeliveryRunDetailPage` için yazdığı T-3'ün aynısı.

### 4d. Dört kategori — AYRI AYRI sayılmış

**A. Sözleşme kusurları — 1**

**SK-9 · `AdminAccessPage` kirli form bekçisini HİÇ çağırmıyordu (ÜRETİMDE
CANLI).** Yukarıda 1e'de. Mutasyon A7D4-9.

**B. Ortak katmanda eksik (kusur değil, sınır) — 0**

Üçüncü dalga üst üste. Altı ekranın hiçbiri "bunu ortak katman yapamıyor"
demedi. Tersine: bu paketin ana işi (dedektör) ortak katmana **eklendi** ve
altı ekranın hiçbiri değişmek zorunda kalmadı.

**C. Ekran regresyonu — 0**

A7d2'nin C-1'i (satır içi formlarda odak `<body>`ye düşüyordu) tekrarlamadı;
gerçek tarayıcı ölçtü (odak `Rol kodu` alanında, `aria-invalid="true"`,
`pencereIcinde: true`, iki temada da).

**D. Kasıtlı davranış değişikliği — 6**

| # | Değişiklik | Neden |
|---|---|---|
| 1 | Rol formunun doğrulaması tarayıcıdan alana taşındı | A2'den beri yazılı sözleşme; tarayıcı baloncuğu ekran okuyucuya inmiyor |
| 2 | "Günü kapat" geçerlilikle kapanmıyor | Kilitli kararın açık ihlaliydi |
| 3 | Rol kodu alanına "sonradan değiştirilemez" ipucu eklendi | Alan yalnız oluşturmada var; sebebi görünür değildi |
| 4 | Rol açıklaması "isteğe bağlı" işaretlendi | Şema zaten öyleydi; etiket söylemiyordu |
| 5 | Sunucu 422'si alan altına, 500'ü pencere içi şeride | A7d1'den beri yazılı sözleşme |
| 6 | `ClosedDays` sunucu hatası önce alana denenir | Aynı sözleşme |

**E. Alet kusuru (bu paketin kendi ürettiği) — 3**

Ayrı sayılıyor çünkü üçü de ölçüm aracının kendisindeydi ve üçü de **yalancı
yeşil üretebilirdi**:

| # | Kusur | Nasıl bulundu | Düzeltme |
|---|---|---|---|
| AK-1 | Parçalanmış kapının kapanış nöbetçileri bildirim sırasına bağlıydı | **karışık tohum 4001/4013/4027** | `afterAll` |
| AK-2 | Mutasyon sürücüsü vitest **kanca** hatasını görmüyordu ("×" arıyordu) | A7D4-10 "YAKALANMADI" çıktı | özet satırları da okunuyor + frontend **yeşil taban kapısı** eklendi |
| AK-3 | Tarayıcı sondası hata kontrastını **yanlış öğede** ölçüyordu (pencerenin açıklama paragrafı desene uyuyordu) | ölçüm çıktısı okunurken | `[role="alert"]` ile hedeflendi |

AK-3 kayda değer: sonda "kontrast 4,76 · geçti" diyordu ve **hata renginin
kontrastı hiç ölçülmemişti**. Düzeltmeden sonra gerçek ölçüm: açık 6,29 · koyu
6,63.

### 4e. Kalan 7 adsız kontrolün kapsam dışı gerekçesi — teyit

Görev tanımının istediği teyit. Yeniden ölçüldü ve **üçünün de gerekçesi
geçerli**:

| Dosya | Adet | Ne | Neden kapsam dışı |
|---|---|---|---|
| `pages/DeliveryDriver.tsx` | 4 | saha ekranı girdileri | **Panel değil, saha ekranı**: tam ekran, tek elle kullanım, kamera, OTP, offline dayanıklılık. Panel sözleşmesini oraya taşımak göç değil **yeniden tasarımdır** ve kendi kabul matrisini ister. |
| `components/PersonalizeModal.tsx` | 2 | tema/pano tercih anahtarları | **Paylaşılan widget**, form değil; kendi tasarım sözleşmesi var |
| `components/ImageCropModal.tsx` | 1 | yakınlaştırma kaydırağı (`type=range`) | **Kırpma tuvalinin kendi denetimi**; ortak `Button`/`Form` dili oraya uymuyor |

Üçü de A7d3'ten devralınan gerekçelerdir ve bu pakette **değişmedi**. Panelin
göç edilebilir yüzeyinde adsız kontrol sayısı **sıfır** (çalışma zamanı kapısı
tabanı: yalnız `ImageCropModal` 1).

---

## Görev 5 — Gerçek tarayıcı turu

Sonda: `frontend/scripts/ip_a7d4_tur.mjs` + `scripts/probe/A7d4Probe.tsx`
(Chrome + CDP, headless). Ölçüm: `docs/arsiv/ip-a/ip-a7d4/tur-olcum.json`, **17 ekran
görüntüsü** aynı klasörde. **30 kapı, hepsi geçti.**

**Canlı `ceyhandb`ye bağlanılmadı**; sonda axios adapter'ını kendi sahte
sunucusuyla değiştirir, veriler uydurmadır ve gerçek kişisel veri içermez.
**Tur bitince vite (5199) ve CDP (9294) portları kapatıldı ve ayrı ayrı
doğrulandı** (`netstat`: ikisi de LISTENING değil).

### 5a. Hangi ekrana hangi tur ve NEDEN

| Ekran | Tur | Gerekçe |
|---|---|---|
| `yetki` | **TAM** (2 tema × 2 genişlik + 6 etkileşim ölçümü) | Bu dalganın **tek yeni yazımı**: pencere içinde `Form.*` formu + gruplanmış izin kutusu ızgarası (`fieldset`/`legend`). SK-9'un gerçek tarayıcı kanıtı da burada. |
| `takvim` | **TAM** | Satır içi form + **`type="date"`**: koyu temada yerel widget şeması (SK-6 sınıfı) bu dalgada YALNIZ burada ölçülebilir. Ayrıca kilitli karar düzeltmesi. |
| `ayarlar` · `operasyon` · `bugun` · `tahta` | **KISA** (mobil 380 + koyu) | Göçleri **mekaniktir** (`useState` → yüzey); pencerelerini zaten ortak `ConfirmDialog`/`ReasonDialog` çiziyordu ve o yazım A7d1-A7d3'te tam turdan geçti. Burada ölçülen yeni bir yazım değil, mobil düzen ve pencerenin gerçekten açılıp kapanması. |

### 5b. Ölçülenler

**Mobil (380 px) ve masaüstü (1280 px).** Altı ekranın altısında da, iki
temada da **yatay taşma YOK** (`tasmaPiksel: 0`), **iç içe `<button>` 0** ve
**adsız kontrol 0**. En küçük dokunma hedefi her ekranda **36 px**.

**Koyu temada yerel widget şeması.** `takvim`in `type="date"` kutusu:
`colorScheme: "dark"`, erişilebilir adı `"Kapatılacak gün"`. (SK-6'nın bu
dalgadaki tek bağlamı; ortak `.input` sınıfı kullanıldığı için düzeltme
zaten uygulanıyordu — ölçüm bunu doğruladı, yeni bir kusur çıkmadı.)

**Odak tuzağı (gerçek klavye).** "Yeni rol" düğmesi odaklanıp `Enter` ile
pencere açıldı: 16 `Tab` boyunca odak **pencereden çıkmadı**, `Shift+Tab`
pencere içinde kaldı, `Escape` kapattı ve **odak açan düğmeye iade edildi**
(`acanaDondu: true`).

**SK-9'un gerçek tarayıcı kanıtı.** `Rol adı` alanına yazıldı, `Escape`:
"Kaydedilmemiş değişiklikler var" çıktı ve editör ayakta kaldı. **İzin
kutusuyla da ayrı ölçüldü** (`kutuKirletti: true`).

**Gönderim → odak + kontrast.** Boş formda "Kaydet":

| | Değer |
|---|---|
| Gönder düğmesi | bulundu, **`disabled: false`** (kilitli karar) |
| Odak | `Rol kodu`, `aria-invalid="true"`, **pencere içinde** |

| Tema | Hata rengi | Kontrast | Eşik |
|---|---|---|---|
| açık | `rgb(190,18,60)` | **6,29** | 4,5 |
| koyu | `rgb(251,113,133)` | **6,63** | 4,5 |

**Takvimde kilitli karar.** "Günü kapat" `disabled: false`; boş gönderimde
"Kapatılacak günü seçin." **alanda** çıktı.

**Onay pencereleri.** `operasyon`, `bugun`, `tahta`: üçünde de pencere açıldı
(başlıklarıyla) ve `Escape` kapattı.

### 5c. Sondanın kendi kusuru (AK-3)

İlk koşumda kontrast sondası `role="alert"` yerine metin desenine bakıyordu ve
pencerenin **açıklama paragrafını** ("İzinler en az yetki ilkesine göre
seçilmelidir.") ölçüyordu — yani "geçti" diyordu ama ölçtüğü şey hata rengi
değildi. Sonda kendi yalancı yeşilini üretmişti. Düzeltildi ve gerekçesi
dosyaya yazıldı.

Ayrıca `dugmeyeBas` **tam metin eşleşmesi** yapıyordu; "Günü Optimize Et"
düğmesi yanında bir sayaç rozeti taşıdığı için hiç bulunamıyor, sonda sessizce
ilerliyordu. Önek eşleşmesine çevrildi **ve** kapalı düğmede açık hata
döndürüyor.

---

## Görev 6 — Eşikler, mutasyon, kapanış envanteri

### 6a. Eşikler

| Ölçüm | A7d3 (eski) | **A7d4 (yeni)** | Fark |
|---|---|---|---|
| ham `<button` | 104 | **102** | −2 |
| adsız form kontrolü (kaynak) | 7 | **7** | **0 — düşmedi** |
| ekranda yaşayan pencere durumu | 9 | **2** | **−7** |
| etiketsiz overlay | 0 | **0** (`toBe(0)`) | 0 — **sıfırda kaldı** |
| ölçüm tabanı dosya sayısı | 109 | **110** | +1 (`ui2/icerikKorumasi.ts`) |

**Adsız kontrol neden DÜŞMEDİ.** Kalan 7'nin tamamı kapsam dışı üç dosyada
(4e). Bu dalganın altı ekranında adsız kontrol zaten sıfırdı — düşürecek borç
yoktu. "0 düştü" yazmak dürüst olan; sahte ilerleme üretmemek için eşik
7'de bırakıldı.

**Ham buton neden yalnız −2.** Kalan 102'nin dağılımı A7d3'te isimle yazıldı ve
değişmedi: 41'i saha ekranı + üç paylaşılan widget, ~55'i kabuk bileşenlerinin
kendi iç denetimleri, 5'i `aria-pressed` taşıyan seçim çipleri. Bu metrik
sıfıra **inmeyecek ve inmemeli**; doğru kapanış hedefi "kalanın her biri isimle
ve gerekçesiyle yazılı" olmasıdır.

**Pencere durumu 2.** Kalan iki bağ `AdminDemandsPage` ve `ReturnQueuePage`de;
ikisi de `ReasonDialog` (SK-7 ile zaten korumalı) ve ikisi de aynı mekanik
dönüşümdür. Metrik bir sonraki küçük adımda **sıfırlanabilir** ve `toBe(0)`
hâline getirilebilir — overlay metriğinin bugünkü hâli gibi.

### 6b. Mutasyon provası — **13/13 yakalandı**

Sürücü: ortak `backend/scripts/mutation_drill.py`. `git checkout` kullanmaz,
ham baytları bellekte tutar, her mutasyondan sonra HEAD + `git status
--porcelain` eşitliğini doğrular, CRLF korunur. Paket **önce commit edildi**
(`b4d73e0`), prova temiz ağaçta koşuldu.

> `--allow-dirty` kullanıldı ve gerekçesi: depo kökünde bu dallarda **izlenmeyen**
> prompt/script dosyaları duruyor (`ip-a*-prompt.md`, `borderscan.mjs`,
> `sayim.sh`) ve sürücü onları "kirli ağaç" sayıyor. Hiçbir mutasyon o
> dosyalara dokunmuyor; asıl koruma olan **başta/sonda `git status` eşitliği**
> her mutasyonda doğrulandı ve on üçünde de tuttu.

| # | Mutasyon | Kırılan |
|---|---|---|
| A7D4-1 | ham `<button>` geri kondu (102→103) | eşik testi |
| A7D4-2 | adsız form kontrolü eklendi (7→8) | kaynak eşiği **+ çalışma zamanı kapısı** |
| A7D4-3 | pencere durumu ekrana geri taşındı (2→3) | sayı eşiği + dosya listesi |
| A7D4-4 | etiketsiz overlay geri kondu (0→1) | sayı eşiği + dosya listesi |
| **A7D4-5** | **dedektör: `Dialog` denetimi hiç çağrılmıyor** | `korumasizIcerik` |
| **A7D4-6** | **dedektör: girdi sondası hiçbir kontrol görmüyor** | `korumasizIcerik` |
| **A7D4-7** | **dedektör: pencere HER ZAMAN "korumalıyım" diyor** | `korumasizIcerik` |
| **A7D4-8** | **statik tarama ham `<Dialog>`ı taramayı bıraktı** | `korumasizPencere` |
| **A7D4-9** | **SK-9 geri: rol penceresinin bekçisi kaldırıldı** | `adminYetkiGoc` |
| **A7D4-10** | **parçalanmış kapı sessizce daraltıldı (ilk 5 ekran)** | `calismaZamaniKapisi` (kanca) |
| A7D4-11 | adsız kontrol tabanından bir kayıt silindi | `calismaZamaniKapisi` |
| A7D4-12 | takvimde "Günü kapat" yine geçerlilikle kapanıyor | `dalga4Pencereleri` |
| A7D4-13 | rol penceresinde "Kaydet" yine geçerlilikle kapanıyor | `adminYetkiGoc` |

#### İlk turda İKİSİ YAKALANMADI — ve ikisi de testin değil, ALETİN kusuruydu

**A7D4-3.** İlk yazım yalnız bir `useState` bildiriyordu. Sayaç ise "ekranda
yaşayan pencere durumu"nu bir bildirim olarak değil, o durumun bir pencerenin
`open` prop'una **AKMASI** olarak ölçüyor — yani mutasyon metriğin ölçtüğü
şeyi hiç üretmemişti. **A7d3'te A7D3-3 ile tam olarak aynı tuzağa düşülmüştü.**
Mutasyon `open={secili !== null || yuzey.acik}` ek yamasıyla yeniden yazıldı →
yakalandı. Kayda geçiyor çünkü "yakalanmadı" sonucunu testin kusuru sanmak yine
kolay bir hataydı.

**A7D4-10.** Sürücünün frontend tarafı kırılmayı yalnız **"×" işaretli
satırlarda** arıyordu. Bir `afterAll` kancasında düşen iddia vitest çıktısında
"×" üretmez; "Test Files 1 failed" / "Unhandled Error" olarak görünür. Yani
sürücü **gerçek bir kırılmayı görmüyordu** (AK-2).

Düzeltme iki parçalı ve ikincisi bilinçli:

1. `_kirilanlar` artık "×" yoksa özet satırlarını da okuyor.
2. **Frontend için YEŞİL TABAN KAPISI eklendi** (eski sınır: TB-45). Duyarlılığı
   taban kapısı olmadan artırmak yanlış yönde risktir: zaten kırık bir vitest
   dosyası mutasyon altında da kırık kalır ve "YAKALANDI" sayılırdı. Artık
   sürücü mutasyondan ÖNCE hedef testleri koşuyor ve yeşil değilse provayı
   geçersiz sayıyor — backend tarafında İP-21'de kapatılan kapının frontend
   karşılığı.

Bu ikinci düzeltme **ortak aracı değiştirir**: bundan sonraki bütün frontend
provaları taban ölçümüyle koşacak. On üç mutasyonun on üçünde de
`yeşil taban çizgisi: EVET`.

### 6c. Kapı

| Kapı | Sonuç |
|---|---|
| `tsc -b` | temiz |
| `npm run build` | başarılı (34,4 sn) |
| `npm run lint` | **0 hata**, 31 uyarı (hepsi bu paketin dışında; A7d3 tabanıyla aynı) |
| Tam suite | **1656/1656**, 143 dosya, ~105 sn |
| Karışık tohum | **6 tohum yeşil** (4001·4013·4027·4041·4055·4069) |
| Mutasyon | **13/13** |
| Gerçek tarayıcı | 30 kapı geçti; vite + CDP portları kapatıldı ve doğrulandı |
| Çalışma ağacı | mutasyon provası başta ve sonda AYNI |

### 6d. Test türleri (dürüst sınıflandırma)

| Tür | Sayı |
|---|---|
| Gerçek DOM + gerçek axios örneği (kabul) | 36 (`adminYetkiGoc` 21, `dalga4Pencereleri` 11, `ip19Filo` A7d4 4) |
| Gerçek DOM (ortak bileşen sözleşmesi) | 9 (`korumasizIcerik`) |
| Gerçek DOM (çalışma zamanı kapısı, parçalanmış) | 110 test + 2 kanca |
| Kaynak/AST sözleşmesi (nöbetçi) | 10 (`korumasizPencere`) + mevcut eşikler |
| Gerçek tarayıcı (Chrome + CDP) | 1 tur · 6 ekran · 17 ekran görüntüsü · 30 kapı |

Snapshot yok, "import oldu" testi yok, "render oldu" testi yok.

---

## KAPANIŞ ENVANTERİ — denetim #3'ün girdisi

> Denetçinin ilk okuyacağı belge budur.

### E1. Kalan borcun tamamı: ne kaldı, nerede, **neden**

#### E1.1 — Kapatılabilir ama bilinçli bırakılan (küçük)

| Kalem | Yer | Neden kaldı |
|---|---|---|
| Pencere durumu **2** | `AdminDemandsPage` (1), `ReturnQueuePage` (1) | Paketin kapsamı 4-6 ekrandı, altısı alındı. İkisi de `ReasonDialog` (SK-7 ile **zaten korumalı**) ve aynı mekanik dönüşüm. Metriği sıfırlar; kapsamı genişletmek ürün sahibinin kararı. |
| `OperatorLibrary`nin `Form.*`a tam geçişi | `pages/dashboards/OperatorLibrary.tsx` | A7d3'te kapsam kararıyla ertelendi: yedi kardeş bölümün altısı aynı yerel-durum idiomunda; tek bölümü çevirmek aynı ekranda iki form yazımı üretirdi. Alan adları ve hata görünürlüğü çözüldü, **doğrulama hâlâ sunucuya bırakılıyor**. |

#### E1.2 — Sıfırlanamayan kalemler ve NEDEN

| Kalem | Sayı | Neden kalıyor |
|---|---|---|
| `pages/DeliveryDriver.tsx` | 19 ham düğme + 4 adsız | **Panel değil, saha ekranı.** Tam ekran, tek elle kullanım, kamera, OTP, offline. Panel sözleşmesini oraya taşımak göç değil yeniden tasarımdır. |
| `MapPicker` · `PersonalizeModal` · `ImageCropModal` | 22 ham düğme + 3 adsız | **Paylaşılan widget'lar**, ekran değil. Ham düğmeleri kendi tuvallerinin denetimleridir. |
| Kabuk/görünüm bileşenleri | ~55 ham düğme | `DashboardShell`, `AdminLayout`, `NotificationsBell`, `ShareButton`, `DataTable`, `Dialog`, `Button`in kendisi… iç denetimler; ortak `Button`a çevirmek döngüsel ya da anlamsız. |
| `aria-pressed` seçim çipleri | 5 ham düğme | Dört dalgadır tutarlı bilinçli istisna: aksiyon değil seçim durumu. |

#### E1.3 — Bilinen teknik borç kayıtları

* **TB-45 (frontend yarısı) — KAPANDI.** Mutasyon sürücüsünün frontend
  tarafında yeşil taban kapısı yoktu; bu pakette eklendi (6b).
* `docs/teknik-borc.md`e bu paketten yeni kalem **eklenmedi**; kalan borç
  yukarıdaki tablolarda isimle ve gerekçesiyle yazılı.

### E2. Bu tur boyunca bulunan TÜM sözleşme kusurları

| # | Paket | Nerede | Canlı mıydı | Nasıl kapatıldı | Dedektörü var mı |
|---|---|---|---|---|---|
| SK-1 | A7d1 | `AdminAuditLogsPage` — prop olarak inen pencere durumu | **EVET** | düzenleme yüzeyine taşındı | eşik + dosya listesi |
| SK-2 | A7d1 | `AdminBookingsPage` — süzgeç `useState`te | hayır (davranış) | `useUrlDurumu` | kabul testi |
| SK-3 | A7d1 | `useYuzeyKirliFormBekcisi` pencere DIŞINDA çağrılabiliyordu | **EVET** (sessiz veri kaybı) | A7d2'de `pencereSiz` beyanı + geliştirmede `throw` | **evet** (`sk3Beyani.test.tsx`) |
| SK-4 | A7d2 | `store/ProductForm` bekçiyi HİÇ çağırmıyordu | **EVET** | bekçi bağlandı | **evet — bu paket** (çalışma zamanı; geriye dönük sınandı) |
| SK-5 | A7d2 | `AdminPayoutsPage` gönder düğmesi geçerlilikle kapanıyordu | evet (kullanılabilirlik) | düğme açıldı, hata alana | kabul testi + mutasyon |
| SK-6 | A6c/A7d3 | koyu temada yerel widget şeması (`color-scheme`) | **EVET** (görsel) | ortak `.input` + ekran başına `dark:[color-scheme:dark]` | **tarayıcı turu** (her dalgada ölçülüyor) |
| SK-7 | A7d3 | `ReasonDialog` bekçiyi HİÇ çağırmıyordu — **13 çağrı yeri** | **EVET** | ortak katmanda bekçi | **evet — bu paket** (çalışma zamanı; geriye dönük sınandı) |
| SK-8 | A7d3 | `ReasonDialog` gönder düğmesi geçerlilikle kapanıyordu — 13 çağrı yeri | evet (kullanılabilirlik) | düğme açıldı | `gerekcePenceresi` + mutasyon |
| **SK-9** | **A7d4** | **`AdminAccessPage` bekçiyi HİÇ çağırmıyordu** | **EVET** | bekçi + `Form.*` göçü | **evet — kaynak nöbetçisi bunu BULDU** |

**Sınıf bazında:** SK-4 / SK-7 / SK-9 aynı sınıftır (üçü de canlıydı). İlk
ikisi elle bulundu; **üçüncüyü nöbetçi buldu.** Sınıfın dedektörü artık iki
katmanlı ve her ikisinin de mutasyon provası var (A7D4-5…8).

### E3. Bilinen sınırlar — birleştirilmiş, güncel

1. **Çalışma zamanı dedektörü yalnız RENDER EDİLEN pencereyi görür.** Ölçüldü:
   tam suite'te sıfır bulgu üretirken canlı bir kusur duruyordu. Kaynak
   nöbetçisi bu deliği kapatıyor.
2. **Kaynak nöbetçisi yalnız TEK DOSYA içini görür.** SK-4'ü göremezdi. Çapraz
   dosyalı pencereler `belirsiz` listesinde ve o liste kimlikle sabit —
   dördünün de korumasının nerede olduğu elle doğrulanmış durumda, otomatik
   değil.
3. **`ConfirmDialog` bilinçli olarak bekçisiz.** İçinde yazılan bir şey yok;
   dedektör de onu (haklı olarak) görmez.
4. **`OperatorLibrary` yalnız etiketlendi, `Form.*`a geçmedi** (A7d3'ten
   devam). Doğrulama sunucuya bırakılıyor.
5. **Kontrast ve `color-scheme` yalnız Chrome'da ölçüldü.** Firefox/Safari
   yerel widget'ları farklı çizebilir.
6. **`useUrlDurumu`nun "aynı olayda iki yazım" yolu** (A6c · BULGU-4) bu
   pakette de yeni bir yazımla sınanmadı — A7d1'den beri devam eden sınır.
7. **Kırmızı matris sürücüsü diskten okuyan nöbetçilerde `--otomatik`
   çalışmaz** (2d). Reddediyor, sessiz geçmiyor; elle ölçüm gerekiyor.
8. **`--taban` verilmezse kırmızı matris yanıltıcıdır** (commit sonrası HEAD
   zaten göç etmiş hâlidir). Varsayılan hâlâ `HEAD` ve tuzak dosyanın içinde
   yazılı.
9. **`operator-kutuphanem`in 28 px'lik olanak çipi** panelin en küçük dokunma
   hedefi (A7d3'te ölçüldü). WCAG 2.2 asgarisini (24 px) geçiyor.
10. **Mutasyon sürücüsü `--allow-dirty` ile koşuldu** (6b): depo kökündeki
    izlenmeyen prompt dosyaları yüzünden. Asıl koruma (başta/sonda `git status`
    eşitliği) her mutasyonda doğrulandı.

### E4. Kilitli kararların son hâli

| Karar | Durum |
|---|---|
| Ekranlar `@medusajs/ui`den doğrudan import etmez | **tutuluyor** (nöbetçi: `medusaDirectImports = []`) |
| Medusa'nın `DataTable`ı alınmıyor | tutuluyor |
| Gönder düğmesi geçerlilikle kapanmaz | **tutuluyor** — bu pakette iki ihlal daha kapatıldı (`ClosedDays`, rol penceresi); mutasyon A7D4-12/13 |
| Satır aksiyonları açık düğme kalır | tutuluyor |
| Alan hataları alanda, form geneli/sunucu hataları şeritte | tutuluyor (Y-4) |
| Ekranlarda modal `useState`i yaşamaz | **9 → 2**; kalan ikisi isimle yazılı |
| `renderMobileRow` korunur | tutuluyor |
| Filtreler URL'de | bu pakette yeni süzgeç doğmadı |
| Kart `<button>`a sarılmaz | tutuluyor (iç içe `<button>` = 0, tarayıcıda ölçüldü) |
| `onRowClick` verilince erişilebilir ad çağırandan gelir | tutuluyor |

### E5. Nöbetçi eşiklerinin tam listesi ve her birinin ne koruduğu

| Nöbetçi | Değer | Ne koruyor | Mutasyonu |
|---|---|---|---|
| `rawButton <= 102` | 102 | ham `<button>` borcunun sessizce büyümesi | A7D4-1 |
| `adsizKontrol <= 7` | 7 | kaynakta yazılı adsız kontrol borcu (TEŞHİS; doğruluk kaynağı değil) | A7D4-2 |
| `modalDurumu <= 2` | 2 | ekranda yaşayan pencere durumu | A7D4-3 |
| `modalDurumDosyalari` kimlik | 2 dosya | borcun yayılması (sayı sabit kalarak yer değiştirme) | A7D4-3 |
| `unlabeledOverlays === 0` | **0** | etiketsiz overlay — tavan değil **TABAN** | A7D4-4 |
| `overlayOffenders` kimlik | boş | aynı, dosya bazında | A7D4-4 |
| `OLCUM_TABANI` kimlik (3 test) | 110 dosya | ölçüm tabanının kendisi (dosya taşıyarak eşik düşürme) | — (A5'te kuruldu) |
| `medusaDirectImports === []` | 0 | ekranların Medusa'yı doğrudan import etmesi | — |
| `tsHamButonlari() === []` | 0 | `.ts` içinde `createElement("button")` kaçağı | — (A6b) |
| **`korumasizPencere` bulgular** | **0** | **korumasız pencere (SK-4/7/9 sınıfı), render gerekmeden** | **A7D4-8** |
| **`korumasizPencere` belirsiz** | 4 dosya, kimlik | çapraz dosyalı pencerelerin sessizce büyümesi | — |
| **`korumasizIcerik` (9 test)** | — | **dedektörün kendisi: yakalar, yanlış yerde patlamaz** | **A7D4-5/6/7** |
| `calismaZamaniKapisi` kapsam kimliği | 88 ekran | kapının sessizce daralması (iki yön) | **A7D4-10** |
| `CALISMA_ZAMANI_ADSIZ` kimlik | 1 dosya | render edilen adsız kontrol borcu (iki yön) | **A7D4-11** |
| `toplamKontrol >= 39` | 39 | kapının boşa koşması | — |
| `KAPI_DISI` gerekçe ters provası | 17 dosya | mount edilebilen ekranı kapı dışına park etme | — |
| `sk3Beyani` (3 test) | — | pencere dışında çağrılan bekçi (SK-3) | A7D2 turu |
| `gerekcePenceresi` (17 test) | — | SK-7 + SK-8 (13 çağrı yeri) | A7D3-5/6 |

---

## Denetim #3'e notlar — savunmalar değil, **şüpheler**

Bu kodu en iyi bilen oturum benim. Aşağıdakiler kendi kararlarımın savunması
değil; **nereye bakılması gerektiğinin** listesi.

### N1. En çok şüphelendiğim yer: dedektörün `Dialog`ta yaşaması

Denetimi `ui/Dialog`ın `useEffect`ine koydum ve **bağımlılık dizisi vermedim**
(her render'da koşuyor). Gerekçem "çocuk efektleri ebeveyn efektinden önce
koşar, yani kayıt tazedir". Bu React'in belgelenmiş sırasıdır ama:

* **`Suspense`/`lazy` sınırlarında** ya da içerik bir sonraki tikte kaydolan
  bir yazımda ne olur, sınamadım. Yanlış pozitif geliştirmede `throw` demektir
  ve bu ekranı **kullanılamaz** hâle getirir.
* Bugün panelde böyle bir yazım yok (tam suite bunu doğruluyor), ama **yeni bir
  ekran getirebilir**. Kaçış yolu var (`korumasiz`) ama onu yazacak kişi önce
  patlamayı görecek.
* Şüphem şu: **bu, yanlış pozitifin bedelinin fazla yüksek olduğu bir yer
  olabilir.** Alternatif (uyarı + CI'da hata) düşünülmedi çünkü bu projede beş
  kez `throw` seçildi ve işe yaradı; ama o beşinin hiçbiri **her pencerede**
  koşmuyordu.

### N2. Kaynak nöbetçisinin `belirsiz` listesi elle doğrulanmıştır

Dört çapraz dosyalı pencerenin korumasının nerede olduğunu **ben okudum ve
teste yorum olarak yazdım**. Hiçbir otomatik kontrol o dört satırın doğru
olduğunu iddia etmiyor. `EditProductModal → ProductForm` bağı bugün doğru; ama
`ProductForm` yarın bekçisini kaybederse:

* çalışma zamanı dedektörü **yakalar** (o pencereyi açan test var: A7d2'nin
  kabul dosyası),
* kaynak nöbetçisi **yakalamaz** (belirsiz kalır).

Yani güvence tek katmandan geliyor. **Denetçi buraya baksın:** dört belirsiz
pencerenin her biri için, o pencereyi AÇAN bir test gerçekten var mı?
(Benim cevabım: `EditProductModal` evet, `AdminLibraries` ödeme yüzeyi evet,
`AdminAuditLogsPage` salt-okunur, `AdminLibraries` operatör penceresi —
**emin değilim**.)

### N3. En az sınanmış varsayım: `korumasiz` beyanının hiç kullanılmaması

Bugün panelde `korumasiz` yazan **tek bir çağrı yeri yok**. Yani beyanın
gerçek bir kullanımda doğru davrandığı yalnız sentetik testle biliniyor. İlk
gerçek kullanım (muhtemelen bir seçici/filtre penceresi) beyanın yeterince
ifade edici olup olmadığını gösterecek. Şüphem: **beyan boolean olmamalıydı,
gerekçe metni olmalıydı** (`korumasiz="salt-okunur detay"`). `pencereSiz` ile
tutarlılık uğruna boolean seçtim; bu, tutarlılığın doğruluğa tercih edildiği
tek yer olabilir.

### N4. `ip19Filo` A7d4 bölümü 4/0 kırmızı

Dört testin dördü de tabana karşı yeşil. Dürüstçe raporladım ama şüphem şu:
**bu dört test gerçekten bir şey koruyor mu, yoksa "göç bunları kırmadı"nın
pahalı bir yazımı mı?** Onları tutan tek gerçek kanıt eşik testi
(A7D4-3) ve `tsc`. Denetçi bu dört testi silmeyi önerirse iyi bir gerekçem yok.

Aynı şüphe `dalga4Pencereleri`nin on yeşil testi için de geçerli (biri kırmızı).

### N5. Karışık tohum kusuru bir kez daha olabilir

AK-1 (bildirim sırasına bağlı nöbetçi) **normal koşumda görünmüyordu**. Şimdi
`afterAll`a taşındı, ama:

* aynı sınıf başka dosyalarda da olabilir — **tarama yapmadım**;
* özellikle "önce ölç, sonra iddia et" deseni kullanan başka test dosyaları
  varsa (modül seviyesi sayaç + ayrı `it`), aynı kusuru taşırlar.
* Denetçi `grep -rn "let .*= 0;" src/**/*.test.tsx` benzeri bir tarama yapsın.

### N6. Sürücü değişikliği geçmiş turların anlamını değiştirdi

`_kirilanlar`ın duyarlılığı arttı ve frontend yeşil taban kapısı eklendi. Yani
**geçmiş paketlerde "YAKALANMADI" raporlanmış bir prova**, kanca hatası
yüzünden öyle görünüyorduysa artık YAKALANDI sayılabilir; tersine, taban zaten
kırıkken "YAKALANDI" sayılmış olanlar artık **geçersiz** sayılır. Geriye dönük
yeniden koşum **yapılmadı**. Denetçi bunu bir borç sayabilir.

### N7. `AdminAccessPage`in şema-form uyumsuzluğu

Düzenleme dalında `code` alanı **basılmıyor** ama şema onu istiyor; mevcut kod
`defaultValues`a taşınıyor ki "geçersiz kod" hayalet hatası doğmasın. Testi var
(Y-3, Y-4) ama bu bir **kokudur**: form şeması gösterilmeyen bir alanı
doğruluyor. Daha temizi iki ayrı şema olurdu (`yeni` / `duzenleme`). Bilinçli
seçim, ama savunulacak bir tarafı yok — kod okunurluğu ile şema doğruluğu
arasında bir denge.

### N8. Bu paket kendi aletlerinde üç kusur üretti

AK-1, AK-2, AK-3. Üçü de bulundu ve düzeltildi, ama **oran dikkat çekici**:
bu turda üretilen üç ölçüm aletinin üçünde de kusur çıktı ve üçü de yalancı
yeşil üretebilirdi. Denetçinin bu pakete bakarken en verimli sorusu şu olabilir:
**"bu paketin ölçüm araçlarının hangisi HÂLÂ kendi doğruluğunu kanıtlamıyor?"**
Benim cevabım: `korumasiz-pencere.mjs`in `belirsiz` sınıflandırması (N2) ve
tarayıcı sondasının kalan ölçümleri (yalnız düşen kapılar raporlanıyor; geçen
bir kapının **doğru şeyi** ölçtüğü ayrıca kanıtlanmıyor — AK-3 tam olarak
buydu).
