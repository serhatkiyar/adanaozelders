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
