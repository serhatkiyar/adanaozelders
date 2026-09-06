import medusaPreset from "@medusajs/ui-preset";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [medusaPreset],
  // Dark mode SÖKÜLDÜ (CMS turu): `dark` sınıfını köke koyan hiçbir kod yok,
  // bu satır bilinçli DURUYOR — kaldırılırsa Medusa preset'inin/varsayılanın
  // `media` stratejisi devreye girer ve @medusajs/ui'nin kendi `dark:` stilleri
  // OS tercihiyle kendiliğinden aktifleşirdi.
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@medusajs/ui/dist/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      // ── Panel token köprüsü (İP-B1 · docs/tasarim-dili.md §1.2) ──
      //
      // Değerler `src/index.css` → `:root` / `.dark` altında yaşar; burası
      // yalnız onları sınıf hâline getirir. `<alpha-value>` yer tutucusu
      // saydamlık varyantlarını (`bg-panel-surface/60`) çalışır kılar —
      // değerler bu yüzden hex değil boşluklu RGB üçlüsü olarak yazılır.
      colors: {
        // ── Site marka köprüsü (docs/tasarim-dili.md §1.4) ──
        //
        // Anahtar bilerek `accent` DEĞİL: Tailwind'in kendi `accent-<renk>`
        // yardımcısı (CSS `accent-color`) var ve `accent-accent` gibi sınıflar
        // doğardı. Depo dili zaten Türkçe (nöbetçiler, scriptler, dokümanlar).
        marka: {
          DEFAULT: "rgb(var(--marka) / <alpha-value>)",
          hover: "rgb(var(--marka-hover) / <alpha-value>)",
          fg: "rgb(var(--marka-fg) / <alpha-value>)",
          soft: "rgb(var(--marka-soft) / <alpha-value>)",
          metin: "rgb(var(--marka-metin) / <alpha-value>)",
          "metin-hover": "rgb(var(--marka-metin-hover) / <alpha-value>)",
          "soft-fg": "rgb(var(--marka-soft-fg) / <alpha-value>)",
          line: "rgb(var(--marka-line) / <alpha-value>)",
          mid: "rgb(var(--marka-mid) / <alpha-value>)",
          focus: "rgb(var(--marka-focus) / <alpha-value>)",
        },
        // Dikkat AKSAN DEĞİLDİR (§1.3 madde 2). Ayrı isim altında durmasının
        // sebebi budur: `marka` yazan biri yanlışlıkla uyarı rengine ulaşamaz.
        dikkat: {
          DEFAULT: "rgb(var(--dikkat) / <alpha-value>)",
          soft: "rgb(var(--dikkat-soft) / <alpha-value>)",
          fg: "rgb(var(--dikkat-fg) / <alpha-value>)",
        },
        panel: {
          bg: "rgb(var(--panel-bg) / <alpha-value>)",
          surface: "rgb(var(--panel-surface) / <alpha-value>)",
          "surface-subtle": "rgb(var(--panel-surface-subtle) / <alpha-value>)",
          "surface-hover": "rgb(var(--panel-surface-hover) / <alpha-value>)",
          border: "rgb(var(--panel-border) / <alpha-value>)",
          "border-strong": "rgb(var(--panel-border-strong) / <alpha-value>)",
          fg: "rgb(var(--panel-fg) / <alpha-value>)",
          "fg-muted": "rgb(var(--panel-fg-muted) / <alpha-value>)",
          "fg-subtle": "rgb(var(--panel-fg-subtle) / <alpha-value>)",
          accent: "rgb(var(--panel-accent) / <alpha-value>)",
          "accent-fg": "rgb(var(--panel-accent-fg) / <alpha-value>)",
          "accent-soft": "rgb(var(--panel-accent-soft) / <alpha-value>)",
          "accent-soft-fg": "rgb(var(--panel-accent-soft-fg) / <alpha-value>)",
          "accent-text": "rgb(var(--panel-accent-text) / <alpha-value>)",
          focus: "rgb(var(--panel-focus) / <alpha-value>)",
          // Dikkat rengi (#F6AD55) AKSAN DEĞİLDİR — yalnız uyarı ve bekleyen
          // iş durumları. Ayrı bir isim altında durmasının sebebi tam olarak
          // budur: `accent` yazan biri yanlışlıkla turuncuya ulaşamaz.
          attention: "rgb(var(--panel-attention) / <alpha-value>)",
          "attention-soft": "rgb(var(--panel-attention-soft) / <alpha-value>)",
          "attention-fg": "rgb(var(--panel-attention-fg) / <alpha-value>)",
        },
      },
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
        // Panel başlıkları (docs/tasarim-dili.md §1.4). `.panel-kok` altındaki
        // h1/h2/h3 bunu index.css'teki TEK kuraldan alır; ekran dosyaları
        // yazı tipi sınıfı yazmaz.
        display: [
          "Figtree",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        // Preset'in "Roboto Mono"su geri alınıyor: yazı tipi yüklü değil ve
        // dış yazı tipi CDN'i KULLANILMIYOR. Bu cümle İP-B2'ye kadar YANLIŞTI
        // — `index.html` `Inter`ı CDN'den çekiyordu (Ç-5 · KVKK). Artık doğru
        // ve bir nöbetçiye bağlı: `src/__guards__/disFont.test.ts`.
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
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
