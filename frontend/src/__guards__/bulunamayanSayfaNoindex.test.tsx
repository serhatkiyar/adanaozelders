/**
 * Bulunamayan detay sayfası dizine girmez (teknik SEO denetimi, 28 Eyl 2026).
 *
 * Blog yazısı, ürün ve kütüphane detayları SPA'dır: kaldırılmış/olmayan kayıt
 * HTTP 200 ile açılır ve "bulunamadı" yazar. Denetimde bu üç ekran hiç meta
 * basmıyordu; sayfa `index.html`in jenerik ana sayfa başlığı ve açıklamasıyla
 * indekslenebilir durumdaydı (yumuşak 404 + yinelenen başlık). Sunucu 404'ü
 * bu yollar için yok; o yüzden asgari koruma `noindex`tir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosRequestConfig } from "axios";
import type { ReactElement } from "react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { PATHS } from "@/lib/routes";
import LibraryDetail from "@/pages/LibraryDetail";
import BlogPostPage from "@/pages/blog/BlogPostPage";
import ProductDetailPage from "@/pages/store/ProductDetailPage";

let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  // Her istek 404: ayrıntı ucu kaydı bulamıyor.
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const yanit = {
      data: { detail: "Bulunamadı." },
      status: 404,
      statusText: "Not Found",
      headers: {},
      config,
    };
    throw new AxiosError("404", "ERR_BAD_REQUEST", config as never, null, yanit as never);
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
});

function ciz(yol: string, desen: string, sayfa: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={desen} element={sayfa} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

const robots = () =>
  document.head.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";

describe("bulunamayan detay sayfası noindex alır", () => {
  it.each([
    ["blog yazısı", "/blog/kaldirilmis-yazi", PATHS.blogPost, <BlogPostPage />],
    ["ürün", "/magaza/urun/kaldirilmis-urun", PATHS.storeProduct, <ProductDetailPage />],
    ["kütüphane", "/kutuphaneler/kapanmis-kutuphane", PATHS.library, <LibraryDetail />],
  ])("%s", async (_ad, yol, desen, sayfa) => {
    ciz(yol, desen, sayfa);
    await waitFor(() => expect(robots()).toContain("noindex"));
  });
});
