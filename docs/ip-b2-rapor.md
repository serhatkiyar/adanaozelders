# İP-B2 — Liste sayfası anatomisi + ürün listesi

**Dal:** `feat/panel-tasarim` (taban `13d17a6` = İP-B1) · **Worktree:**
`C:\Users\kiyar\Desktop\adana-tasarim` · **Tarih:** 22 Ağustos 2026

B serisinin ikinci paketi. B1 envanteri, dili ve kabuğu kurmuştu; bu paket
**panelin en çok tekrar eden yüzeyini** — liste sayfasını — ortak parçalara
çıkarıyor ve tek bir referans ekranda kanıtlıyor.

| Görev | Çıktı |
|---|---|
| Ç-5 | Yazı tipi self-host + KVKK nöbetçisi (**lansman engeliydi**) — §1 |
| Ç-3 | Marka aksanı (lacivert) + dikkat rengi (turuncu), panel geneline — §2 |
| Ç-2 | Satır aksiyon kuralı (Seçenek D) — bileşende ZORLANIYOR — §3 |
| Kapsam | Ortak parçalar: `DataTable` v2 · `ListeAracCubugu` · boş durum ikizi — §4 |
| Referans | Ürün listesi ekranı göç etti (tek ekran) — §5 |
| Yöntem | Kırmızı matris (§6) · mutasyon provası (§7) · gerçek Chrome (§8) |
| Kapı | §9 · Borç numaraları §10 · Bilinen sınırlar §11 |

---

## 1. Ç-5 — Yazı tipi artık kendi alanımızdan (KVKK)

### Sorun neydi

`frontend/index.html` `Inter`ı bir dış yazı tipi CDN'inden çekiyordu;
`tailwind.config.js` yorumu ise "KVKK gereği … CDN'i kullanılmıyor" diyordu.
İkisi aynı anda doğru olamaz ve doğru olmayan taraf **koddu**: her sayfa
yüklemesinde — giriş yapmamış anonim ziyaretçi dahil — tarayıcı ABD'de
barındırılan bir sunucuya bağlanıyor ve **IP adresini oraya gönderiyordu**.

Bu, projenin Cloudflare'i DNS-only tutma gerekçesinin birebir aynısıdır
(KVKK m.9 · yurt dışına aktarım); Almanya'da aynı gerekçeyle tazminata
hükmedilmiş emsal karar var (LG München I, 3 O 17493/20).

### Ne yapıldı

| | |
|---|---|
| Dosyalar | `public/fonts/` altına **dört woff2** (Inter latin + latin-ext, Figtree latin + latin-ext) — toplam **163 KB** |
| Bildirim | `src/index.css` → dört `@font-face`, hepsinde `font-display: swap` |
| `index.html` | Dış bağlantılar KALDIRILDI; yerine `latin` altkümesine `preload` |
| Lisans | Inter ve Figtree, SIL OFL 1.1 — self-host açıkça serbest (`public/fonts/README.md`) |
| Nöbetçi | `src/__guards__/disFont.test.ts` (10 test) + `scripts/dis-font-tarama.mjs` |

**`latin-ext` isteğe bağlı değil:** Türkçenin `ş ğ İ Ş Ğ` harfleri `latin`
altkümesinde YOKTUR. Yalnız `latin` alınsaydı panel ve public site Türkçe
metinlerin bir kısmını yedek yazı tipiyle çizerdi — ve fark ancak gerçek
tarayıcıda görülürdü. Nöbetçi bunu ayrıca iddia ediyor.

### Nöbetçi kendi kaynağını yakalamıyor — ve bunu iki kez kanıtladı

Tarayıcı aradığı konak adlarını **parçalardan** birleştirir
(`["goog","leapis"].join("")`), böylece aranan dizi depoda hiçbir yerde tam
yazılı değildir ve tarama **sıfır istisnayla** çalışır. Hariç tutma listesi
YOK — çünkü hariç tutma bir kaçış kapısıdır.

Bu tasarımın çalıştığı **ölçüldü**, iddia edilmedi:

1. İlk yazımda üç dosyanın (tarayıcı, nöbetçi, `index.css`) **yorumları**
   konak adlarını düz yazıyordu. Nöbetçi üçünü de yakaladı; hariç tutma
   eklenmedi, **yorumlar düzeltildi**.
2. Bu paketin gerçek tarayıcı turu (`scripts/ip_b2_liste_turu.mjs`) ağ
   filtresinde konak adını düz yazmıştı. Mutasyon sürücüsünün "taban yeşil mi"
   kapısı onu yakaladı ve tur betiği de parçalı desene geçti.

Ayrıca **ters prova**: tarama sentetik bir `<link …>` ve bir `url(…)` metnini
gerçekten yakalıyor, `url("/fonts/inter-latin.woff2")` gibi masum metni
yakalamıyor.

### Davranış kanıtı

Kaynak taraması yalnız metni görür. Gerçek Chrome turu ağ kaydını okuyor:
sayfa yüklenirken **dış yazı tipi konağına giden istek sayısı** ve
**yerel woff2 indirme sayısı** ölçülüyor (§8).

---

## 2. Ç-3 — Marka aksanı: lacivert yüzey değil, lacivert AKSAN

### Karar ve uygulaması

- `--panel-accent` = **#1A365D** (açık tema). Zemin, kenarlık ve metin NÖTR
  kalır (slate). Marka yalnız üç yerde görünür: etkin gezinme öğesi, birincil
  düğme, odak halkası.
- `#F6AD55` **aksan değil DİKKAT rengi**: uyarı/bekleyen iş rozetleri
  (`Badge tone="warning"`). Birincil düğme turuncu olsaydı aynı ekranda hem
  "yap" hem "dikkat et" anlamına gelirdi.
- **Koyu temada aksan farklı bir değerdir** (`#8AB0DE`): `#1A365D` koyu
  yüzeyin üstünde **1,3** kontrast verir; düğme zeminden ayırt edilemezdi.

### Panel yarı lacivert yarı indigo KALMADI — ölçüldü

İP-B1 aksanı bilerek çevirmemişti ("aksanı yalnız kabukta çevirmek paneli
yarı lacivert yarı indigo bırakırdı"). Bu turda değişiklik **token
katmanında** yapıldı ve panel ağacındaki (`components/admin/**`,
`pages/admin/**`) **55 `indigo-` sınıfı** — 28 dosyada — token'lara süpürüldü.

Eşik artık `toEqual([])` (`__guards__/panelAksani.test.ts`): panelde yeni bir
`indigo-` sınıfı doğduğu gün CI kırılır ve **hangi dosyada** doğduğu isimle
görünür. Kapsam bilinçli olarak `admin/` ağacıyla sınırlı ve **sınırın kendisi
de test ediliyor** — public site bu turda çevrilmedi, "0 bulgu" iddiası
yanıltıcı olmasın.

### Süpürme sırasında bulunan CANLI kusur

Ortak `Button`ın birincil varyantı `bg-indigo-600 text-white` yazıyordu.
`text-white` **koyu temada da beyaz** kalıyordu; `indigo-600` koyu temada da
koyu olduğu için kusur gizliydi. Aksan açık lacivertle değişince beyaz metin
**1,35** kontrasta düşecekti — yani göç, var olan bir tasarım borcunu görünür
etti. `text-panel-accent-fg` ile kapandı (koyu temada `slate-950`, ölçülen
**8,98**).

Aynı sınıf beş yerde daha vardı (`bg-panel-accent … text-white`: etiket baskı
düğmeleri, paketleme kuyruğu, kokpit aralık seçicisi) ve hepsi düzeltildi.

### Ölçülen kontrastlar (hesap + gerçek Chrome · §8)

| Çift | Oran | Eşik |
|---|---|---|
| beyaz metin / `#1A365D` | **12,14** | 4,5 |
| `#1A365D` / `#EAF0F7` (etkin satır) | **10,58** | 4,5 |
| odak halkası `#1A365D` / beyaz | **12,14** | 3 (SC 1.4.11) |
| `#8AB0DE` / slate-900 (koyu, etkin gezinme) | **7,94** | 4,5 |
| slate-950 metin / `#8AB0DE` (koyu, birincil düğme) | **8,98** | 4,5 |
| `#8AB0DE` / `#152944` (koyu, etkin satır) | **6,52** | 4,5 |
| `#7C2D12` / `#FDF1E1` (dikkat rozeti, açık) | **8,41** | 4,5 |
| `#F6AD55` / `#422006` (dikkat rozeti, koyu) | **7,65** | 4,5 |

### Tipografi: Figtree başlıklara, Inter gövdeye

`docs/tasarim-dili.md` §1.4'ün önerisi uygulandı. Uygulama **tek kuraldır**:
`index.css` → `.panel-kok :is(h1,h2,h3)`; sınıf yalnız `AdminLayout`un kök
`<div>`ünde durur. Ekran dosyaları yazı tipi sınıfı YAZMAZ.

Gerekçe aksanınkiyle aynı: ekran başına yazılsaydı panelin bir kısmı Figtree,
bir kısmı Inter başlık taşırdı — ve bu tur yalnız **bir** ekranı göç ettiriyor.
Kural kabukta olduğu için göç etmemiş 21 liste ekranı da doğru başlığı bugün
alıyor. Public site etkilenmez.

---

## 3. Ç-2 (D) — Satır aksiyon kuralı BİLEŞENDE zorlanıyor

Kilitlenen karar üç maddedir ve üçü de `ui2/liste/satirAksiyonlari.tsx`te
zorlanır, ekranlarda değil:

1. Satır başına **en fazla 2 açık düğme**; fazlası üç nokta menüsünde.
2. Masaüstü ve mobilde **aynı desen**.
3. Açıktakilerin hiçbiri **yıkıcı olamaz**; yıkıcı aksiyon her zaman menüde
   ve **onay adımlıdır**.

### Neden gürültülü

İP-B1'in `Form.Control` dersi: yazıyla korunan bir sözleşme çürür. Bu yüzden
ihlal **sessizce düzeltilmez**:

- **geliştirme/test** → `console.error` + `throw` (ekran açılmaz, gerekçe
  kırmızı ekranda yazar),
- **üretim** → `console.error` + güvenli bozunma (fazlalar menüye iner).

Üretimde `throw` etmemek bilinçlidir: bir tasarım kuralı yüzünden yöneticinin
sipariş ekranı beyaz kalmamalı.

### Tip düzeyinde de kapalı

`SatirAksiyonu` ayrık bir birleşimdir: `yikici: true` yazan bir aksiyon
`acik` alamaz (`acik?: never`) ve `onay` metni vermeden **derlenmez**.
Çalışma zamanı kontrolü yine de var, çünkü aksiyon dizileri koşullu
ifadelerden üretiliyor (`...(canManage ? [...] : [])`) ve TypeScript orada
birleşimi genişletebiliyor.

### "Hangi ikisi birincil" kararı EKRANINDIR

Bileşen sayıyı ve yıkıcılığı zorlar, seçimi yapmaz. Ürün listesinde açıktaki
ikisi **Düzenle** ve **Yayınla/Gizle**; menüde kapak yükleme ve **Sil**.

---

## 4. Ortak parçalar

| Dosya | Ne yapar |
|---|---|
| `ui2/liste/aracCubugu.tsx` | Arama (300 ms, URL'de) · "Filtre ekle" (önce kriter, sonra değer) · "Sırala" (alan + yön) · uygulanan filtre çipleri · "Tümünü temizle" · **sayfa sıfırlama** |
| `ui2/liste/bosDurum.tsx` | `KayitYokDurumu` + `SonucYokDurumu` — **iki ayrı bileşen** |
| `ui2/liste/satirAksiyonlari.tsx` | Ç-2 · D kuralı + onay penceresi |
| `ui2/liste/menu.tsx` | WAI-ARIA "menu button" — üç yerde aynı mekanizma |
| `data-table/DataTable.tsx` | v2: çerçeve her hâlde durur · iki boş durum tip düzeyinde ayrıldı · token'lar |
| `layout/baslikAksiyonu.tsx` | Birincil aksiyonu kabuğun başlık şeridine portallar |

### Ekran "hangi filtreler" der, düzen kurmaz

Araç çubuğu URL okumasını/yazmasını, gecikmeyi, çipleri ve **sayfa
sıfırlamayı** kendi yapar. Sayfa sıfırlama kuralı ekran başına yazılsaydı bir
yerde unutulurdu ve sonuç şu olurdu: 4. sayfadayken arama yapan kullanıcı boş
bir liste görür ve "kayıt yok" sanır.

### Neden Radix / `@medusajs/ui` `DropdownMenu` kullanılmadı

Teknik engel yoktu (`ui2/` Medusa'yı import edebiliyor). Karar ölçüme
dayanıyor: Radix menüsü `pointerdown`/`pointermove`/`hasPointerCapture`
üzerine kurulu; jsdom bunların hiçbirini uygulamıyor. Bu depoda aynı sınıf iki
kez ısırdı (A7d5 `Observer` shim'leri; A7d1 Radix `aria-hidden` tuzağı) ve
her seferinde bedeli aynı oldu: davranış testleri ürünü değil **test
ortamının kılığını** ölçmeye başladı.

Elle yazılan menü ~200 satır; karşılığında klavye, ESC, dış tıklama ve odak
dönüşü gerçek DOM'da test edilebiliyor (10 test). `fixed inset-0` **yok** —
bir menü pencere değildir ve `uiBaseline`ın "etiketsiz overlay `toBe(0)`"
eşiğini de bozmaz.

### İki ayrı boş durum — neden aynı bileşen değil

"Hiç kayıt yok" diyen kişi bir şey **yaratmak** ister; "eşleşme yok" diyen
kişi **filtresini gevşetmek** ister. `KayitYokDurumu`nun aksiyonu serbest bir
yuvadır (her ekranın "yarat"ı farklıdır); `SonucYokDurumu` aksiyonunu KENDİ
basar ve yalnız `onTemizle` alır — orada doğru aksiyon tektir ve yuva
bırakmak onu unutmayı serbest bırakırdı.

Seçim `DataTable`ın işidir, ekranın değil: ekran yalnız `filtreli` bayrağını
verir. 22 ekranda 22 kez unutulabilecek bir karar, bir kez veriliyor.

---

## 5. Referans ekran: ürün listesi

Yukarıdan aşağı sabit sıra (tasarım dili §5):

```
1  Üst başlık   : yol · <h1> · açıklama · birincil aksiyon (KABUKTAN)
2  Araç çubuğu  : arama | "Filtre ekle" | "Sırala"
3  Uygulanan    : filtre çipleri + "Tümünü temizle"
4  Tablo        : başlık · satırlar · satır aksiyonları (≤2 açık + menü)
5  Sayfalama    : "N kayıt" · sayfa boyu · Önceki / Sonraki
```

### Ne kayboldu ve neden

Dört `<select>`li filtre şeridi kalktı. Ölçülen sorun: dört açılır liste yan
yana 380 px'te alt alta dört satıra kırılıyordu ve hiçbiri "uygulanmış mı"
bilgisini taşımıyordu (varsayılan "Tümü" ile seçili değer aynı görünüyordu).
Menü + çip deseni ikisini birden çözer.

### Mobil kart İLK KEZ bağlandı

İP-B1 envanteri T1 şöyle yazıyordu: "`renderMobileRow` bugün kullanılmıyor —
B2'de bağlanır." Bağlandı: 380 px'te tablo gizlenir, yerine kart gelir
(kimlik satırı + en fazla üç meta satırı + aksiyonlar).

**Bunun bir bedeli oldu ve raporlanıyor:** aynı ürün artık DOM'da iki kez
basılıyor (tablo + kart; `md:hidden` yalnız CSS'tir ve jsdom ikisini de
görür). Mevcut kabul testlerinin **on düğümü** daraltılmadan sorgu yaptığı
için "birden çok eşleşme" hatası verdi. İDDİALAR DEĞİŞMEDİ, sorguların
KAPSAMI daraldı (`within(tablo)`); her biri gerekçesiyle yorumlandı. Aynı
düzeltme A7d1'de sipariş tablosu için de yapılmıştı — desen yeni değil.

### Birincil aksiyon artık kabuğun başlığında

İP-B1 `AdminPageHeader`da boş bir `aksiyon` yuvası açıp gerekçesini yazmıştı:
"B2'nin 'Yeni ürün' düğmesini nereye koyacağını bu belgede bulması: her
ekranda AYNI yerde." Yuva dolduruldu.

**Context+state DEĞİL portal** kullanıldı ve gerekçesi ölçüldü: `children` her
render'da yeni bir element kimliği alır, efekt her render'da koşar, `setState`
yeni bir render tetikler — **sonsuz döngü**. Portal'da böyle bir durum yok.

Kabuk yoksa (kabul testi, çalışma zamanı kapısı) aksiyon **satır içinde**
çizilir; hiç çizmemek daha kötüydü (düğme sessizce kaybolurdu).

---

## 6. Kırmızı matris

### Ölçüm nasıl yapıldı (ve neden bu yöntem)

Görev metni "üretim kodundan önce düşen testler var olacak" diyor. Bu turda
**daha güçlü** bir ölçüm yapıldı: testler yazıldıktan sonra üretim kodu
**paket öncesi hâline geri döndürüldü** ve testler o hâlde koşuldu. Fark
önemlidir — "önce yazdım" bir sıra iddiasıdır, "üretim kodu olmadan düşüyor"
ise bir ÖLÇÜMDÜR ve testin gerçekten o kodu koruduğunu gösterir.

Sürücü: `frontend/scripts/ip-b2-kirmizi-matris.mjs`

- `--geri-al`: 33 değişen dosya `git show 13d17a6:<yol>` ile eski hâline
  döner, 10 yeni dosya bir **kasaya** taşınır. Test dosyaları YERİNDE kalır.
- `--geri-yukle`: kasadan bayt bayt geri yükler ve her dosyayı **SHA-256** ile
  doğrular; uymayan varsa kasa SİLİNMEZ ve hata verir.

`git stash` KULLANILMAZ: bu makinede stash yığını worktree'ler arasında
paylaşılıyor ve başka bir oturum aynı anda push/pop yapabiliyor (bu turda
gerçekten başka bir oturum aktifti). Kök CLAUDE.md §D'nin kuralı da aynı:
sürücü `git checkout --` ile dosya kaybettirmemeli.

### Sonuç — üretim kodu YOKKEN

| Dosya | Toplanan | Düşen |
|---|---|---|
| `ui2/liste/menu.test.tsx` | **0** (modül çözülemedi) | dosya kırmızı |
| `ui2/liste/aracCubugu.test.tsx` | **0** (modül çözülemedi) | dosya kırmızı |
| `ui2/liste/satirAksiyonlari.test.tsx` | **0** (modül çözülemedi) | dosya kırmızı |
| `ui2/liste/bosDurum.test.tsx` | **0** (modül çözülemedi) | dosya kırmızı |
| `dashboards/urunListesiAnatomisi.acceptance.test.tsx` | **0** (modül çözülemedi) | dosya kırmızı |
| `__guards__/disFont.test.ts` | 10 | **7** |
| `__guards__/panelAksani.test.ts` | 6 | **5** |
| `data-table/bosDurumIkizi.test.tsx` | 8 | **3** |
| **Toplam** | 24 | **15 kırmızı / 9 yeşil** · **8/8 dosya kırmızı** |

### Geçen 9 test — yalancı yeşil değil, TASARIM

Üretim kodu yokken geçen dokuz testin hepsi, geçmesi GEREKEN testlerdir:

- **Dedektörün kendi ayırt ediciliği** (`disFont`: sentetik `<link>`/`url()`
  metnini yakalıyor mu, masum metni yakalamıyor mu; yasak konak listesi iki
  konağı da adlandırıyor mu).
- **Kapsam çıpaları** (`disFont`/`panelAksani`: tarama gerçekten 100+ dosyaya
  ve panel ağacına bakıyor mu — "hiçbir şey bulamayan tarayıcı da boş liste
  döndürür" tuzağı).
- **Eski sözleşme** (`bosDurumIkizi`: `emptyTitle` veren 12 ekran bozulmadı
  mı; yükleniyorken iskelet geliyor mu).

Yani kırmızı/yeşil ayrımı ölçümün kendisiyle tutarlı: yeni davranışı iddia
eden her test kırmızı, aleti ve eski sözleşmeyi koruyan her test yeşil.

### Geri yükleme kanıtı

`--geri-yukle` çıktısı: **43 dosyanın 43'ü SHA-256 `OK`**, kasa silindi.
Ayrıca bağımsız bir doğrulama yapıldı — 43 dosyanın kopyası sürücünün
kasasından AYRI bir dizine alındı, `--geri-al` + `--geri-yukle` çevrimi bir kez
daha koşuldu ve sonuç `cmp` ile bayt bayt karşılaştırıldı:

```
cmp: 43 dosya karşılaştırıldı, FARK=0
```

(İlk `cmp` denemesi 43/43 "FARKLI" dedi ve sebebi ÖLÇÜMÜN KENDİSİYDİ: komut
`frontend/` dizininden koşulmuş, göreli yollar `frontend/frontend/...`e
çözülmüştü. Depo kökünden koşulunca fark sıfır. Kayda geçiyor çünkü "43/43
farklı" bir an için gerçek bir felaket gibi göründü.)

---

## 7. Mutasyon provası

**Sürücü:** `frontend/scripts/ip_b2_mutasyon.mjs` · **Sonuç: 23 / 23 yakalandı.**

Sürücü `git checkout --` KULLANMAZ (kök CLAUDE.md §D): dosyanın ham baytları
bellekte tutulup aynen geri yazılır, **her mutasyondan sonra SHA-256
doğrulanır** (uymazsa koşum durur), ve başlangıç/bitiş `git status --porcelain`
çıktıları karşılaştırılır. Kapanışta: **"Çalışma ağacı: BAŞLANGIÇTAKİ HÂLİ"**,
dokuz dosyanın dokuzu da SHA-256 `OK`.

| # | Mutasyon | Yakalayan |
|---|---|---|
| A1 | Açık düğme tavanı kaldırılır | `satirAksiyonlari.test` |
| A2 | Açıktaki yıkıcı aksiyon denetimi kaldırılır | `satirAksiyonlari.test` |
| A3 | Yıkıcı aksiyon onay adımını atlar | `satirAksiyonlari.test` |
| A4 | Kural ihlali sessiz kabul edilir (`throw` kalkar) | `satirAksiyonlari.test` |
| A5 | Onay penceresi aksiyondan ÖNCE kapanır | `satirAksiyonlari.test` |
| B1 | Boş durum seçimi `filtreli` bayrağını yok sayar | `bosDurumIkizi.test` |
| B2 | Yüklenirken boş durum basılır | `bosDurumIkizi.test` |
| C1 | Arama gecikmesi 300 → 0 | `aracCubugu.test` |
| C2 | Filtre değişince sayfa sıfırlanmaz | `aracCubugu.test` |
| C3 | Çip kaldırma filtreyi silmez | `aracCubugu.test` |
| C4 | "Tümünü temizle" sıralamayı da siler | `aracCubugu.test` |
| C5 | Uygulanmış kriter menüde tekrar sunulur | `aracCubugu.test` |
| D1 | `index.html`e dış yazı tipi bağlantısı geri gelir | `disFont.test` |
| D2 | `font-display: swap` düşer | `disFont.test` |
| D3 | `latin-ext` bildirimi `latin`e döner | `disFont.test` |
| E1 | Panel ağacına `indigo-` sınıfı girer | `panelAksani.test` |
| E2 | Aksan lacivertten kayar | `panelAksani.test` |
| E3 | Koyu temada aksan metni beyaz olur | `panelAksani.test` |
| E4 | Dikkat rengi ile aksan aynılaşır | `panelAksani.test` |
| F1 | `renderMobileRow` bağı sökülür | `urunListesiAnatomisi.acceptance` |
| F2 | Başlık portalı sökülür | `urunListesiAnatomisi.acceptance` |
| F3 | Menü ESC'te odağı döndürmez | `menu.test` |
| F4 | Menü kapalıyken içeriğini DOM'da tutar | `menu.test` |

### Prova ÜÇ gerçek kusur buldu — ikisi aletin, biri nöbetçinin

**(1) Nöbetçide YALANCI YEŞİL (D3).** `latin-ext` bildirimini `latin`e
çeviren mutasyon **yakalanmadı**. Sebep iki katmanlıydı:

- *Aletin kusuru:* `String.replace` ilk eşleşmeyi değiştirir ve
  `inter-latin-ext.woff2` dizisi dosyada İKİ kez geçiyordu — biri
  `@font-face`te, biri **açıklama yorumunda**. Mutasyon yorumu bozdu,
  bildirime hiç dokunmadı.
- *Nöbetçinin kusuru — asıl bulgu:* iddia `css.toContain(...)` idi, yani
  **bildirim silinse bile yorumun varlığı testi geçirirdi.** Kaynak
  sözleşmesi testinin klasik zayıflığı (kök CLAUDE.md §C: "yorum ve
  docstring yanlış pozitif üretmemeli").

İkisi de düzeltildi: mutasyon artık `src:` satırını hedefliyor, nöbetçi
`@font-face` bloklarının İÇİNDEKİ `url()` **kümesini** karşılaştırıyor.

**(2) Sürücünün deseni Türkçe karakterde eşleşmiyordu (A1).** Beklenen mesaj
deseni Türkçe harfler içeriyordu; yakalanan çıktı Windows konsol kod
sayfasından geçtiği için eşleşmiyor, mutasyon "yakalandı ama teşhis zayıf"
görünüyordu. Desenler ASCII'ye çevrildi.

**(3) Turun kendi konak adı nöbetçiyi tetikledi.** Sürücünün "taban yeşil mi"
kapısı, `disFont.test`in **kırmızı** olduğunu bildirdi ve provayı durdurdu.
Sebep: gerçek tarayıcı turu betiği (`ip_b2_liste_turu.mjs`) ağ filtresinde
konak adını düz yazıyordu. Yani KVKK nöbetçisi, kendisini doğrulamaya gelen
aleti yakaladı. Betik parçalı desene geçti.

Üçü de "yeşil kapı kanıt değildir" cümlesinin somut karşılığıdır.

---

## 8. Gerçek tarayıcı turu

**Betik:** `frontend/scripts/ip_b2_liste_turu.mjs` (Chrome + CDP, headless)
**Çıktı:** `docs/ip-b2/tur.json` + 8 ekran görüntüsü · **Düşen kapı: 0**

Ortam: bu worktree'nin `backend/.env`i **demo veritabanına** (`adana_b1_demo`)
bakıyor; canlı veriye dokunulmadı. Tura beş demo ürün eklendi (yayında /
gizli / taslak / dijital / azalan stok) çünkü boş katalog yalnız boş durumu
ölçerdi.

Portlar: makinede BAŞKA bir oturum 8000 ve 5173'ü tutuyordu. Onlara
dokunulmadı; tur 8010 + 5183 üzerinde koştu.

### 8.1 Ç-5'in DAVRANIŞ kanıtı (kaynak taraması değil)

| Ölçüm | Değer |
|---|---|
| Sayfa yüklemesinde toplam ağ isteği | 974 |
| **Dış yazı tipi konağına giden istek** | **0** |
| Yerel `woff2` indirmesi | 21 |
| `document.fonts` yüklenenler | `Figtree` x2, `Inter` x2 |
| Panel `<h1>` yazı tipi | `Figtree, Inter, ...` |
| Gövde yazı tipi | `Inter, ui-sans-serif, ...` |

Nöbetçi metni görür; bu tur **ağı** görür. İkisi birlikte, ayrı ayrı hiçbirinin
veremeyeceği kanıtı veriyor.

### 8.2 Ç-3'ün DAVRANIŞ kanıtı — hesaplanan renk

Birincil düğmenin hesaplanan zemini: açık temada `rgb(26, 54, 93)` = #1A365D,
koyu temada `rgb(138, 176, 222)` = #8AB0DE. Yani token gerçekten uygulanıyor;
"sınıf yazıldı" ile "renk çizildi" ayrı şeylerdir.

### 8.3 Kontrast (2 tema x 1280 px, gerçek `getComputedStyle`)

| Seviye | Açık | Koyu | Eşik |
|---|---|---|---|
| Birincil düğme | **12,14** | **8,98** | 4,5 |
| İkincil düğme | 10,35 | 14,48 | 4,5 |
| Tablo başlığı | 4,55 | 7,87 | 3 |
| Tablo hücresi | 7,58 | 12,02 | 4,5 |
| Sayfalama sayacı | 4,76 | 6,96 | 4,5 |
| Durum rozeti | 9,45 | 9,85 | 4,5 |
| **Filtre çipi** | — | **14,48** | 4,5 |
| **Boş durum başlığı** | — | **17,06** | 4,5 |

Son iki satır varsayılan ekranda **YOKTUR** (çip ancak filtre uygulanınca,
boş durum ancak sonuç bulunmayınca doğar). İlk yazımda ikisi de `null`
dönüyordu ve rapora "geçti" diye girebilirdi — İP-A8 · B-8'in dersi
("kontrast sondaları o güne dek yalnız hata metnine bakıyordu; düğme metni
hiçbir tur raporunda ölçülmemişti"). Tur artık ikisini **var oldukları
adımda** ölçüyor ve ölçülemeyen seviyeleri `olculmeyenSeviyeler` altında
isimle raporluyor.

### 8.4 Düzen ve kırılma noktası

| Ölçüm | 1280 | 380 |
|---|---|---|
| Tablo görünür | evet | hayır (doğru) |
| Mobil kart görünür | hayır (doğru) | evet |
| Yatay taşma | 0 px | 0 px |
| `<h1>` sayısı | 1 | 1 |
| Satırdaki AÇIK düğmeler | `Düzenle`, `Gizle` | `Düzenle`, `Gizle` |
| En küçük dokunma hedefi | **32 px** (tablo başlığı sıralama düğmesi) | **36 px** (kabuk hamburger'i) |

İki dokunma hedefi bulgusu:

- **1280'de 20 px ölçüldü** ve düzeltildi (32 px): tablo başlığındaki sıralama
  düğmesinin yüksekliği yoktu. `<th>`in `py-3` dolgusu satırı ~44 px yaptığı
  için `min-h-8` satır yüksekliğini büyütmedi.
- **380'de 36 px** ve bu **kabuğun hamburger'i** — İP-B1'den kalma, tasarım
  dili §4.1'in 40 px kuralının altında. Bu paketin kapsamı değil, borç
  açıldı (**TB-82**). Mobil kart aksiyonları bu turda 44 px'e çıkarıldı
  (tasarım dili §5.5).

### 8.5 Etkileşim

| Adım | Sonuç |
|---|---|
| Satır menüsü açılıyor, ekrandan taşmıyor | evet (`tasiyor: false`) |
| Menüde `Sil` var, satırda YOK | evet |
| ESC menüyü kapatıyor | evet |
| "Filtre ekle" → kriter listesi | `Stok durumu · Yayınevi · Yazar` |
| Kriter → değer listesi | `< Stok durumu · Tükendi · Azalan · ...` |
| Değer seçimi URL'e yazıldı | `?stok=tukendi` |
| Filtreli boş liste → doğru boş durum | `sonuc-yok` · "Eşleşen ürün yok" + "Filtreleri temizle" |
| Gerçek `Tab` ile odak halkası | 10 öğe gezildi, **10'unda da halka var** |

### 8.6 Turun KENDİ kusuru (raporlanıyor)

İlk koşumda **"satır menüsü ESC ile kapanmadı"** kapısı düştü ve sebep ÜRÜN
DEĞİL, turun yardımcı fonksiyonuydu: mobil kart bölümü DOM'da tablodan ÖNCE
gelir ve masaüstünde `display:none`dır. Adı eşleşen ilk düğme bu yüzden
**gizli** karttaki tetikleyiciydi; `el.click()` gizli düğmede de çalışır, menü
açılır — ama `focus()` `display:none` bir öğede ETKİSİZDİR, odak `<body>`de
kalır ve ESC olayı menünün kabına hiç ulaşmaz.

Gerçek kullanıcı gizli bir düğmeye basamaz; yani tur var olmayan bir yolu
ölçüyordu. `dugmeyeBas` artık yalnız **görünür** öğeleri seçiyor ve gerekçe
betiğin içinde yazılı.

Bir kozmetik bulgu daha: menü öğesinin erişilebilir adı ipucuyla birleşip
"Kapak görseli yüklePNG veya JPG" okunuyordu. Etiket ile ipucu arasına açık
bir boşluk düğümü kondu; artık "Kapak görseli yükle PNG veya JPG".

---

## 9. Kapı

| Kapı | Sonuç |
|---|---|
| `tsc --noEmit` | temiz |
| `npm run build` | başarılı (25,4 sn) |
| `npm run lint` | **0 hata**, 32 uyarı — İP-B1 tabanıyla AYNI (yeni uyarı yok) |
| Tam suite (sıralı) | **1833 / 1833 yeşil** · 157 / 157 dosya |
| Kırmızı matris | 8/8 dosya kırmızı, 15 test düştü (§6) |
| Mutasyon provası | **23 / 23 yakalandı**, çalışma ağacı bozulmadı (§7) |
| Gerçek tarayıcı turu | 4 ölçüm + 8 etkileşim, **düşen kapı yok** (§8) |
| ≥6 tohumlu karışık koşum | **YEŞİL DEĞİL** — aşağı bakınız |

### 9.1 Karışık sıralı kapı — HAM sonuç

Görev metni açık: *"Koş, sonucu ham olarak raporla, ama 'geçti' YAZMA ve
düzeltmeye girme."* Yapılan tam olarak budur.

| Tohum | Sonuç |
|---|---|
| 101 | **1 düşük** / 1832 geçti |
| 4001 | 1833 geçti |
| 7 | 1833 geçti |
| 20260822 | 1833 geçti |
| 555 | 1833 geçti |
| 31337 | 1833 geçti |

Düşen tek test: `adminKataloglarGoc.acceptance` → *"silme ONAY penceresi
açmadan istek göndermez"* · `Unable to find role="button" and name "Sil"`.

**İmport kapanışı (görev metninin istediği kanıt).** Düşen dosyanın zinciri:

```
adminKataloglarGoc.acceptance.test.tsx
  └─ pages/dashboards/AdminExamCatalogs.tsx
       ├─ components/admin/AccessState.tsx
       ├─ components/admin/ui           → Button · ConfirmDialog · ErrorState
       ├─ components/admin/ui2/form.tsx
       └─ hooks/… · lib/errors · store/toastStore
```

Bu paketin **yeni** dosyalarından (`ui2/liste/*`, `baslikAksiyonu`,
`bosDurumIkizi`) hiçbiri bu kapanışta YOK. Ama dürüst olmak gerekirse
kapanış **bu paketin DEĞİŞTİRDİĞİ iki ortak dosyayı içeriyor**:
`admin/ui/Button.tsx` ve `admin/ui/Badge.tsx` — ikisinde de değişiklik
yalnız Tailwind sınıflarıdır (aksan token'ı), davranış değil. Kırmızının DOM
dökümü bunu doğruluyor: ekran render edilmiş (başlık, açıklama ve "Yeni
katalog" düğmesi basılmış, sınıflarında `bg-panel-accent` görünüyor), yalnız
**liste satırları henüz gelmemiş** — yani sorgu RTL'in bekleme bütçesinde
çözülmemiş.

**Tek başına koşum:** aynı dosya, üç kez, **15/15 yeşil** (3/3).

Bu, **TB-78**'in (ve main'deki ikizi **TB-74**'ün) tarif ettiği zaman aşımı
sınıfının aynısıdır. Bu pakette düzeltilmedi.

**"Altı tohum yeşil" DİYE YAZILMADI** — çünkü değil. Beşi yeşil, biri değil ve
hangisi olduğu yukarıda yazıyor.

---

## 10. Borç numaraları

### Ölçüm görev metnindeki öneriyi ÇÜRÜTTÜ — ve ikinci kez ölçmek gerekti

Görev metni bu paketin karışık-sıra borcu için "TB-75" öneriyordu. Defterin
zorunlu ölçümü (`git fetch --all` + dal başına döküm) **iki kez** yapıldı ve
ikisi farklı sonuç verdi:

| Ölçüm | main'in tepesi | Sonuç |
|---|---|---|
| Paketin ortası | `70 74 75 75 76 76` | numaralar 77'den başlıyor |
| **Kapanış** | `70 74 75 76 77` | **main ilerledi**, numaralar **78**'den başlıyor |

Aradan geçen sürede main'e TB-77 girdi ("Tedarikçiden temin edilen üründe
teslim tarihi SÖYLENEMİYOR"). İlk ölçüme göre yazılmış 77-82 aralığı kapanışta
**78-83'e kaydırıldı**. Bu, kuralın neden "numarayı almadan önce ÖLÇ" değil
"**merge turunda** tahsis et" dediğinin canlı örneğidir: ölçüm bayatlayabilir.

`main → 70 74 75 75 76 76` çıktısındaki mükerrer 75/76 bir okuma hatası değil,
gerçek bir belge kusuru (aşağıda).

### İP-B1'in beş geçici etiketi

| Etiket | Sonuç |
|---|---|
| `TB-?A` karışık sıralı kapı | → **TB-78** |
| `TB-?B` `TaskCommandPalette` | → **TB-79** |
| `TB-?C` Google Fonts / KVKK | **KAPANDI** — numara almadı (Ç-5, §1) |
| `TB-?D` "Kişiselleştir" erişimi | → **TB-80** |
| `TB-?E` mobil çekmecede `Ctrl K` rozeti | **KAPANDI** — numara almadı |

`TB-?E` bu turda kapandı (`AdminSidebar` `cekmece` bayrağı): bayrak AÇIK
yazıldı, `testId`den ya da `onKatlamaDegistir`in yokluğundan çıkarılmadı —
ikisi de tesadüfi bağıntı ve biri değişirse rozet sessizce geri gelirdi.

### İP-B2'nin açtığı üç kayıt

| # | Konu |
|---|---|
| **TB-81** | Satır aksiyonları iki kez monte ediliyor (tablo + mobil kart) — **maliyeti ÖLÇÜLMEDİ** |
| **TB-82** | Kabuk hamburger'i 36 px; tasarım dili 40 px diyor (İP-B1'den kalma) |
| **TB-83** | Nöbetçi envanterleri satır numarasına çıpalı — bu turda üç kez alakasız kırmızı üretti (TB-38'in kardeşi) |

### İki BELGE KUSURU bulundu — ikisi de main'de, bu dalda değil

1. **TB-73 bir HAYALET kimliktir.** `main`de TB-70'in "Sonraki adım" satırı
   `(bkz. TB-73 ile aynı sınıf)` diyor ama **TB-73 başlığı hiç açılmamış**.
   İP-A9 turu bunu fark edip yeni kaydına 74 vermiş, ama atfı düzeltmemiş.
   Kimlik **yakılmıştır**: yeniden kullanılmaz. Bu dalda TB-70 kaydı YOK, o
   yüzden burada düzeltilemedi — **merge turunda düzeltilmelidir**.
2. **main'de TB-75 ve TB-76 İKİŞER kez yazılmış** (`## TB-75` ve `## TB-76`
   başlıkları mükerrer). İçerikleri aynı; ikinci kopyalar silinmelidir. Bu,
   defterin kendi ölçüm komutunun çıktısını da bozuyor.

Not: **TB-78 ile main'deki TB-74 aynı kusur sınıfını anlatıyor.** Bu dal
main'den TB-74 açılmadan önce ayrıldığı için kayıt burada yok. Merge turunda
**birleştirilmelidirler**; iki ayrı numara olarak durmaları defteri yanıltır.
Kayıt bunu kendi içinde yazıyor.

---

## 11. Bilinen sınırlar ve bulunan kusurlar

### Bu paketin ÜRETTİĞİ regresyon — bulundu, düzeltildi, nöbetçilendi

`SatirAksiyonlari` ilk yazımında onay penceresini **aksiyondan ÖNCE**
kapatıyordu. Sonuç: onay düğmesi DOM'dan kalkıyor ve `isPending` ile sağlanan
**çift tıklama koruması yok oluyordu** — istek uçarken ikinci bir DELETE
gönderilebilirdi.

Kusuru bu paketin testleri DEĞİL, **mevcut bir kabul testi** yakaladı
(`adminSafetyStates.acceptance` · C-2: *"ürün silme onayı beklerken düğme
disabled kalır"*). Yani ortak bileşene taşınan bir sözleşme, taşınırken
kırılmıştı ve yalnız ekran testi onu tutuyordu.

Yapılanlar: (a) yaşam döngüsü düzeltildi — pencere aksiyon boyunca AÇIK kalır,
kapatmayı **çağıran başarıda** yapar (`onSec(kapat)`); (b) sözleşme ortak
bileşenin kendi testine taşındı (iki yeni düğüm); (c) mutasyon sürücüsüne
**A5** eklendi ve yakalandığı gösterildi.

### Kapsam dışı bırakılanlar (bilinçli)

1. **Diğer 21 liste ekranı göç etmedi.** Görev metni bunu açıkça söylüyor:
   "yalnız ortak parça + tek referans". `DataTable`ın eski boş durum sözleşmesi
   (`emptyTitle`/`emptyDescription`/`emptyAction`) bu yüzden korundu ve
   testlendi; 12 ekran dokunulmadan çalışıyor.
2. **Public sitede `indigo` duruyor.** Ç-3 kararı PANEL için verildi. Public
   yüzeyi aynı turda çevirmek, ölçülmemiş bir tasarım değişikliğini kaçak
   yolcu olarak taşırdı. Nöbetçinin kapsamı bu yüzden isimle sınırlı ve
   sınırın kendisi de test ediliyor.
3. **`meta name="theme-color"` hâlâ `#4f46e5`** (indigo). Tarayıcı arayüz
   rengidir ve public siteyi de kapsar; marka kararının o yüzeye taşınması
   ayrı bir karardır.
4. **`amber-*` sınıfları panelde duruyor.** Dikkat rengi rozete bağlandı
   (`Badge tone="warning"`), ama ekranlarda elle yazılmış kehribar uyarı
   şeritleri var. Tasarım dili §1.3 durum renklerini **rozete kilitliyor**;
   o göç kendi paketini hak ediyor.
5. **B3 yüzey ailesi** (FocusModal / adımlı akış / görsel yükleyici),
   **Ç-1** operatör-kurye alt çubuğu, **Ç-4** ayarlar bölümü ve **A3b** router
   göçü kapsam dışı bırakıldı (görev metni).

### Ölçülmemiş noktalar (dürüstlük kaydı)

- **Satır aksiyonlarının montaj maliyeti** ölçülmedi (**TB-81**). Tur ilk
  boyamayı temiz gördü ama render süresini kaydetmedi.
- **Ekran okuyucu ile gerçek okuma yapılmadı.** Erişilebilir adlar hesaplandı
  ve ölçüldü (menü tetikleyicisi satırı tanıtıyor, menü öğesi ipucuyla
  boşluklu birleşiyor), ama NVDA/VoiceOver turu yok.
- **Yalnız BİR ekran gerçek tarayıcıda ölçüldü.** Ortak parçaların 21 ekranda
  nasıl davranacağı kanıtlanmadı — kanıtlanan şey referans uygulamadır.
- **`prefers-reduced-motion`** için bir şey yapılmadı; menünün açılışı zaten
  animasyonsuz ama bu bilinçli bir karar değil, bir yan etki.

### Karışık sıralı kapı yeşil değil

Bkz. §9.1 ve **TB-78**. Bu paket düzeltmedi (görev metni yasakladı) ve
"geçti" yazılmadı.
