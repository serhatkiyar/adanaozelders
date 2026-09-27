# İP-C1 düzeltme — ölçüm raporu

Dal: `feat/magaza-hero` · Ölçüm tarihi: 22 Ağustos 2026
Alet: `frontend/scripts/ip_c1_kontrast.mjs` (gerçek Chrome + ham CDP)

Denetim İP-C1'i iki P1 ile geri çevirdi; **ikisi de ölçüm aletindeydi, banner'da
değil**. Bu belge sırayı takip eder: önce alet düzeltildi, sonra taze taban
ölçüldü, tasarım kararı **en sonda ve ölçüme dayanarak** verildi.

---

## 1 · Aletteki iki kusur ve nasıl kapatıldı

### P1-1 · object-fit eşlemesi ölçeği iptal ediyordu

Eski kod zemini `<img>`in **natural** piksellerinden okuyordu:

```js
const natXScaled = dx * scale + offX;
const nx = Math.round(natXScaled / scale);   // = dx + offX  →  scale sadeleşiyor
```

`scale` çarpılıp bölündüğü için ölçüm "CSS pikseli natural piksele eşittir"
varsayan bir şeye dönüşmüştü. Denetimin kanıtı: metin +200 CSS px kaydırıldığında
natural aralık 375→553 px kaymalıyken alet sabit 200 px kaydırıyordu.

**Formül düzeltilmedi — yaklaşım değiştirildi.** Natural pikselden okumak,
object-fit kırpmasını, scrim alfa kompozisyonunu, temayı, `transform`u ve DPR'yi
elle modellemeyi gerektiriyordu; her biri ayrı bir sessiz hata kaynağı.

Yeni alet **`Page.captureScreenshot` ile render edilmiş sayfanın kompozit
pikselini** okur. Geriye tek bir koordinat dönüşümü kalır, o da ölçülebilirdir:

```
ekranGoruntusuPx = cssViewportPx × (ssGenislik / window.innerWidth)
```

Ölçek tahmin edilmez, **ekran görüntüsünün kendi genişliğinden türetilir** →
deviceScaleFactor ne olursa olsun kendini düzeltir.

Metin nasıl "arkasındaki zemin"e dönüşüyor: ölçümden hemen önce metnin rengi
saydama çekilir (`color` + `-webkit-text-fill-color`), kare alınır, renk geri
konur. Yerleşim ve örtü yerinde kalır, kareden yalnız glyph'ler düşer — yani
örneklenen her piksel gerçekten metnin ARKASIDIR. (Aksi hâlde glyph pikselini
zemin sanıp 1.0 kontrast raporlama riski vardı.)

Diğer iki iyileştirme:

| | eski | yeni |
|---|---|---|
| örnekleme alanı | elementin kutusu (scrim dolgusu dâhil) | metnin kendi satır kutuları (`Range.getClientRects`) |
| ızgara | 11×11 = 121 nokta, sabit | ≤ 2 CSS px adım → 432–896 nokta (viewport'a göre) |
| tekrarlanabilirlik | commit 6.9 / taze koşu 6.84 (aynı kod) | aynı kodda koşular arası fark gözlenmedi |

### P1-2 · sıfır örnek = yeşil kapı

Eski kapı `gecti === false` sayıyordu. Hata kaydında `gecti` **undefined**
olduğu için sayıma hiç girmiyordu → kapsamın yarısı sessizce düşerken exit 0.
Denetimde gerçekten yaşandı (soğuk koşu, selector bulunamadı, kapı yeşil).

Yeni kapı (`kapiSonucu`, saf fonksiyon):

* beklenen kombinasyon sayısı **önceden sabit** (banner × genişlik × tema = 8),
* `gecti === true` sayısı bu sayıya eşit değilse **exit 1**,
* tek bir `hata` kaydı varsa **exit 1**,
* selector bulunamazsa ölçüm **açık mesajla patlar** (sessiz "bulunamadı" kaydı
  üretmez).

---

## 2 · Aletin kendi kapısı (`--selftest`)

Alet artık "hep yeşil" olamayacağını kanıtlamak zorunda:

```
✓ S-4a hata kaydı exit 1
✓ S-4b sıfır örnek exit 1
✓ S-4c tam kapsam exit 0
✓ S-1 scrim alfa 0 → eşik GEÇMEMELİ — kontrast 1.01 (eşik 4.5), 752 örnek
✓ S-3 +200 CSS px kayma → örnek aralığı 200×DPR kaymalı — beklenen 400px, ölçülen 400px (DPR 2)
✓ S-2 bozuk selector → açık mesajla patlar
SELFTEST: TAMAM
```

**S-3 neden DPR 2 ile koşuluyor:** DPR 1'de `200 × 1 = 200` olduğu için nöbetçi,
ölçek çarpanı tamamen kaldırılmış olsa bile geçerdi — yani hiçbir şey ayırt
etmezdi. DPR 2'de beklenen kayma 400 px'tir ve çarpan gerçekten sınanır.

**Mutasyon provası (M3):** `Math.round(cssX * olcek)` → `Math.round(cssX)`
(ölçek çarpanı kaldırıldı):

```
✗ S-3 — beklenen 400px, ölçülen 200px (DPR 2)
SELFTEST: BAŞARISIZ · süreç çıkış kodu 1
```

Ölçülen 200 px, eski aletin kusurunun tam imzasıdır. Mutasyon geri alındı,
selftest yeniden yeşil.

---

## 3 · Taze taban (DEĞİŞTİRİLMEMİŞ kod, `bg-black/80`)

Düzeltilmiş aletle, tasarıma hiç dokunmadan:

| kombinasyon | en kötü kontrast | örnek |
|---|---|---|
| landing-magaza · vp1280 · açık/koyu | **8.82** | 752 |
| landing-magaza · vp380 · açık/koyu | **8.82** | 432 |
| magaza-ozelders · vp1280 · açık/koyu | **19.76** | 896 |
| magaza-ozelders · vp380 · açık/koyu | **19.76** | 504 |

Kapı: 8/8. (Commit mesajındaki 6.84–19.06 aralığı bozuk eşlemeyle ölçülmüştü.)

## 4 · Scrim alfa taraması (metin ORTADAYKEN)

Her banner için tüm viewport × tema kombinasyonlarındaki **en kötü** değer:

| alfa | landing-magaza (turuncu/yeşil) | magaza-ozelders (beyaz/mor) |
|---|---|---|
| 0.0 | 1.51 | **9.32** ✔ |
| 0.3 | 2.85 | 13.16 ✔ |
| 0.5 | **4.57** ✔ | 16.10 ✔ |
| 0.6 | 5.78 ✔ | 17.44 ✔ |
| 0.7 | 7.30 ✔ | 18.79 ✔ |
| 0.8 | 8.82 ✔ | 19.76 ✔ |

En düşük güvenli alfa: **landing 0.50** · **mağaza 0.00**.

Ham çıktı: `docs/arsiv/ip-c/ip-c1/taban/` (bu tablo, sevk edilen tasarım geçici olarak geri
alınıp `HEAD`'in kodu geri yüklenerek yeniden üretildi ve arşivlendi; sayılar
ilk koşuyla birebir aynı çıktı).

Bu, denetimin sayılarını bağımsız olarak doğruluyor (denetim: mağaza örtüsüz
9.32, landing 0.6→5.72, 0.5→4.48). Yani `bg-black/60 → /80` kararı gerçekten
**hayali bir sayıya** dayanıyordu: mağaza banner'ının örtüye hiç ihtiyacı yoktu,
landing'in ihtiyacı ise 0.80 değildi.

---

## 5 · Tasarım kararı

### Mağaza sayfası (`/magaza`) — örtü tamamen KALDIRILDI

Ölçüm: beyaz metin, düz mor zeminde örtüsüz **9.32** — eşiğin (4.5) iki katı.
Örtü okunabilirliğe hiçbir şey katmıyor, yalnız düz mor alanın üstüne siyah bir
hap çiziyordu. `headingClassName` artık sadece `text-white`.

### Ana sayfa (`/`) — orta hap yerine yönlü gradyan

Turuncu (`#F6AD55`) metin yeşil zeminde örtüsüz **1.51** — örtü zorunlu.

Metin sola yaslanınca zemin değişti (düz yeşil yerine sarı defter + beyaz kâğıt
dekoru), bu yüzden tarama **metin yeni yerindeyken tekrarlandı**
(`docs/arsiv/ip-c/ip-c1/scrim-taramasi.json`):

| alfa | landing (metin SOLDA) | mağaza (örtü kaldırılmış) |
|---|---|---|
| 0.0 | 1.01 | **9.32** ✔ |
| 0.3 | 1.28 | 13.16 ✔ |
| 0.5 | 2.35 | 16.10 ✔ |
| 0.6 | 3.34 | 17.44 ✔ |
| 0.7 | **4.85** ✔ | 18.79 ✔ |
| 0.8 | 6.95 ✔ | 19.76 ✔ |

En düşük güvenli uniform alfa: **0.70**.

"Bir kademe üstü" → **0.80**. Uygulanan biçim:

```
bg-gradient-to-r from-black/80 from-0% via-black/80 via-26% to-transparent to-62%
```

0.80'lik koyuluk metnin bittiği yere kadar (%26 — vp380'de metnin sağ kenarı
%23) düz korunur, sonra %62'de tamamen söner; sağdaki dekor (kalem/silgi/cetvel)
kirlenmeden kalır.

Örtü artık metnin arka planı değil, **ayrı bir katmandır** (`data-hero-scrim`) —
metin kutusundan geniş biçimler ancak böyle kurulabilir.

### Sevk edilen tasarımın taze ölçümü

| kombinasyon | kontrast | eşik | örnek |
|---|---|---|---|
| landing-magaza · vp1280 · açık | **6.97** | 4.5 | 752 |
| landing-magaza · vp1280 · koyu | **6.97** | 4.5 | 752 |
| landing-magaza · vp380 · açık | **8.81** | 4.5 | 432 |
| landing-magaza · vp380 · koyu | **8.81** | 4.5 | 432 |
| magaza-ozelders · vp1280 · açık | **9.32** | 4.5 | 896 |
| magaza-ozelders · vp1280 · koyu | **9.32** | 4.5 | 896 |
| magaza-ozelders · vp380 · açık | **9.32** | 4.5 | 504 |
| magaza-ozelders · vp380 · koyu | **9.32** | 4.5 | 504 |

**KAPI: 8/8 · exit 0.** Odak halkası her kombinasyonda gerçek `:focus-visible`
altında doğrulandı (ölçümden önce gerçek Tab tuşu gönderilir).

---

## 6 · Nöbetçi testler (önce SIFIRDI)

`frontend/src/components/crossPromoBanner.acceptance.test.tsx` — üretim
kodundan ÖNCE yazıldı.

| | iddia | tür |
|---|---|---|
| N-1 | ana sayfada banner'ın erişilebilir adı + `href` + `src` + `alt=""` + LCP ipuçları | gerçek DOM (RTL) |
| N-2 | mağaza sayfasında aynısı | gerçek DOM (RTL) |
| N-2b | iki banner birbirinin sayfasına gider (yön karışmaz) | gerçek DOM (RTL) |
| N-3 | ölçüm scripti banner adlarını `crossPromo.json`dan alır, sabit string kopyalamaz | kaynak sözleşmesi (§C, düşük güçlü) |

**Tek kaynak:** `frontend/src/config/crossPromo.json` — hem `Landing.tsx` hem
`StorePage.tsx` hem `ip_c1_kontrast.mjs` aynı dosyadan besleniyor. Artık script
selector'ü ile bileşen etiketi ayrışamaz.

### Kırmızı faz (üretim kodu değişmeden)

```
× N-1  expected null to be 'high'          (img fetchpriority yok)
× N-2  expected null to be 'high'
✓ N-2b (regresyon nöbetçisi — bilerek yeşil)
× N-3  script crossPromo.json'u import etmiyor
```

### Mutasyon provası

| mutasyon | sonuç |
|---|---|
| M1 · `crossPromo.json`daki etiketi değiştir | **4/4 yeşil kaldı** — doğru: sayfa da script de aynı dosyadan okuyor, ayrışma yok. Bu mutasyon sözleşmeyi ayırt etmiyor |
| M1b · sayfa etiketi elle kopyalasın (tek kaynaktan kopsun) | ✗ N-1, ✗ N-2b — `Unable to find role="link" and name "Mağazaya git"` |
| M2 · script'e sabit `a[aria-label="Mağazaya git"]` kopyası ekle | ✗ N-3 |
| M3 · ölçümde ölçek çarpanını kaldır | ✗ S-3 (yukarıda), süreç exit 1 |

M1'in yeşil kalması **kusur değil bulgudur**: sözleşmeyi ayırt eden mutasyon
M1b'dir ve tuttu.

---

## 7 · Performans

* `<img>`e `fetchpriority="high"` + `decoding="async"` eklendi. (`preload`
  eklenmedi — talimat yalnız bu ikisini istedi.)
  React 18.3'ün DOM'u `fetchPriority`yi tanımıyor, bu yüzden attribute **küçük
  harfle** ve spread ile veriliyor; camelCase yazımı geliştirme uyarısı basıyor.
* Retina varlıkları yeniden üretildi (`ffmpeg` + `libwebp`):

| varlık | gösterildiği yer | eski | yeni | boyut |
|---|---|---|---|---|
| `magaza-hero.webp` | ana sayfa | 2280×220 · 18,364 B | **2432×234** | **19,588 B** |
| `ozelders-hero.webp` | mağaza | 2280×220 · 48,350 B | **2800×270** | **59,618 B** |

İkisi de 150 KB sınırının çok altında. **Kalite ayarı tahmin edilmedi:**
`-quality 82` mevcut iki dosyanın boyutunu **bayt bayt** yeniden ürettiği için
(18,364 / 48,350) orijinal ayar bu olarak saptandı ve aynen kullanıldı.

> ⚠ **Dürüstlük notu — bunlar ÜST ÖLÇEKLEMEDİR.** Elimizdeki en yüksek
> çözünürlüklü kaynak PNG'ler 2280×220'dir (Masaüstündeki üç aday da aynı).
> 2432 ve 2800 px'lik varlıklar Lanczos ile büyütülmüştür: tarayıcının kendi
> büyütmesinden biraz daha iyi bir yeniden örnekleme sağlarlar ama **yeni ayrıntı
> taşımazlar**. Gerçek 2× keskinlik isteniyorsa kaynak görseller o genişlikte
> yeniden üretilmelidir.

---

## 8 · Script hijyeni

* **Süreç sonlandırma:** `chromeProc.kill()` Windows'ta yalnız başlatılan süreci
  hedefliyordu (denetimde sızıntı görüldü). Artık `taskkill /PID <pid> /T /F` ile
  ağaç kesiliyor, ardından **kalan süreç sayısı doğrulanıyor**; kalan varsa
  yalnız kendi damgamızı taşıyan PID'ler ikinci kez hedefli kesiliyor. Makinedeki
  başka Chrome pencerelerine, MCP sunucularına veya başka oturumlara dokunulmaz.
  Her viewport kapanışında sayı log'a basılıyor (`kalan süreç: 0`).
* **Port seçimi:** `9200 + rand(500)` kaldırıldı (denetimde yabancı bir Chrome'a
  bağlanıldı, iki kez CDP zaman aşımı oldu). Artık `net.createServer().listen(0)`
  ile port **gerçekten bind ediliyor**, sonra Chrome'a devrediliyor. Üstüne bir
  tazelik nöbetçisi var: bağlanılan tarayıcıda tek bir `about:blank` sekmesi
  yoksa ölçüm "yabancı tarayıcıya bağlanma riski" diyerek patlıyor.

**Bilinen nüans:** bazı koşularda `taskkill /T /F`ten sonra 1–2 Chrome yardımcı
süreci ~10 sn daha listede kalabiliyor (yeniden ebeveynlenmiş yardımcılar);
hedefli ikinci tur uygulanıyor ve süreçler kısa süre sonra kendiliğinden
düşüyor. Koşu sonrası doğrulamada damgalı süreç sayısı **0**.

---

## 8b · Çalışma sırasında bulunan ALET kusuru (kök CLAUDE.md §I)

**Bulgu:** tarama, örtü katmanı olmayan banner'da metin `<span>`ının kendi
arka planını boyuyordu. Inline bir öğenin arka planı yalnız **içerik alanını**
(≈font-size) kaplar; oysa örneklenen `Range.getClientRects()` kutusu
**line-height** kadar uzundur. Üstteki/alttaki boşluk örtüsüz kaldığı için en
kötü piksel hiç değişmiyordu.

**Nasıl görüldü:** mağaza banner'ının örtüsü kaldırıldıktan sonra tarama
0.0'dan 0.8'e kadar **hep 9.32** raporladı — alfa hiçbir şeyi değiştirmiyordu.
Eski tasarımda span'ın `py-1.5` dolgusu satır kutusunu kapattığı için kusur
görünmüyordu.

**Düzeltme:** örtü katmanı yoksa tarama artık `data-hero-scrim-gecici` adlı
**tam kaplayan geçici bir katman enjekte ediyor** ve metnin kendi arka planını
saydama çekiyor (iki katman üst üste binerse alfa çarpışırdı). Düzeltmeden
sonra mağaza taraması 9.32 → 19.76 aralığını doğru üretiyor.

**Bu bir yalancı yeşil miydi?** Kapıyı etkilemedi (taban ölçümü ve kapı doğruydu),
ama tarama tablosunu ölçüsüz kılıyordu — yani "0.8 gerekiyor" gibi bir tasarım
kararı bu tabloya dayansaydı **kanıtsız** olurdu.

---

## 9 · Kapsam dışı bırakılanlar (talimat gereği dokunulmadı)

TB-74 / Vitest `testTimeout` · `prefers-reduced-motion` · mobil
`object-position` · dark-mode paritesi · ekran görüntüsü dosya adındaki çift
viewport son eki (`…__vp1280__acik__vp1280.png` biçimi bilerek korundu).

---

## 10 · Ne kanıtlandı, ne kanıtlanmadı

**Kanıtlandı**

* Kontrast, gerçek Chrome'da render edilmiş sayfanın kompozit pikselinden, metnin
  glyph kutuları içinde ≤2 CSS px ızgarayla, **en kötü noktadan** ölçüldü.
* Ölçüm aletinin ölçek dönüşümü DPR 2'de mutasyonla sınandı ve nöbetçi tuttu.
* Kapı, hata kaydında ve sıfır örnekte **exit 1** üretiyor (üç ayrı iddiayla).
* Banner'ların erişilebilir adı, hedefi ve LCP ipuçları gerçek DOM'da nöbette;
  tek kaynaktan koptuklarında test patlıyor (M1b).
* Tam Vitest suite: **153 dosya / 1751 test yeşil**. `tsc -b` + `vite build`
  temiz.

**Kanıtlanmadı / sınır**

* Örnekleme alanı `Range.getClientRects()` **satır kutusudur**, mürekkep (ink)
  kutusu değil: line-height'tan gelen üst/alt boşluk da örneklenir. Bu yönde
  ölçüm **fazla katıdır** (hiçbir glyph'in dokunmadığı bir pikseli en kötü
  olarak seçebilir), gevşek değil — yani yanlış "geçti" üretmez.
* Ölçüm yalnız **DPR 1**'de sevk edilen tabanı üretti; DPR 2'de tam tablo
  koşulmadı (DPR 2 yalnız selftest'te kullanıldı).
* Yalnız iki genişlik (1280 · 380) ve iki tema ölçüldü; ara kırılma noktaları
  (`sm`/`md`/`lg` sınırları) ölçülmedi.
* Retina varlıkları üst ölçeklemedir (bkz. §7).
* LCP'nin gerçekten iyileştiği **ölçülmedi** — ipuçları eklendi, etkileri
  gerçek ağ koşullarında sınanmadı.
