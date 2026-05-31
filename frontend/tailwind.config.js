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
