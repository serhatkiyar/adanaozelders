# `magaza-tasarim` merge öncesi doğrulama raporu

**Tarih:** 21 Ağustos 2026 · **Dal:** `magaza-tasarim` · **Taban:** `cdc5e3f`
(merge: main `8ee17ea` → `magaza-tasarim`)

Merge raporunda **kanıtlanmamış üç iddia** kalmıştı. Bu tur onları ölçüme
çevirir. **Üretim kodu değiştirilmedi** — yalnız ölçüm aracı, ölçüm çıktısı ve
borç kaydı üretildi.

Ölçüm aracı: `frontend/scripts/marka_logo_turu.mjs` (Chrome + CDP, İP-A7d4
sondasının harness'ı) · sonda sayfası `frontend/scripts/probe/MarkaLogoProbe.tsx`
· çıktılar `docs/magaza-merge-dogrulama/`.

---

## Görev 1 — Logo oranı: göz kararı yerine kanıt

### İddia

Merge raporu: "`logo.svg` yerini aldığı PNG'den %12,6 daha geniş … flex/shrink-0
olduğu için **taşma görmedim**." Bu göz kararıydı.

### Ölçülen — bileşen × genişlik

Her satır gerçek `getBoundingClientRect()` değeridir. "Taşma" = kök
`scrollWidth > clientWidth`. "Kesişim" = logo ⟂ kategori şeridi bounding box
kesişimi (şerit, sınıf adından değil kendi öğelerinden türetilir: Landing'de
`/icons/categories/*` sekmeleri, mağazada `a[href*="category="]` bağlantıları).

| Yüzey | Genişlik | Logo | Logo px | Kapsayıcı px | Yatay taşma | Şerit kesişimi |
|---|---:|---|---:|---:|---|---|
| PublicNavbar (anasayfa) | 360 | `logo-compact.svg` | 32.0 | 32.0 | yok (0 px) | yok |
| PublicNavbar | 414 | `logo-compact.svg` | 32.0 | 32.0 | yok (0 px) | yok |
| PublicNavbar | 768 | `logo.svg` | 257.7 | 257.7 | yok (0 px) | **146.1 × 36 px** |
| SiteFooter (anasayfa) | 360 | `logo.svg` | 229.1 | 229.1 | yok (0 px) | yok |
| SiteFooter (anasayfa) | 414 | `logo.svg` | 229.1 | 229.1 | yok (0 px) | yok |
| SiteFooter (anasayfa) | 768 | `logo.svg` | 257.7 | 257.7 | yok (0 px) | yok |
| StoreLayout header | 360 | `magaza-logo.svg` | 135.2 | 135.2 | yok (0 px) | yok |
| StoreLayout header | 414 | `magaza-logo.svg` | 135.2 | 135.2 | yok (0 px) | yok |
| StoreLayout header | 768 | `magaza-logo.svg` | 152.1 | 152.1 | yok (0 px) | yok |
| SiteFooter (mağaza) | 360 | `logo.svg` | 229.1 | 229.1 | yok (0 px) | yok |
| SiteFooter (mağaza) | 414 | `logo.svg` | 229.1 | 229.1 | yok (0 px) | yok |
| SiteFooter (mağaza) | 768 | `logo.svg` | 257.7 | 257.7 | yok (0 px) | yok |

Mağaza yüzeyi oturumlu (`magaza-oturum`) hâlinde de üç genişlikte aynı
değerleri verdi.

### Kabul ölçütü sonucu

**360 px'te hiçbir bileşende yatay taşma yok ve çakışma yok** — kabul ölçütü
karşılandı. 414 px de temiz.

### 768 px'te GERÇEK ÇAKIŞMA var (kod değiştirilmedi)

`PublicNavbar`'da logo, kategori şeridinin üstüne biniyor: logo 32 → 289.7 px,
şerit 143.6 px'ten başlıyor. Ekran görüntüsü `magaza-merge-dogrulama/anasayfa-768.png`
— "Adana Özel Ders" yazısının üstünde "Hepsi"/"Eğitmenler" ikonları duruyor.

Çakışma bandını taradım (aynı ölçüm, ek genişlikler):

| Genişlik | Navbar logosu | Logo sağ kenarı | Şerit sol kenarı | SVG kesişimi | **PNG kesişimi** |
|---:|---|---:|---:|---:|---:|
| 640 | `logo-compact.svg` (32 px) | 48.0 | 120.2 | yok | yok |
| 700 | `logo-compact.svg` (32 px) | 48.0 | 150.2 | yok | yok |
| 768 | `logo.svg` (257.7 px) | 289.7 | 143.6 | **146.1** | **117.2** |
| 820 | `logo.svg` | 289.7 | 195.6 | **94.1** | **65.2** |
| 900 | `logo.svg` | 289.7 | 250.2 | **39.5** | **10.6** |
| 1024 | `logo.svg` | 289.7 | 201.1 | **88.6** | **59.7** |
| 1280 | `logo.svg` | 289.7 | 440.2 | yok | yok |

**Kusur merge'ün getirdiği bir şey değil.** Sağdaki sütun, aynı DOM'da `src`
geçici olarak `/logo.png`'ye çevrilip yeniden ölçülerek üretildi (depoda hiçbir
şey değişmedi): PNG ile de çakışma var. SVG geçişi kusuru **yaratmadı**,
768 px'te 117.2 → 146.1 px büyüttü.

Sebep: navbar üç sütunlu bir flex satırı (`flex-1` logo · `shrink-0` kategoriler
· `flex-1` aksiyonlar). Orta sütun daralmadığı için yan sütunlara ~148 px kalıyor;
`w-auto` logo 257.7 px doğuyor ve kendi sütunundan taşıp ortadakinin üstüne
çiziliyor. `md:` eşiği tam 768'de büyük logoyu açtığı için sorun orada başlıyor.

Talimat gereği **sınıf/stil değiştirilmedi**; bulgu `docs/teknik-borc.md` →
`TB-?C` olarak kaydedildi.

---

## Görev 2 — SiteFooter mağaza bağlamında

Ölçümler mağaza yüzeyinde, DOM'dan (kaynak kodundan değil):

| Kontrol | Ölçülen | Sonuç |
|---|---|---|
| Footer logosu `src` | `/logo.svg` | ✔ |
| Uygulanan yükseklik | `computedHeight: 36px`, sınıf `h-8 … md:h-9` | ✔ `md:h-9` ile tutarlı |
| `PublicNavbar` logosu (768) | 36.0 px | ✔ |
| `StoreLayout` header logosu (768) | 36.0 px | ✔ |
| `SiteFooter` logosu (768, iki yüzeyde de) | 36.0 px | ✔ üçü eşit |
| Konsol (9 ekran/genişlik kombinasyonu) | 0 kayıt | ✔ |
| Konsol (oturumlu mağaza — footer `useAuthStore` + `useCurrentUser` koşuyor) | 0 kayıt | ✔ |

`iyzico` ödeme rozeti (`/odeme/iyzico-logo-band*.svg`, 28 px) yükseklik
karşılaştırmasına **bilerek dahil edilmez** — marka lockup'ı değildir.

---

## Negatif kontrol — sondanın gerçekten ölçtüğü

İki ayrı mutasyon; ikisi de gerekliydi.

**M1 · Logo 3x şişirildi** (`--negatif 1`). Normal turda 1 kapı kırmızıydı,
mutasyonla **32 kapı kırmızı**: her yüzey/genişlikte yatay taşma (360'ta 288 px,
414'te 342 px, 768'de 654 px) ve görünür alanı aşan logolar.

**M2 · Kesişim dedektörü ayrıca prova edildi.** M1 çakışma kapısını prova
ETMİYOR: logo genişleyince flex satırı da genişliyor, şerit sağa kaçıyor ve
kesişim tesadüfen kayboluyor (ölçüldü: 768'de şerit sol kenarı 143.6 → 829.2).
Bu yüzden ikinci mutasyon eklendi — 1280 px'te (normalde çakışma **yok**,
taban doğrulandı) logo `translateX(418px)` ile şeridin üstüne taşındı:
dedektör `257.7 × 36 px` kesişim bildirdi, `dedektorCalisti: true`.

## Sondanın kendi kusurları (bulundu ve düzeltildi)

Kural I gereği açıkça yazıyorum — ikisi de sondanın **yalancı** sonucuydu:

1. **Yalancı kırmızı.** İlk koşuda `anasayfa/360` ve `/414` "görünür logo yok"
   dedi; ekran görüntüsü **bomboştu**. Sebep: `readyState === "complete"` +
   sabit 1.6 sn bekleme, Vite'ın ilk (soğuk) derlemesine yetmiyordu ve sonda
   henüz render olmamış sayfayı ölçüyordu. Düzeltme: marka logosunun DOM'a
   girmesi beklenir; girmezse bu ayrıca bir kapı olarak raporlanır
   (`sayfaHazir`).
2. **Yalancı kırmızı.** "768'de logo yükseklikleri eşit değil" kapısı, marka
   logosu olmayan iyzico ödeme rozetini (h-7 = 28 px) karşılaştırmaya dahil
   ediyordu. Düzeltme: karşılaştırma `MARKA_LOGOLARI` listesiyle sınırlandı.

## Ölçülemeyen

- **"Kapsayıcı genişliği" kapısı zayıftır.** Logonun doğrudan ebeveyni, içeriğe
  sarılan `Link`'tir; genişliği her zaman logoya eşit çıkar (tabloda görülüyor).
  Yani "kapsayıcıyı aşıyor" kapısı pratikte hiç ateşlenemez. Gerçek taşma
  buradan değil, **görünür alan** ve **şerit kesişimi** kapılarından ölçüldü;
  768 px'teki kusuru yakalayan da o ikisi oldu.
- **Karanlık tema ölçülmedi.** Tur `koyu=0` ile koşuldu; logo geometrisi temaya
  bağlı değildir, ama karanlık temada `dark:hidden`/`dark:block` ile yer
  değiştiren **iyzico rozeti** ölçülmemiş kalmıştır.
- **Gerçek arka uç yok.** Sonda axios adapter'ını sahte sunucuyla değiştirir
  (İP-A7d4 deseni). Ölçülen şey yerleşimdir; veri yollarının doğruluğu bu turun
  konusu değildir.
- **768 üstü/altı ara genişlikler** yalnız çakışma taramasındaki yedi noktada
  ölçüldü; sürekli bir tarama (1 px adımlarla) yapılmadı.

## Şüphe listesi (denetçiye)

1. **TB-?C (768-1024 çakışması) hangi kararla kapanacak?** Üç seçenek farklı
   tasarım kararıdır: logoya `max-w` vermek · orta sütunu `min-w-0` yapmak ·
   büyük logoyu `md:` yerine `lg:` eşiğine almak. Karar verilmedi.
2. **Bu kusur ne kadar zamandır canlı?** PNG ölçümü kusurun SVG'den önce de var
   olduğunu gösteriyor, ama hangi commit'te doğduğu araştırılmadı.
3. **`marka_logo_turu.mjs` CI'da koşmuyor.** Elle çalıştırılan bir turdur;
   kusur düzeltildikten sonra nöbetçi olarak bağlanması ayrı bir karardır.
4. **TB-?A/?B/?C etiketleri hâlâ geçicidir.** Numara main merge turunda
   tahsis edilecek; kontrol listesi `docs/teknik-borc.md` → "Merge turu kontrol
   listesi" bölümüne yazıldı.
