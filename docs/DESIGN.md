# Adana Özel Ders — Tasarım Dili (Audit, 24 Eylül 2026)

**Ne:** Üründe *bugün gerçekten kullanılan* tasarım dilinin kaydı. Yeni bir sistem
icat etmez; kodu ve çalışan ekranları tarif eder.
**Nasıl üretildi:** `frontend/src` kaynak taraması + Playwright ile gerçek
ekranların masaüstü (1440px) ve telefon (390px) görüntüleri (ana sayfa, arama,
kartlar, public profil, giriş/kayıt, öğrenci ve öğretmen panelleri, takvim,
ayarlar, ilan sihirbazı, kütüphaneler, blog, mağaza).
**Kapsam dışı ama not edildi:** eski yönetim paneli (`/yonetim`) ve yeni antd
paneli (`/yonetim-yeni`) — ikisi de ayrı bir dil taşır (bkz. §2.3).

Her madde üç etiketten birini taşır:

- **[E] Established** — üründe tekrar eden, standart kabul edilebilecek desen.
- **[R] Recommendation** — henüz standartlaşmamış; ileride uygulanması önerilen kural.
- **[I] Inconsistency** — birbiriyle çelişen mevcut uygulamalar. *Standart değildir*; sessizce tek bir hâle çevrilmez, karar ister.

Dosya yolları `frontend/src/` köküne göredir. Panel karar kaydı (`docs/tasarim-dili.md`)
eski yönetim paneli için geçerlidir ve bu belgeyle çelişmez; bu belge public site
ve kullanıcı panolarını (öğrenci/öğretmen) kapsar.

---

## 1. Ürün tasarım ilkeleri (Product design principles)

1. **[E] Fotoğraf ve içerik önde, kutu arkada.** Public sitede kart = fotoğraf +
   scrim + altında çıplak metin; kenarlık ve gölge yok (`components/TutorCard.tsx:73-127`).
   Panolarda bölümler önce boşluk, sonra saç-teli çizgi, en son kartla ayrılır
   (`components/pano/stil.ts` → `KART`).
2. **[E] Renk = aksiyon.** Zemin, kenarlık ve metin nötrdür (slate ailesi). Marka
   turuncusu yalnız birincil düğme, etkin sekme çizgisi, odak halkası ve
   "sıcak zemin" (`marka-soft`) olarak girer (`index.css:128-267`).
3. **[E] Dolgu parlak, yazı koyu.** `bg-marka` (#FF9900) üstünde `text-marka-fg`
   (#2B1000). Açık zeminde marka yazısı ayrı ve koyu bir adımdır: `text-marka-metin`
   (#96430A). `text-marka` yazılmaz (`__guards__/markaAksani.test.ts`).
4. **[E] Tek açık tema.** `dark:` yasak (`__guards__/tekTema.test.ts`),
   `html { color-scheme: light }` (`index.css:289`).
5. **[E] Yazı tipi self-host, dış CDN yok** (KVKK; `__guards__/disFont.test.ts`).
6. **[E] Erişilebilirlik primitive'de zorlanır, ekranda hatırlanmaz:** `Field`
   etiketi girdiye bağlar, `Modal` portal + odak tuzağı + `aria-modal` taşır,
   `PlainButton` `type="button"` varsayar (`components/ui/*`).
7. **[E] Mobil ayrı bir kip.** Alt sekme çubuğu, alttan açılan pencereler,
   tam ekran arama sayfası, 44px dokunma hedefi (`components/ui/DaireDugme.tsx:45-50`).
8. **[E] Referans ürünler Airbnb / Preply / Google Takvim'dir**; yorumlar ölçüm
   kaynağı olarak bunları anar (`index.css:546-608`, `components/ui/SecenekSatiri.tsx`).
   Kopya değil uyarlama: marka rengi ve içerik hiyerarşisi bize aittir.
9. **[R] "Seçenekler çok kalın" / "her yeni butonda farklı bir buton mu" itirazları**
   (`SecenekSatiri.tsx`, `DaireDugme.tsx` yorumları) ürünün fiili ilkesidir: ölçü ve
   görünüm tek yerde yaşar, çağıran yalnız içerik verir. Yeni tekrar eden öğe
   için aynı yol izlenmelidir.

## 2. Görsel karakter (Visual character)

**[E] Public site ve panolar:** `bg-slate-50` sayfa, `bg-white` yüzeyler,
`border-slate-200` saç-teli, `text-slate-900` gövde, `text-slate-500/600` ikincil.
Turuncu az ve keskin; yeşil yalnız "İlk ders ücretsiz" (`text-emerald-700`; 600 beyazda 3,8:1, AA altı) ve
"Doğrulandı" gibi olumlu durumlarda. Fotoğraflar kare ve büyük yuvarlatmalı
(`rounded-3xl`). Gölge neredeyse yok; tek belirgin gölge Airbnb tarzı arama hapı
(`components/HeroSearch.tsx:148`).

**[E] Etkileşim dili:** sekmelerde alt çizgi (`PanelSekmeleri.tsx:62-64` `after:h-1 after:bg-marka`;
`CategoryBar.tsx` `border-b-2 border-slate-900`), düğmede `active:scale-[0.98]`,
hover'da kenarlık koyulaşması (`hover:border-slate-900`).

**2.3 [I] Üç ayrı UI dili aynı depoda yaşıyor:**

| Yüzey | Teknoloji | Yazı tipi | Köşe | Kaynak |
|---|---|---|---|---|
| Public site + öğrenci/öğretmen panosu | Tailwind + `--marka` token'ları | Inter | 8/12/16/24px karışık | bu belge |
| Eski yönetim paneli `/yonetim` | Tailwind + `--panel-*` token'ları | Inter gövde, **Figtree** h1-h3 (`index.css:307`) | 12/16px | `docs/tasarim-dili.md` |
| Yeni yönetim paneli `/yonetim-yeni` | **antd v5**, inline `style`, `panel/theme.ts` | `system-ui` | **4px**, kontrol 40px, siyah sider 224px | `panel/layout/PanelShell.tsx` |

Bu bir standart değil, bilinen bir çatallanmadır. Yeni panel bilinçli olarak
ikas referansını izler (`docs/ikas-panel-referans.md`); public site onu kopyalamaz.

## 3. Tipografi (Typography)

**[E] Aile:** Inter (değişken, self-host, `latin` + `latin-ext`), `font-feature-settings: "cv11","ss01"`,
`antialiased` (`index.css:80-99, 310-314`). Figtree yalnız `.panel-kok` altında (eski admin).
Yeni antd paneli `system-ui` kullanır (`panel/theme.ts`) — **[I]** üç yüzey, üç aile.

**[E] Pano ölçeği** (`lib/tipografi.ts`, `components/pano/stil.ts`):

| Rol | Sınıf | Nerede |
|---|---|---|
| Sayfa başlığı | `SAYFA_BASLIGI` = `text-2xl font-bold leading-8 tracking-tight text-slate-900 sm:text-[32px] sm:leading-9` | Genel Bakış, Derslerim, Profilim, Ayarlar, DersSayfasi |
| Bölüm başlığı | `BOLUM_BASLIGI` = `text-xl font-semibold leading-6 text-slate-900` | pano kart başlıkları |
| Etiket | `ETIKET` = `text-base font-semibold leading-6 text-slate-900` | form alanı etiketi (TutorSettings) |
| Açıklama | `ACIKLAMA` = `text-base leading-6 text-slate-600`, `KUCUK_ACIKLAMA` = `text-sm leading-5 text-slate-600` | |

**[E] Public site ölçeği:**
- Sayfa h1: `text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl` (SSS, İletişim, Hukuki, Blog listesi) ve auth kartlarında `text-2xl font-bold text-slate-900` (`pages/Login.tsx:61`, `components/AuthModal.tsx:154`).
- Bölüm h2: `text-xl font-bold text-slate-900` (`pages/PublicTutorProfile.tsx:395-431`, `components/ReviewsSection.tsx`).
- Vitrin kuşak başlığı: `text-xl font-bold tracking-tight` (`components/VitrinSeridi.tsx:71`).
- Kart metni: ad `text-base font-bold text-white drop-shadow-md`, başlık `text-[13px] leading-snug text-slate-800` (`TutorCard.tsx:117,148`); fiyat `text-sm font-bold` + `/saat` `text-[11px]`.
- Uzun metin: `text-[15px] leading-relaxed text-slate-600` (profil, blog gövdesi).
- Uppercase eyebrow: `text-xs font-semibold uppercase tracking-wide text-slate-400` (SSS, İletişim, BookingModal).

**[I] Çelişkiler:**
- Ana sayfa ve `/egitmenler` sayfasında `<h1>` yok (`pages/Landing.tsx`, `pages/PublicMarketplace.tsx`); `TutorReviews` de h1 taşımaz.
- Profil h1 `text-3xl font-extrabold` (`PublicTutorProfile.tsx:387`), blog yazısı `text-3xl font-bold`, "Yakında" `text-2xl font-semibold` (`pages/Yakinda.tsx:40`), Favori daveti `sm:text-4xl`.
- Bölüm başlığı ağırlığı pano'da `semibold`, public'te `bold`; `ReviewsSection.tsx:98` `text-2xl font-semibold`.
- Rastgele boyutlar: `text-[11px]`, `[13px]`, `[15px]`, `[17px]`, `[46px]` (sonuncular ilan sihirbazı istisnası, `pages/tutorOnboarding/tema.ts`).
- İkincil metin için `slate-400/500/600/700` hepsi kullanılıyor; tek "muted" adımı yok.

**[R]** Pano ölçeğini (`tipografi.ts` + `stil.ts`) public sayfalara da taşımak;
h1 boyutu için `SAYFA_BASLIGI`, bölüm için `BOLUM_BASLIGI` tek kaynak olsun.
Ana sayfa ve arama sayfasına en azından `sr-only` bir h1 eklensin.

## 4. Renk sistemi (Color system)

**[E] Tek kaynak** `index.css` `:root` (boşluklu RGB üçlüsü) → `tailwind.config.js` köprüsü.

| Token | Değer | Rol | Sınıf |
|---|---|---|---|
| `--marka` | `255 153 0` (#FF9900) | birincil dolgu — metin olarak KULLANILMAZ | `bg-marka` |
| `--marka-hover` | #E08700 | dolgu hover | `hover:bg-marka-hover` |
| `--marka-fg` | #2B1000 | dolgu üstündeki yazı | `text-marka-fg` |
| `--marka-metin` / `-hover` | #96430A / #7C3708 | açık zeminde marka yazısı, bağlantı, etkin alt sekme | `text-marka-metin` |
| `--marka-soft` | #FFF4E9 | sıcak zemin (etiket çipi, seçili satır, bilgi kutusu) | `bg-marka-soft` |
| `--marka-soft-fg` | = marka-metin | soft üstündeki yazı | |
| `--marka-line` | #FDD9B5 | yalnız kenarlık | `border-marka-line` |
| `--marka-mid` | #D9660F | kenarlık/halka; metin taşımaz | `focus:border-marka-mid` |
| `--marka-focus` | #C2570C | odak halkası (beyazda 4,5) | `ring-marka-focus` |
| `--dikkat`, `-soft`, `-fg` | amber-500 / amber-100 / amber-900 | uyarı: açık zemin + koyu metin; dolgulu düğme olmaz | `bg-dikkat-soft text-dikkat-fg` |
| `--panel-*` | slate-50/white/slate-200/900/600/500 | eski admin yüzey aileleri; aksan `--marka`ya takma ad | `bg-panel-surface` |

**[E] Nötr paleti:** sayfa `slate-50`, yüzey `white`, ikincil yüzey `slate-100`,
kenarlık `slate-200` (giriş kutularında `slate-300`), gövde `slate-900`, ikincil `slate-600`, üçüncül `slate-500`.

**[E] Anlam renkleri** (`lib/reservationStatus.ts:29-40`): bekliyor `bg-amber-50 text-amber-700`,
onaylandı `bg-marka-soft text-marka-metin-hover`, tamamlandı `bg-emerald-50 text-emerald-700`,
reddedildi `bg-red-50 text-red-700`, iptal/süresi doldu `bg-slate-100 text-slate-600`.
Takvim renkleri `index.css:698-747` (bekliyor amber, onaylı marka, deneme teal,
tamamlandı slate, haftalık rose, izin taralı slate, ek aralık emerald) ve lejantı
`pages/TutorCalendar.tsx:43`. Okunmamış rozet `bg-rose-500 text-white`.

**[I] Çelişkiler:**
- `components/RightContextPanel.tsx:177` onaylandı=emerald, tamamlandı=marka-line yazar; merkez haritanın tersi. Ayrıca emoji durum ikonu kullanır.
- `bg-marka` üstünde `text-white`: `VitrinSeridi.tsx:327` — kural `text-marka-fg` (profil CTA'sı ve mobil `DersTalepSeridi` 28 Eyl 2026'da kurala alındı; beyaz 2,1:1 idi).
- Token dışı turuncu: `components/store/DeliveryPrefControls.tsx:232` `bg-orange-500 text-white`; `pages/CargoTrackingPage.tsx` `bg-orange-500`; mağaza `hover:text-[#F09A38]`, Amazon paleti `text-[#007185]` (`components/store/AnaVitrin.tsx`) — mağaza bugün kapalı (`MAGAZA_ACIK=false`).
- Ham hex `bg-[#f4f4f4]` navbar/footer/kütüphaneler/DashboardHeader'da (token değil).
- `components/DistrictMapModal.tsx:41-43` eski marka hex'lerini (`#C2410C`) hâlâ sabit yazıyor.
- Yorum eskimiş: `index.css:185` `#F0850F` der, değer `#FF9900`dur.
- Yeni antd panelinde `colorWarning` tanımsız; `Tag color="warning"` altın sarısı marka turuncusunun yanında duruyor (`panel/theme.ts`).
- Kırmızı ailesi `red-*` ve `rose-*` karışık (Field hatası `rose-600`, banner `red-700`, tehlike düğmesi `red-600` / `rose-600`).

**[R]** `#f4f4f4` için bir token (`--yuzey-gri` gibi) ve `red`/`rose` için tek aile seçilsin;
durum → renk haritası yalnız `reservationStatus.ts`ten okunsun.

## 5. Boşluk sistemi (Spacing system)

**[E]** Tailwind 4px ölçeği; fiilen kullanılan adımlar 1·2·3·4·5·6·8.
- Sayfa iç dolgusu: `p-4 sm:p-6` (`components/DashboardShell.tsx:348`, `PublicShell.tsx:170`); sıkı kip `px-4 pb-8 pt-8 sm:px-6`.
- Kart iç dolgusu: `p-6` (`KART`), auth kartı `p-8` (`AuthModal.tsx:60`), modal `p-6` (`ui/Modal.tsx:112`).
- Kart altı metin: `pt-3 pb-1 px-1` (`TutorCard.tsx:127`).
- Satır: `h-14` seçenek satırı, `gap-3` (`SecenekSatiri.tsx`); liste konteyneri `divide-y divide-slate-200`.
- Vitrin kuşağı: `-mx-4 sm:-mx-6` taşma + `px-4 md:px-8` (`VitrinSeridi.tsx:54`).
- Sekme şeridi: `px-4 py-4` (`PanelSekmeleri.tsx:62-64`).
- Dokunma hedefi ≥ 44px (`DaireDugme.tsx`, `scripts/sihirbaz_mobil_turu.mjs`).

**[I]** Aynı kart tipi `p-4` / `p-5 sm:p-6` / `p-6 sm:p-8` (`pages/TutorAnalytics.tsx:132,195`, `components/tutor/DersKarti.tsx:59`).
Public sayfalar `PublicShell` dolgusunun üstüne kendi `px-4`ünü ekleyip 32/40px kenar boşluğu üretir (blog, SSS, iletişim).

**[R]** Kart içi 24px (`p-6`), mobilde 16-20px; "aynı şeyin parçaları" 16px, "ayrı şeyler" 24px
(`docs/tasarim-dili.md §3` kuralı panolara da uygulanabilir).

## 6. Yerleşim ve konteyner (Layout and container rules)

**[E] Kabuklar:**
- `PublicShell` (`components/PublicShell.tsx`): navbar + `<main>` + `SiteFooter` + mobil alt sekme; mobil detay ekranı (profil) navbar'ı ve sekmeleri gizler (:156-176).
- `DashboardShell` (`components/DashboardShell.tsx`): üst bar (64px `sm`, 72px `md`) + yatay sekme şeridi; ikisi `sticky top-0 z-40`; yüksekliği `--yapiskan-ust` değişkeniyle yayınlanır (:220-232). Yan menü yok.
- Genişlik sözleşmesi `PANEL_GENISLIKLERI` (:142): `dar` `max-w-3xl` (Öğretmen genel bakış, Derslerim, ders detayı), `orta` `max-w-6xl` (Öğrenci panosu, Ayarlar, Profilim, Öğrenciler, Analizler), `genis` `max-w-[1600px]` (Takvim). Sayfalar kendi `max-w`sını yazamaz (`__guards__/panelGenisligi.test.ts`).
- Public krom: `mx-auto max-w-screen-2xl px-4 md:px-8` (navbar, vitrin, popüler dersler).
- Profil: sol içerik + sağda `lg:sticky` kart; sticky ofset `--yapiskan-ust` ile hesaplanır (`__guards__/ilanKartiTasmaz.test.ts`).
- Ayarlar/Profilim: sol dikey alt menü (turuncu sol çizgi ile etkin) + içerik (+ Profilim'de sağ sütun) — `lg:grid-cols-[14rem_minmax(0,1fr)_18rem]` (`pages/TutorSettings.tsx`).

**[I] Genişlik envanteri (public):** `max-w-screen-2xl` (krom), `max-w-[1216px]` (footer), `max-w-[1100px]` (kütüphaneler), `max-w-[1050px]` (arama), `max-w-[76rem]` (ders sayfası, kütüphane detayı), `max-w-[64rem]` (profil), `max-w-6xl` (hukuki), `max-w-5xl` (blog), `max-w-3xl` (SSS, iletişim, blog yazısı). Footer kenarı navbar'la 1216px üstünde hizalanmaz. `PublicTutorProfile.tsx:181` yorumu 76rem'e "site standardı" der; iki sayfa kullanır.
Öğretmen panosu `dar`, öğrenci panosu `orta` + 340px sağ ray — iki rol farklı genişlikte.

**[R]** Public içerik için iki genişlik yeter: krom/vitrin `max-w-screen-2xl`, okuma sayfaları `max-w-3xl`; liste/detay için tek bir orta değer (`max-w-6xl` veya `76rem`) seçilip diğerleri ona çekilmeli. Footer'ı navbar konteynerine bağlamak.

## 7. Kenarlık ve köşe (Borders and radius)

**[E] Kenarlık:** 1px `border-slate-200` (yüzey), `border-slate-300` (giriş kutusu, kesikli boş durum), `border-2 border-slate-200 → hover:border-slate-900` (ikincil düğme), `ring-1 ring-slate-200` (yüzen kart).

**[E] Köşe kullanımı (fiilî):**

| Değer | Nerede | Kaynak |
|---|---|---|
| `rounded-full` | arama hapı, filtre çipleri, kategori pill'leri (mobil), etiket çipleri, daire düğmeler, avatar, profil CTA, takvim "Bugün"/"Oluştur" | `HeroSearch.tsx`, `PublicMarketplace.tsx:328`, `DaireDugme.tsx` |
| `rounded-3xl` | kart görseli (öğretmen/kütüphane), Modal paneli (`sm:`), mobil alt-sheet üst köşe | `TutorCard.tsx:76`, `ui/Modal.tsx:112` |
| `rounded-2xl` | popover/menü (bildirim, cüzdan), iskelet blokları, eski kart tarifi (`shadow-sm ring-1`), hata kutusu | `NotificationsBell.tsx:106`, `pages/Settings.tsx:225` |
| `rounded-xl` | auth giriş kutusu ve düğmesi, `.input`, modal kapatma düğmesi, seçenek satırı | `AuthModal.tsx:165,218`, `index.css:329` |
| `rounded-lg` | pano kartı, pano düğmeleri, hesap menüsü, ikon düğmeleri, durum çipi (nadiren) | `pano/stil.ts` |

**[I]** Aynı rol üç yarıçapta: birincil düğme `rounded-lg` (pano), `rounded-xl` (auth/booking), `rounded-full` (profil CTA, ilan sihirbazı, mağaza). Kart `rounded-lg` (pano) / `rounded-xl` (Öğrenciler) / `rounded-2xl` (Ayarlar, blog). Modal paneli `rounded-3xl` (varsayılan) / `rounded-2xl` (Reschedule, Cancel, Review, Question `panelClassName` ile) / `rounded-lg` (`DersOnayKarti`). `rounded-md` 15 yerde, `rounded-sm` 1 yerde.

**[R]** Rol tabanlı sabitleme: çip/pill ve arama = `full`; kontrol (düğme, girdi) ve kart = tek değer (pano zaten `lg`, public auth `xl`; biri seçilmeli); pencere/popover = `2xl`; fotoğraf = `3xl`. Yeni kodda beşinci bir değer açılmaz.

## 8. Gölge ve yükseklik (Shadows and elevation)

**[E]**
- İçerik kartı: **gölge yok**, yalnız kenarlık (`KART`, `TutorCard`, blog kartı).
- Yüzen katman (menü, popover): `shadow-lg` veya `shadow-2xl` + `ring-1 ring-slate-100/200` (`DashboardHeader.tsx:480` `shadow-[0_8px_32px_rgba(18,17,23,0.15)]`, `CuzdanPaneli.tsx:144`).
- Pencere/çekmece: `shadow-2xl` (`ui/Modal.tsx`, `MobilPanelCekmecesi.tsx:77`); öğrenci çekmecesi `shadow-[0_8px_40px_rgba(18,17,23,0.18)]` (`components/tutor/OgrenciPaneli.tsx:70`).
- Arama hapı: `shadow-[0_3px_16px_rgba(15,23,42,0.10)]` → hover/focus `[0_6px_22px_…0.13]` (`HeroSearch.tsx:148`) — amaçlı, Airbnb dili.
- Toast: `shadow-lg ring-1 ring-slate-100` (`Toaster.tsx:60`).
- Kart scrim: `bg-gradient-to-t from-black/85 via-black/35 to-transparent` — okunabilirlik için, dekor değil.

**[I]**
- `shadow-sm ring-1 ring-slate-100` kart tarifi Ayarlar'da 5 yerde ve ölü `StatCard.tsx`te; pano `KART` gölgesiz. Profil sticky kartı `shadow-lg shadow-slate-300/40` (`PublicTutorProfile.tsx:217`) tek gölgeli içerik kartı.
- Arama düğmeleri `bg-gradient-to-r from-marka to-marka-hover` (`HeroSearch.tsx:236,353,429`, `FavorilerGirisDaveti.tsx:61`) — diğer tüm birincil düğmeler düz `bg-marka`.
- `BookingActionCard.tsx:67` üstte `from-marka via-dikkat to-marka-hover` dekoratif şerit; `ProfileCompleteness.tsx:63` ilerleme çubuğu gradyan.
- Filtre uygula düğmesi `shadow-sm shadow-marka/20` (`EgitmenFiltreModali.tsx:178`) tek örnek.
- `backdrop-blur` 56 yerde; navbar ve alt sekmeler `bg-white/95 backdrop-blur-md` amaçlı, NotFound "glass" düğmeleri ve mobil hero pili dekoratif.

**[R]** Üç seviye yeter: 0 (kart), `shadow-lg` (açılır), `shadow-2xl` (pencere). Gradyan yalnız scrim'de.

## 9. Düğmeler (Buttons)

**[E] Ortak stil sabitleri** `components/pano/stil.ts` (public'te `BookingModal`, `DersSayfasi`; panolarda yaygın):

```
DUGME_BIRINCIL        h-12 rounded-lg bg-marka px-6 text-lg font-semibold text-marka-fg hover:bg-marka-hover
DUGME_IKINCIL         h-12 rounded-lg border-2 border-slate-200 bg-white px-6 text-lg text-slate-900 hover:border-slate-900
DUGME_SATIR_BIRINCIL  h-10 … px-4 text-base   (satır/kart içi)
DUGME_SATIR_IKINCIL   h-10 … border-2 …
DUGME_SATIR_TEHLIKE   h-10 … text-red-700 hover:border-red-700   (tehlike = kenarlıklı, dolgusuz)
METIN_BAGLANTI        underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900
taban                 inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition active:scale-[0.98] disabled:opacity-60
```

**[E] Auth tarifi** (`AuthModal.tsx:218`, `KayitAkisi.tsx:268`, `pages/Login.tsx:130`):
`w-full rounded-xl bg-marka py-3.5 text-sm font-semibold text-marka-fg hover:bg-marka-hover disabled:opacity-60`;
Google düğmesi `rounded-xl border border-slate-300 bg-white py-3.5` (`GoogleGirisDugmesi.tsx:108`).

**[E] Diğer tekrar edenler:**
- Metin bağlantısı: `font-semibold text-marka-metin hover:text-marka-metin-hover`.
- Navbar düğmeleri: `btn-neon-hover rounded-full px-5 py-2.5 text-sm font-semibold text-slate-700`; hover'da `inset 0 0 0 1.5px` marka kenarlık (`index.css:459-468`).
- Daire ok düğmesi: yalnız `components/ui/DaireDugme.tsx` (`__guards__/daireDugmeTekligi.test.tsx`).
- Filtre çipi: `rounded-full border px-3.5 py-1.5 text-sm font-semibold shadow-sm`, etkin `border-slate-900` (`PublicMarketplace.tsx:328`).
- Takvim: "Bugün" `h-10 rounded-full border border-slate-900 px-6 font-semibold`; "Oluştur" `rounded-full border-slate-200 shadow-md h-11` (Google Takvim referansı).
- Segment düğmeleri (Ders şekli): seçili `bg-marka text-marka-fg`, diğerleri beyaz kenarlıklı (`pages/TutorSettings.tsx`).

**[I] Tek bir Button bileşeni yok**; sayılan varyantlar:
- Birincil yarıçap `lg` / `xl` / `full`; ağırlık `semibold` / `bold`; yükseklik `py-2` … `py-3.5`, `h-12`, `min-h-[48px]`, `h-14` (sihirbaz).
- Siyah birincil: Ayarlar `rounded-xl bg-slate-900 text-white` (`pages/Settings.tsx:318`), masaüstü filtre uygula `bg-slate-900` (`FiltreAcilir.tsx:124`), "Yakında" (`pages/Yakinda.tsx:50`), Kurye ana sayfa; aynı filtre mobilde `bg-marka` (`EgitmenFiltreModali.tsx:178`).
- Eski modal düğmeleri: `rounded-lg bg-marka px-4 py-2 text-sm` + iptal `bg-slate-100` (Reschedule/Cancel/Review/Question).
- Tehlike altı biçimde: kenarlıklı (`stil.ts`), `border-2 border-red-200 text-lg` (`LessonDetail.tsx:57`), dolu `bg-red-600` (`CancelModal.tsx:153`, `Settings.tsx:1002`), `ring-red-200` (`BookingActionCard.tsx:192`), admin `bg-rose-600`.
- İkon düğmeleri: `h-10 w-9 rounded-lg` (header), `h-9 w-9 rounded-xl` (Modal kapat), `h-10 w-10 rounded-full` (öğrenci çekmecesi), `h-[34px] rounded-full` (takvim okları), `rounded-full p-2`, `rounded-lg p-2`.
- `text-white` on `bg-marka` (bkz. §4).

**[R]** `stil.ts` sabitleri bir `Button` bileşenine (variant: birincil/ikincil/tehlike/metin; boy: 48/40) taşınsın; auth ve public sayfalar ona geçsin. Tehlike = kenarlıklı kırmızı (dolgusuz) kabul edilsin; siyah birincil yalnız "sistem" ekranlarında (Yakında, NotFound) kalsın ya da tamamen kalksın.

## 10. Girdiler ve formlar (Inputs and forms)

**[E] Primitive:** `components/ui/Field.tsx` — `useId` ile `htmlFor`, `hint` → `aria-describedby`, `error` → `role="alert"` + `aria-invalid`. Etiket `block text-sm font-medium text-slate-700`, zorunlu yıldızı `text-rose-500`, ipucu `mt-0.5 text-xs text-slate-500`, hata `mt-1 text-xs text-rose-600`. Kullananlar: AuthModal, KayitAkisi, Login, ForgotPassword, ResetPassword, BookingModal, QuestionModal, ReviewModal, EngelleModal.

**[E] Auth girdi tarifi** (`AuthModal.tsx:165`, `Login.tsx:79`, `KayitAkisi.tsx:147`):
`mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20` (ölçülen: 50px yüksek).

**[E] Pano girdi tarifi** (`pages/TutorSettings.tsx:125`):
`w-full rounded-lg border border-slate-200 px-4 py-3 text-base focus:border-marka-mid focus:ring-2 focus:ring-marka/20`; etiket `mb-2 block ${ETIKET}`; yardım metni `text-sm text-slate-500`.

**[E] Ortak `.input` sınıfı** (`index.css:329`): `rounded-xl border-slate-200 px-3 py-2 text-sm focus:border-marka-focus focus:ring-2 focus:ring-marka/20` — yalnız admin/mağaza kullanır.

**[E] Form hatası deseni (public):** alan hatası değil, form üstü banner: `rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700` (AuthModal, KayitAkisi, Login, Forgot/Reset). Gönder düğmesi doğrulamayla `disabled` olmaz (kilitli karar; `docs/tasarim-dili.md §7`).

**[E] Seçenek satırı:** `components/ui/SecenekSatiri.tsx` — 40px simge kutusu `rounded-lg bg-slate-100`, satır 56px, başlık 14px/500, alt başlık 12px gri; seçiliyse sağda marka onay işareti.

**[E] Mobil girdi 16px** (iOS zoom'u engeller) — sihirbaz ve `components/form/alanlar.tsx` zorlar; `text-sm` girdiler buna aykırı (auth, RescheduleModal, QuestionModal).

**[I]**
- Girdi yüksekliği/dolgusu: `py-3.5` (auth), `py-3` (pano), `py-2.5` (Settings, SSS), `py-2` (iletişim, Reschedule), `h-12` (DersTeklifModal — odak stili yok).
- Odak rengi: inline tarifler `border-marka-mid` (3,58), `.input` `border-marka-focus` (4,5); `OgretmenErtelemeModal` `ring-marka-focus`; Öğrenciler araması `focus:border-slate-900`.
- Etiket: `text-sm font-medium text-slate-700` (Field) / `text-xs font-medium text-slate-500` (Settings) / `ETIKET` `text-base font-semibold` (TutorSettings) / uppercase eyebrow (BookingModal).
- `ContactPage` Field yerine elle etiket yazar (`text-red-500` yıldız).
- `react-hook-form` yalnız admin/operatörde; panolarda kullanılmaz.
- `Settings.tsx:983` hesap silme onay girdisi etiketsiz.

**[R]** Tek girdi tarifi (`Field` + `Input` bileşeni) ve odak için `marka-focus`; mobilde `text-base`. Alan hataları `Field error=` ile alanda, form geneli hata banner'da.

## 11. Kartlar ve yüzeyler (Cards and surfaces)

**[E] Kart genişliği ızgaranındır** (kullanıcı kararı, 24 Eyl 2026; eski `max-w-[310px] mx-auto` çelişkisini kapatır): öğretmen kartı, kütüphane kartı ve vitrin "tümünü gör" kartı kendi genişliğini TAŞIMAZ — `w-full` ile hücresini doldurur; kartın solu sayaç/başlıkla aynı çizgidedir. Liste ızgarası tek kaynaktan gelir: `components/kartIzgarasi.ts` → `KART_IZGARASI` = `grid grid-cols-1 gap-8 min-[480px]:grid-cols-2 md:grid-cols-3` (arama, oturumlu arama, öne çıkanlar, favoriler, kütüphane sonuçları ve iskeletleri). Hücre ~200–345px: telefon (<480) tek sütun tam genişlik (390px'te 358), 480–767 iki sütun (208–343), 768+ üç sütun (219–329; kütüphane kabı 1100px'te 345). Kart arası boşluk her genişlikte 32px. Ders sayfası (2/3/4 sütun) ve vitrin şeridi (`VITRIN_KART`) kendi ızgaralarını korur — kart onlarda da hücreyi doldurur. Yeni kart listesinde kartın kendisine `max-w` yazılmaz; genişlik ızgarayla ayarlanır.

**[E] Öğretmen kartı** `components/TutorCard.tsx`: kare görsel `rounded-3xl bg-slate-100`, scrim, sol altta beyaz ad (`text-base font-bold drop-shadow-md`) + konum (`text-xs font-semibold text-white/90`), sağ üstte kalp (`BookmarkButton`), sol üstte "Reklam" pili (`bg-white/95 text-[11px] shadow-sm`, yasal). Altında: yıldız/"Yeni" satırı, `text-[13px]` başlık (2 satır, `min-h-[36px]`), `₺600/saat · İlk ders ücretsiz` (`text-emerald-700`). Kenarlık ve gölge yok; hover yalnız scrim'i koyulaştırır. Kütüphane kartı aynı çerçevenin klonu (`LibraryCard.tsx`), placeholder zemin `from-marka-soft to-marka-line`, "Şu an açık/Kapalı" pili `bg-emerald-500/95` / `bg-rose-500/95 text-white`.

**[E] Pano kartı** `KART` = `rounded-lg border border-slate-200 bg-white p-6` (KesifKarti, SiradakiDersKarti, ProfileCompleteness, LessonDetail, OgrenciPano, TutorSettings sağ sütun). Liste: `divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white`. Ayarlar satırı: başlık + değer + sağda altı çizili "Düzenle/Ekle" bağlantısı.

**[E] Profil sticky kartı** `PublicTutorProfile.tsx:217`: `rounded-2xl bg-white p-5 shadow-lg shadow-slate-300/40 ring-1 ring-slate-200/60`; foto, ad, "Yeni öğretmen", Ücret/Cevaplama satırları, `rounded-full bg-marka` CTA, altında yeşil "İlk ders ücretsiz". Mobilde sabit alt şerit (`DersTalepSeridi.tsx`).

**[E] Blog kartı:** `rounded-2xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm`.

**[E] Anlamlı renkli konteynerler:** profil tamamlama kartı `KART ring-1 ring-marka/20` (uyarı niteliğinde), iletişim başarı paneli `border-emerald-200 bg-emerald-50`, hata `bg-rose-50`.

**[I] / AI-üretimi izlenimi veren kalıplar (standart değil):**
- Kart içinde kart: `BookingModal.tsx:476,820` (`KART` bir `rounded-3xl` modal içinde); `LessonDetail.tsx:289` (`DersOnayKarti` + amber kutular `KART` içinde); `BookingActionCard.tsx:91` (`shadow-lg` kart içinde `bg-slate-50` kutu); `RightContextPanel.tsx:303`.
- Anlamsız renkli kutu: `BookingModal.tsx:440` `border-2 border-marka-line bg-marka-soft` bilgi kutusu; `:700` ikon balonu `rounded-full bg-marka-line p-4`; `LegalPage.tsx:91,122` `bg-slate-100/70` içindekiler + `bg-marka-soft/60 ring-1` dipnot; `RightContextPanel.tsx:326` öğrenci notu `bg-marka-soft`; `TutorCalendar.tsx:486` `bg-marka-soft/40` talimat bandı; `TutorDashboard.tsx:56` `bg-slate-100` boş durum kutusu + dekoratif PNG.
- Dekoratif pill: geri sayım `rounded-full bg-marka-soft` (`SiradakiDersKarti.tsx:61`); `NewLessonRequestModal.tsx:44` `text-[10px] font-bold` pill; `📚` emoji karesi (`BookingActionCard.tsx:73`); sınav çipi `border-amber-300 bg-amber-50` (`PublicMarketplace.tsx:405`).
- Çift çerçeve: `ProfileCompleteness.tsx:52` border + ring.
- Emoji ikon olarak: `RightContextPanel.tsx:184-204,286`, boş durumlar (`PublicMarketplace.tsx:529`, `Libraries.tsx:431`), ErrorBoundary.
- Ölü kart deneyleri: `LibraryCardCalm/Codex/CodexA/CodexB.tsx` (yalnız DEV rotası `/test-kutuphane-karti`), `StatCard.tsx`, `LessonTasksCard.tsx`, `TutorTrust.tsx` içindeki sky/violet rozetler.

**[R]** Kart yalnız (a) kendi başına kayıt, (b) kendi aksiyonu olan bölüm, (c) kaydırılabilir alt yüzey için. Bilgi kutusu için önce düz paragraf + `text-slate-600`, sonra sol çizgi; renkli zemin yalnız uyarı/başarı anlamı varsa.

## 12. Gezinme (Navigation)

**[E] Public navbar** `components/PublicNavbar.tsx`: `sticky top-0 z-40 border-b border-slate-200`, `bg-[#f4f4f4]/95` veya `bg-slate-50/95` + `backdrop-blur-md`; üç sütun (logo · `CategoryBar` · "Ders Ver" / "Giriş Yap"). Kayıt düğmesi yok; giriş `?modal=login` ile `AuthModal` açar. Ana sayfada altta genişleyen arama hapı (`HeroSearch`), kaydırınca daralır (`kesif/KesifKabugu.tsx:230`).
- Kategori sekmeleri masaüstünde alt çizgi (`border-b-2 border-slate-900`), mobilde pill (`rounded-full border bg-white shadow-sm`, etkin `ring-1 ring-inset ring-slate-900`) (`CategoryBar.tsx:183`).
- Arama hapı: `rounded-3xl md:rounded-full border-slate-200` + özel gölge, sağda turuncu daire arama düğmesi; mobilde "Aramaya başlayın" pili → tam ekran `MobilAramaSheet` + `AramaAdimlari` (`z-[110]`).

**[E] Pano üst barı** `DashboardHeader.tsx` + `PanelSekmeleri.tsx`: logo · sağda (öğretmen) cüzdan `0 ₺` / mesaj / zil / avatar, (öğrenci) mesaj / zil / kalp / avatar; altında beyaz sekme şeridi `text-base font-semibold`, etkin sekme turuncu alt çizgi. Sekmeler `lib/nav.ts:289` (öğrenci: Genel Bakış · Derslerim · Mesajlar · Ayarlar; öğretmen: Genel Bakış · Takvim · Mesajlar · Öğrenciler · Analizler · Profilim · Ayarlar). Hesap menüsü `rounded-lg … w-72 p-2` popover. Üst barda tek kısayol sınırı (`__guards__/ustBarSadeligi.test.tsx`).

**[E] Mobil:** alt sekme çubuğu `MobilAltSekmeler.tsx` (`fixed bottom-0 z-40 bg-white/95 backdrop-blur-md md:hidden`, 60px + safe-area, `text-[11px]`, etkin `text-marka-metin`; yüksekliği `--alt-serit` olarak yayınlanır); sağdan hamburger çekmecesi `MobilPanelCekmecesi.tsx` (`w-[85vw] max-w-xs shadow-2xl`, animasyonsuz). Alt sayfa alt menüleri (Ayarlar, Profilim) mobilde yatay kayan sekme şeridine döner.

**[E] Yönetim panelleri:** eski `/yonetim` sol rail 264/72px + üst başlık (`components/admin/layout/AdminLayout.tsx`); yeni `/yonetim-yeni` antd siyah `Sider` 224px, üst bar yok, mobilde antd `Drawer` 240px.

**[I]**
- 640-767px bandında hem sekme şeridi (`sm:block`) hem alt çubuk (`md:hidden`) görünür, hamburger gizlenir (`DashboardShell.tsx:286`, `MobilAltSekmeler.tsx:231`) — üç katman.
- Sekme şeridi `bg-white`, üst bar `sm:bg-slate-50` — görünür dikiş (`PanelSekmeleri.tsx:12` yorumu tersini söyler).
- Ayarlar/Profilim yan rayı `top-24` (96px) ile sabitlenir; gerçek sticky yığın ~130px (`TutorSettings.tsx:174`).
- Mobil hamburger `absolute right-0 top-2` arka plansız, içerik altında kayar (`DashboardHeader.tsx:506`).

**[R]** Bant çakışması için tek eşik (`md`) seçilsin; yan raylar `var(--yapiskan-ust)` okusun.

## 13. Pencereler ve çekmeceler (Modals and drawers)

**[E] Kabuk:** `components/ui/Modal.tsx` — portal, `z-[100]`, arka plan `bg-slate-950/50 backdrop-blur-sm` (klavyeyle erişilebilir `<button>`), panel `max-h-[92vh] w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl`; **telefonda alt sheet, `sm+` ortalı**; başlık `text-lg font-semibold`, açıklama `text-sm text-slate-500`, kapat `h-9 w-9 rounded-xl`; `useModalA11y` (odak tuzağı, ESC, kaydırma kilidi); `mobilAltSeridiKoru` ile alt sekmeler görünür kalabilir (giriş/kayıt). Giriş animasyonu yok.
Kullananlar: AuthModal, BookingModal, MobilAramaSheet, ShareModal, ReviewListModal, TutorCalendar pencereleri, DersTeklifModal, EkAralikModal, IzinModal, EngelleModal, cüzdan (mobil).

**[E] Öğrenci çekmecesi** `components/tutor/OgrenciPaneli.tsx`: sağdan 480px, `border-l shadow-[…]`, 300ms `ease-in-out` (Preply ölçümü), `prefers-reduced-motion` saygılı; **arka plan karartmasız**, kaydırma kilidi kapalı.

**[E] Onay/Ertele/İptal/Değerlendir pencereleri:** `Modal` + `panelClassName="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200"`, kendi `h3 text-lg font-bold`, kapat düğmesi yok.

**[E] Toast** `components/Toaster.tsx`: sol alt, `rounded-2xl border-l-4 bg-white shadow-lg ring-1`, sol kenar rengi emerald/red/amber/marka-mid, 28px ikon karesi, 4,5 sn ilerleme çubuğu.

**[I]**
- Kendi overlay'ini yazan ve `role="dialog"`/ESC taşımayan yüzeyler: `EgitmenFiltreModali.tsx:92`, `pages/Libraries.tsx:466`, `LibraryDetail.tsx:601`, `LibraryReservationModal.tsx:31`, `TaskCommandPalette.tsx:201`, `ExamResultModal.tsx:14`, mağaza sepeti/galerisi.
- Overlay rengi 8 farklı: `slate-950/50`, `slate-900/50|40|10|60|90`, `black/50|60|85`.
- Panel yarıçapı `3xl` / `2xl` / `lg`; `panelClassName` ile geçenler `max-h` ve `overflow-y-auto`yu kaybeder (ReviewModal kısa telefonda taşabilir).
- Kapat düğmesi 5 biçim (§9).
- Animasyon: `animate-in zoom-in-95` yalnız `@medusajs/ui-preset`in getirdiği `tailwindcss-animate` sayesinde çalışır; `index.css:361` yorumu "projede yok" der — yorum eski.
- Toast `bottom-4` `--alt-serit`i okumaz (telefonda sekme çubuğunun altında kalır); `toast-in` sağdan gelirken konteyner solda; 375px'te 16px taşar.
- Popover yarıçapı `lg` (hesap) / `xl` (şablon, takvim menüsü) / `2xl` (cüzdan) / `3xl` (bildirim, mesajlar).

**[R]** Bütün overlay'ler `Modal`dan (ya da çekmece için tek bir `Drawer` kabuğundan) geçsin; `panelClassName` yalnız tam ekran istisnalar için. Toast konumu `--alt-serit`e bağlansın.

## 14. Öğretmene özgü desenler (Tutor-specific UI patterns)

- **[E] Kart ve profil:** §11. Profil düzeni: sol içerik (etiket çipleri `rounded-full bg-marka-soft text-marka-metin-hover`, h1, "X ile ilgili bilgiler", Ders Mekânı, Müsait Saatler tablosu `rounded-2xl border`, değerlendirmeler) + sağ sticky kart; bölümler `border-t border-slate-200` ile ayrılır (`pages/PublicTutorProfile.tsx`). Mobilde tam ekran foto + üstte geri/paylaş/kalp daireleri + sabit alt "Ders talep et" şeridi (`components/egitmen/EgitmenMobilUst.tsx`, `DersTalepSeridi.tsx`).
- **[E] Durum rozeti:** `ReservationStatusBadge` `rounded-full px-2.5 py-1 text-xs font-medium` + `RESERVATION_STATUS_STYLE` (§4). Profilim durum bandı: renkli nokta + metin ("Yayında" `text-emerald-700`) + sağda "Pasife al" ikincil düğme (`TutorSettings.tsx:80-100`).
- **[E] Takvim** `pages/TutorCalendar.tsx` + `index.css:585-761`: sol mini takvim (bugün turuncu daire), "ETİKETLER" lejantı (renkli sol çubuk), sağda FullCalendar haftalık ızgara 28px/30dk, gün başlığı `14px 600`, bugün koyu alt çizgi, olay `rounded 8px`, "şu an" çizgisi kırmızı noktalı. Mobilde tek sütun: mini takvim + lejant + "Bu hafta ders ya da izin yok" gri kutu.
- **[E] Profil tamamlama** `components/ProfileCompleteness.tsx`: `KART` + `ring-marka/20`, yüzde `text-marka-metin`, gradyan çubuk, eksikler altı çizili bağlantı, turuncu "Profilime git".
- **[E] Müsaitlik editörü** (`TutorSettings.tsx:937`): satır başına gün `select` + iki `time` girdisi `h-10 rounded-lg`, sil ikonu `hover:bg-red-50`, "Ekle" ikincil, "Kaydet" `DUGME_BIRINCIL`.
- **[E] Cüzdan** `CuzdanPaneli.tsx`: üst barda `0 ₺` tetikleyici, `rounded-2xl shadow-2xl w-80` popover; düğmeler `h-11 rounded-lg`, bilgi kutusu `bg-marka-soft`; mobilde `Modal`.
- **[E] Öğrenciler** `pages/TutorStudents.tsx`: `rounded-full` arama girdisi, tabloda avatar + ad, "Tek ders" gri çip, altı çizili "Ders planla", sağda ikon düğmeleri; mobilde kart listesi.
- **[E] İlan sihirbazı** `pages/tutorOnboarding/**`: bilinçli istisna — mercan (`#F2695E`, `tema.ts`), `rounded-full h-14` düğme, dolgulu bilgi kartı, 30-46px başlık (`docs/tasarim-dili.md Ek A`, `__guards__/sihirbazMercani.test.ts`). Bitiş ekranı: yeşil onay dairesi + `rounded-2xl` turuncu "İlanını paylaş" + kenarlıklı "İlanını gör" + altı çizili bağlantı.
- **[E] Genel bakış:** selam h1 ("İyi akşamlar, Canlı"), tek sütun `max-w-3xl`, profil tamamlama kartı, "Sıradaki dersin yok" kutusu + "Takvimi aç".
- **[I]** §4'teki durum rengi çelişkisi; rozet biçimi dört varyant (`ReservationStatusBadge`, `DersKarti.tsx:134 text-sm`, `LessonDetail` `font-semibold`, `OgrenciPaneli.tsx:228 rounded-md`); `BookingActionCard` (mesaj içi ders kartı) hiçbir pano token'ını kullanmaz; `TutorTrust.tsx` sky/violet rozetleri ölü.

## 15. Duyarlılık ve mobil (Responsive/mobile rules)

**[E]**
- Kırılma noktaları: `sm` 640 (sekme şeridi, üst bar 64px, Modal ortalama), `md` 768 (alt çubuk kalkar, üst bar 72px, Ayarlar rayı), `lg` 1024 (profil sticky kart, öğrenci sağ rayı, admin rail), `xl` 1280 (`RightContextPanel`). Yeni antd paneli 768'de tek eşik (`useMobil`).
- Telefonda: alt sekme çubuğu (`--alt-serit`), tam ekran arama sayfası, alt-sheet pencereler, profil detayında krom gizli, sabit alt CTA şeridi, tablo → kart listesi (`TutorStudents`, admin `renderMobileRow`), yan menüler → yatay kayan sekmeler.
- Vitrin kuşakları yatay kaydırma (`HScroll`, `DaireDugme` oklarıyla) ve `snap`.
- Görsel `aspect-square`; kart hücresini doldurur, genişliği ızgara belirler (§11). Liste ızgarası (`KART_IZGARASI`): telefonda (<480px) tek sütun tam genişlik, `min-[480px]` iki, `md` üç sütun; arama sayfası kabı `max-w-[1050px]`.
- Telefonda sütun sayısı bağlama göredir: arama/favori/kütüphane sonuç listesi tek sütun (karar anı, büyük fotoğraf), ders sayfası iki sütun ve vitrin şeridi ~2,3 kart (genel bakış). Bu bilinçli farktır, çelişki değildir.
- Yatay taşma yok: 12 public sayfa 390px'te `scrollWidth == 390` ölçüldü.
- `prefers-reduced-motion` çekmece ve öğrenci paneli animasyonlarını kapatır (`index.css:560,579`).
- Sabit öğeler için CSS değişkenleri: `--yapiskan-ust` (üst yığın), `--alt-serit` (alt çubuk).

**[I]** 640-767 üç gezinme katmanı (§12); toast `--alt-serit`i okumaz; `text-sm` girdiler iOS'ta zoom yapar; `panelClassName` geçen pencereler mobil sheet yarıçapını kaybeder; `BookingModal` `rounded-3xl` mobilde köşe kaybı.

## 16. Yükleniyor, boş ve hata durumları (Loading, empty and error states)

**[E]**
- İskelet: `animate-pulse rounded-lg bg-slate-100` bloklar (panolar; `TutorDashboard.tsx:175`, `OgrenciPano.tsx:77` …); public'te `rounded-2xl` (`PublicMarketplace.tsx:520`, `VitrinSeridi.tsx:155`).
- Tam ekran dönen halka: `components/Spinner.tsx` `h-8 w-8 animate-spin border-4 border-slate-300 border-t-marka` (profil, ders detayı, rota dağıtıcıları — kromu da gizler).
- Boş: kesikli kutu `rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center` (panolar) / `rounded-2xl … py-20` + emoji (public); Favoriler'de gri kare placeholder + "0 kayıtlı öğretmen".
- Hata: `components/admin/ui/PageState.tsx` `ErrorState` (`rounded-2xl border-rose-200 bg-rose-50 p-5 text-rose-900` + "Yeniden dene") panolarda; public'te `rounded-2xl bg-red-50 text-red-700 ring-1 ring-red-100`; sayfa çökmesi `components/ErrorBoundary.tsx` ("Bu sayfa yüklenemedi", emoji, turuncu `rounded-full` "Geri dön").
- Bölüm kapalı: `pages/Yakinda.tsx` (saat ikonu karesi, siyah pill + beyaz pill).
- Yeni antd paneli: `panel/components/Durum.tsx` (`Spin`, `Empty`, `Alert`) — iskelet yok.

**[I]** İskelet yarıçapı `lg`/`2xl` ve rengi `slate-100`/`slate-200`; iskelet şekli gerçek karta (kare `3xl`) uymuyor; `VitrinSeridi.tsx:209` hata/boşta `null` döner (ana sayfa sessizce boş kalır); boş durum `border-slate-200/300`, `py-10/16/20`, `rounded-lg/xl/2xl` karışık; hata rengi `rose`/`red`.

**[R]** Üç durum için üç bileşen (`Iskelet`, `BosDurum`, `HataDurumu`) pano token'larıyla; iskelet gerçek kart oranında.

## 17. Erişilebilirlik beklentileri (Accessibility expectations)

**[E]**
- Etiket-girdi bağı `Field` ile zorunlu; `Modal` `role="dialog" aria-modal aria-labelledby`, odak tuzağı, ESC, odak geri dönüşü; overlay `<button aria-label="Pencereyi kapat">`.
- Odak halkası: `focus-visible:ring-2 focus-visible:ring-marka-focus` (112 kullanım) veya `focus:ring-2 focus:ring-marka/20` girdilerde; takvim olayında `outline 2px marka-focus`.
- Kontrast eşikleri nöbetçide ölçülür: `marka-fg`/`marka` ≥ 4,5, `marka-metin`/beyaz ≥ 4,5, odak ≥ 3 (`__guards__/markaAksani.test.ts`). Dolgu 3:1 kenar eşiği bilerek terk edildi (`index.css:170-183`).
- Dekoratif ikon `aria-hidden`, ikon düğmesi `sr-only` metin (`Modal` kapat, `DaireDugme`).
- `color-scheme: light` kökte; yerel widget'lar (tarih, select) tutarlı.
- Dokunma hedefi 44px; `SecenekSatiri` `aria-pressed`.
- Erişilebilir adı olmayan kontrol tabanı admin ağacında ≤7, ham `<button>` ≤122 (`__guards__/uiBaseline.test.ts`).
- Ekran okuyucu başlığı: pano sayfalarında tek h1 (Takvim `sr-only`).

**[I]** Kendi overlay'ini yazan 6+ yüzeyde `role="dialog"`/ESC yok (§13); ana sayfa/arama h1'siz; `Settings.tsx:983` etiketsiz girdi; emoji ile taşınan durum anlamı (`RightContextPanel`); öğrenci çekmecesi karartmasız (odak dışı içerik tıklanabilir); `text-white` on `bg-marka` 2,6:1.

## 18. Kanonik yeniden kullanılabilir bileşenler (Canonical reusable components)

| Bileşen | Dosya | Not |
|---|---|---|
| Düğme primitive (stilsiz) | `components/ui/PlainButton.tsx` | `type="button"` varsayılanı |
| Düğme/kart/başlık stil sabitleri | `components/pano/stil.ts`, `lib/tipografi.ts` | panoların tek kaynağı |
| Form alanı | `components/ui/Field.tsx` | render-prop `(id, describedBy)` |
| Pencere kabuğu | `components/ui/Modal.tsx` + `hooks/useModalA11y.ts` | alt-sheet/ortalı |
| Seçenek satırı | `components/ui/SecenekSatiri.tsx` (`SIMGE_KUTUSU`) | arama/giriş seçicileri |
| Daire ok düğmesi | `components/ui/DaireDugme.tsx` | tek kaynak, nöbetçili |
| İkonlar | `components/AppIcon.tsx` | Fluent Regular 24px, tek set |
| Öğretmen kartı / kütüphane kartı | `components/TutorCard.tsx`, `LibraryCard.tsx` | genişliği ızgara belirler |
| Kart liste ızgarası | `components/kartIzgarasi.ts` (`KART_IZGARASI`) | 1 / 2 / 3 sütun, `gap-8`, tek kaynak |
| Arama hapı | `components/HeroSearch.tsx`, `AramaSecicileri.tsx`, `MobilAramaSheet.tsx` | |
| Kategori sekmeleri | `components/CategoryBar.tsx` | |
| Vitrin kuşağı | `components/VitrinSeridi.tsx`, `HScroll.tsx` | |
| Public kabuk / navbar / footer | `components/PublicShell.tsx`, `PublicNavbar.tsx`, `SiteFooter.tsx` | |
| Pano kabuğu / üst bar / sekmeler / mobil çekmece | `components/DashboardShell.tsx`, `DashboardHeader.tsx`, `PanelSekmeleri.tsx`, `MobilPanelCekmecesi.tsx`, `lib/nav.ts` | |
| Alt sekme çubuğu | `components/MobilAltSekmeler.tsx` | `--alt-serit` |
| Durum rozeti + renk haritası | `components/booking/ReservationStatusBadge.tsx`, `lib/reservationStatus.ts` | |
| Toast | `components/Toaster.tsx` | |
| Spinner | `components/Spinner.tsx` | |
| Boş/hata/iskelet (panolar) | `components/admin/ui/PageState.tsx` | admin ağacından ödünç |
| Öğrenci çekmecesi | `components/tutor/OgrenciPaneli.tsx` | |
| Cüzdan | `components/CuzdanPaneli.tsx` | |
| Profil tamamlama | `components/ProfileCompleteness.tsx` | |
| Takvim stilleri | `index.css` `.fc …`, `pages/TutorCalendar.tsx` | |
| Auth | `components/AuthModal.tsx`, `KayitAkisi.tsx`, `GoogleGirisDugmesi.tsx` | |
| Rotalar | `lib/routes.ts` (`ROUTES`, `PATHS`, `ilanYolu`) | |
| Token'lar | `index.css` `:root`, `tailwind.config.js` | |
| Eski admin UI | `components/admin/ui/{Button,Badge,PageState}.tsx`, `ui2/*` | `docs/tasarim-dili.md` |
| Yeni panel | `panel/theme.ts`, `panel/components/{ListePage,Durum,FormPage,YanPencere}.tsx` | antd |

## 19. Tuzaklar / anti-desenler (Gotchas / anti-patterns)

- `dark:` yazma; `indigo-` yazma; `text-marka` yazma (soluk kalır); `bg-marka` üstüne `text-white` koyma; `bg-dikkat*` ile `text-white` birleştirme — nöbetçiler kırar.
- Köprüde olmayan `*-marka-*` sınıfı sessizce çalışmaz (`__guards__/gecerliMarkaSinifi.test.ts`); `--marka` hex yazılırsa `/20` saydamlıklar bozulur.
- `backdrop-blur` taşıyan ata, içindeki `position: fixed` öğeyi hapseder → pencereler **portal** ile `document.body`ye çizilir (`ui/Modal.tsx` yorumu).
- `animate-in`/`zoom-in-95` Medusa preset'inden gelir; preset kalkarsa animasyonlar sessizce kaybolur. `plugins: []` boş.
- `panelClassName` verilen `Modal` varsayılan `max-h`/`overflow`/mobil yarıçapı kaybeder.
- Sticky ofsetleri elle `top-24` yazma; `var(--yapiskan-ust)` kullan. Alt sabit öğeler `var(--alt-serit)` okumalı.
- `PublicShell` üç dolgu kipi taşır; sayfa kendi `px-4`ünü eklerse çift kenar boşluğu oluşur.
- `pages/dashboards/*` öğrenci/öğretmen panosu DEĞİLDİR (admin/operatör/kurye); gerçek panolar `pages/TutorDashboard.tsx`, `pages/OgrenciPano.tsx`.
- `LibraryCardCalm/Codex*`, `StatCard`, `LessonTasksCard`, `TutorTrust` rozetleri ölü kod; örnek alma.
- Eski yorumlar: `index.css:185` `#F0850F`, `index.css:361` "tailwindcss-animate yok", `DashboardShell.tsx:138` "öğretmen genis", `PanelSekmeleri.tsx:12` "aynı arka plan" — kod yorumdan üstündür.
- Sağ alttaki palmiye/ada ikonu ürün UI'ı değil, TanStack Query devtools düğmesidir (yalnız dev); tasarım kararlarında yok sayılır ama telefonda alt sekmenin son öğesini kapatır.
- Dev sunucusunda `/mesajlar` bu turda "Bu sayfa yüklenemedi" verdi: Vite `504 Outdated Optimize Dep` (bağımlılık önbelleği), ürün hatası değil; `npm run dev` yeniden başlatılınca geçer.
- Birçok `className` dizesi `dark:` sökümünden kalan sondaki boşluğu taşır (`"… text-slate-900 "`); zararsız ama arama/`toEqual` karşılaştırmalarını şaşırtır.
- Mağaza (`/magaza/*`) `MAGAZA_ACIK=false` ile "Yakında" verir; mağaza bileşenlerindeki Amazon paleti canlı değildir, referans alınmaz.

## 20. Standart OLMAYAN mevcut tutarsızlıklar (özet)

Aşağıdakiler üründe bugün birden fazla biçimde var; hiçbiri "böyle yapılır" demek değildir. Yeni kod yazarken **[E]** tarifleri seçilir; bu liste karar bekler.

1. Birincil düğme yarıçapı: `lg` (pano) · `xl` (auth/booking) · `full` (profil CTA, sihirbaz, mağaza, hata sayfası).
2. Birincil düğme rengi: turuncu · siyah (`Settings`, masaüstü filtre, Yakında, kurye) · gradyan (arama).
3. Tehlike düğmesi altı biçim (kenarlıklı / dolu red-600 / rose-600 / ring).
4. Kart yarıçapı ve gölgesi: `rounded-lg` gölgesiz (pano) · `rounded-2xl shadow-sm ring-1` (Ayarlar, StatCard) · `rounded-xl` (Öğrenciler) · profil kartı `shadow-lg`.
5. Modal panel yarıçapı `3xl`/`2xl`/`lg`; overlay 8 renk; kapat düğmesi 5 biçim; 6+ yüzey `Modal` dışında.
6. Girdi dolgusu (`py-2` … `py-3.5`), odak rengi (`marka-mid` / `marka-focus` / `slate-900`), etiket boyutu (xs/sm/base/uppercase).
7. Başlık: h1 boyut/ağırlık 6 varyant; bölüm başlığı `bold` (public) vs `semibold` (pano); ana sayfa ve arama h1'siz.
8. İkincil metin `slate-400/500/600/700`.
9. Rezervasyon durumu renkleri: merkez harita vs `RightContextPanel` tersi; rozet 4 biçim.
10. Konteyner genişlikleri 10+ değer; footer navbar'la hizasız; öğretmen `dar` / öğrenci `orta`.
11. Kırmızı ailesi `red` vs `rose`.
12. Token dışı renkler: `bg-[#f4f4f4]`, `orange-500`, `DistrictMapModal` eski hex'ler, mağaza Amazon paleti.
13. Popover yarıçapı `lg/xl/2xl/3xl`.
14. İskelet `lg`/`2xl`, `slate-100`/`slate-200`; boş durum `py-10/16/20`.
15. 640-767px'te üç gezinme katmanı; sekme şeridi/üst bar zemin dikişi; sticky `top-24`.
16. Toast konumu alt çubuğu hesaba katmaz; animasyon yönü konteynerle çelişir.
17. Gradyan/dekor: `BookingActionCard` şeridi, ilerleme çubuğu gradyanı, `bg-marka-soft` bilgi kutuları, emoji ikonlar, `📚` karesi.
18. Üç UI dili (Tailwind public/pano · Tailwind+Figtree eski admin · antd yeni panel) ve üç yazı tipi ailesi.
19. Yeni antd panelinde `warning` rengi tanımsız, `info` tonu iki farklı renk, başlık stili 29 yerde kopya.
20. `.input` sınıfı public'te kullanılmıyor; `react-hook-form` yalnız admin'de.