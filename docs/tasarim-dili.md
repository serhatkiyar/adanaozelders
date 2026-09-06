# Panel Tasarım Dili

**Durum:** İP-B1'de yazıldı · **Kapsam:** `/yonetim/*` yönetim paneli kabuğu ve
ekranları · **Sözleşme:** B2..Bn paketlerinin her ekranı bu belgeye bakarak
yazılır.

Bu belge bir stil rehberi değil, bir **karar kaydıdır**. Her kuralın yanında
_neden_ o değer seçildiği yazılıdır; B2'yi yazan oturum "burada neden 24 değil
de 16 piksel" sorusunun cevabını burada bulmalıdır. Gerekçesi olmayan kural
kural değildir — kopyalanır, sonra da unutulur.

Kaynak: Medusa Admin'in tasarım dili (`docs.medusajs.com/user-guide` +
`@medusajs/ui@4.2.1` paketinin kendi kaynağı). Karşılaştırma belgeleri:
`docs/medusa-arayuz-karsilastirma.md`, `docs/medusa-karsilastirma-raporu.md`,
`docs/medusa-karsilastirma-tur2.md`.

---

## 0. Dilin tanımı: "Medusa + mobil uzantısı"

Panelimiz Medusa'nın **klonu değildir**. Medusa'nın dili masaüstü-önceliklidir
ve bizim iki kullanıcı sınıfımız (kütüphane operatörü, kurye/dağıtıcı) sahada
telefondan çalışır. Aynı zamanda panelin yarısından fazlası Medusa'da hiç
karşılığı olmayan yeteneklerdir (dağıtım turları, rota optimizasyonu, hakediş,
sayım oturumu, eğitmen onayı, denetim kaydı).

Bu yüzden dil iki katmanlıdır:

| Katman | Kaynak | Kural |
|---|---|---|
| **Masaüstü (≥1024px)** | Medusa | Düzen, ritim, kompozisyon ve etkileşim desenleri Medusa'yı izler |
| **Mobil (<1024px)** | Bizim | `renderMobileRow` kart deseni, açık dokunmatik aksiyonlar, çekmece gezinme |

**Neden iki katman:** Medusa'nın `products`/`inventory`/`orders` rota
dizinlerinde `sm:`/`md:`/`lg:` araması **sıfır sonuç** verir — mobil düzen
yoktur, bir tasarım tercihi olarak yoktur. Bizde 83 responsive sınıf kullanımı
ve çalışan bir mobil kart deseni var. Medusa'yı bire bir kopyalamak bu yeteneği
kaybettirirdi; kaybettirmemesi kilitli karardır (İP-A serisi).

**Kural:** Bir Medusa deseni mobilde çalışmıyorsa, mobilde **bizim desenimiz
geçerlidir**. Ters yön yasaktır: mobil kısıtı yüzünden masaüstü deseni
bozulmaz.

---

## 1. Renk ve token sistemi

### 1.1 Neden token

> **KARAR (CMS turu, 28 Ağu 2026): SİTE TEK TEMADIR — dark mode SÖKÜLDÜ.**
> Amazon/Trendyol sınıfı e-ticaret yüzeylerinde koyu tema yoktur; iki tema
> paritesi her rengin iki kez yazılması ve unutulan ikizler demekti (İP-A3c'nin
> ölçtüğü 891'lik borç). `themeStore` silindi, 5.557 `dark:` sınıfı söküldü,
> `.dark` CSS blokları kalktı. **Yeni kodda `dark:` YAZILMAZ** — nöbetçisi
> `src/__guards__/tekTema.test.ts`.

Medusa'nın token çözümü **indirection**: semantik sınıf → CSS değişkeni.
Bileşen tek sınıf yazar (`bg-panel-surface`); renk kararı tek noktada durur.
(Tarihçe: değişkenlerin `.dark` altında koyu yeniden tanımı vardı; tek tema
kararıyla kalktı, indirection'ın "renk tek yerde" faydası aynen sürüyor.)

`index.css`te İP öncesinden kalan `--admin-surface` / `--admin-border` /
`--admin-focus` değişkenleri **tanımlıydı ama hiçbir yere bağlı değildi** —
yarım kalmış bir girişim. İP-B1 onları silmedi, **tamamladı**: yerlerine tam
`--panel-*` kümesi geldi ve Tailwind'e köprülendi.

### 1.2 Token kümesi

`frontend/src/index.css` → `@layer base` içinde `:root` (tek tema).
Değerler **boşluklu RGB üçlüsü** olarak yazılır (`15 23 42`), çünkü Tailwind
köprüsü `rgb(var(--x) / <alpha-value>)` biçimini kullanır ve bu biçim
`bg-panel-surface/60` gibi saydamlık varyantlarını çalışır kılar. Hex yazılsaydı
saydamlık varyantı sessizce kırılırdı.

| Token | Rolü | Değer | Koyu (tarihçe — kalktı) |
|---|---|---|---|
| `--panel-bg` | Uygulama zemini (rail dışı en alt katman) | slate-50 | slate-950 |
| `--panel-surface` | Kart / panel / çekmece yüzeyi | beyaz | slate-900 |
| `--panel-surface-subtle` | İkincil yüzey (tablo başlığı, boş durum) | slate-50 | slate-950 |
| `--panel-surface-hover` | İşaretçi altındaki yüzey | slate-100 | slate-800 |
| `--panel-border` | Varsayılan saç-teli çizgi | slate-200 | slate-800 |
| `--panel-border-strong` | Ayrım gerektiren kenar (girdi, odak dışı) | slate-300 | slate-700 |
| `--panel-fg` | Birincil metin | slate-900 | slate-50 |
| `--panel-fg-muted` | İkincil metin, açıklama | slate-600 | slate-400 |
| `--panel-fg-subtle` | Üçüncül metin, ikon, etiket | slate-500 | slate-500 |
| `--panel-accent` | Aksiyon rengi (etkin gezinme, birincil düğme) | **#1A365D** (marka lacivert) | **#8AB0DE** |
| `--panel-accent-fg` | Aksiyon üstündeki metin | beyaz | slate-950 |
| `--panel-accent-soft` | Aksiyonun sakin hâli (etkin satır zemini) | **#EAF0F7** | **#152944** |
| `--panel-focus` | Odak halkası | **#1A365D** | **#8AB0DE** |
| `--panel-attention` | **Dikkat** rengi — düz hâl (şerit, nokta) | #F6AD55 | #F6AD55 |
| `--panel-attention-soft` | Dikkat rozetinin zemini | #FDF1E1 | #422006 |
| `--panel-attention-fg` | Dikkat rozetinin metni | #7C2D12 | #F6AD55 |

**Koyu temada aksan neden farklı bir değer:** `#1A365D` slate-900 yüzeyin
üstünde **1,3** kontrast verir — düğme zeminden ayırt edilemez. Aksan aynı
renk AİLESİNİN açık ucuna taşınır; lacivertin ton eğrisi korunur, kimlik
kaybolmaz. Ölçülen: `#8AB0DE` / slate-900 = **7,94**; slate-950 metin /
`#8AB0DE` = **8,98** (İP-B2 · gerçek Chrome).

Tailwind köprüsü `tailwind.config.js` → `theme.extend.colors.panel`. Kullanım:
`bg-panel-surface`, `text-panel-fg-muted`, `border-panel-border`,
`ring-panel-focus`. **`dark:` yazılmaz** — site tek temadır (yukarıdaki karar).

### 1.3 Renk kuralları

1. **Renk = sadece aksiyon.** Zemin, kenarlık ve metin nötrdür (slate ailesi).
   Doygun renk yalnız üç yerde görünür: etkin gezinme öğesi, birincil düğme,
   durum rozeti. Gerekçe: kalıcı karar — "kutu yerine boşluk, renk = sadece
   aksiyon". Medusa da aynı ekonomiyi uygular: `--tag-*` renkleri yalnız
   rozetlerde yaşar.
2. **Durum renkleri rozete kilitlidir.** Yeşil/kehribar/kırmızı yalnız
   `Badge`/`StatusBadge` içinde geçer, düz metinde değil. Gerekçe: aynı yeşil
   hem "başarılı" hem "aktif" hem de dekoratif olarak kullanılırsa anlamını
   kaybeder.
   **Uyarı çipi = açık zemin + KOYU metin; asla dolgulu düğme değildir.**
   Aksan turuncu olduktan sonra (Ç-4) uyarıyı aksandan ayıran şey hue değil
   BİÇİMdir: aksan koyu dolgu + açık metin taşır, uyarı tam tersini. Dolgulu
   bir uyarı düğmesi hem yanlış anlam verir hem kontrastı düşürür
   (`amber-500` üstünde beyaz metin = **2,15**). Nöbetçi:
   `__guards__/markaAksani.test.ts` — `bg-*dikkat*` ile `text-white` aynı
   sınıf dizesinde `toEqual([])`.
3. **Odak halkası her etkileşimli öğede zorunludur** ve `ring-panel-focus` +
   `ring-2` + `ring-offset-2`'dir. Kontrast eşiği 3:1'dir (WCAG 2.1 SC 1.4.11).
   Gerekçe: bağımsız denetim #3 (B-11) açık temada `indigo-400` halkanın
   **2,98:1** kaldığını ölçmüştü; eşik zar zor kaçırılıyordu.
4. **`color-scheme` kök öğededir**, bileşende tekrarlanmaz
   (`html { color-scheme: light }` / `html.dark { … dark }`). Gerekçe: İP-A8
   B-9 — dokuz yerel widget koyu temada beyaz blok çiziyordu; tek tek yamamak
   onuncusunu davet ederdi.

### 1.4 Marka aksanı: **TURUNCU — KARAR (Ç-4, kullanıcı)**

Aksan `#C2410C`dir. Zemin, kenarlık ve gövde metni **nötr** kalır; marka aksan
olarak girer (etkin gezinme öğesi, birincil düğme, odak halkası) ve sıcak zemin
`#FFF7ED` ile sınırlıdır: hover, seçili satır/sekme, yumuşak bilgi kartı.

**Bu karar §1.4'ün eski hâlini (Ç-3) bilerek TERSİNE ÇEVİRİR.** Ç-3 "turuncu
aksan değil, dikkat rengidir" diyordu ve gerekçesi aşağıda tarihçe olarak
duruyor. Gerekçe kullanıcıya iletildi, karar tekrarlandı. Dayanağı bir ölçüm
düzeltmesi değil **ürün yargısıdır**; burada böyle yazılmasının sebebi, ileride
"acaba kontrast mı gerektirdi" diye okunmamasıdır.

**Ölçülen bedel — kabul edildi.** Aksan `indigo-600` iken beyaz metinle **6,29**
veriyordu; `#C2410C` **5,18** verir. AA (4,5) korunur, pay daralır.

| Rol | Değer | Ölçülen |
|---|---|---|
| Aksan dolgu | `#C2410C` | beyaz metin **5,18** (AA) |
| Hover / aktif | `#9A3412` | beyaz metin **7,31** (AAA) |
| Sıcak zemin | `#FFF7ED` | üstünde `#9A3412` = **6,88** |
| Kenarlık | `#FED7AA` | **yalnız kenarlık** — metin olarak 1,35 |
| Ara ton (kenarlık/halka) | `#EA580C` | beyaza karşı **3,56** — SC 1.4.11'i geçer, **AA metni GEÇMEZ** |
| Odak halkası | `#C2410C` | beyaza karşı **5,18** (eşik 3) |
| Dikkat düz | `#F59E0B` | beyaza karşı 2,15 — **metin taşımaz** |
| Dikkat çipi | `#FEF3C7` zemin / `#78350F` metin | **8,15** |

**Marka turuncusu `#F6AD55` birincil dolgu OLAMAZ:** üstünde beyaz metin
**1,90** verir. Beyaz metni taşıyabilen en açık turuncu `#C2410C`dir. Bu, "sarı
turuncu" isteğinin düğmede değil **zeminlerde** karşılanmasının sebebidir.

**Aksan ile dikkat DEĞER ve BİÇİMle ayrılır, hue ile değil.** Ç-3'ün endişesi
("aynı ekranda hem 'yap' hem 'dikkat et'") ortadan kalkmadı; çözüm değişti:
aksan = koyu dolgu + AÇIK metin, dikkat = açık zemin + KOYU metin. Yeni bir hue
ailesi icat edilmez. Nöbetçi bunu parlaklık ve kontrastla ölçer
(`__guards__/markaAksani.test.ts`).

**Uygulama token katmanındadır.** `--marka-*` / `--dikkat-*` `index.css`
`:root` içinde tek kaynaktır; panel ailesi (`--panel-accent` vb.) ona **takma
ad**dır, yani panel ağacındaki 244 sınıf hiç değişmeden turuncuya geçti. Public
sitedeki 1.086 ham `indigo-` sınıfı token'a süpürüldü; nöbetçi eşiği `src/**`
için `toEqual([])`.

**Kalan risk — kabul edildi.** Sitede turuncu/kehribar zaten **alan rengi**
olarak kullanılıyor: yıldız puanı, kargo firması rengi, görev önceliği ölçeği.
Aksan turuncu olunca bunlar marka gibi okunabilir. Azaltıcı, aksanın her zaman
koyu dolgu, alan renklerinin açık/orta ton olması. Tümüyle çözülemez.

---

### 1.4 (tarihçe) Marka: navy + turuncu — Ç-3, **GEÇERSİZ**

> Aşağıdaki bölüm **yürürlükte değildir**; Ç-4 ile yukarıdaki karar geçerlidir.
> Silinmemesinin sebebi, o günkü gerekçenin ve ölçümlerin okunabilir kalmasıdır.

`#1A365D` navy, `#F6AD55` turuncu ve `Figtree` yazı tipi **bugün kod tabanında
hiç geçmiyor** (arama: sıfır sonuç, `frontend/` ağacının tamamında). Panel
bugün `indigo-600` aksanı ve tek başına `Inter` kullanıyor.

Tavsiye — **Medusa'nın dili + bizim kimliğimiz**, klon değil:

- Yüzeyler, kenarlıklar ve metin seviyeleri Medusa gibi **nötr** kalır. Panel
  günde saatlerce bakılan bir çalışma aletidir; marka rengiyle boyanmış bir
  arka plan yorar ve önemli olanı (durum, uyarı, aksiyon) bastırır.
- Marka yalnız **aksan** olarak girer: etkin gezinme öğesi, birincil düğme,
  odak halkası. Yani tek bir token değişir — `--panel-accent`.
- Turuncu `#F6AD55` **aksan değil, dikkat rengi** olmalıdır: kehribar durum
  rozetlerinin (bekleyen ödeme, rotayı bozan durak, kontenjan dolmak üzere)
  yerini alır. Birincil düğme turuncu olursa, aynı ekranda hem "yap" hem
  "dikkat et" anlamına gelir.
- `Figtree` yalnız **başlıklar** için, `Inter` gövde için önerilir. Ama
  bugün `index.html` Google Fonts CDN'inden `Inter` çekiyorken
  `tailwind.config.js` yorumu "KVKK gereği Google Fonts CDN'i kullanılmıyor"
  diyor — **belge ile kod çelişiyor** (bkz. rapor · Ç-5). İkinci bir CDN yazı
  tipi eklemeden önce bu çelişki çözülmelidir.

**İP-B2'de uygulandı.** Değişiklik yalnız token'da kalmadı: panel ağacındaki
(`components/admin/**`, `pages/admin/**`) **55 `indigo-` sınıfı** token'lara
süpürüldü ve nöbetçi eşiği `toEqual([])` yapıldı
(o gün `__guards__/panelAksani.test.ts`; Ç-4'te `markaAksani.test.ts` adıyla
kapsamı `src/**`e genişletildi) — yani panelde yeni bir `indigo-` doğduğu
gün CI kırılır. "Panel yarı lacivert yarı indigo kalmaz" bir niyet değil,
ölçülen bir sözleşmedir.

Süpürme sırasında **koyu temada canlı bir kontrast kusuru** görüldü: ortak
`Button`ın birincil varyantı `bg-indigo-600 text-white` yazıyordu ve `white`
koyu temada da beyaz kalıyordu. `indigo-600` koyu temada da koyu olduğu için
kusur gizliydi; aksan açık lacivertle değişince **1,35** kontrasta düşecekti.
`text-panel-accent-fg` ile kapandı.

Yazı tipi: `Figtree` **panel başlıklarına** (`h1/h2/h3`), `Inter` gövdeye.
Uygulama tek kuraldır (`index.css` → `.panel-kok :is(h1,h2,h3)`); ekran
dosyaları yazı tipi sınıfı YAZMAZ. Ekran başına yazılsaydı panelin bir kısmı
Figtree, bir kısmı Inter başlık taşırdı — aksanın yarım kalması riskinin
tipografideki ikizi. İkisi de **self-host** (Ç-5).

---

## 2. Tipografi

Medusa iki adlandırılmış ölçek taşır (`txt-compact-*`, `txt-*`). Biz **ham
Tailwind ölçeğini** kullanmaya devam ediyoruz ama **rol bazlı sabitliyoruz** —
yani serbestlik kalkıyor, yeni bir ölçek katmanı eklenmiyor.

| Rol | Sınıf | Ağırlık | Nerede |
|---|---|---|---|
| Sayfa başlığı (H1) | `text-xl` (mobil) / `sm:text-2xl` | `font-semibold` | Üst başlık alanı, sayfa başına **bir tane** |
| Bölüm başlığı (H2) | `text-base` | `font-semibold` | Kart/bölüm üstü |
| Alt başlık (H3) | `text-sm` | `font-semibold` | Bölüm içi gruplama |
| Gövde | `text-sm` | `font-normal` | Tablo hücresi, form değeri, paragraf |
| Yardımcı / açıklama | `text-xs` | `font-normal` | Alan ipucu, meta satırı, zaman damgası |
| Etiket (uppercase) | `text-[10px]` + `tracking-[0.14em]` | `font-semibold` | Gezinme grup başlığı, tablo başlığı |

Kurallar ve gerekçeleri:

1. **Sayfa başına tek `<h1>`.** Ekran içeriği kendi başına `<h1>` basmaz —
   başlık kabuktan gelir. Gerekçe: ekran okuyucu belge ana hattı; iki `<h1>`
   "bu sayfa nerede başlıyor" sorusunu belirsizleştirir.
2. **`font-bold` ve `font-black` panelde kullanılmaz.** Bugün 74 `font-bold`
   ve bir tekil `font-black` var. Yönetim panelinde en ağır seviye
   `font-semibold`tir; daha ağırı ekranı bağırtır ve hiyerarşi yaratmaz,
   gürültü yaratır.
3. **`text-lg`/`text-xl`/`text-3xl` gövdede kullanılmaz.** Üç ara boyut hiçbir
   ayrım üretmiyor; ölçek yukarıdaki altı role indirgenir. Sayısal vurgu
   (metrik kartındaki büyük sayı) istisnadır ve `text-2xl tabular-nums` yazılır.
4. **Sayılar `tabular-nums`.** Tutar, adet ve saat sütunlarında rakam
   genişliği sabitlenir; yoksa tablo satırları arasında sayılar kayar.

---

## 3. Boşluk ritmi ve düzen

Bugün panelde **43 farklı padding** ve **15 farklı gap** değeri var. Dil bunu
**altı adıma** indirger:

| Adım | Değer | Kullanım |
|---|---|---|
| `1` | 4px | İkon ↔ metin arası, rozet iç dolgusu |
| `2` | 8px | Satır içi denetimler arası, çip dolgusu |
| `3` | 12px | Form alanı iç dolgusu, gezinme öğesi dolgusu |
| `4` | 16px | Kart iç dolgusu (mobil), liste öğeleri arası |
| `6` | 24px | Kart iç dolgusu (masaüstü), bölümler arası |
| `8` | 32px | Sayfa üst boşluğu, büyük bölüm ayrımı |

**Neden 16 değil de 24 (ve tersi):** 16px "aynı şeyin parçaları" arasındaki
boşluktur (bir kartın içindeki iki satır); 24px "ayrı şeyler" arasındaki
boşluktur (iki kart, iki bölüm). Karar sorusu şudur: *bu iki öğe aynı cümlenin
kelimeleri mi, yoksa iki ayrı cümle mi?* Kelimeler 16, cümleler 24.

### 3.1 İçerik alanı

- Genişlik tavanı **1200px** (`max-w-[1200px]`), ortalanmış.
  **Neden 1200:** tabloların en geniş hâli (ürün listesi: seçim, görsel, ad,
  kategori, fiyat, stok, durum, aksiyon) 1100px civarında doyuyor; daha geniş
  bir alan satırları esnetip göz taramasını uzatıyor. Medusa da içerik alanını
  sınırsız bırakmaz.
  İstisna: **rota haritası ve dağıtım tahtası** tam genişlik kullanabilir,
  çünkü orada ölçülen şey mesafedir, metin değil.
- Yatay dolgu: mobil `16px`, ≥640px `24px`, ≥1024px `32px`.
- Dikey: üst başlıktan sonra `24px`, sayfa altında `48px` nefes payı.

### 3.2 Kutu yerine boşluk

Kalıcı karar: **kart enflasyonu yasaktır.** Bir bölümü ayırmak için önce
boşluk, sonra saç-teli çizgi (`border-panel-border`), en son kart denenir.
Kart yalnız şu üç durumda meşrudur:

1. İçerik **kendi başına bir kayıt** ise (mobil satır kartı, tur kartı),
2. İçeriğin **kendi aksiyonları** varsa (bölüm + "Düzenle" düğmesi),
3. İçerik **kaydırılabilir bir alt yüzey** ise (harita, defter).

Kart kalıbı tektir: `rounded-xl border border-panel-border bg-panel-surface`.
Gölge **yoktur** (aşağı bakınız).

### 3.3 Yükseklik (elevation)

Medusa rol bazlı adlandırılmış gölge ölçeği taşır. Biz daha da azını
kullanıyoruz — çünkü panelde 41 `shadow-sm` yığılmış ve hiçbiri bilgi
taşımıyor:

| Rol | Değer |
|---|---|
| Zemin üstü yüzey (kart, tablo) | **gölge yok**, yalnız `border` |
| Açılır katman (menü, popover, tooltip) | `shadow-lg` |
| Pencere (dialog, çekmece, komut penceresi) | `shadow-2xl` |

**Neden kartta gölge yok:** gölge "bu şey zeminden ayrı bir katmanda" der. Bir
kart zeminden ayrı bir katmanda değildir; kenarlık yeter. Gölge, gerçekten
üstte yüzen şeyler için ayrılırsa bir anlam taşır.

### 3.4 Köşe yarıçapı

Bugün `rounded-lg`(89) / `rounded-xl`(73) / `rounded-2xl`(69) birbiriyle
yarışıyor. Hiyerarşi sabitlendi:

| Rol | Değer |
|---|---|
| Küçük denetim (rozet, çip, ikon düğme) | `rounded-lg` (8px) |
| Girdi, düğme, gezinme öğesi, kart | `rounded-xl` (12px) |
| Pencere, çekmece, komut penceresi | `rounded-2xl` (16px) |

Kural: **yarıçap öğenin büyüklüğüyle birlikte artar**, keyfî değildir.

---

## 4. Kabuk (panel çerçevesi)

### 4.1 Masaüstü (≥1024px)

```
┌──────────────┬──────────────────────────────────────────────┐
│  RAIL 264px  │  ÜST BAŞLIK  (yol · başlık · birincil aksiyon)│
│              ├──────────────────────────────────────────────┤
│ ┌──────────┐ │                                              │
│ │ marka    │ │                                              │
│ │ arama ⌘K │ │            İÇERİK (max-w-1200)               │
│ ├──────────┤ │                                              │
│ │ gezinme  │ │                                              │
│ │  (kayar) │ │                                              │
│ ├──────────┤ │                                              │
│ │ Ayarlar  │ │                                              │
│ │ profil ▲ │ │                                              │
│ └──────────┘ │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

Üç bölge, Medusa'nın kendi çubuğuyla aynı:

- **Üst:** marka + **arama öğesi**. Arama bir girdi değil, komut penceresini
  açan bir düğmedir ve yanında `Ctrl+K` tuş rozeti taşır.
  **Neden düğme:** rail'de gerçek bir girdi olsa iki arama alanı doğardı
  (rail + liste sayfasının kendi araması) ve hangisinin neyi aradığı
  belirsizleşirdi. Medusa da aynı sebeple düğme kullanır.
- **Orta:** alan gezinmesi, gruplu (Platform · Eğitim · Ticaret · Operasyon ·
  Güvenlik). Yalnız bu bölge kayar; üst ve alt bölge sabittir.
  **Neden yalnız orta kayar:** 20 öğeli bir menüde tümü kayarsa arama ve profil
  ekrandan çıkar; ikisi de her an erişilebilir olmalıdır.
- **Alt:** **Ayarlar** + **profil**. Profil bir açılır menüdür: ad/e-posta,
  profil bağlantısı, çıkış. (Tema anahtarı vardı; tek tema kararıyla kalktı.)

**Rail genişliği 264px.** Neden: en uzun öğe metni ("Deneme Katalogları") +
ikon + rozet + dolgu 240px'e sığıyor; 264 bir satırlık kırılma payı bırakıyor.
Daha dar olsa uzun etiketler kesilirdi, daha geniş olsa içerik alanından çalardı.

**Katlanabilirlik.** Rail 264px ↔ **72px** arasında katlanır. Katlı hâlde
yalnız ikon görünür; erişilebilir ad `aria-label` ile korunur ve `title` ile
işaretçi ipucu verilir. Durum `localStorage`'da yaşar (`adana-panel-kabuk`) —
her açılışta yeniden katlamak, katlama özelliğini işe yaramaz kılardı.

**Katlı genişlik neden 72:** 40px'lik dokunma/tık hedefi + her iki yanda 16px
dolgu = 72. 64'te hedef kenarlara yapışıyor, 80'de ikon ortada yüzüyor.

### 4.2 Üst başlık alanı

Kabuğun üstünde, `sticky`, alt kenarında saç-teli çizgi:

- **Sol:** sayfa yolu (`Yönetim / Mağaza`) ve altında `<h1>` sayfa başlığı +
  açıklama. Mobilde yol gizlenir (yer yok), yalnız başlık kalır.
- **Sağ:** birincil aksiyon yuvası + bildirim zili.

**Neden birincil aksiyon üst başlıkta:** liste sayfalarında "Yeni ürün" gibi
tek bir birincil aksiyon vardır ve her ekranda aynı yerde olmalıdır. Bugün
kimi ekranda tablonun üstünde, kimi ekranda filtrenin yanında duruyor.

### 4.3 Mobil (<1024px) — Ç-1 kararının uygulaması

- Rail **gizlenir**. Üst başlık alanı hamburger + başlık + zil olur.
- Gezinme **soldan çekmece** olarak açılır (`role="dialog"` + `aria-modal` +
  odak tuzağı + ESC + gövde kaydırma kilidi). Bugünkü davranış korunur.
- **Alt gezinme çubuğu YAPILMAZ.** Gerekçe ölçülebilir: yönetim gezinmesi beş
  grupta **20 öğedir**; bir alt çubuk en fazla 5 yuva taşır. Kalan 15 öğe ya
  "Daha fazla" arkasına saklanırdı (iki dokunuş — çekmeceyle aynı maliyet) ya
  da beş öğe keyfî seçilirdi. Alt çubuk 3-5 öğeli **rol panellerinin** deseni
  olarak doğrudur (operatör, kurye) ve o paketlerde ayrıca ele alınacaktır —
  ama onlar `DashboardShell` kullanıyor, bu kabuğu değil.
- Komut penceresi mobilde de çalışır; tetikleyicisi çekmecenin üstündeki arama
  öğesidir (fiziksel klavye yoksa `Ctrl+K` erişilemez).

### 4.4 Klavye

| Kısayol | Etki |
|---|---|
| `Ctrl+K` / `⌘K` | Komut penceresi |
| `G` sonra `<harf>` | Alana git (rozet olarak komut penceresinde gösterilir) |
| `Esc` | Açık pencereyi/çekmeceyi kapat |

**Neden `G` + harf:** Medusa'nın deseni. Tek harfli kısayol bir metin
alanındayken yazmayı bozar; iki tuşlu dizi bu çakışmayı doğal olarak çözer
(ilk tuş bir metin alanında yakalanmaz).

Kısayollar **girdi odaktayken çalışmaz** — `input`/`textarea`/`select`/
`contenteditable` odaktayken dizi başlatılmaz. Aksi hâlde "Görev" yazarken
`G` gezinmeyi tetiklerdi.

---

## 5. Liste sayfası anatomisi

Yukarıdan aşağı, **sabit sıra**:

```
1  Üst başlık   : yol · <h1> · açıklama · birincil aksiyon (kabuktan)
2  Araç çubuğu  : arama girdisi | "Filtre ekle" | sıralama | [seçim aksiyonları]
3  Uygulanan    : filtre çipleri + "Tümünü temizle"
4  Tablo        : başlık satırı · satırlar · satır aksiyonları
5  Sayfalama    : "N kayıt" · sayfa boyu · Önceki / Sonraki
```

### 5.1 Araç çubuğu

- **Arama** solda, tek girdi, **300 ms gecikmeli** ve URL'e yazılır (`q`).
  Gecikme neden 300: 150 ms'te her tuşta istek gidiyor, 500 ms'te yazmayı
  bitirip beklemek gerekiyor. `ProductsPanel` bugün 300 kullanıyor ve doğru.
- **"Filtre ekle"** açılır menüsü: önce kriter, sonra değer. Uygulanan her
  filtre bir çip olur ve çipin kendi kaldırma düğmesi vardır.
- **Sıralama ayrı bir düğmedir** (alan + yön) **ve tablo başlığındaki
  sıralama göstergesi korunur.** Medusa'nın ana listelerinde sıralama hiç
  yoktur; bizde `manualSorting` ile sunucu taraflıdır ve bu bizim artımızdır
  (kilitli karar).
- Filtreler **URL'de yaşar** (`useUrlDurumu`) — kilitli karar. Sayfa yenilenince
  ya da bağlantı paylaşılınca aynı liste açılır.

### 5.2 Tablo

- Ortak `DataTable` **zorunludur**. Envanter ve hasar sayfalarının elle yazılmış
  tabloları B serisinde ona taşınır.
- **Satır aksiyonları: en fazla 2 açık düğme, fazlası üç nokta menüsünde**
  (kilitli karar, Ç-2 · **Seçenek D**; İP-B2'de uygulandı). Masaüstü ve mobil
  AYNI deseni kullanır. **Açıktakilerin hiçbiri yıkıcı olamaz** (sil/iptal/
  iade); yıkıcı aksiyon her zaman menüde ve **onay adımlıdır**.

  Kural yazıyla değil **bileşende** zorlanır (`ui2/liste/satirAksiyonlari.tsx`):
  üçüncü açık düğme ya da açıkta bir yıkıcı aksiyon verilirse geliştirmede
  `throw`, üretimde `console.error` + güvenli bozunma. Gerekçe İP-B1'in
  `Form.Control` dersidir: zorlanmayan bir sözleşme çürür.

  "Hangi ikisi birincil" kararı **ekranındır** — üründe "Düzenle" +
  "Yayınla/Gizle", pakette "Yeniden paketle" + "Etiket".
- Satır tıklaması gerçek gezinti semantiği taşır: `onRowClick` verildiğinde
  erişilebilir ad **çağırandan** gelir (kilitli karar 7 — kart `<button>`a
  sarılmaz).
- Sütun sırası: kimlik → ayırt edici alanlar → durum → sayısal → aksiyon.
  Sayısal sütunlar sağa yaslı ve `tabular-nums`.

### 5.3 Boş, yükleniyor, hata — üçü ayrı

| Durum | Bileşen | İçerik |
|---|---|---|
| Hiç kayıt yok | `EmptyState` (kayıt-yok) | "Henüz … yok" + **birincil aksiyon** |
| Arama/filtre eşleşmedi | `EmptyState` (sonuç-yok) | "Eşleşen … bulunamadı" + **"Filtreleri temizle"** |
| Yükleniyor | `PageSkeleton` | Tablo iskeleti, satır sayısı sayfa boyu kadar |
| Hata | `ErrorState` + `role="alert"` | Hata metni + **"Yeniden dene"** |

**Neden iki ayrı boş durum:** ikisi farklı kullanıcı niyetidir. "Hiç kayıt yok"
diyen kullanıcı bir şey **yaratmak** ister; "eşleşme yok" diyen kullanıcı
**filtresini gevşetmek** ister. Tek bileşen ikisine de yanlış aksiyon sunar.
Medusa bunu `NoRecords`/`NoResults` diye ikiye ayırmış.

### 5.4 Sayfalama

Altta, `20`'şerli varsayılan, `10/25/50` seçici + Önceki/Sonraki. Solda toplam
kayıt sayısı. Sayfa numarası URL'dedir.

### 5.5 Mobil karşılığı

- Tablo `md:` altında **gizlenir**, yerine `renderMobileRow` kartları gelir.
  Yatay kaydırma **çözüm değildir** — bugünkü `min-w-[64rem]` kapsayıcılar
  B serisinde kart desenine geçer.
- Kart anatomisi: üstte kimlik satırı (ad + durum rozeti), altında en fazla
  **üç meta satırı**, en altta aksiyon düğmeleri (tam genişlik, min 44px).
  Üçten fazlası kartı listeye çevirir ve tarama avantajını yok eder.
- Araç çubuğu mobilde iki satıra kırılır: arama tam genişlik, altında filtre
  ve sıralama düğmeleri yan yana.
- Kart `<button>`a sarılmaz (kilitli karar 7).

---

## 6. Detay sayfası anatomisi

Detay **gerçek bir sayfadır**, pencere değil — deep-link ve geri tuşu bedava
gelir.

```
Üst başlık (kabuktan): yol · kayıt adı · durum rozeti · [aksiyonlar]
├─ Özet şeridi        : 3-5 anahtar değer, çizgiyle ayrılmış, kutusuz
├─ Bölüm 1 (salt okunur) ………………………………… [Düzenle]
├─ Bölüm 2 (salt okunur) ………………………………… [Düzenle]
└─ Yan sütun (≥1280px) : ilişkili kayıtlar, zaman çizelgesi
```

- **Salt okunur bölüm + ayrı düzenleme yüzeyi.** Bir bölümün "Düzenle"si o
  bölümün alanlarını içeren bir çekmece açar. Gerekçe: tek uzun form hem
  okunmaz hem de bir alanı düzeltmek için tümünü riske atar.
- Yan sütun ≥1280px'te görünür; altında kalırsa ana akışın sonuna iner.
- Zaman çizelgesi (durum geçmişi) detay sayfasının **standart** bölümüdür.

---

## 7. Düzenleme yüzeyi: ne zaman ne

Kilitli karar 6: ekranlarda pencere `useState`'i yaşamaz — her şey
`ui2/duzenlemeYuzeyi` üzerinden. Yüzey **tipi** şu tabloya göre seçilir:

| Yüzey | Ne zaman | Neden |
|---|---|---|
| **Satır içi** (inline) | Tek alan, anında etkili (aktif/pasif anahtarı, sıra numarası) | Pencere açmak tek bir anahtarı çevirmek için fazla ağır |
| **Çekmece** (`Drawer`, sağdan) | 1-8 alanlık **düzenleme**; kullanıcının arkadaki listeyi görmeye devam etmesi değerliyse | Bağlam kaybolmaz; "hangi kaydı düzenliyordum" sorusu doğmaz |
| **Tam ekran pencere** (`FocusModal`) | **Oluşturma** ve çok adımlı akışlar; 8+ alan; görsel yükleme gibi alan gerektiren işler | Yeni kayıt yaratmak yeni bir bağlamdır; arkadaki liste dikkat dağıtır |
| **Onay penceresi** (`Prompt`) | Geri alınamayan tek aksiyon | Metin **ne kaybedileceğini** söyler; "Emin misiniz?" tek başına yasaktır |

Her yüzey için değişmezler:

1. `role="dialog"` + `aria-modal` + erişilebilir ad (nöbetçi eşiği: **0**).
2. Odak tuzağı, ESC, odak geri dönüşü, gövde kaydırma kilidi.
3. **Kirli form bekçisi**: kapatma isteği kaydedilmemiş değişiklik varsa onay
   ister (`useYuzeyKirliFormBekcisi`).
4. Sabit alt şerit (footer): sağda **Kaydet**, solunda **Vazgeç**.
5. Alan hataları alanda, form geneli/sunucu hataları şeritte (kilitli karar 5).
6. **Gönder düğmesi geçerlilikle kapanmaz** (kilitli karar 4): geçersizse
   gönderim yapılmaz, hatalar alanlarda görünür, odak ilk hatalı alana gider.

Mobilde çekmece **alttan yükselen sayfa** (sheet) olur, tam ekran pencere zaten
tam ekrandır.

---

## 8. Adımlı akış (`ProgressTabs`)

Adımlı akış **üç koşulun üçü birden** sağlanınca kullanılır:

1. Akış bir **oluşturma** akışıdır (düzenleme değil),
2. Alanlar **doğal olarak** 3-4 anlamlı kümeye ayrılıyor,
3. Sonraki adımın içeriği önceki adıma **bağlı** (ör. varyant ekseni
   seçilmeden varyant tablosu üretilemez).

Sadece "form uzun" olması yetmez — uzun ama düz bir form katlanır bölümlerle
daha iyi okunur; adım eklemek gereksiz tıklama üretir.

Kurallar:

- Her adımın **kendi doğrulaması** vardır; "Devam" geçersiz adımda ilerlemez,
  odak ilk hatalı alana gider (kilitli karar 4 adım düzeyinde de geçerli).
- Tamamlanan adım sekmede işaretlenir; kullanıcı **geri dönebilir**.
- Son adımın düğmesi işi adlandırır: "Yayınla", "Oluştur" — "Bitir" değil.
- İlerleme **kaybolmaz**: pencere kapatma isteği kirli form bekçisine düşer.
- **Görsel yükleme akışın içindedir**, ayrı ekran değildir (Medusa'nın deseni;
  bizde bugün `uploadProductImages` yazılmış ama hiçbir bileşen çağırmıyor).

---

## 9. Ayarlar bölümü

Ayarlar **kendi alt gezinmesi olan ayrı bir bölümdür**, tek bir uzun sayfa
değil. Bugün `/yonetim/ayarlar` yalnız ödeme kolu kapıları + özellik
bayraklarını taşıyor; B serisinde şunlar da oraya taşınacak (tur 2 raporundaki
"`.env` sabiti" kalemleri):

```
/yonetim/ayarlar
├─ Genel              (işletme bilgileri, OPERATOR sabiti)
├─ Ödeme              (kol kapıları — bugün burada)
├─ Özellik bayrakları (bugün burada)
├─ Kargo ve teslimat  (ücret, ücretsiz kargo eşiği, teslimat ilçeleri)
├─ Vergi              (varsayılan oranlar, SHIPPING_TAX_RATE)
└─ Bildirim/e-posta   (şablon ayarları)
```

Alt gezinme **soldaki dikey liste** olarak durur (Medusa deseni), mobilde
yatay kaydırılabilir sekme şeridine döner. Rail'deki "Ayarlar" öğesi alt
bölgede, gezinme gruplarının dışındadır — çünkü ayarlar bir **alan** değil,
bir **kip**tir.

---

## 10. İkonlar

- Panelde ikon **tek kaynaktan** gelir. Bugün admin ağacında
  `@tabler/icons-react` yüklü ama hiç kullanılmıyor; ikonlar 10 dosyada elle
  inline `<svg>` olarak dağınık. `@medusajs/icons` paketi **kurulu** (465 ikon,
  15×15 viewBox, `currentColor`).
- **Kural:** yeni ikon yazılmaz, `ui2/` üzerinden `@medusajs/icons`ten alınır
  (ekran dosyası doğrudan import edemez — kilitli karar 1).
- İkon **hiçbir zaman tek başına anlam taşımaz**: ya yanında metin vardır ya da
  `aria-label` ile adlandırılmıştır. Dekoratif ikon `aria-hidden="true"`.
- Boyut: gezinme ve düğme içinde 18px, tablo hücresinde 16px, boş durumda 24px.

**Kabuk bu turda inline `<svg>` taşımaya devam ediyor** — ikon göçü kendi
paketini hak ediyor ve kabukla karıştırılırsa ikisi de yarım kalır (bkz. rapor ·
bilinen sınırlar).

---

## 11. Değişmezler (nöbetçi eşikleri)

Bu dil aşağıdakileri **bozamaz**. Bozuyorsa tasarım kararı yanlıştır:

| Eşik | Değer | Nöbetçi |
|---|---|---|
| Etiketsiz overlay | `toBe(0)` | `uiBaseline.test.ts` |
| Ekranda yaşayan pencere durumu | `toBe(0)` | `uiBaseline.test.ts` |
| Erişilebilir adı olmayan form kontrolü | `≤ 7` (kaynak) / `0` (çalışma zamanı) | `uiBaseline` + `calismaZamaniKapisi` |
| Ham `<button>` | artamaz | `uiBaseline.test.ts` |
| `ui2/` dışında `@medusajs/ui` importu | `toEqual([])` | `uiBaseline.test.ts` |
| **`src/**` içinde `indigo-` sınıfı** | `toEqual([])` | `markaAksani.test.ts` (Ç-4) |
| **Aksan/hover/çip AA kontrastı** | `≥ 4,5` (kaynaktan hesaplanır) | `markaAksani.test.ts` (Ç-4) |
| **Dolgulu uyarı düğmesi** (`bg-*dikkat*` + `text-white`) | `toEqual([])` | `markaAksani.test.ts` (Ç-4) |
| **Köprüde karşılığı olmayan marka sınıfı** | `toEqual([])` | `gecerliMarkaSinifi.test.ts` (Ç-4) |
| **Dış yazı tipi konağına atıf** | `toEqual([])` | `disFont.test.ts` (İP-B2 · KVKK) |
| **Satır başına açık düğme** | `≤ 2`, hiçbiri yıkıcı değil | `satirAksiyonlari.tsx` (çalışma zamanı) |

Ek olarak: ölçüm tabanına giren her yeni panel dosyası `OLCUM_TABANI`'na
**ve** çalışma zamanı kapısının kapsamına yazılır. Sessizce eklenen bir dosya
ölçüme girmez ve borç görünmez büyür.

---

## Ek A — Bilinçli istisna: `/ilanini-olustur` (eğitmen ilan sihirbazı)

**Tarih:** 5 Eylül 2026 · **Karar:** kullanıcı · **Kapsam:** yalnız
`frontend/src/pages/tutorOnboarding/**`

Bu belgenin kapsamı (§0) yönetim panelidir; ilan sihirbazı public bir ekrandır
ve teknik olarak zaten kapsam dışıdır. Yine de istisna buraya yazılıyor: bu
belge deponun tek yazılı tasarım karar kaydı ve sihirbazın kabuğu kendi içinde
"kart yok" kararını yazmıştı. Yazılmazsa bir sonraki oturum o yorumu okuyup
kartı söker.

### Ne değişti

| Kural | Sihirbazdaki hâli |
|---|---|
| §3.2 "kart enflasyonu yasaktır" | Adımın yardım metni **dolgulu bir kart** (`BilgiKarti`). Sorunun kendisi hâlâ kutusuz. |
| §2 "en ağır `font-semibold`" | Adım başlığı `font-bold`, 30→46px, vurgulu sözcük ikinci renkte. |
| Aksan indigo / panel laciverti | Sihirbaz **mercan** (`#F2695E`). |

### Neden

Kullanıcı akışı gerçek bir sunucuda kullandı: *"bizimki bok gibi, neyin ne
olduğu belli değil."* Ölçülen kusur estetik değil işlevsel — her adımda
kullanıcının aklındaki "bunu neden soruyorsunuz, ne yazmam lazım" sorusu
ekranda cevaplanmıyordu. Saç teli çizginin yanındaki soluk gri paragraf
okunmuyor. Sihirbaz bir dönüşüm hunisidir ve ölçüsü **tamamlanma oranıdır**,
panelin ölçüsü olan tarama hızı değil: burada kullanıcı listeyi gözüyle
taramıyor, tek bir soruya cevap yazıyor. Tek-soru-tek-ekran düzeninde başlık
sayfanın tek yön bulma işaretidir; küçük bir başlık o işareti yok eder.

### Kapsam kilidi

Bu istisna **yalnız** `src/pages/tutorOnboarding/**` için geçerlidir. Başka bir
ekran "sihirbazda böyle yapılmış" diyerek buraya dayanamaz.

- Mercan **Tailwind token'ı DEĞİL**: `pages/tutorOnboarding/tema.ts` içinde
  yerel sabit. Token eklemek rengi tüm siteden erişilebilir kılar ve panel
  token ailesiyle karışırdı.
- Nöbetçi: `src/__guards__/sihirbazMercani.test.ts` — mercan hex'inin her
  geçtiği yer bu ağacın altında olmak zorunda, `tailwind.config.js` temiz
  kalmak zorunda.
- Kabuğun kendi sözleşmesi: `pages/tutorOnboarding/kabuk.test.tsx` — bilgi
  kartı ve aksiyon çubuğu DOM'da tek kopya, ilerleme oranı adım sözleşmesinden
  türer, iOS klavye eşiği çalışır.

### Değişmeyenler

Tek tema (`dark:` yasağı), 16px girdi yazısı, 44px dokunma hedefi, tek mesaj
slotu ve birincil düğmenin doğrulamayla `disabled` olmaması bu ekranlarda da
aynen geçerlidir.

