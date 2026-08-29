/**
 * Vitrin hero + banner söküm nöbetçisi.
 *
 * TARİHÇE: Bu dosya İP-C1 çapraz tanıtım banner'ının (Landing ↔ mağaza)
 * kabul matrisiydi. Banner 29 Ağu 2026'da kullanıcı kararıyla SÖKÜLDÜ
 * ("kocaman hero var özel ders ekranında") — CrossPromoBanner.tsx,
 * config/crossPromo.json ve scripts/ip_c1_kontrast.mjs silindi. Kalan iki
 * nöbet:
 *   • N-1: Landing'de mağaza banner'ı GERİ GELMEZ (söküm regresyonu).
 *   • N-2: mağaza vitrini MANUEL hero'yu API'siz, LCP ipuçlarıyla çizer
 *     (pages/store/vitrin/AnaVitrin.tsx — 28 Ağu manuel vitrin kararı).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { PATHS } from "@/lib/routes";
import Landing from "@/pages/Landing";
import StorePage from "@/pages/store/StorePage";

import type { AxiosRequestConfig } from "axios";

/* Sahte sunucu: her uca boş sonuç — vitrin/banner iddiaları veri akışından
   bağımsız kalmalı ("ancak veri gelirse çiziliyor" gizli bağı da ölçülür). */
let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    return ({
      // /tutors/search DİZİ döner (bkz. api/tutors.ts) — {items:...} verilirse
      // TutorRow `data.map`te patlar ve Vitest "unhandled error" ile KIRMIZI
      // düşer (CI 33274844233 dersi). {items:...} yalnız mağaza aramasının.
      data: url.includes("/tutors/")
        ? []
        : /\/search\b/.test(url)
          ? { items: [], total: 0, page: 1, size: 20, pages: 0 }
          : [],
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    }) as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
});

function sar(yol: string, rota: string, element: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={rota} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe("vitrin hero + banner söküm nöbetçisi", () => {
  it("N-1: Landing'de mağaza banner'ı YOK (söküm geri gelmez)", async () => {
    sar("/", "/", <Landing />);
    // Eski banner /magaza'ya giden, İÇERİK görseli taşıyan bir linkti.
    // Kategori şeridindeki meşru "Mağaza" kapısı da görselli bir linktir ama
    // ikonu dekoratiftir (aria-hidden) — ayrım oradan yapılır: /magaza'ya
    // giden hiçbir link aria-hidden OLMAYAN bir <img> taşımamalı.
    await waitFor(() => {
      const bannerBenzeri = screen
        .queryAllByRole("link")
        .filter(
          (l) =>
            l.getAttribute("href") === PATHS.store &&
            l.querySelector("img:not([aria-hidden])")
        );
      expect(bannerBenzeri).toHaveLength(0);
    });
  });

  it("N-2: mağaza sayfası MANUEL vitrini bağlantısıyla çizer (API'siz)", async () => {
    sar(PATHS.store, PATHS.store, <StorePage />);

    const image = await screen.findByRole("img", { name: "Okula dönüş kampanyası" });
    expect(image.getAttribute("src")).toBe("/vitrin/hero-okula-donus.webp");
    expect(image.getAttribute("fetchpriority")).toBe("high");
    expect(image.closest("a")?.getAttribute("href")).toBe("/magaza/okula-donus");
  });
});
