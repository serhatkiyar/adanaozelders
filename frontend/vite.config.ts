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
