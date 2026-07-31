/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    // Node 22+ kirik yerlesik localStorage'ini jsdom'unkiyle degistirir;
    // zustand/persist kullanan store'lar olmadan test edilemiyordu.
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
