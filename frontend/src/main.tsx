import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "@/App";
import { initMonitoring } from "@/lib/monitoring";
import "@/index.css";

// Hata izleme mümkün olduğunca erken başlar (VITE_SENTRY_DSN yoksa no-op).
initMonitoring();

// Flash önle: kayıtlı tema tercihini render'dan önce uygula.
try {
  const saved = localStorage.getItem("adana-theme");
  const state = saved ? JSON.parse(saved)?.state : null;
  // Yeni şema `preference` tutar; eski kayıtlar yalnız `theme` içerirdi.
  const pref = state?.preference ?? state?.theme ?? "light";
  const dark =
    pref === "dark" ||
    (pref === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) {
    document.documentElement.classList.add("dark");
  }
} catch {
  /* yok say */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </StrictMode>
);
