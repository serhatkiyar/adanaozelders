import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "@/App";
import "@/index.css";

// Flash önle: kayıtlı tema tercihini render'dan önce uygula.
try {
  const saved = localStorage.getItem("ceyhan-theme");
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
