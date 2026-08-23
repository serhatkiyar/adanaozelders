/**
 * İP-C1 · Çapraz tanıtım banner'ı — nöbetçi matrisi.
 *
 * ## Neden bu dosya var
 *
 * Banner iki sayfada canlıya çıktı ama arkasında SIFIR test vardı (denetim
 * bulgusu: 152 test dosyası içinde `CrossPromoBanner` için tek eşleşme yok).
 * Aynı anda, ölçüm scripti banner'ları `a[aria-label="…"]` sabit stringiyle
 * arıyordu; bileşendeki etiket değişse script sessizce "bulunamadı" der,
 * kapı da (eski hâlinde) yeşil kalırdı. İki kusur birlikte "ölçülüyor" hissi
 * veriyordu.
 *
 * ## Bu dosya üretim kodundan ÖNCE yazıldı (kırmızı faz)
 *
 * Kırmızı koşuda beklenen düşüşler:
 *   • N-1/N-2 → `fetchpriority`/`decoding` yok (LCP ipuçları eklenmemişti).
 *   • N-3     → ölçüm scripti aria-label'ı JSON'dan DEĞİL sabit stringden
 *               alıyordu.
 * Erişilebilir ad iddiaları kırmızı koşuda da geçiyordu — bilerek: onlar
 * REGRESYON nöbetçisi, yeni davranış değil. Doluluk nöbetçisi olarak
 * yanlarında `href` ve `<img src>` iddiaları duruyor; "banner hiç render
 * olmadı" ile "adı doğru" ayırt edilebilsin diye.
 *
 * ## Erişilebilir ad neden JSON'dan okunuyor
 *
 * Test, etiketi kendi içinde SABİTLEMEZ; `crossPromo.json`dan okur. Böylece
 * dosya "etiket X'tir" değil, "sayfadaki etiket ile ölçüm aletinin aradığı
 * etiket AYNI KAYNAKTAN gelir" sözleşmesini korur. Sayfa etiketi elle
 * kopyalarsa ve JSON değişirse test patlar.
 *
 * ## Test türleri (kök CLAUDE.md §H)
 *   • N-1, N-2 → GERÇEK DOM (jsdom + RTL) + gerçek axios adapter'ı üzerinden
 *     giden gerçek istekler.
 *   • N-3      → KAYNAK SÖZLEŞMESİ testi (§C: düşük güçlü). Tek başına
 *     "ölçüm doğru" kanıtı değildir; yanındaki davranış testleriyle birlikte
 *     yalnız "sabit string kopyası geri gelmesin" nöbetini tutar.
 *
 * SINIR (§F): jsdom kontrast ölçmez. Gerçek piksel/kontrast kanıtı
 * `scripts/ip_c1_kontrast.mjs` (gerçek Chrome + CDP) tarafından üretilir.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import CROSS_PROMO from "@/config/crossPromo.json";
import { PATHS } from "@/lib/routes";
import Landing from "@/pages/Landing";
import StorePage from "@/pages/store/StorePage";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu — her uca boş liste ══════════════
   Banner navigasyon/veri akışından bağımsızdır; sayfaların veri uçları
   burada bilerek BOŞ döner. Böylece "banner ancak veri gelirse çiziliyor"
   gizli bağımlılığı da ölçülmüş olur. */
let eskiAdapter: unknown;
let storeHeroSlides: unknown[];

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  storeHeroSlides = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    return ({
      data: url.includes("/store/hero-slides")
        ? storeHeroSlides
        : url.includes("/store/products")
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

/** Banner'ın ortak sözleşmesi: link + LCP ipuçlarını taşıyan dekoratif görsel. */
async function bannerDogrula(ariaLabel: string, hedefYol: string, gorsel: string) {
  const link = await screen.findByRole("link", { name: ariaLabel });
  expect(link.getAttribute("href")).toBe(hedefYol);

  // Doluluk nöbetçisi: gerçekten banner mı, aynı adlı başka bir link mi?
  const img = link.querySelector("img");
  expect(img, "banner içinde <img> yok — yanlış link yakalanmış olabilir").not.toBeNull();
  expect(img!.getAttribute("src")).toBe(gorsel);
  // Metin HTML olarak durur (görsele gömülü değil) → ekran okuyucu görseli
  // ikinci kez okumasın diye alt boş.
  expect(img!.getAttribute("alt")).toBe("");

  // LCP ipuçları — banner altı ölçümün altısında da LCP öğesi çıktı.
  expect(img!.getAttribute("fetchpriority")).toBe("high");
  expect(img!.getAttribute("decoding")).toBe("async");
  return link;
}

describe("İP-C1 · çapraz tanıtım banner'ı", () => {
  it("N-1: ana sayfada mağaza banner'ı erişilebilir adıyla ve LCP ipuçlarıyla çizilir", async () => {
    const cfg = CROSS_PROMO.landingToStore;
    sar(cfg.pagePath, cfg.pagePath, <Landing />);
    await bannerDogrula(cfg.ariaLabel, PATHS.store, cfg.imageSrc);
  });

  it("N-2: mağaza sayfası admin kaynaklı vitrin görselini bağlantısıyla çizer", async () => {
    storeHeroSlides = [{
      id: 17,
      image_url: "https://cdn.example.com/vitrin.webp",
      mobile_image_url: null,
      alt_text: "Okula dönüş vitrini",
      link_url: "/magaza?q=okul",
    }];
    sar(PATHS.store, PATHS.store, <StorePage />);

    const image = await screen.findByRole("img", { name: "Okula dönüş vitrini" });
    expect(image.getAttribute("src")).toBe("https://cdn.example.com/vitrin.webp");
    expect(image.getAttribute("fetchpriority")).toBe("high");
    expect(image.closest("a")?.getAttribute("href")).toBe("/magaza?q=okul");
    expect(screen.queryByRole("link", { name: CROSS_PROMO.storeToTutors.ariaLabel })).toBeNull();
  });

  it("N-2b: iki banner birbirinin sayfasına gider (yön karışmaz)", async () => {
    const magaza = CROSS_PROMO.landingToStore;
    sar(magaza.pagePath, magaza.pagePath, <Landing />);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: CROSS_PROMO.storeToTutors.ariaLabel })).toBeNull()
    );
    expect(screen.getByRole("link", { name: magaza.ariaLabel }).getAttribute("href")).toBe(
      PATHS.store
    );
  });

  /**
   * N-3 · Ölçüm aleti ile bileşen AYNI KAYNAKTAN beslenmeli.
   *
   * Bu bir kaynak sözleşmesi testidir (§C, düşük güçlü). İddiası dar ve
   * ölçülebilir: script `crossPromo.json`u import ediyor mu, ve aria-label
   * metinlerinin sabit kopyasını taşıyor mu. Yorum satırı yanlış pozitif
   * üretmesin diye satır bazlı yorumlar ayıklanır.
   */
  it("N-3: kontrast scripti banner adlarını JSON'dan alır, sabit string kopyalamaz", () => {
    const yol = resolve(__dirname, "../../scripts/ip_c1_kontrast.mjs");
    const ham = readFileSync(yol, "utf8");
    const kod = ham
      .split("\n")
      .filter((s) => !s.trimStart().startsWith("//") && !s.trimStart().startsWith("*"))
      .join("\n");

    expect(kod, "script crossPromo.json'u import etmiyor").toMatch(
      /import\s+[\w$]+\s+from\s+["'][^"']*config\/crossPromo\.json["']/
    );
    for (const cfg of Object.values(CROSS_PROMO)) {
      expect(
        kod.includes(cfg.ariaLabel),
        `script "${cfg.ariaLabel}" etiketini sabit string olarak kopyalamış`
      ).toBe(false);
    }
  });
});
