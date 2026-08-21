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
      // ── Panel token köprüsü (İP-B1 · docs/tasarim-dili.md §1.2) ──
      //
      // Değerler `src/index.css` → `:root` / `.dark` altında yaşar; burası
      // yalnız onları sınıf hâline getirir. `<alpha-value>` yer tutucusu
      // saydamlık varyantlarını (`bg-panel-surface/60`) çalışır kılar —
      // değerler bu yüzden hex değil boşluklu RGB üçlüsü olarak yazılır.
      colors: {
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
          focus: "rgb(var(--panel-focus) / <alpha-value>)",
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
        // Preset'in "Roboto Mono"su geri alınıyor: font yüklü değil ve
        // KVKK gereği Google Fonts CDN'i kullanılmıyor. Tailwind varsayılanı.
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
