import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // Ağ paylaşımı (telefon vb.): LAN IP'sinden erişilebilsin diye 0.0.0.0'a bağlan.
    host: true,
    // Yerel geliştirmede gerçek domain maskesi (hosts dosyasında 127.0.0.1'e
    // yönlendirilir); Vite 5.4.12+ bilinmeyen Host header'larını engeller.
    // https'i Vite DEĞİL, maske scriptinin TLS proxy'si verir (443→5173,
    // scripts/dev-tls-proxy.js) — böylece http://localhost:5173 de çalışır.
    allowedHosts: [
      "adanaozelders.com.tr",
      "www.adanaozelders.com.tr",
      // Oturumsuz kargo takibi subdomain'i (reverse-proxy /<token> → /kargo-takip/<token>).
      "kargotakip.adanaozelders.com.tr",
    ],
    // Backend'i aynı origin'den (/api) proxy'le → CORS preflight YOK (daha hızlı),
    // IP'yi .env'e yazmaya gerek YOK. ws:true ile WebSocket de iletilir.
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
