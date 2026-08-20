# İP-A7d1 — Göç dalgası 1: yapısal olarak farklı üç ekran

**Taban:** `6b75abd` (A6c) · branch `feat/medusa-ui-taban`
**Paket commit'i:** `a22e50b` (kod + testler + eşikler) + bu rapor
**Girdi:** `docs/denetim2-a4-a6.md`, `docs/ip-a6b-rapor.md`, `docs/ip-a6c-rapor.md`

---

## Özet

Bu dalganın amacı ekran göçü değil, **sözleşmenin sınanmamış yazım alanının
zorlanmasıydı**. Ölçülen sonuç:

| | |
|---|---|
| Göç eden ekran | 3 (+1 ev sahibi dosya) |
| **Bulunan sözleşme kusuru** | **3** (biri üretimde canlı bir hata, biri sessiz veri kaybı tuzağı, biri göçü engelleyen eksik) |
| Ekran regresyonu | 0 |
| Kasıtlı davranış değişikliği | 4 (hepsi aşağıda gerekçeli) |
| Yeni test | 51 (9 + 12 + 14 + 16) |
| Eşik | 4'ü düştü, 1'i sabit kaldı (gerekçesi §Görev 6) |
| Mutasyon provası | **9/9 yakalandı** |
| Gerçek tarayıcı | 3 ekran × 2 tema × 2 genişlik + çakışma sondası, **17 ekran görüntüsü** |
| Bekleme bütçesi | **artırılmadı** (çağrı yeri hâlâ 3) |

---

## Görev 0 — Ekran seçimi

Seçim kriteri yük değil **yapısal çeşitlilik**; üçü de sözleşmenin farklı bir
yüzünü zorluyor.

| Tip | Seçilen | Neden bu |
|---|---|---|
| **(a) Çok bölümlü form** | `components/LibraryEditorModal.tsx` + ev sahibi `pages/dashboards/AdminLibraries.tsx` | 20+ alan, **üç bağımsız koşullu dal** (admin/operatör kimlik yetkisi · yeni/düzenleme · günün açık-kapalı olması), **çapraz alan** doğrulaması (kapanış > açılış), doğrulamanın tamamı toast'taydı, sunucu 422'si alanlara hiç dağıtılmıyordu. A6 pilotu (`DamageDialog`) beş alanlıydı — bu genişlik hiç sınanmamıştı. |
| **(b) Çoklu filtre** | `pages/admin/AdminBookingsPage.tsx` | Üç bağımsız filtre (serbest metin + iki ayrık seçim) + sunucu tarafı sıralama (**iki anahtar tek olayda yazılır**) + sayfalama. `useUrlDurumu` bugüne dek yalnız **tek filtreli** pilot ekranda kullanılmıştı. |
| **(c) Satır tıklamalı liste** | `pages/admin/AdminAuditLogsPage.tsx` | Tabanda **yapısal olarak tek**: pencere durumunun ekranda yaşayıp bir bileşene **prop olarak indiği** tek örnek (İP-A6b · BULGU-3). Ayrıca `onRowClick` + `renderMobileRow` ikilisini kullanan iki ekrandan biri — Görev 1'in çakışmasını gerçekten taşıyor. |

**(a) neden iki dosya:** kilitli karar "ekranlarda modal `useState`i yaşamaz"
diyor. Editör göç edince pencere durumu ev sahibinden çıkmak zorundaydı;
`AdminLibraries`in **dört** pencere durumunun dördü de yüzeye taşındı. Yani (a)
tek bir düzenleme yüzeyidir, iki dosyaya yayılmıştır.

### Elenen adaylar

| Aday | Neden elendi |
|---|---|
| `ExamSessionsManager.tsx` | (a) için güçlü ve sayısal olarak daha kârlı (14 ham düğme, 2 pencere durumu). Ama **saf bir form değil**: liste + form + iki pencere karışımı. Dalganın amacı `Form.*`ı zorlamaktı; hibrit bir yüzey ölçümü bulanıklaştırırdı. Dalga 2'nin ilk adayı. |
| `AdminUsersPage.tsx` | (c) adayıydı; `onRowClick` var ama **satır aksiyonu yok** ve pencere durumu hiç yok. Çakışmayı da, pencere göçünü de sınamıyordu. |
| `AdminDemandsPage.tsx` | (b)/(c) adayıydı; `AdminBookingsPage`in dar bir kopyası (tek filtre, tek aksiyon). Aynı yazımı ikinci kez sınamak dalganın amacını boşa çıkarırdı. |
| `DeliveryVehiclesPage.tsx` | 701 satır, 18 alanlı form — ama alanları zaten yerel `Field` sarmalayıcısıyla adlandırılmış; `Form.*`ın çözdüğü sorunu taşımıyor. |
| `AdminExamCatalogs.tsx` | `ExamSessionsManager`e bağımlı; onu göç ettirmeden ölçülemez. |

---

## Görev 1 — `onRowClick` çakışması: karar ve çözüm

### Çelişki

Denetim #2 gerçek tarayıcıda ölçtü: `onRowClick` verildiğinde mobil kart
**bütünüyle tek bir `<button>`a** sarılıyordu. İç içe `<button>` geçersiz
HTML'dir → kartın içine ikinci bir aksiyon konulamıyordu. Kilitli kararımız ise
"satır aksiyonları açık düğme kalır, üç nokta menüye geçilmez". İkisi bir arada
mümkün değildi.

### Karar: **seçenek 2** — kart `<button>`a sarılmaz

| Seçenek | Karar | Gerekçe |
|---|---|---|
| 1 · Mobilde satır tıklamasını bırak | ✗ | Aynı liste masaüstünde tıklanır, mobilde tıklanmaz olurdu; kullanıcı tek ekranın iki davranışını öğrenmek zorunda kalır. |
| 3 · Aksiyonları kart altına ayrı şeride al | ✗ | Aksiyonun hangi kayda ait olduğu görsel yakınlık meselesidir; ayrı şerit bunu zayıflatır ve her satırın yüksekliğini büyütür. |
| **2 · Tıklanabilir alanı kart içinde bir katmana indir** | ✔ | Hem tam kart tıklanabilir kalır hem içine gerçek denetim konulabilir. |

### `ui2/` katmanında nasıl çözüldü

`components/admin/data-table/DataTable.tsx` (ekran başına DEĞİL, tek yerde):

* Mobil kart artık bir `<div>`; tıklama **kabın kendisinde** dinlenir.
* Kabın içine, içeriğin **altında** (`z-0`) duran görünmez bir "satırı aç"
  `<button>` serilir. Bu düğme klavye ve ekran okuyucu içindir: odak halkasını
  o taşır, erişilebilir adını **`aria-labelledby` ile kart içeriğinden** alır.
  Çağıran taraf yeni bir prop yazmaz → 21 ekranda unutulamaz.
* Fare tarafında tek kural: **etkileşimli bir öğeden gelen tıklama satırı
  açmaz** (`a[href], button, input, select, textarea, [role=button]`).

Aynı kural masaüstü `<tr>` için de kondu — ve orada bir **üretim hatası**
kapattı (§Sözleşme kusurları · SK-1).

**Kilitli karar değişmedi**: satır aksiyonları açık düğme olarak kaldı.

---

## Görev 2 — Kırmızı matris (implementasyondan ÖNCE)

Üç ekranın hiçbirinin kabul testi **yoktu**. Bu yüzden her dosya iki bölüm
yazıldı: (1) mevcut davranışı sabitleyen iddialar — göç bunları kırmamalı,
(2) göçün getirdiği davranış — yazıldığı anda kırmızı.

| Dosya | Toplam | Yazıldığında KIRMIZI | Kırmızının içeriği |
|---|---|---|---|
| `components/admin/data-table/satirAksiyonu.test.tsx` | 9 | **3** | mobil kartta iç içe `<button>` (2 tane: "Sil 1", "Sil 2") · mobilde aksiyon satırı da açıyor · **masaüstünde aksiyon satırı da açıyor** |
| `pages/admin/adminDenetimKayitlari.acceptance.test.tsx` | 12 | **3** | varsayılan değer adrese yazılıyor (`?page=1`) · "filtre eşleşmedi" ile "kayıt yok" aynı metin · çıkış yolu (filtreleri temizle) yok |
| `pages/admin/adminRezervasyonFiltre.acceptance.test.tsx` | 14 | **3** | aynı üçü |
| `components/kutuphaneEditoruDalAdlari.acceptance.test.tsx` | 16 | **16** | ekranın tamamı (bileşen sözleşmesi `state` prop'undan yüzeye geçtiği için hepsi kırmızı başladı) |

"Hiç koşmadı" durumu **ayrı** raporlanır: `satirAksiyonu.test.tsx`in ilk
koşumunda 7 test kırmızıydı ama **4'ü yanlış sebeple** — mobil bölümü seçen
işaret (`data-mobil-satirlar`) henüz yoktu. İşaret nötr bir değişiklikle
eklendi ve matris yeniden koşuldu; **gerçek** kırmızı sayısı 3'tür. Yanlış
sebeple kırmızıyı "yakalandı" saymak, ölçülmek isteneni ölçmeden geçmek olurdu.

### Zorunlu kabul kriteri (A4'ten beri taşınıyor)

Göç eden form **tüm koşullu dallarıyla** render edilip her alanın erişilebilir
adı `test-utils/alanAdlari` ile doğrulandı. Dallar kartezyen çarpılmadı:

| Dal | Ne açılıyor |
|---|---|
| admin · yeni kayıt | görsel yöneticisi yok (yönlendirme metni), durum bölümü var |
| admin · düzenleme | görsel yöneticisi var |
| operatör | ad salt-okunur, **durum bölümü hiç render edilmiyor** |
| gün açık ↔ kapalı | saat alanları kapalı günde HİÇ render edilmiyor; açılınca beliriyor |

Ölçüm: en dar dalda bile ≥ 15 form kontrolü render ediliyor (yalancı yeşil
kapısı), adsız kontrol **0**.

**Bilinen istisna, isimle:** `MapPicker`ın kendi adres arama kutusu adsız.
`MapPicker.tsx` bu paketin üç ekranından biri değil ve "seçilen üç ekran ve
ortak katman dışında ekran dosyası değişmedi" kabul kriteri var; borç zaten
çalışma zamanı kapısında kayıtlı (`CALISMA_ZAMANI_ADSIZ`). Test onu **sayıyla
da** doğruluyor (tam 1): borç kapanırsa ya da ikincisi doğarsa kırılır.

---

## Görev 3 — Göç, ekran ekran

Üçü **ayrı ayrı** yeşile alındı (sırasıyla c → b → a); her adımda tam suite
yeniden koşuldu.

### (c) `AdminAuditLogsPage` — önce/sonra

| | Önce | Sonra |
|---|---|---|
| Pencere durumu | `useState<AuditLogOut \| null>` → `AuditDetailDialog`a **prop olarak iniyor** → `<Dialog open={log !== null}>` | `useDuzenlemeYuzeyi` + `DuzenlemePenceresi` |
| Filtreler | elle `useSearchParams` + `setQueryValue`, her çağrı yerinde elle `page: 1` | `useUrlDurumu` (`sayfaAnahtari: "page"`) |
| Varsayılan değer | adrese yazılıyordu (`?page=1`) | yazılmıyor |
| Boş durum | tek metin | filtreliyse "Bu filtreyle kayıt bulunamadı" + **Filtreleri temizle**; değilse "Denetim kaydı yok" |
| Sıralama | `sort`+`order`+`page` üç anahtar elle | tek `ayarla` çağrısı, sayfa sıfırlaması kancanın işi |

Adres parametrelerinin **adları korundu** (`q`,`target`,`actor`,`rid`,`sort`,
`order`,`page`,`limit`): paylaşılmış eski bağlantılar çalışmaya devam ediyor.
Enum beyaz listesi (`parseAdminAuditQuery`) **kaldı** — `useUrlDurumu` tip ve
varsayılan yönetir, `?sort=drop_table` gibi bir adresi eleyemez.

### (b) `AdminBookingsPage` — önce/sonra

Yukarıdakinin aynısı, artı: `decision` `useState`i yüzeye taşındı; üç filtrenin
üçü de `useUrlDurumu`ya girdi; boş durum ayrıştı. Satır aksiyonları (ihtilaf /
iptal) **açık düğme olarak kaldı**, mobil kartta da.

### (a) `LibraryEditorModal` + `AdminLibraries` — önce/sonra

| | Önce | Sonra |
|---|---|---|
| Doğrulama | `submit()` içinde elle, ilk hata `toast.error`la köşeye | `zod` + `react-hook-form`, hata **alanın altında**, `aria-invalid` + `role="alert"`, **odak ilk hatalı alana** |
| Çapraz alan | "Salı: kapanış açılıştan sonra olmalı" — yedi günlük tabloda hangi satır? | hata **o günün kapanış alanında** (`hours.1.close`) |
| Sunucu hatası | her şey tek toast | 422 `loc`u alana düşüyorsa **alanda**; düşmüyorsa şeritte |
| Gönder düğmesi | `disabled={busy}` | aynı (geçerlilik kapısı yok — kilitli karar) |
| Pencere | elle `fixed inset-0`: `role="dialog"` yok, `aria-modal` yok, odak tuzağı yok, ESC yok | `DuzenlemePenceresi` (+ kirli form bekçisi) |
| Ev sahibi | 4 pencere `useState`i, 2 elle overlay, 13 ham `<button>`, 4 adsız kontrol | 4 yüzey, 0 elle overlay, 0 ham `<button>`, 0 adsız kontrol |

Değişmeyen: gövde alanları, `cover_url`ün gönderilmemesi, oluşturunca
kapatmayıp düzenleme moduna geçme, operatörde adın salt-okunur olması.

### Kusur sınıflandırması

#### A. Sözleşme kusurları — **bu paketin asıl çıktısı** (3)

> Üçü de `ui2/`/ortak katmanda; düzeltilmeseydi **21 ekrana kopyalanacaktı**.

**SK-1 · `DataTable`: satır aksiyonuna basmak satırı da açıyordu (ÜRETİMDE CANLI)**

`<tr onClick={() => activateRow(row)}>` olayı yakalıyordu ve hücredeki bir
düğmeye basıldığında olay `tr`ye kabarıyordu: kullanıcı "Sil"e basıyor, hem
silme penceresi açılıyor hem satır tıklaması çalışıyordu. Bugün üretimde
`AdminUsersPage` ve `AdminAuditLogsPage` bu davranışı taşıyor — yalnız o iki
ekranda satır aksiyonu bulunmadığı için **görünmüyordu**. Dalga 2'de satır
aksiyonu olan ilk ekrana `onRowClick` eklendiği gün canlıya çıkardı.
Düzeltme: `etkilesimliKaynak()` kapısı, hem tıklama hem `Enter`/`Space` için.
Mutasyon: **A7D1-6** (kaldırıldığında 2 test kırılıyor).

**SK-2 · Mobil kart tek `<button>`a sarılıyordu (Görev 1'in çelişkisi)**

Ayrıntısı Görev 1'de. Sözleşme kusuru sayılmasının sebebi: karar ekran başına
verilseydi 21 ekranda 21 farklı davranış doğardı.

**SK-3 · `useYuzeyKirliFormBekcisi` yanlış yerde çağrılınca SESSİZCE devre dışı**

Kanca bekçiyi `BekciBildirimCtx` üzerinden pencereye bildirir; o bağlamı
`DuzenlemePenceresi` açar. Kancayı **pencereyi render eden** bileşende çağırmak
bağlamın dışında kalmaktır: `bildir` `null` gelir, pencere bekçiyi hiç tanımaz
ve ×/ESC/dış tıklama **kirli formu sormadan kapatır** — kullanıcının yazdığı
veri gider. Tip hatası yok, uyarı yok.

Bu tuzağa bu göçte düşüldü. **Ters prova yapıldı**: kanca sağlayıcı dışına
alındığında "KİRLİ formda kapatma önce sorar" testi kırılıyor, geri alınınca
geçiyor.

Otomatik uyarı **eklenmedi** ve sebebi bilinçli: sağlayıcısız çağrı meşru bir
kullanımdır (satır içi form — pencere yokken bekçi yalnız rota/sekme korumasını
kurar), yani "sağlayıcı yok" tek başına hata değildir. Nöbetçi kabul testidir;
kural artık `ui2/duzenlemeYuzeyi.tsx`in başında **keskin kenar** olarak yazılı.

#### B. Ortak katmandaki eksik (1) — kusur değil, göçü engelleyen sınır

**Ortak `Dialog` tek genişlikteydi (`max-w-lg`).** Ondan geniş yaşayan yüzeyler
ortak pencereye **geçemiyordu**: kütüphane editörü (iki sütunlu adres ızgarası +
harita + yedi günlük saat tablosu) ve oturum yönetimi kendi `fixed inset-0`
katmanlarını kuruyordu — yani etiketsiz overlay borcunun bir kısmı doğrudan bu
eksikten geliyordu. `genislik?: "dar" | "genis"` eklendi (serbest `className`
değil: yüzeylerin rastgele genişlemesi bir tasarım kararıdır).

#### C. Ekran regresyonu: **0**

Göç sırasında mevcut davranışı sabitleyen iddiaların hiçbiri kırılmadı.

#### D. Kasıtlı değişiklikler (4)

| Değişiklik | Neden |
|---|---|
| Doğrulama toast → alan | Kullanıcı hangi alanı düzelteceğini göremiyordu (A2'den beri yazılı sözleşme). |
| Boş durum ikiye ayrıldı | "Filtre eşleşmedi" bir düzeltme talimatı, "kayıt yok" bir durum bildirimidir. |
| Sayısal alanlara "negatif olamaz" | `min={0}` özniteliği yazmayı kesmez; kural artık şemada. |
| Editörde "Kaydet"in yanındaki "Vazgeç" kaldırıldı | `DuzenlemePenceresi` kapatmayı × / ESC / dış tıklamadan **bekçiye bağlı** olarak veriyor; ikinci bir vazgeç düğmesi aynı işi bekçiden geçmeyen bir yolla tekrar ederdi. |

**Yanlış çıkan bir hipotez (dürüstlük kaydı):** göç sırasında "`Form.Field`
(Controller) + `form.register` aynı ada iki kez bağlanınca kirli form bayrağı
bozuluyor" diye bir sözleşme kusuru olduğunu düşündüm. **Ölçtüm: yanlış.**
Tek alanı eski yazıma geri çevirdim, kirli form testi **geçmeye devam etti**.
Gerçek sebep SK-3 (sağlayıcı yerleşimi) ve bir de testimin kendi hatasıydı
(aşağıda). `register` → `field` dönüşümü bu yüzden bir kusur düzeltmesi değil,
tekrarı temizleyen bir sadeleştirmedir.

**Kendi testimin hatası:** "kirli formda kapatma sorar" testi önce
`getAllByRole("dialog")` ile editörün ayakta olduğunu arıyordu ve onay penceresi
(Radix) açıkken kardeş düğümlere `aria-hidden` koyduğu için editör
erişilebilirlik ağacından **geçici olarak düşüyordu** — test yanlış sebeple
kırmızıydı. Varlık DOM üzerinden okunacak şekilde düzeltildi ve gerekçesi
testin içine yazıldı.

---

## Görev 4 — Bekleme bütçesi

**Artırılmadı.** RTL bekleme bütçesi çağrı yeri sayısı **3'te kaldı**
(`adminStoreDalAdlari`, `storeVariants`, `ticketsPaymentGate` — hepsi
`{ timeout: 4000 }`). Bu paketin 51 testinin hiçbiri özel bir bekleme bütçesi
kullanmıyor; en yavaş yeni dosya 2,2 s (16 test, gerçek DOM + harita bileşeni).

Ölçüm yapılmadan bütçe artırılmadığı için gerekçe yazılacak bir şey yok.

---

## Görev 5 — Gerçek tarayıcı turu

Sonda: `frontend/scripts/ip_a7d1_tur.mjs` + `scripts/probe/a7d1-probe.html`
(Chrome + CDP, headless). Ölçüm: `docs/ip-a7d1/tur-olcum.json`, 17 ekran
görüntüsü aynı klasörde.

**Canlı `ceyhandb`ye bağlanılmadı.** Sonda sayfası axios adapter'ını kendi
sahte sunucusuyla değiştirir; veriler uydurmadır ve gerçek kişisel veri
içermez. **Tur bitince vite sunucusu kapatıldı** (port 5199 doğrulandı).

### Kapsam

| Ekran | Açık 1280 | Açık 380 | Koyu 1280 | Koyu 380 |
|---|---|---|---|---|
| (a) kütüphane editörü | ✔ | ✔ | ✔ | ✔ |
| (b) rezervasyonlar | ✔ | ✔ | ✔ | ✔ |
| (c) denetim kayıtları | ✔ | ✔ | ✔ | ✔ |
| çakışma sondası (sentetik) | ✔ | ✔ | — | ✔ |

### Ölçülenler

**Mobil kart (380 px).** Gövde 380, kart 346 px, **yatay taşma yok** (üç ekranda
da, iki temada da). Satır aksiyonu düğmesi 36 px yüksekliğinde — dokunma hedefi
olarak okunur. `(b)`de kartta iki açık aksiyon düğmesi var ("İhtilaf işaretle",
"İptal / iade"), **iç içe `<button>` sayısı 0**. `(c)`de kartı kaplayan bir
"satırı aç" düğmesi var ve adı **kart içeriğinden** geliyor.

**Görev 1'in kararı, gerçek tarayıcıda.** Göç eden üç ekranın hiçbiri satır
tıklaması ile satır aksiyonunu **aynı anda** istemiyor ((b) aksiyon istiyor,
(c) tıklama). Bu yüzden karar sentetik ama **gerçek `DataTable`** ile ayrıca
ölçüldü (`?ekran=d`), iki temada, 380 px'te:

| Ölçüm | Sonuç |
|---|---|
| iç içe `<button>` | **0** |
| kart içindeki "Sil"e basınca | `aksiyon:1` — satır **açılmadı** |
| kartın metnine basınca | `satir:1` — satır **açıldı** |

Ekran görüntüsü: `cakisma-koyu-380.png` / `cakisma-acik-380.png`.

**Odak tuzağı (gerçek klavye).** Satır klavyeyle odaklanıp `Enter` ile pencere
açıldı: 12 `Tab` boyunca odak **pencereden çıkmadı**, `Shift+Tab` pencere
içinde kaldı, `Escape` kapattı ve **odak açan satıra iade edildi**
(`acanaDondu: true`, `<tr>`).

**Odak ilk hatalı alana (gerçek klavye).** Ad alanı boşaltılıp gönderildi:
odak `aria-invalid="true"` taşıyan alanda, pencere içinde. İki temada da.

**Kontrast (A6c'nin 4,70 → 6,29 düzeltmesi doğrulandı).**

| Tema | Renk | Ölçülen | Eşik |
|---|---|---|---|
| Açık | `rgb(190, 18, 60)` (`rose-700`) | **6,29** | 4,5 (12 px) |
| Koyu | `rgb(251, 113, 133)` (`rose-400`) | **6,63** | 4,5 |

**Sayı girdisi koyu temada (A6c'nin `color-scheme` eklemesi doğrulandı).**
Editördeki iki sayı alanı da koyu temada `color-scheme: dark`, açık temada
`normal`.

Sondanın kendi geçerlilik kapıları var (kontrast 5,5'in altına düşerse, odak
hatalı alanda değilse, koyu temada `color-scheme` `dark` değilse, iç içe düğme
varsa çıkış kodu 2). Tur **kapıların hepsi geçerek** bitti.

---

## Görev 6 — Eşikler

| Ölçüm | A6c (eski) | A7d1 (yeni) | Fark |
|---|---|---|---|
| ham `<button` | 199 | **182** | −17 |
| adsız form kontrolü (kaynak) | 41 | **37** | −4 |
| ekranda yaşayan pencere durumu | 32 | **28** | −4 |
| etiketsiz overlay | 6 | **3** | −3 |
| ölçüm tabanı dosya sayısı | 109 | **109** | **0** |

### Düşmeyen sayı: taban dosya sayısı — **sahte düşüş yazılmadı**

Taban dosya sayısı bir **borç metriği değil**, ölçümün kimlik listesidir
(`OLCUM_TABANI`). Bu pakette panel ağacına dosya eklenmedi/silinmedi: eklenen
dört dosyanın hepsi **test** (ölçüm dışı), sonda dosyaları ise `scripts/`
altında. Sayının 109'da kalması doğru sonuçtur; düşürmek ancak bir ekranı
ölçümden çıkarmakla olurdu ve o zaten yasaklı (İP-A6 · TB-A5-1).

### Kalan borcun nerede olduğu

* **ham `<button` 182:** editörde kalan tek ham düğme **olanak rozetleridir**
  (`aria-pressed` taşıyan yuvarlak seçim çipi) ve bilinçlidir — bir aksiyon
  değil, bir seçim durumu; ortak `Button`ın dolgu/gölge varyantları oraya
  uymuyor (`AdminStore`daki `KatlanirBaslik` istisnasının aynısı).
* **adsız kontrol 37:** en büyük kalemler `CourierManager` 9, `OperatorLibrary`
  7, `LibraryPayoutForm` 5.
* **etiketsiz overlay 3:** `ExamSessionsManager`, `AdminPayoutsPage`,
  `AdminExamCatalogs`.

### Çalışma zamanı kapısının kimlik listesi

Göç eden üç ekranın üçü de `KAPI_KAPSAMI`nda (sığ kapı) — kapsam değişmedi.
`LibraryEditorModal` propsuz mount edilemediği için `KAPI_DISI`ndadır; gerekçe
metni güncellendi (`zorunlu kayit` → `zorunlu yuzey`) ve dosya **`DERIN_KAPI`ya
eklendi**: borcu artık dal testiyle kapanıyor. İki yönlü koruma sağlam —
`KAPI_KAPSAMI ∪ KAPI_DISI = taban` ve kesişim boş testleri yeşil.

### Mutasyon provası — **9/9 yakalandı**

Sürücü: ortak `backend/scripts/mutation_drill.py` (git checkout kullanmaz, ham
baytları bellekte tutar, her mutasyondan sonra HEAD + `git status --porcelain`
eşitliğini doğrular). Çalışma ağacı başta ve sonda aynıydı.

| # | Mutasyon | Kırılan |
|---|---|---|
| A7D1-1 | ham `<button>` geri kondu (182→183) | `ham <button sayısı artamaz` |
| A7D1-2 | adsız form kontrolü eklendi (37→38) | kaynak eşiği **+ çalışma zamanı kapısı** (iki katman birden) |
| A7D1-3 | pencere durumu ekrana geri taşındı (28→29) | sayı eşiği **+ dosya listesi** |
| A7D1-4 | etiketsiz overlay geri kondu (3→4) | sayı eşiği **+ dosya listesi** |
| A7D1-5 | bir ekran ölçüm tabanından çıkarıldı | `panel ağacındaki her dosya listede yazılıdır` |
| A7D1-6 | Görev 1'in satır aksiyonu koruması kaldırıldı | mobil + masaüstü çakışma testleri |
| A7D1-7 | koşullu dalda duran alanın adı silindi | **dört dal testinin dördü** |
| A7D1-8 | boş durum ayrımı kaldırıldı | (b) kabul testi |
| A7D1-9 | filtre değişince sayfa sıfırlaması kapatıldı | (b) kabul testi (2 test) |

A7D1-7 özellikle anlamlı: silinen ad **yalnız gün açıkken render edilen** bir
alandaydı. Dal testi olmasaydı üretime adsız çıkardı ve kaynak sayacı "0 borç"
derdi — A4'ten beri taşınan kabul kriterinin varlık sebebi tam olarak budur.

---

## Kapı

| Kapı | Sonuç |
|---|---|
| `tsc -b` | temiz |
| `npm run build` | başarılı (9,59 s) |
| `npm run lint` | 0 hata, 32 uyarı (hepsi bu paketin dışındaki dosyalarda; mevcut taban) |
| Tam suite | **1277/1277**, 126 dosya |
| Karışık tohum | **7/7** (1001–1007) |
| Mutasyon | **9/9** |
| Gerçek tarayıcı | tur geçti, vite kapatıldı |

### Test türleri (dürüst sınıflandırma)

| Tür | Sayı |
|---|---|
| Gerçek DOM + gerçek axios örneği (kabul) | 26 (12 + 14) |
| Gerçek DOM (bileşen sözleşmesi) | 25 (9 + 16) |
| Gerçek tarayıcı (Chrome + CDP) | 1 tur · 3 ekran × 2 tema × 2 genişlik + çakışma sondası |
| Kaynak/AST sözleşmesi (nöbetçi eşikleri) | mevcut 11 test, eşikleri güncellendi |

Snapshot yok, "import oldu" testi yok.

---

## Dalga 2 için değerlendirme

### Kalan ~18 ekran bu sözleşmeyle güvenle göç edebilir mi?

**Evet — ama iki koşulla.**

Çıkan sözleşme kusuru sayısı **3**. Bu, denetim #2'nin ölçtüğü orandan (beş
yazımda beş kusur) belirgin biçimde düşük ve üçünün de **niteliği farklı**:

* SK-1 zaten üretimde duran, göçün *ortaya çıkardığı* bir hataydı — sözleşmenin
  yeni bir kusuru değil.
* SK-2 bilinen ve önden masaya konan çelişkiydi; kusur değil, karar borcuydu.
* SK-3 **gerçek bir yeni bulgu**: sessiz, tipsiz, veri kaybettiren bir tuzak.

Yani "sınanmamış yazım alanı" bu dalgada **bir** yeni tuzak üretti. Bu, 21
ekranlık bir dalgayı durduracak bir sayı değil.

**Koşul 1 — SK-3 her göçte ayrıca doğrulanmalı.** Otomatik dedektör yazılamadı
(sağlayıcısız çağrı meşru). Bu yüzden pencere içeren her ekran göçünde
"kirli formda kapatma sorar" testi **zorunlu** olmalı. Dalga 2'nin görev
tanımına bu madde yazılmalı.

**Koşul 2 — ekran başına kabul testi olmadan göç edilmemeli.** Bu dalgada üç
ekranın **hiçbirinin** kabul testi yoktu; kırmızı matris yazılmasaydı SK-1 ve
SK-3'ün ikisi de sessiz geçerdi. Ekran başına maliyet ölçüldü: ortalama
**~13 test / ~1,3 s**.

### Dalga 2'ye geçmeden önce yapılması önerilenler

1. **`ExamSessionsManager` ile başlanmalı** (dalga 2'nin ilk ekranı): kalan üç
   etiketsiz overlay'in biri, kalan pencere durumlarının ikisi ve 14 ham düğme
   orada; ayrıca `AdminExamCatalogs` ona bağımlı.
2. **`MapPicker`ın adsız arama kutusu** kapatılmalı (tek satır) — bu pakette
   kapsam kuralı gereği bırakıldı ve şu an üç ayrı testte "bilinen istisna"
   olarak taşınıyor.
3. **Dalga 2 en fazla 6–8 ekran** olmalı: 3 ekranda 3 kusur çıktı; 18 ekranı
   tek seferde göç ettirmek, geri alınacak yüzeyi yine büyütür.

---

## Bilinen sınırlar

1. **Çakışma kararı gerçek bir ekranda değil, sentetik sondada ölçüldü.** Göç
   eden üç ekranın hiçbiri satır tıklaması ile satır aksiyonunu aynı anda
   istemiyor. Ölçüm gerçek `DataTable` ile yapıldı ama gerçek bir ekran
   yüzeyinde ilk kez dalga 2'de görülecek.
2. **`AdminLibraries`in liste yüzeyi `DataTable`a geçmedi.** Kart listesi kaldı:
   sayfalaması ve sunucu tarafı sıralaması olmayan bir liste için `DataTable`ın
   getireceği tek şey görsel tutarlılıktı; kapsamı büyütmemek için bırakıldı.
3. **Operatör ekleme formu `Form.*`a değil, elle aynı sözleşmeye geçti.** O form
   `react-hook-form` bağlamı taşımıyor (pencerenin formu değil) ve
   `DuzenlemePenceresi` tek korumalı içerik taşıyabiliyor (İP-A6c · BULGU-5).
   Etiket/`id` bağı, hata slotu ve odak taşıması elle ama aynı kurallarla
   kuruldu; ikinci bir form bağlamı açmak bu paketin işi değildi.
4. **Kontrast ve `color-scheme` yalnız Chrome'da ölçüldü.** Firefox/Safari yerel
   widget'ları farklı çizebilir.
5. **`useUrlDurumu`nun "aynı olayda iki yazım" yolu (A6c · BULGU-4) bu pakette
   yeni bir yazımla sınanmadı**: üç ekranın çoklu yazımları tek `ayarla`
   çağrısında birleşiyor. İki ardışık `ayarla` çağrısı olan bir ekran dalga
   2'de aranmalı — o yol hâlâ yalnız kendi birim testiyle korunuyor.
6. **Sürücünün frontend tarafında yeşil taban kapısı ölçüm yapmıyor** (mevcut
   sınır, [[TB-45]] notu). Taban elle doğrulandı: tam suite 1277/1277.
