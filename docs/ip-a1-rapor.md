# İP-A1 raporu — Preset'i kalıcı almak + site sağlığını doğrulamak

Worktree: `C:\Users\kiyar\Desktop\adana-medusa-ui`, branch `feat/medusa-ui-taban`.
Tarih: 19 Ağustos 2026. Hiçbir ekran dosyası yeniden yazılmadı.

**Kısa sonuç:** Preset kalıcı olarak alındı, `font-mono` geri alındı, tip/test kapısı
temiz geçti, dört nöbetçi eşiği çalışan test olarak commit'lendi ve kasıtlı ihlalle
kırıldıkları gösterildi. K1 turunda **storefront regresyonu bulunmadı**: 20 sayfa
(10 yüzey × açık/koyu) piksel piksel karşılaştırıldı, 18'i **bit düzeyinde aynı**,
kalan 2'sinin farkı zamana bağlı bir geri sayım metni. B planına dönüş tetikleyicisi
oluşmadı.

---

## Görev 1 — Kurulum ve tip/test kapısı

| Ölçüm | Kurulumdan ÖNCE | Kurulumdan SONRA |
|---|---|---|
| `npx tsc --noEmit` | exit 0, çıktı boş | exit 0, çıktı boş |
| `npm run test` | **102 dosya / 1015 test**, hepsi yeşil | **103 dosya / 1021 test**, hepsi yeşil |

Kurulum çıktısı: `added 106 packages`, ERESOLVE yok. Sürümler doğrulandı —
`@medusajs/ui@4.2.1`, `@medusajs/ui-preset@2.19.0`.

Sonraki değer, eklenen nöbetçi test dosyasını (+1 dosya / +6 test) içerir.
**Kurulumdan önce kırık test yoktu**, dolayısıyla önce/sonra karşılaştırmasında
"yeni kırılan" da yok.

### `@tanstack/react-table` çift kopyası

```
adana-ozel-ders-frontend@0.0.0
+-- @medusajs/ui@4.2.1
| `-- @tanstack/react-table@8.20.5
`-- @tanstack/react-table@8.21.3
```

Ağaçta iki kopya duruyor, **ama tip düzeyinde çakışmıyor**. Bu, kurulum anında
değil, `@medusajs/ui`'den gerçekten değer import edildikten sonra ölçüldü:
`ui2/medusa-tr.tsx` `DataTable`, `Table` ve `I18nProvider`'ı import ediyor ve
`DataTable.Toolbar` / `Table.Pagination` props'undan tip türetiyor — `tsc --noEmit`
yine temiz. `DataTable` tipleri `@tanstack/react-table`'ın 8.20.5 kopyasına
bağlı (`blocks/data-table/index.d.ts` `VisibilityState`/`ColumnOrderState`'i
oradan re-export ediyor).

**Açık kalan risk (İP-A2'ye):** çakışma ancak *bizim* 8.21.3 tipimizle üretilmiş
bir kolon tanımı Medusa'nın `DataTable`'ına verilirse doğar. Bugün böyle bir
çağrı yok. Karar (npm `overrides` ile tek sürüme zorlamak vs. 8.20.5'e düşmek)
şimdi gerekmiyor; ilk `DataTable` kullanımında yeniden ölçülmeli.

Bundle tarafında iki kopya **birden gelmiyor** — bkz. Görev 6.

---

## Görev 2 — Preset uygulandı, `font-mono` geri alındı

`frontend/tailwind.config.js` son hâli:

```js
import medusaPreset from "@medusajs/ui-preset";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [medusaPreset],
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@medusajs/ui/dist/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter", "ui-sans-serif", "system-ui", "-apple-system",
          "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif",
        ],
        // Preset'in "Roboto Mono"su geri alınıyor: font yüklü değil ve
        // KVKK gereği Google Fonts CDN'i kullanılmıyor. Tailwind varsayılanı.
        mono: [
          "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas",
          "Liberation Mono", "Courier New", "monospace",
        ],
      },
      keyframes: {
        snow: {
          "0%": { transform: "translateY(-10vh) translateX(0)" },
          "100%": { transform: "translateY(110vh) translateX(20px)" },
        },
      },
      animation: { snow: "snow 10s linear infinite" },
    },
  },
  plugins: [],
};
```

`darkMode: "class"`, `fontFamily.sans` ve `snow` keyframe/animation aynen korundu.

### `font-mono` geri alımının kanıtı — **iki kural ayrı ayrı**

`npm run build` çıktısındaki `dist/assets/index-Dhr926Su.css` üzerinde:

```
.font-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,
           Liberation Mono,Courier New,monospace}

code,kbd,samp,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,
                  Liberation Mono,Courier New,monospace;
                  font-feature-settings:normal;font-variation-settings:normal;
                  font-size:1em}
```

Her iki kural da baseline CSS'teki hâliyle **birebir aynı**. Ek olarak tüm
dosyada `Roboto Mono` geçen **0** eşleşme var (`grep -c 'Roboto Mono' → 0`).

### Preset gerçekten uygulandı mı

Evet — `font-mono`'yu geri almak preset'i devre dışı bırakmadı:

- `*{border-color:var(--border-base)}` üretilmiş (yeni global kural).
- `.animate-in{animation-name:enter;animation-duration:.15s;--tw-enter-opacity:initial;…}` üretilmiş.

### ESM `import` notu (İP-A0'a bir düzeltme + bir uyarı)

- `require()` yerine ESM `import` kullanıldı, istendiği gibi. **Ancak** preset'in
  ESM build'i (`dist/index.mjs`) saf Node ESM çözümleyicisinde **kırık**:
  `tailwindcss/plugin`'i uzantısız import ediyor ve `ERR_MODULE_NOT_FOUND`
  veriyor. Config'de çalışmasının sebebi, Tailwind'in yükleyicisi `jiti`'nin
  CJS gibi çözmesi. Yani "`require` davranışa bağlı" endişesi teknik olarak
  `import` için de geçerli; bugün ikisi de aynı `jiti` sayesinde çalışıyor.
  Riskli değil ama sözleşme sanıldığı kadar temiz değil.
- İP-A0 preset'in katkısını "`@tailwindcss/forms` + `tailwindcss-animate`" diye
  tarif etmiş. Ölçüldü: preset nesnesi `{ content, plugins }`'ten ibaret,
  `theme` anahtarı gerçekten yok (bu doğru), ama iki eklenti
  `tailwindcss-animate` + **Medusa'nın kendi plugin'i** (`ui-*` yardımcıları,
  CSS değişkenleri, base katmanı). `@tailwindcss/forms` bağımlılıklar arasında
  yok; üretilen CSS'te `[type='text']` gibi forms imzası da yok. Sonuca etkisi
  olmadı, ama kayda geçsin.

---

## Görev 3 — Türkçe/locale taban katmanı

- `src/components/admin/ui2/medusa-tr.tsx` açıldı: `MEDUSA_LOCALE = "tr-TR"`,
  `MedusaI18nProvider`, ve **boş ama tipli** `tablePaginationTr`,
  `dataTableToolbarTr`, `promptTr` nesneleri. İçerikleri bilinçli olarak boş —
  kullanıldıkları pakette dolacak.
- Uygulama kökü sarıldı: `main.tsx` → `<HelmetProvider><MedusaI18nProvider><App/></MedusaI18nProvider></HelmetProvider>`.
- Bir sürtünme: `DataTableToolbarTranslations` paket kökünden **export
  edilmiyor** (`tsc` TS2305 verdi). Tip, `React.ComponentProps<typeof
  DataTable.Toolbar>["translations"]` üzerinden türetildi; sözleşme yine sabit.

**Kalıcı kural yürürlükte:** `ui2/` dışında `@medusajs/ui` import eden dosya
sayısı **0** — ve bu artık test tarafından bekleniyor (aşağıya bakın).

---

## Görev 4 — Nöbetçi eşikleri, çalışan test olarak

- Sayım betiği: `frontend/scripts/ui-baseline-sayim.mjs` — İP-A0'ın `sayim.sh`'inin
  taşınabilir Node sürümü (Windows'ta ve CI'da bash'siz koşsun diye). JSX etiket
  sayımı **dosya bütünü** üzerinde yapılır; satır bazlı sayım bu tabanda ham
  butonu 5,7 kat eksik ölçüyordu.
  **Çapraz doğrulama:** Node sürümü perl sürümüyle aynı sayıları veriyor —
  78 dosya / 126 ham `<button>` / 59 `<label>` / 3 `htmlFor`.
- Test: `frontend/src/__guards__/uiBaseline.test.ts` (Vitest `include` deseniyle
  `npm run test`'te koşar).

| Ölçüm | Taban | Eşik kuralı | Test |
|---|---|---|---|
| Ham `<button` | 126 | artamaz | `≤ 126` |
| `<label htmlFor` / `<label` | 3 / 59 | oran azalamaz | `3/59 ≤ oran` |
| `ui2/` dışında `@medusajs/ui` import | 0 | 0 kalmalı | `toEqual([])` |
| `role="dialog"`+`aria-modal`'sız overlay | 5 | artamaz | `≤ 5` + dosya listesi sabit |

Etiketsiz overlay dosyaları testte **isimle** sabitlendi:
`AdminPayoutsPage.tsx`, `AdminExamCatalogs.tsx`, `AdminLibraries.tsx` (×2 overlay,
1 dosya), `AdminStore.tsx`. Baskı katmanları (`LabelSheet`, `PackageLabel`,
`PackingLabelSheet`) isimle hariç tutuldu.

Ayrıca bir **yalancı-yeşil kapısı** var: ölçüm tabanı çökerse tüm sayımlar 0'a
düşer ve her eşik "geçer" — bu yüzden `files >= 70` ayrıca doğrulanıyor.

### Mutasyon provası — dört eşik de gerçekten nöbet tutuyor

Her mutasyon uygulandı, test kırıldı, mutasyon geri alındı, test yeşile döndü.
Çalışma ağacı `git status` ile temiz doğrulandı (kullanıcı değişikliği silinmedi).

| # | Mutasyon | Sonuç |
|---|---|---|
| M1b | `AdminPayoutsPage.tsx`'e **gerçek JSX** `<button type="button">MUTASYON</button>` | ✗ `expected 127 to be less than or equal to 126` |
| M2 | `htmlFor`suz `<label>` eklendi (3/59 → 3/60) | ✗ `expected 0.05 to be greater than or equal to 0.0508…` |
| M3 | Ekran dosyasına `import { Button } from "@medusajs/ui"` | ✗ `expected [ Array(1) ] to deeply equal []` |
| M4 | `role="dialog"`sız yeni overlay dosyası | ✗ **iki test birden**: `expected 6 to be less than or equal to 5` + dosya listesi eşleşmedi |

**Testin kendi kusuru, raporlanıyor (§C/§I):** M1'i önce bir *yorum satırıyla*
(`// MUTASYON: <button`) denedim ve test kırıldı — yani sayım **yorumları ve
string'leri de sayıyor**. Bu, İP-A0'ın perl sürümünde de var olan bir yanlış
pozitif kaynağı. Eşik "artamaz" yönlü olduğu için yanlış pozitif ancak *gereksiz
kırmızı* üretir (sessizce geçirmez), o yüzden bloklayıcı değil; ama gerçek
kanıtın yorumla üretilmemesi için M1 gerçek JSX ile tekrarlandı ve yukarıdaki
tabloya o hâli yazıldı. Sınıflandırma: bu testler **kaynak/AST sözleşmesi
testidir → düşük güçlü** (CLAUDE.md §C); amaçları davranış kanıtlamak değil,
borcun sessizce büyümesini engellemek.

---

## Görev 5 — K1 storefront regresyon turu (asıl kabul kanıtı)

Yöntem: gerçek Chrome (headless, CDP), gerçek backend (`ceyhandb`, gerçek veri),
gerçek Vite dev sunucusu. Aynı tur **iki kez** koşuldu — bir kez preset'siz
(`git show HEAD:frontend/tailwind.config.js`), bir kez preset'li — ve aradaki
fark **piksel piksel** ölçüldü. Betikler commit'lendi:

- `frontend/scripts/ip_a1_k1_tour.mjs` (tur + `--karsilastir` piksel diff)
- `frontend/scripts/ip_a1_anim_probe.mjs` (canlanan animasyon + kenarlık sondası)
- `frontend/scripts/ip_a1_modal_probe.mjs` (modal açılış animasyonu sondası)

Kararlı kare için sabit `sleep` değil, `document.getAnimations()` üzerinden
"yükleniyor göstergesi (`pulse`/`spin`) durana kadar bekle" mantığı kullanıldı —
iskelet ekran yakalamak yalancı piksel farkı üretiyordu (ilk denemede üretti de).

### Piksel karşılaştırması: 20 kare

| Yüzey | açık | koyu |
|---|---|---|
| Landing `/` | 0 px fark | 0 px fark |
| Marketplace `/egitmenler` | 0 | 0 |
| Libraries `/kutuphaneler` | 0 | 0 |
| LibraryDetail `/kutuphaneler/bizim-kutuphane` | 0 | 0 |
| Mağaza listesi `/magaza` | 0 | 0 |
| **Mağaza ürün detayı** | **874 px (%0,086)** | **2451 px (%0,242)** |
| Eğitmen profili (ilk karttan) | 0 | 0 |
| Admin `/yonetim/magaza/urunler` | 0 | 0 (maks kanal farkı 1) |
| Admin `/yonetim/envanter` | 0 | 0 |
| Kütüphane overlay yüzeyi | 0 | 0 |

Tek farkın sebebi ekran görüntülerinden okundu: **teslimat söz rozetinin geri
sayımı** — "1 sa **17** dk içinde sipariş ver" → "1 sa **10** dk". İki tur
arasında geçen süre. **CSS regresyonu değil.** Ham veri:
`docs/ip-a1/k1-piksel-fark.json`.

### "Daha önce animasyon olmayan yerde şimdi animasyon var mı?"

Dingin kare karşılaştırması bu soruyu cevaplayamaz, o yüzden ayrı sonda yazıldı:
sayfa başına `animate-in|fade-in|zoom-in|slide-in-*` sınıfı taşıyan eleman sayısı
ve bunlardan kaçının computed `animation-name`'i `none` **değil**.

| Yüzey | ÖNCE (sınıflı / canlı) | SONRA (sınıflı / canlı) |
|---|---|---|
| Landing | 0 / 0 | 0 / 0 |
| Marketplace | 1 / **0** | 1 / **1** |
| Libraries | 1 / **0** | 1 / **1** |
| LibraryDetail | 1 / **0** | 1 / **1** |
| Mağaza listesi | 0 / 0 | 0 / 0 |
| Görevler, Alışkanlıklar | 0 / 0 | 0 / 0 |

İP-A0'ın "70 sınıf ölü duruyor, canlanacak" tespiti **doğrulandı**: önce
`animation-name: none`, sonra `animation-name: enter`. Canlanan eleman:
`class="w-full animate-in fade-in duration-300"` — arama sonuç listesi, 300 ms
opaklık geçişi. **İstenmeyen değil**: yazan kişinin niyeti tam bu, dingin karede
görsel fark sıfır, çift animasyon yok.

### Modallar (`zoom-in-95` / `slide-in-from-*`)

Bu sınıflar yalnız modal açılışında DOM'a girdiği için sayfa turu bunlara hiç
dokunmuyor — ayrı sonda ile açıldı ve **açılıştan 120 ms sonra** ölçüldü.

| Modal | ÖNCE | SONRA |
|---|---|---|
| ShareModal (açık/koyu) | koşan animasyon `[]`, `animation-name: none` | koşan `[enter]`, `animation-name: enter` |
| AuthModal (açık/koyu) | koşan `[]`, `transform: matrix(1,0,0,1,0,0)` | koşan `[enter,enter]`, `transform: matrix3d(0.95…)` → 1 |

Yani modal artık `zoom-in-95`'ten 200 ms'de yerine oturuyor. Açılış karesi
görüntülendi (`modal-sonra/auth-modal-dark-acilis.png`): arka plan kararırken
panel ölçekleniyor — standart, akıcı bir modal girişi, göz tırmalamıyor.
**Dingin hâl önce/sonra bit düzeyinde aynı** (4 kare, 0 px fark —
`docs/ip-a1/modal-dingin-piksel-fark.json`).

### Koyu temada kenarlık rengi (`#e5e7eb` → `rgba(255,255,255,.08)`)

`--border-base` değişkeni gerçekten tanımlandı ve temaya göre değişiyor:
önce `(tanımsız)`, sonra açıkta `rgba(228,228,231,1)` / koyuda
`rgba(255,255,255,0.08)`. Yeni `*{border-color:var(--border-base)}` kuralı da
üretilmiş durumda.

**Görünür etkisi yok.** 14 sayfa/tema kombinasyonunda `border-width > 0` olan
elemanların renk dağılımı önce/sonra karşılaştırıldı: **0/14 sayfada fark**.
Sebep açık — bu tabandaki bordürlü elemanların hepsi zaten açık bir
`border-slate-*` sınıfı taşıyor, `*` kuralı yalnız *varsayılanı* değiştiriyor.
20 karelik piksel karşılaştırması da bunu bağımsız olarak doğruluyor.
`::before`/`::after` kaynaklı bir uyumsuzluk da gözlenmedi.

### Bulunan regresyon

**Yok.** B planına dönüş tetikleyicisi oluşmadı.

### Kapsam boşlukları (dürüstçe)

- **BookingModal ve LibraryReservationModal açılmadı.** İkisi de CLIENT oturumu
  istiyor; turda yalnız ADMIN token'ı vardı. `slide-in-from-right-4` adım
  geçişleri bu yüzden gerçek tarayıcıda görülmedi. Panel sınıf dizgisi
  (`animate-in zoom-in-95 duration-200`) ShareModal/AuthModal ile birebir aynı
  olduğu için davranışın aynı olması bekleniyor — ama bu **çıkarım, ölçüm değil**.
- **TaskCommandPalette ve `useNavSearch`** yüzeyleri de aynı sebeple ölçülmedi
  (`/gorevler` ve `/ogren/aliskanliklar` admin oturumuyla açıldı ama animasyon
  sınıflı eleman içermiyordu; paletler klavye kısayoluyla açılıyor).
- Ekran görüntüleri (56 PNG) repoya konmadı, boyut sebebiyle. Ölçüm JSON'ları
  `docs/ip-a1/` altında; görüntüler scratchpad'te ve **betikler commit'lendiği
  için tur yeniden üretilebilir**.
- Turda MinIO bucket'ı yoktu; ürün görselleri kırık ikonla render oldu. Bu
  önce/sonra **her iki turda da aynı** olduğu için karşılaştırmayı etkilemiyor.
- Bu worktree'de `backend/.env` ve `frontend/.env` yoktu; tur için
  `adana-ozel-ders` worktree'sinden kopyalandı ve `AUTO_CREATE_DB=False`,
  `PAYMENT_PROVIDER=fake`, `EMAIL_PROVIDER=console` yapıldı (canlı `ceyhandb`'ye
  migration çalıştırmamak ve iyzico sandbox'ına çıkmamak için). Dosyalar
  gitignore'da; worktree'de bırakıldı.

---

## Görev 6 — Bundle etkisi

### `@tanstack/react-table` iki kopya birden geliyor mu — **hayır**

- Çekirdek imza (`getCoreRowModel`) yalnız **tek** chunk'ta: `DataTable-CnSPtRhV.js`.
- O chunk'ın boyutu önce ve sonra **birebir aynı**: 54.391 B. Medusa'nın 8.20.5
  kopyası bundle'a hiç girmedi — tree-shaking beklendiği gibi düşürdü.
- Bundle'da `8.20.5` sürüm imzası yok.

### CSS

| Yapılandırma | Ham | gzip |
|---|---|---|
| Baseline (preset yok) | 153.868 B | 27,53 kB |
| Preset var, `content`'te Medusa dist **yok** | 170.815 B | — |
| **Son hâl** (preset + Medusa dist content'te) | **209.994 B** | **35,37 kB** |

Ayrıştırma: preset'in kendi katkısı **+16,9 kB** (base katmanı, `ui-*` CSS
değişkenleri, canlanan 70 sınıf için `animate` yardımcıları). Kalan **+39,2 kB**
tamamen `content`'e eklenen `node_modules/@medusajs/ui/dist` yolundan geliyor —
yani **henüz kullanılmayan** Medusa bileşenlerinin sınıfları için üretilmiş,
bugün ölü CSS. İstenen buydu; ama karar noktası olarak kayda geçiyor: o content
satırı ilk gerçek Medusa bileşeni `ui2/`'den render edilene kadar ertelenebilirdi.
Gzip'te toplam maliyet +7,8 kB.

### JS

| | Toplam JS |
|---|---|
| Baseline | 2.337.442 B |
| Son hâl | 2.339.995 B |

**+2.553 B**, tamamı `index` chunk'ında (269.835 → 272.388 B) — `I18nProvider`'ın
getirdiği `react-aria` locale tesisatı. `vendor` ve `DataTable` chunk'ları
bayt bayt değişmedi.

---

## Bitiş kontrolü

- [x] `tsc --noEmit` temiz (kurulumdan önce ve sonra)
- [x] Test paketi kurulumdan önceki hâlinden kötü değil (1015 → 1021, hepsi yeşil)
- [x] `.font-mono` ve `code,kbd,samp,pre` ikisi de eski yığında; `Roboto Mono` 0 eşleşme
- [x] `ui2/` dışında `@medusajs/ui` import eden dosya: 0 (ve test bunu bekliyor)
- [x] Dört nöbetçi eşiği test olarak çalışıyor **ve kasıtlı ihlalle kırıldığı gösterildi**
- [x] K1 turu açık + koyu temada yapıldı, ekran görüntüleri + piksel farkıyla
- [x] Hiçbir ekran dosyası yeniden yazılmadı

## Karar bekleyen / İP-A2'ye taşınan

1. `@tanstack/react-table` çift kopyası — bugün zararsız; ilk `DataTable`
   kullanımında yeniden ölçülmeli.
2. `content`'teki Medusa dist yolunun +39,2 kB ölü CSS maliyeti — ilk bileşen
   kullanımına kadar ertelenebilir mi?
3. Nöbetçi sayımının yorum/string'leri de sayması (yanlış pozitif; sessiz geçiş
   üretmiyor).
4. CLIENT oturumu gerektiren modallar (BookingModal, LibraryReservationModal) ve
   komut paletleri gerçek tarayıcıda görülmedi.
