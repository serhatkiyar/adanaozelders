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
    // Varsayilan 5000 ms bu suite icin marjsizdi: bostaki makinede bile en agir
    // test butcenin yarisini yiyor, yuk altinda jsdom kurulumu uzayinca suite
    // toplu halde "Test timed out in 5000ms" ile dusuyordu. Dususlerin hicbiri
    // assertion hatasi degildi; yesil/kirmizi sinyali makine yukune baglanmisti
    // (TB-23; ayni kokun uc ayri "flake" kaydi: TB-19/9, TB-14/8).
    //
    // Deger OLCUMLE secildi, tahminle degil. Once bosta makinede
    // --testTimeout=60000 ile tam suite kosuldu (hicbir test kesilmesin ki
    // GERCEK sureler okunabilsin): 74 dosya / 756 test gecti, en yavas test
    // 2409 ms, 20. sira 591 ms. Ardindan bu ayarla bes tam kosum yapildi
    // (5/5 kez 756/756) ve en yavas testin TEPE degeri olcuruldu:
    // 2410-2959 ms, tepe 2959 ms. Ust ucu her kosumda ayni test tutuyor:
    // PackageLabel "print CSS'i etiketin GORUNURLUGUNU geri verir" -- yani
    // TB-19/9'un kaydettigi testin ta kendisi. 9000 ms, o tepenin 3.04 kati.
    //
    // Neden daha genis DEGIL: TB-23'un onerdigi 20000 ms en yavas testin 8.3
    // kati olurdu. O marjda 2.4 s'lik bir testin 15 s'ye cikmasi -- gercek bir
    // performans regresyonu -- sessizce yutulur. Butce, testi kesmeyecek kadar
    // genis ama regresyonu gizlemeyecek kadar dar olmali.
    //
    // Tek yerde tanimli: dosya basina testTimeout ezmesi YAPILMAZ. Bir test bu
    // butceye sigmiyorsa cozum butceyi buyutmek degil, testi incelemektir.
    testTimeout: 9000,
    // Isci sayisi OLCUMLE sabitlendi (16 cekirdek, bellek sinirli makine).
    // Varsayilan (cekirdek-1 = 15 fork) tam suite'i 550 sn'de bitirdi ama
    // 33 test yuk altinda 9000 ms butcesini asarak dustu (assertion degil,
    // hepsi timeout); bellek de dar. 6 fork: yuk kaynakli dusus kalkti.
    // 4 fork ve `pool: "threads"` src/panel alt kumesinde 6 forktan yavas
    // olculdu (387 sn -> 507 / 554 sn). happy-dom denendi: __guards__'ta 189
    // test kirdi ve ortam kurulumu jsdom'dan yavasti -- kullanilmiyor.
    //
    // DOM'a ihtiyaci olmayan saf test dosyalarinin basinda
    // `// @vitest-environment node` yorumu var: jsdom kurulumunu (~1 sn/dosya)
    // tamamen atlarlar. Yeni bir saf test icin ayni yorumu ekleyin; DOM,
    // storage, File/FormData ya da `window` dalina dokunan testler jsdom'da kalir.
    maxWorkers: 6,
    minWorkers: 1,
  },
});
