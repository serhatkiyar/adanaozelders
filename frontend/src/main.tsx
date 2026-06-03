import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "@/App";
import "@/index.css";

// Flash önle: kayıtlı temayı render'dan önce uygula.
try {
  const saved = localStorage.getItem("ceyhan-theme");
  if (saved && JSON.parse(saved)?.state?.theme === "dark") {
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
