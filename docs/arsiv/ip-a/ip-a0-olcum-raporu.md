# İP-A0 Ölçüm Raporu

Tarih: 19 Ağustos 2026 · Worktree: `adana-spike-a0` · Branch: `spike/ip-a0-medusa-ui`
Ölçen: Claude Code (ölçüm ajanı) · **Hiçbir commit / push / merge yapılmadı**

---

## Karar tablosu

| Kapı | Sonuç | Kanıt |
|---|---|---|
| **B1** React sürümü | **YEŞİL** (dışarıda ölçüldü, doğrulandı) | Kurulu `react@18.3.1` / `react-dom@18.3.1`; `@medusajs/ui@4.2.1` peer dep'i tam olarak `{"react":"^18.3.1","react-dom":"^18.3.1"}` |
| **B2** Tailwind sürümü | **YEŞİL** (dışarıda ölçüldü, doğrulandı) | Kurulu `tailwindcss@3.4.19` (bildirim `^3.4.13`), `tailwind.config.js` mevcut; `@medusajs/ui-preset@2.19.0` peer dep'i `{"tailwindcss":"^3.4.3"}` |
| **B3** Kurulum çakışması | **YEŞİL** | `npm install` **ERESOLVE vermeden** geçti: `added 106 packages, and audited 578 packages in 17s`, exit 0. Bilinen sorun (#15398) **tekrar üretilemedi** — sebebi aşağıda |
| **B4** Preset yan etkisi | **SARI** | Build geçti (exit 0). **Silinen kural: 0**, eklenen: 413, **değeri değişen: 10**. Ayrıca preset, kodda hâlihazırda **ölü** olan 70 adet `animate-in` / `fade-in` / `zoom-in` / `slide-in-*` sınıfını **canlandırıyor** (müşteriye dönük sayfalar dahil) |
| **Ek: `useBlocker` uyumu** | **KIRMIZI** | Proje klasik `<BrowserRouter>` + `<Routes>` kullanıyor (`src/App.tsx:326`, 126 adet `<Route`). `react-router-dom@7.18.1` kurulu ama **data router değil** → `useBlocker` çalışmaz. A3 paketi önce `createBrowserRouter` göçünü gerektirir |

---

## Tavsiye

**A planı — paket alınır; ancak iki koşulla ve A3'ün yeniden fiyatlanmasıyla.**

Gerekçe:

1. **B3 gerçekten temiz.** Görev dosyasındaki bilinen sorun artık geçerli değil: `@medusajs/icons` 2.15.x'te React `^19.2.5` isterken, transitive olarak gelen **2.19.0** peer aralığını `^18.3.1 || ^19.0.0`'a genişletmiş. `--legacy-peer-deps` gerekmedi, lockfile temiz kaldı.
2. **B4'te hiçbir mevcut kural silinmiyor** ve `--admin-*` CSS değişkenlerimiz korunuyor (preset'in `:root`/`.dark` bloğu bizimkinden **önce** basılıyor; bizimki sonra geldiği için çakışma olsa bile bizimki kazanırdı — zaten isim çakışması yok).
3. Değişen 10 kuralın tamamı **sayılabilir ve sınırlı**; hiçbiri `slate-*` renk paletine, `rounded-*` / `shadow-*` / `text-*` ölçeklerine dokunmuyor.

Koşullar:

- **K1 — Storefront regresyon turu zorunlu.** `tailwind.config.js` tek dosyadır; preset yalnız admini değil `/magaza`, `/kutuphaneler`, eğitmen panelini ve `Landing`'i de etkiler. Özellikle **70 ölü animasyon sınıfının canlanması** görsel bir davranış değişikliğidir ve müşteriye dönük ekranlarda **gerçek tarayıcıda** doğrulanmalıdır (CLAUDE.md §F).
- **K2 — `font-mono` kararı.** Preset mono yığınının başına `Roboto Mono` ekliyor; bu font projede **yüklü değil** (ne `index.html`'de ne CSS'te "roboto" geçiyor). Kullanıcının makinesinde varsa görünür, yoksa yok — yani **tutarsız render**. Ya font yüklenmeli ya `theme.extend.fontFamily.mono` ile geri alınmalı. Kodda 35 `font-mono` kullanımı var.
- **A3 yeniden fiyatlansın.** `useBlocker` bugünkü router mimarisiyle **imkânsız**. Ya A3'ten önce 126 rotalık `createBrowserRouter` göçü ayrı bir paket olarak alınmalı, ya A3 `beforeunload` + elle onay diyaloğuna indirgenmeli. Bu, İP-A0'ın kapsamı dışında ama planı doğrudan etkiliyor.

**B planına dönüş tetikleyicisi:** K1 turunda storefront'ta düzeltilemeyen görsel regresyon çıkarsa. Tek `tailwind.config.js` olduğu için preset'i "yalnız admine" daraltmanın temiz bir yolu yok — ikinci bir Tailwind derleme hattı kurmak gerekir ki bu, B planının (primitive'leri elle yazmak) maliyetine yaklaşır.

**Maliyet notu (karar için):** paket +106 npm paketi, **+41,3 MB** `node_modules`, **56 adet `@radix-ui/*`**, ve `@tanstack/react-table`'ın ikinci bir kopyası (8.20.5; bizimki 8.21.3 kalıyor). Üretim CSS'i **+%36,5** (gzip +%29,1). Karşılığında kazanılan taban ise 20.505 satır / 77 dosyalık bir admin yüzeyi.

---

## Nöbetçi taban sayıları

Ölçüm tabanı: `src/components/admin/**` + `src/pages/admin/**` + `src/pages/dashboards/Admin*.tsx` (`.tsx` / `.ts`).

| # | Ölçüm | Değer |
|---|---|---|
| 0 | Dosya sayısı | **77** |
| 0 | Toplam satır | **20.505** |
| 1 | Ham `<button` | **126** |
| 2 | Ortak `<Button` (projenin kendi bileşeni) | **93** |
| 3 | `<input` | 107 |
| 3 | `<select` | 31 |
| 3 | `<textarea` | 6 |
| 3 | **Form alanı toplamı** | **144** |
| 4 | `<label` | **59** |
| 4 | bunlardan `htmlFor` içeren | **3** (%5,1) |
| 5 | `dark:` kullanımı (occurrence) | **1.199** |
| 5 | `dark:` içeren dosya | 55 / 77 |
| 6 | `fixed inset-0` içeren dosya | **9** (aşağıda) |

### Yalnız `AdminStore.tsx`

| Ölçüm | Değer |
|---|---|
| Toplam satır | **2.216** |
| Ham `<button` | **28** |
| Ortak `<Button` | **4** |
| `<input` / `<select` / `<textarea` | 35 / 12 / 1 |
| `<label` | 12 |
| `dark:` | 116 |

> Ham/ortak oranı taban genelinde 126/93, `AdminStore.tsx`'te ise **28/4**. Yani en büyük tek admin ekranı, ortak bileşen benimseme oranında tabanın belirgin şekilde altında.

### `fixed inset-0` içeren 9 dosya

| Dosya | `useModalA11y` | `role="dialog"` + `aria-modal` | `createPortal` | Not |
|---|---|---|---|---|
| `components/admin/ui/Dialog.tsx` | **EVET** | EVET | EVET | Ortak diyalog — referans uygulama |
| `components/admin/layout/AdminLayout.tsx` | hayır | EVET | hayır | Mobil çekmece; a11y elle yazılmış, Escape dinleyicisi var |
| `pages/admin/AdminPayoutsPage.tsx` | hayır | **hayır** | hayır | **Elle modal, a11y yok** |
| `pages/dashboards/AdminExamCatalogs.tsx` | hayır | **hayır** | hayır | **Elle modal, a11y yok** |
| `pages/dashboards/AdminLibraries.tsx` | hayır | **hayır** | hayır | **Elle modal ×2, a11y yok** |
| `pages/dashboards/AdminStore.tsx` | hayır | **hayır** | EVET | **Elle modal, a11y yok** (portal var) |
| `components/admin/delivery/LabelSheet.tsx` | hayır | hayır | EVET | Modal değil — tam ekran **baskı katmanı** |
| `components/admin/packing/PackageLabel.tsx` | hayır | hayır | EVET | Modal değil — baskı katmanı ×2 |
| `components/admin/packing/PackingLabelSheet.tsx` | hayır | hayır | EVET | Modal değil — baskı katmanı |

**Özet:** 9 dosyanın 3'ü baskı katmanıdır (modal değil, kapsam dışı). Kalan 6 gerçek overlay'in **yalnız 1'i** (`ui/Dialog.tsx`) ortak `useModalA11y`'yi kullanıyor; **4'ünde `role="dialog"` / `aria-modal` hiç yok**.

---

## Ölçüm detayları

### Görev 1 — Sürüm envanteri

`frontend/package.json` bildirimi ve `node_modules`'daki **çözülmüş** sürüm:

| Paket | package.json | Kurulu |
|---|---|---|
| `react` | `^18.3.1` | 18.3.1 |
| `react-dom` | `^18.3.1` | 18.3.1 |
| `tailwindcss` | `^3.4.13` | 3.4.19 |
| `vite` | `^5.4.8` | 5.4.21 |
| `react-router-dom` | `^7.18.1` | **7.18.1** |
| `typescript` | `^5.6.2` | 5.9.3 |
| `@tanstack/react-table` | `^8.21.3` | 8.21.3 |
| `@tabler/icons-react` | `^3.45.0` | 3.45.0 |
| `zustand` | `^4.5.5` | 4.5.7 |
| `vitest` | `^2.1.9` | 2.1.9 |

#### `frontend/tailwind.config.js` — değişiklik öncesi tam içerik

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      keyframes: {
        snow: {
          "0%": { transform: "translateY(-10vh) translateX(0)" },
          "100%": { transform: "translateY(110vh) translateX(20px)" },
        },
      },
      animation: {
        snow: "snow 10s linear infinite",
      },
    },
  },
  plugins: [],
};
```

**Yorum (Görev 4 diff'ini yorumlamak için):** `theme` override'ımız gerçekten çok dar — yalnız `fontFamily.sans`, bir `keyframes` ve bir `animation`. Renk paleti, `rounded-*`, `shadow-*`, `spacing`, `fontSize` hiç ellenmemiş; hepsi Tailwind varsayılanı. Bu, B4 diff'inin neden bu kadar temiz çıktığının doğrudan sebebidir: preset'in ezebileceği bir tema yüzeyimiz neredeyse yok. **Tek çakışma noktası `fontFamily`**, ve orada `extend.sans` bizde kaldığı için `font-sans` **değişmedi** (diff'te yok); ama `fontFamily.mono`'yu biz tanımlamadığımız için preset'inki geçti (aşağıda).

#### `react-router-dom` / `useBlocker` tespiti

```
src/App.tsx:3     import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
src/App.tsx:326         <BrowserRouter>
src/App.tsx:550         </BrowserRouter>
```

- `createBrowserRouter` / `createHashRouter` / `RouterProvider`: **hiç kullanılmıyor** (0 eşleşme).
- `useBlocker` / `unstable_usePrompt`: **hiç kullanılmıyor** (0 eşleşme).
- `src/App.tsx` içinde **126** adet `<Route`.

**Sonuç:** Sürüm (7.18.1) `useBlocker`'ı içeriyor, ama hook data router bağlamı ister; klasik `<BrowserRouter>` bunu sağlamaz ve hook hata fırlatır. **A3 paketi bugünkü mimariyle uygulanamaz.** Ön koşul: 126 rotanın `createBrowserRouter` nesne ağacına taşınması (`<Navigate>` yönlendirmeleri, `useLocation` tabanlı rol korumaları ve lazy chunk'lar dahil) — bu kendi başına bir pakettir.

---

### Görev 2 — Nöbetçi taban ölçümleri

Sayılar yukarıdaki "Nöbetçi taban sayıları" bölümünde. Yöntem ve doğrulama, "Ölçüm yöntemi" bölümünde — özellikle **naif `grep` bu tabanda ham buton sayısını 5,7 kat eksik ölçüyor**; oradaki uyarı CI eşiği commit'lenmeden önce okunmalı.

---

### Görev 3 — Kurulum ve çakışma denemesi (B3) → **YEŞİL**

**`npm ci` (temiz kasa):**

```
added 471 packages, and audited 472 packages in 26s

166 packages are looking for funding
  run `npm fund` for details

11 vulnerabilities (3 moderate, 7 high, 1 critical)

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
```

exit 0. Açıklar mevcut tabanın açıklarıdır — kurala uyarak `npm audit fix` **çalıştırılmadı**.

**`npm install @medusajs/ui @medusajs/ui-preset`:**

```
npm warn deprecated lodash.isequal@4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.

added 106 packages, and audited 578 packages in 17s

170 packages are looking for funding
  run `npm fund` for details

11 vulnerabilities (3 moderate, 7 high, 1 critical)

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
```

exit 0. **ERESOLVE yok. `--legacy-peer-deps` gerekmedi.** Açık sayısı kurulumdan önce ve sonra aynı (11) — yeni paketler yeni bilinen açık getirmedi.

**Kurulan sürümler ve peer dep'ler:**

| Paket | Sürüm | peerDependencies |
|---|---|---|
| `@medusajs/ui` | **4.2.1** | `{"react":"^18.3.1","react-dom":"^18.3.1"}` |
| `@medusajs/ui-preset` | **2.19.0** | `{"tailwindcss":"^3.4.3"}` |
| `@medusajs/icons` | **2.19.0** (transitive olarak geldi) | `{"react":"^18.3.1 \|\| ^19.0.0"}` |

**Bilinen sorun (#15398) neden çıkmadı:** Görev dosyasındaki teşhis `@medusajs/icons` **2.15.x** içindi ve o sürüm React `^19.2.5` istiyordu. Bizde `@medusajs/ui@4.2.1`, `@medusajs/icons`'u **`2.19.0` olarak tam pinliyor** (caret değil) ve 2.19.0'ın peer aralığı `^18.3.1 || ^19.0.0`'a genişletilmiş — React 18.3.1 bu aralığın **içinde**. Yani sorun yukarı akışta düzeltilmiş; workspace olup olmaması belirleyici değil. `npm ls` çıktısı:

```
adana-ozel-ders-frontend@0.0.0 C:\Users\kiyar\Desktop\adana-spike-a0\frontend
+-- @medusajs/ui@4.2.1
| +-- @medusajs/icons@2.19.0
| `-- @tanstack/react-table@8.20.5
`-- @tanstack/react-table@8.21.3
```

**Ölçülen maliyet:**

| Ölçüm | Öncesi | Sonrası | Fark |
|---|---|---|---|
| `node_modules` boyutu | 250,7 MB | **292,0 MB** | **+41,3 MB (+%16,5)** |
| `node_modules` dosya sayısı | 43.179 | 57.340 | +14.161 |
| Paket dizini (scope'lar açılmış) | 458 | 556 | **+98** (npm raporu: "added 106 packages") |
| `@radix-ui/*` | **0** | **56** | +56 |

**Dikkat edilecek iki nokta:**

1. **`@tanstack/react-table` ikizlendi.** `@medusajs/ui` 8.20.5'i tam pinliyor, biz `^8.21.3` kullanıyoruz → `node_modules/@medusajs/ui/node_modules/` altında **ikinci kopya**. Bundle'a iki tablo motoru girebilir; admin'de zaten `DataTable-*.js` (54,38 kB) var. Tip düzeyinde çakışma **ölçülmedi** (bkz. Bilinen sınırlar).
2. **`@medusajs/ui` 19 doğrudan bağımlılık getiriyor**: `react-aria`, `react-stately`, `@dnd-kit/core|sortable|utilities`, `prismjs` + `prism-react-renderer`, `sonner`, `cva`, `tailwind-merge`, `copy-to-clipboard`, `lodash.isequal` (deprecated), `react-currency-input-field`, `radix-ui` (meta paket) ve iki ayrı `@radix-ui/react-*`. 56 `@radix-ui/*` pakete `radix-ui` meta paketi üzerinden ulaşılıyor.

---

### Görev 4 — Preset'in tüm siteye etkisi (B4) → **SARI**

**Uygulanan değişiklik (yalnız bu ikisi; hiçbir mevcut ayar silinmedi veya değiştirilmedi):**

```diff
   darkMode: "class",
+  presets: [require("@medusajs/ui-preset")],
-  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
+  content: [
+    "./index.html",
+    "./src/**/*.{js,ts,jsx,tsx}",
+    "./node_modules/@medusajs/ui/dist/**/*.{js,jsx,ts,tsx}",
+  ],
```

> **Not (uygulama ayrıntısı, ölçüm bulgusu değil):** `frontend/package.json` `"type": "module"` ve config `export default` kullanıyor; buna rağmen `require("@medusajs/ui-preset")` **çalıştı**, çünkü Tailwind config'i `jiti` ile yüklüyor ve `require`'ı enjekte ediyor. Yani görev dosyasındaki form birebir çalıştı. Yine de kalıcı kodda ESM `import preset from "@medusajs/ui-preset"` biçimi daha sağlam olur (jiti davranışına bağımlı kalmamak için).

Her iki build de **exit 0**. Baseline 59,27 s, preset'li 31,88 s — ikinci build'de Vite/esbuild önbelleği sıcaktı, **bu süreler karşılaştırılabilir değildir**, yalnız kayıt için.

#### Boyut

| | baseline | preset'li | Fark |
|---|---|---|---|
| Ana Tailwind CSS (`dist/assets/index-*.css`) | **153.868 B** | **210.018 B** | **+56.150 B (+%36,5)** |
| aynı dosya, gzip | 27.127 B | 35.025 B | **+7.898 B (+%29,1)** |
| `dist/assets/*.css` toplamı | 168.760 B | 224.910 B | +56.150 B |

JS bundle'ları değişmedi (henüz hiçbir Medusa bileşeni import edilmedi). Ölçüm bilinçli olarak yalnız preset'in CSS etkisini izole ediyor; bileşen kullanımının JS maliyeti **ayrıca** ölçülmelidir.

#### Kural düzeyi diff (asıl çıktı)

| | |
|---|---|
| baseline kural sayısı | 2.012 |
| preset'li kural sayısı | 2.425 |
| **EKLENEN** | **413** |
| **SİLİNEN** | **0** |
| **DEĞERİ DEĞİŞEN** | **10** |

**Görev dosyasındaki soruların tek tek cevabı:**

**a) Yalnız yeni `ui-*` sınıfları mı eklendi?** — **Hayır.** 413 eklemenin çoğu `ui-*` renk token'lı (`bg-ui-bg-base`, `text-ui-fg-subtle`, `placeholder-ui-fg-muted`…), ama yanında **`ui-*` ile ilgisi olmayan** üç grup daha var:

- **Medusa tipografi sınıfları:** `.txt-compact-xsmall`, `.txt-compact-small-plus`, `.txt-small`, `.txt-large`, `.h1-core`, `.h2-core`, `.h3-core` … (19 adet). **Global isim uzayında, `ui-` öneki YOK.** İleride bizim tanımlayacağımız bir `.txt-*` sınıfıyla çakışma riski taşır.
- **`tailwindcss-animate` yardımcıları:** `.animate-in`, `.fade-in`, `.zoom-in-95`, `.slide-in-from-*` — aşağıda "Ek bulgu 2".
- **Bileşenlerin ihtiyaç duyduğu standart Tailwind sınıfları:** `.size-4` … `.size-11`, `.inset-2`, `.box-border`, `.collapse`, `.-ml-px`, radix değişkenli `.h-[var(--radix-select-trigger-height)]` gibi. Bunlar zararsız — sadece content taramasına Medusa dist'i eklendiği için üretildiler.

**b) Mevcut `slate-*` renk tanımları değişti mi?** — **HAYIR.** Değişen 10 kuralın hiçbiri `slate-*` (veya herhangi bir Tailwind renk yardımcısı) değil. Preset `theme`'i hiç ezmiyor: `require("@medusajs/ui-preset")` nesnesinin anahtarları yalnızca `{ content: [], plugins: [ … ] }` — **`theme` anahtarı hiç yok**. Tüm katkı iki Tailwind eklentisi üzerinden geliyor (`@tailwindcss/forms` ve `tailwindcss-animate`, ui-preset'in kendi bağımlılıkları).

> Yan not: `@tailwindcss/forms` bağımlılık olarak geliyor ama üretilen CSS'te **hiçbir `[type=…]` / `select` / `textarea` taban stili görünmedi** — yani forms eklentisi `class` stratejisiyle geliyor ya da base katmanına yazmıyor. Bu, en büyük "tüm siteyi etkiler" riskinin **gerçekleşmediği** anlamına gelir: mevcut 144 admin form alanı + storefront formları taban düzeyinde etkilenmiyor.

**c) `rounded-*`, `shadow-*`, `font-*`, `text-*` tanımları değişti mi?**

- `rounded-*`: **değişmedi** (0 kural).
- `shadow-*`: **değişmedi** (0 kural).
- `text-*`: **değişmedi** (0 kural).
- `font-*`: **DEĞİŞTİ — 1 kural.**

```
.font-mono
  ESKİ: font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace
  YENİ: font-family: Roboto Mono,ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace
```

Aynı değişiklik preflight'taki `code,kbd,samp,pre` kuralına da yansıyor (2. değişen kural).
**Etki:** kodda **35** `font-mono` kullanımı var; `Roboto Mono` projede **hiç yüklenmiyor** → font kullanıcının makinesinde varsa görünür, yoksa görünmez. **Belirsiz/tutarsız render.** `font-sans` **etkilenmedi**, çünkü `theme.extend.fontFamily.sans`'ımız preset'in üstünde.

**d) `:root` altındaki CSS değişkenleri değişti mi, çakışan isim var mı?** — **Değişken eklendi, hiçbiri ezilmedi, çakışan isim YOK.**

- Preset `:root`'a **113**, `.dark`'a **113** yeni değişken ekliyor: `--bg-*`, `--fg-*`, `--border-*`, `--button-*`, `--buttons-*`, `--borders-*`, `--elevation-*`, `--contrast-*`, `--tag-*`, `--alpha-*`, `--details-*`.
- Bizim **6** değişkenimiz (`--admin-surface`, `--admin-surface-muted`, `--admin-border`, `--admin-focus`, `--admin-success`, `--admin-danger`) hem `:root` hem `.dark` altında **aynen duruyor**.
- **Kaynak sırası doğrulandı:** çıktı CSS'inde preset'in blokları `:root`(#168) ve `.dark`(#169), bizimkiler `:root`(#170) ve `.dark`(#171) — yani **bizimkiler sonra** basılıyor. Eşit özgüllükte sonra gelen kazanır; çakışma olsaydı bile bizimki galip gelirdi. İsim uzayları zaten ayrık (`--admin-*` ↔ `--bg-*` / `--fg-*` / …), **tek bir isim çakışması yok**.
- **Araç yapaylığı uyarısı:** diff aracım bu iki bloğu "değişti" diye işaretledi, çünkü aynı seçiciye ait iki ayrı kural aynı anahtara düştü ve birleştirildi. **Gerçekte ekleme'dir, ezme değil** — yukarıdaki sıra doğrulaması bunun elle kanıtıdır.

**e) `dark` sınıfının davranışı değişti mi?** — **Mekanizma değişmedi, içerik genişledi; bir de yan etki var.**

- `darkMode: "class"` bizde kalıyor; preset `darkMode` **tanımlamıyor** (`undefined`), dolayısıyla ezmiyor.
- `.dark` seçicisine 113 yeni değişken ekleniyor; bizim 6 değişkenimiz korunuyor.
- **Davranışsal yan etki:** `tailwindcss-animate` eklentisi geldiği için `.duration-150/200/300/500` ve `.ease-linear` / `.ease-out` yardımcıları artık **ek olarak** `animation-duration` / `animation-timing-function` de yazıyor (değişen 10 kuraldan 6'sı bunlar). Mevcut `transition-*` bildirimleri **silinmedi**, üzerine eklendi.

**f) Toplam CSS boyut farkı:** +56.150 B ham (+%36,5), +7.898 B gzip (+%29,1).

#### Silinen veya değeri değişen mevcut sınıf — tam liste

**Silinen: 0.** (`spike-ciktilar/diff-silinen.txt` boş.)

**Değeri değişen: 10** (`spike-ciktilar/diff-degisen.txt` içinde eski/yeni değerleriyle tam hâli):

| # | Kural | Değişiklik | Değerlendirme |
|---|---|---|---|
| 1 | `code,kbd,samp,pre` | mono yığınının başına `Roboto Mono` | ⚠️ **Gerçek**, site geneli, font yüklü değil |
| 2 | `.font-mono` | aynı | ⚠️ **Gerçek**, 35 kullanım |
| 3 | `:root` | 113 değişken **eklendi** (bizimkiler duruyor ve sonra basılıyor) | ✅ Ekleme, ezme değil |
| 4 | `.dark` | 113 değişken **eklendi** (bizimkiler duruyor) | ✅ Ekleme, ezme değil |
| 5 | `.duration-150` | `+ animation-duration:.15s` | ⚠️ Davranış genişlemesi |
| 6 | `.duration-200` | `+ animation-duration:.2s` | ⚠️ Davranış genişlemesi |
| 7 | `.duration-300` | `+ animation-duration:.3s` | ⚠️ Davranış genişlemesi |
| 8 | `.duration-500` | `+ animation-duration:.5s` | ⚠️ Davranış genişlemesi |
| 9 | `.ease-linear` | `+ animation-timing-function:linear` | ⚠️ Davranış genişlemesi |
| 10 | `.ease-out` | `+ animation-timing-function:cubic-bezier(0,0,.2,1)` | ⚠️ Davranış genişlemesi |

#### Ek bulgu 1 — yeni GLOBAL taban kuralı (`*`)

Diff'te teknik olarak "eklenen" tarafta, ama site geneli etkisi olduğu için ayrıca raporlanmalı:

```
preset.css #167:   * { border-color: var(--border-base) }
```

Bu kural, Tailwind preflight'ının `*,:before,:after { border-color:#e5e7eb }` kuralından **sonra** geliyor ve `*` için aynı özgüllükte olduğundan **kazanıyor**. Yani hiçbir `border-<renk>` sınıfı verilmemiş her elemanın varsayılan kenarlık rengi değişiyor:

- açık tema: `#e5e7eb` (gray-200) → `rgba(228,228,231,1)` (zinc-200) — **görsel olarak ihmal edilebilir**
- koyu tema: `#e5e7eb` → `rgba(255,255,255,.08)` — **belirgin fark**
- `::before` / `::after` eski değerde kalıyor (yeni kural yalnız `*`) → pseudo-element kenarlıklarıyla **uyumsuzluk** doğabilir

**Ölçülen patlama yarıçapı:** tüm `src` taranarak, kenarlık genişliği veren ama ifadenin hiçbir yerinde kenarlık rengi bulunmayan `className` sayısı: **663 kenarlıklı ifadeden 6'sı**. Bu 6'nın 3'ü rengi harici bir sabit tablodan alıyor (`Toaster.tsx → cls.border`, `TutorSettings.tsx → cfg!.border`, `TaskCommandPalette.tsx → PRIO_DOT[p]`), yani gerçek risk **~3 eleman**. Ayrıca **`divide-x` / `divide-y` kullanan 64 ifadenin 64'ünde de `divide-<renk>` var** → `divide` yüzeyi hiç etkilenmiyor.

**Sonuç: kural küresel ama pratik etkisi ihmal edilebilir.**

#### Ek bulgu 2 — 70 ölü animasyon sınıfı canlanıyor (en önemli davranış değişikliği)

`tailwindcss-animate` projede kurulu **değil**; ama kod bu eklentinin sınıflarını **zaten kullanıyor**. Baseline CSS'te bu sınıflardan **hiçbiri yok** → bugün **hiçbir etkileri yok, ölü sınıflar**. Preset gelince **canlanıyorlar**:

| Sınıf | `src`'de kullanım | baseline.css | preset.css |
|---|---|---|---|
| `animate-in` | 33 | **0 kural** | 1 kural |
| `fade-in` | 15 | **0** | 2 |
| `zoom-in-95` / `zoom-in` | 13 + 1 | **0** | 1 |
| `slide-in-from-right-4` | 6 | **0** | 2 |
| `slide-in-from-bottom-4` | 2 | **0** | (aynı) |
| **Toplam kullanım** | **70** | | |

Üstelik bunların **29'u** aynı `className` içinde bir `duration-*` / `ease-*` ile birlikte kullanılıyor — yani (5)–(10) numaralı değişikliklerle birleşince animasyon süresi de gerçekten uygulanacak. Etkilenen dosyalar **admin dışına taşıyor**: `Landing.tsx`, `Marketplace.tsx`, `PublicMarketplace.tsx`, `Libraries.tsx`, `LibraryDetail.tsx`, `BookingModal.tsx`, `LibraryReservationModal.tsx`, `Habits.tsx`, `useNavSearch.tsx`, `TaskCommandPalette.tsx` …

Bu tek başına "bozulma" değil — bu sınıfları yazan kişi muhtemelen animasyonun çalışmasını bekliyordu. Ama **davranış değişikliğidir ve müşteriye dönük ekranlarda gerçek tarayıcıda görülmeden onaylanamaz** (K1 koşulu). Ayrıca kendi başına bir teknik borç bulgusudur: kodda 70 adet hiçbir şey yapmayan sınıf var.

#### Karar kuralı uygulaması

- Build geçmedi mi? → Hayır, **geçti** (exit 0) ⇒ KIRMIZI değil.
- Yalnız ekleme, hiçbir mevcut tanım değişmemiş mi? → **Hayır**: `.font-mono` + `code,kbd,samp,pre` gerçekten değişti, `duration-*` / `ease-*` genişledi, `* { border-color }` küresel taban kuralı geldi ⇒ YEŞİL değil.
- ⇒ **B4 = SARI**, değişenler yukarıda tam liste hâlinde.

---

### Görev 5 — Gömülü İngilizce metin taraması

Tarama alanı: `frontend/node_modules/@medusajs/ui/dist/esm` (138 `.js`) **ve eşlik eden `.d.ts` sözleşmeleri** — yalnız `.js` grep'i yeterli sayılmadı, her sabit dize için prop'la geçilip geçilemediği tip sözleşmesinden doğrulandı.

| Bileşen | Gömülü İngilizce metin | Prop ile geçilebiliyor mu? | Sarmalayıcı gerekir mi? |
|---|---|---|---|
| **`Table.Pagination`** | `"of"`, `"results"`, `"pages"`, `"Prev"`, `"Next"` | **EVET** — `translations?: { of, results, pages, prev, next }` | **Evet, ama ucuz.** Varsayılanı Türkçe veren ince bir sarmalayıcı yeter |
| **`DataTable.Pagination`** | aynı (`Table.Pagination`'a devrediyor) | **EVET** — `translations` prop'u `Table.Pagination`'ınkini yeniden kullanıyor | Evet, aynı sarmalayıcı |
| **`DataTable.Toolbar`** | `"Clear all"` (varsayılan), sıralama/kolon tooltip'leri | **EVET** — `translations?: { clearAll, sort, columns }` | Evet, ucuz |
| **`DataTable.Search`** | `"Search..."` | **EVET** — `placeholder?: string` | Hayır, kullanım yerinde geçilir |
| **`DataTable.Filter`** | `"Equals"`, `"Greater than"`, `"Greater than or equal"`, `"Less than"`, `"Less than or equal"`, `"Custom"`, `"Starting"`, `"Ending"`, `"Enter value..."`, `"Enter number..."`, `"No results found"`, `"Toggle all"` | **HAYIR** — `data-table-filter.js` içinde sabit; `.d.ts`'te karşılık gelen çeviri prop'u yok | ⚠️ **EVET ve pahalı.** Filtre menüsü kullanılacaksa ya bileşen fork'lanmalı ya filtreler elle yazılmalı |
| **`DatePicker`** | Sabit kullanıcı metni **bulunamadı** | Yerelleştirme `react-aria` / `@internationalized` üzerinden | **Hayır** — `<I18nProvider locale="tr-TR">` ile sarmak yeterli |
| **`Calendar`** | Sabit metin **yok** (ay/gün adları `useLocale` ile üretiliyor) | aynı | **Hayır** — aynı `I18nProvider` |
| **`Prompt`** | Bileşenin kendisinde metin **yok** (tamamı children) | — | Hayır |
| **`usePrompt` / `RenderPrompt`** | `"Cancel"`, `"Confirm"`, `"Please type {val} to confirm:"` | **EVET** — `cancelText?`, `confirmText?`, `verificationInstruction?` | Evet, ucuz |
| **`CommandBar`** | Sabit metin **yok** (etiketler `CommandBar.Command` prop'undan) | — | Hayır |
| **`Copy`** | `"Copy"`, `"Copied"`, `"Copy code snippet"` (tooltip / aria) | **HAYIR** — `.d.ts`'te yalnız `content`, `variant`, `asChild` var | ⚠️ **EVET** — Türkçe tooltip isteniyorsa bileşen kullanılmamalı veya fork'lanmalı |
| **`OtpInput`** | `"One-time password"` (aria-label) | **HAYIR** — props: `autoFocus`, `disabled`, `groupSize`, `inputClassName`, `length`, `onChange`, `onComplete` | ⚠️ Evet — ama yalnız ekran okuyucu metni; düşük öncelik |

**Özet:** 7 hedeften **4'ü prop ile Türkçeleştirilebiliyor** (Table/DataTable Pagination, Toolbar, usePrompt); **2'si locale sağlayıcısıyla otomatik çözülüyor** — `I18nProvider` paketten export ediliyor (`@medusajs/ui → I18nProvider`, `react-aria`'nın `I18nProvider`'ını sarıyor), `locale="tr-TR"` verilince `DatePicker` ve `Calendar` ay/gün adları Türkçeleşir. **3'ünde sabit metin var ve prop yok:** `DataTable.Filter` (en ağırı, 12 dize), `Copy`, `OtpInput`.

**Türkçeleştirme maliyeti:** merkezî bir `medusa-tr.tsx` sarmalayıcı katmanı (varsayılan `translations` nesneleri + `I18nProvider locale="tr-TR"`) — küçük. **Asıl risk `DataTable.Filter`**: filtre menüsü kullanılacaksa 12 sabit dize admin panelinde kullanıcıya İngilizce görünür. Karar gerekir: ya filtre yüzeyi Medusa'dan alınmaz, ya sürüm sabitlenip fork'lanır.

---

## Ölçüm yöntemi

Tüm sayımlar bu oturumda sıfırdan yapıldı; **başka hiçbir rapordan sayı okunmadı veya kopyalanmadı.** Betikler `spike-ciktilar/` altında saklandı ve aynen tekrar çalıştırılabilir.

### Nöbetçi taban sayımı — `spike-ciktilar/sayim.sh`

```bash
cd frontend && bash ../spike-ciktilar/sayim.sh
```

Dosya kümesi:

```bash
find src/components/admin src/pages/admin -type f \( -name '*.tsx' -o -name '*.ts' \)
ls src/pages/dashboards/Admin*.tsx
```

**JSX etiket sayımı `perl -0777` ile, dosya bütünü üzerinde yapılır — satır bazlı `grep` DEĞİL.** Bu kritik: ilk denemede `grep -oE '<button[[:space:]/>]'` kullanıldı ve **22** verdi. Gerçek sayı **126**. Sebep: `<button` etiketlerinin **104'ü** açılıştan hemen sonra **satır sonu** ile devam ediyor (Prettier sarması); `grep` satır bazlı çalıştığı için bunları kaçırıyor. Doğrulama, `<button` sonrası ilk karakterin dağılımıyla yapıldı:

```
NEWLINE => 104
SPACE   =>  22
```

**Çapraz kontrol:** açılan/kapanan etiket dengesi sayıldı — `<button`=126 / `</button>`=124; fark 2, ikisi de **kendinden kapanan backdrop butonu** (`AdminLayout.tsx:102`, `Dialog.tsx:26`) olarak elle okunup doğrulandı. `<Button`=93 / `</Button>`=93, tam denge. `<Button\b` deseni kelime sınırı içerdiği için `<ButtonGroup` gibi isimleri **yakalamaz**.

> **CLAUDE.md §E kapsamında not:** naif `grep` bu tabanda ham buton sayısını **5,7 kat** eksik ölçüyor. İleride CI eşiği olarak commit'lenecek sayı bu yüzden `perl -0777` yöntemiyle üretilmelidir; aksi hâlde eşik yalancı-yeşil olur (biri butonları `<button onClick=…` tek satıra çekince eşik "aniden düzeliyor" gibi görünür).

`htmlFor` sayımı, etiket **gövdesi** üzerinden yapılır (satır değil):

```perl
while(/<label\b[^>]*>/gs){ $lab++; $hf++ if $& =~ /\bhtmlFor\b/ }
```

`fixed inset-0` dosyaları `grep -l` ile bulunur; her dosya için `useModalA11y` / `<Dialog` / `role="dialog"` / `aria-modal` / `createPortal` varlığı ayrıca aranır ve dosyalar **elle okunarak** "modal mı, baskı katmanı mı" ayrımı yapılır (LabelSheet / PackageLabel / PackingLabelSheet baskı katmanıdır — otomatik sayım bunları modal sanardı).

### Router tespiti

```bash
grep -rn "createBrowserRouter\|BrowserRouter\|createHashRouter\|RouterProvider\|useBlocker\|unstable_usePrompt" \
  src --include=*.tsx --include=*.ts
grep -c "<Route" src/App.tsx
```

### Kurulum ölçümü

```bash
cd frontend
rm -rf node_modules && npm ci                      # temiz kasa
npm install @medusajs/ui @medusajs/ui-preset
npm ls @medusajs/icons @tanstack/react-table
```

Boyut/dosya sayımı Windows'ta `du -sm` ile 2 dakikada bitmedi (iptal edildi); PowerShell kullanıldı:

```powershell
Get-ChildItem -LiteralPath node_modules -Recurse -File -Force |
  Measure-Object -Property Length -Sum
```

Paket dizini sayımı (scope'lar açılarak) ve `@radix-ui` sayımı `node` + `fs.readdirSync` ile yapıldı — `npm`'in "added N packages" raporu ile karşılaştırıldı (98 vs 106; fark, npm'in aynı paketin farklı sürümlerini ayrı sayması).

### CSS diff — `spike-ciktilar/cssdiff.mjs`

Üretim CSS'i **tek satır minified** olduğu için metin diff'i anlamsızdır (`wc -l` her iki dosyada da 1). Bunun yerine **postcss ile AST düzeyinde** karşılaştırıldı:

```bash
cd frontend
cp ../spike-ciktilar/cssdiff.mjs ./_cssdiff.mjs      # postcss çözümü frontend/node_modules'dan gelsin
node ./_cssdiff.mjs ../spike-ciktilar/baseline.css ../spike-ciktilar/preset.css
```

Yöntem: her kural bloğu `"at-kural yolu || seçici"` anahtarına indirgenir; değeri `prop:value` bildirimlerinin **sıralanmış** birleşimidir (bildirim sırası farkı gürültü sayılmaz). Sonra üç küme çıkarılır — **EKLENEN** (B'de var, A'da yok), **SİLİNEN** (A'da var, B'de yok), **DEĞİŞEN** (anahtar aynı, bildirimler farklı). Çıktılar: `diff-eklenen.txt`, `diff-silinen.txt`, `diff-degisen.txt`.

Aynı anahtara birden fazla kural düşerse ` ;;+ ` ile birleştirilir. `:root` / `.dark` bu duruma girdi ve **elle** ayrıştırıldı: kural sırası postcss ile ayrıca listelenip preset (#168/#169) ile bizimkilerin (#170/#171) konumu doğrulandı.

Build çıktısı üç CSS üretir (`index-*.css`, `MapPicker-*.css`, `ImageCropModal-*.css`); Tailwind derlemesi **yalnız `index-*.css`**'tir, diğer ikisi vendor (leaflet, react-easy-crop) ve preset'ten etkilenmedi. `baseline.css` / `preset.css` = ilgili build'in `index-*.css`'i.

### `@tailwindcss/forms` taban stili kontrolü

```bash
grep -nE '\[type=|::-webkit-date-and-time-value|appearance:none' spike-ciktilar/diff-eklenen.txt
grep -cE '\|\| .*(input|select|textarea|\[type=)' spike-ciktilar/diff-eklenen.txt   # 2
```

Çıkan 2 eşleşme yanlış pozitiftir (`.h-[var(--radix-select-trigger-height)]` ve `.min-w-[var(--radix-select-trigger-width)]` — "select" kelimesi radix değişken adında geçiyor). Yani forms eklentisinin taban stilleri **üretilmiş CSS'te yok**.

### Varsayılan kenarlık rengine bağımlılık — `spike-ciktilar/borderscan.mjs`

```bash
cd frontend && cp ../spike-ciktilar/borderscan.mjs ./_borderscan.mjs && node ./_borderscan.mjs
```

Her `className=` ifadesinin **tamamı** (süslü parantez dengeli olarak) alınır; tırnak / backtick / `${}` / ternary ayraçları boşluğa çevrilerek düzleştirilir ve token'lara bölünür. Böylece ternary dallarındaki sınıflar da toplanır.

> **Kendi araç hatamı düzelttim (CLAUDE.md §I):** ilk sürüm string literal'leri regex ile eşleştiriyordu; template literal'lerde tırnak eşleşmesi kaydığı için **44 yanlış pozitif** üretti (ör. `DateStrip.tsx` — ternary'de `border-indigo-600` / `border-slate-100` **var**, ama araç göremiyordu). Düzeltilmiş sürüm **6** buldu; bunların 3'ü de rengi harici bir sabit tablodan alıyor. Elle doğrulama: `DateStrip.tsx:68` ve `DistrictSelect.tsx:83` okunarak renk sınıflarının varlığı görüldü. **İlk sayı rapora girseydi riski 15 kat abartmış olurduk.**

### Ölü animasyon sınıfı tespiti

```bash
# kullanım sayımı
grep -rhoE '\b(animate-in|animate-out|fade-in[a-z0-9-]*|slide-in-from-[a-z0-9-]+|zoom-in[a-z0-9-]*)\b' \
  src --include=*.tsx | sort | uniq -c

# üretilmiş CSS'te karşılığı var mı
grep -o "\.animate-in[a-z0-9\\.-]*" spike-ciktilar/baseline.css | sort -u | wc -l   # 0
grep -o "\.animate-in[a-z0-9\\.-]*" spike-ciktilar/preset.css   | sort -u | wc -l   # 1
```

`animate-*` ile `duration-*` / `ease-*` birlikteliği, yukarıdaki `className` düzleştirme yöntemiyle sayıldı (29 ifade).

### Gömülü metin taraması

```bash
D=frontend/node_modules/@medusajs/ui/dist/esm
grep -oE '"[A-Z][A-Za-z][^"]{2,60}"' $D/components/<bilesen>/<bilesen>.js | sort -u
cat $D/components/table/table.d.ts             # translations sözleşmesi
cat $D/blocks/data-table/components/*.d.ts     # DataTable çeviri prop'ları
cat $D/hooks/use-prompt/render-prompt.d.ts     # cancelText / confirmText / verificationInstruction
cat $D/components/copy/copy.d.ts               # prop yok → sabit metin
cat $D/components/otp-input/otp-input.d.ts     # prop yok → sabit aria-label
grep -rn "I18nProvider" $D                     # locale kancası
```

---

## Bilinen sınırlar ve doğrulanmamış noktalar

1. **Hiçbir Medusa bileşeni gerçekten render edilmedi.** Ölçüm yalnız *kurulumu* ve *preset'in CSS etkisini* kapsıyor. Bileşenlerin JS bundle maliyeti, dark-mode paritesi, mevcut `useModalA11y` ile çakışma davranışı ve gerçek görünümü **ölçülmedi**.
2. **Gerçek tarayıcı turu yapılmadı.** B4'ün SARI kalemleri (özellikle 70 animasyon sınıfının canlanması ve `* { border-color }`) yalnız statik/CSS düzeyinde kanıtlandı. CLAUDE.md §F'ye göre bu, kabul kanıtı **değildir**.
3. **Test paketi çalıştırılmadı** (`vitest`, `tsc --noEmit`). Kurulum sonrası tip çakışması — özellikle iki farklı `@tanstack/react-table` sürümünün aynı ağaçta bulunması — **ölçülmedi**. A planı alınırsa ilk doğrulanması gereken şey budur.
4. `borderscan.mjs` gibi statik tarayıcılar CLAUDE.md §C uyarınca **düşük güçlü** sayılır; sonuçları elle örnek doğrulamasıyla desteklendi ama davranış testi yerine geçmez.
5. `require()` ile preset yüklemesi `jiti` davranışına bağlı; ESM `import` formu **denenmedi**.
6. `@tailwindcss/forms`'un taban stil üretmediği sonucu, **üretilen CSS üzerinden** doğrulandı (doğru yöntem), ama eklentinin hangi stratejiyle yapılandırıldığı preset kaynağından okunmadı — ileride preset sürümü değişirse bu yeniden ölçülmeli.

---

## Üretilen dosyalar (`spike-ciktilar/`)

| Dosya | İçerik |
|---|---|
| `ip-a0-olcum-raporu.md` | Bu rapor |
| `baseline.css` / `preset.css` | Karşılaştırılan üretim CSS'leri (153.868 B / 210.018 B) |
| `diff-eklenen.txt` | 413 eklenen kural anahtarı |
| `diff-silinen.txt` | **Boş** (0 silinen) |
| `diff-degisen.txt` | 10 değişen kural, eski/yeni değerleriyle |
| `diff-eklenen-ui-disi.txt` | Eklenenlerin `.ui-` öneki taşımayanları (ham çıktı) |
| `cssdiff.mjs` | postcss tabanlı kural düzeyi diff aracı |
| `borderscan.mjs` | Varsayılan kenarlık rengine bağımlılık tarayıcısı |
| `sayim.sh` | Nöbetçi taban sayım betiği |
| `package.json.baseline`, `package-lock.json.baseline`, `tailwind.config.js.baseline` | Değişiklik öncesi hâller |

## Bitiş kontrolü

- [x] Rapor yazıldı, karar tablosu dolu
- [x] Her sayımın yöntemi belirtildi, hiçbiri başka rapordan kopyalanmadı
- [x] Hata çıkmadı (her iki `npm` komutu ve her iki build exit 0); çıkan uyarı metinleri aynen alındı
- [x] Hiçbir commit atılmadı — `git log --oneline -3` uç commit `f399526`; değişikliklerin tamamı çalışma dizininde (`M frontend/package.json`, `M frontend/package-lock.json`, `M frontend/tailwind.config.js`, `?? spike-ciktilar/`)
- [x] `adana-spike-a0` dışına hiçbir yazma yapılmadı

---

## Düzeltme dipnotu (İP-A2, 19 Ağustos 2026)

> Bu dipnot A0'ın kapanışından SONRA, İP-A1'in ölçümleriyle eklendi. Rapor
> artık nöbetçi eşiklerinin (`src/__guards__/uiBaseline.test.ts`) referansı
> olduğu için kaydın doğru olması gerekiyor.

**Yanlış tespit:** Yukarıda (§ "Mevcut `slate-*` renk tanımları değişti mi?" ve
Ek bulgu 2) preset'in katkısı "iki Tailwind eklentisi: `@tailwindcss/forms` ve
`tailwindcss-animate`, ui-preset'in kendi bağımlılıkları" diye tarif edilmişti.

**Doğrusu:** `@tailwindcss/forms` `@medusajs/ui-preset`'in bağımlılığı
**değildir** ve üretilen CSS'te imzası yoktur. Preset'in `plugins` dizisindeki
iki eklenti `tailwindcss-animate` + **Medusa'nın kendi plugin'i**dir (`ui-*`
yardımcıları, CSS değişkenleri, base katmanı). İP-A1 ölçümü: preset nesnesinin
anahtarları `{ content, plugins }`; `theme` yok (bu kısım doğruydu).

**Sonuca etkisi yok.** A0'ın asıl bulgusu — "forms taban stilleri üretilen
CSS'te YOK, dolayısıyla 144 admin form alanı taban düzeyinde etkilenmiyor" —
üretilen CSS üzerinden ölçülmüştü ve **doğrudur**; yalnızca *nedeni* yanlış
açıklanmıştı. Gerçek neden "forms eklentisi `class` stratejisiyle geliyor"
değil, **eklentinin hiç bulunmaması**dır. A0'ın B4 kararı (SARI) ve dört
nöbetçi eşiği aynen geçerlidir.

Ayrıntılı ölçüm: `docs/arsiv/ip-a/ip-a1-rapor.md` → "ESM `import` notu".

**Dosyanın kaynağı:** Bu rapor A0'da `adana-spike-a0` çalışma dizininde
üretilmiş ama hiçbir dala commit'lenmemişti (Bitiş kontrolü son maddesi).
İP-A2'de olduğu gibi kopyalanıp bu dala alındı — nöbetçi eşiklerinin referansı
kayıt dışı kalmasın diye. İçeriğine bu dipnot dışında dokunulmadı.
