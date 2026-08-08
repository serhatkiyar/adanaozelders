// İP-12 · P1-2 — vitrindeki "son N ürün" uyarısı eşiği SUNUCUDAN okur.
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.
//
// ## Neden
//
// `ProductDetailPage.tsx` düşük stok eşiğini `const LOW_STOCK = 5` olarak
// KENDİ kopyasında tutuyordu. İP-12 eşiği `core/stock_policy` altında tek
// kaynağa taşıdı ve `GET /store/config` ile yayımladı, ama bu dosya paketin
// diff'ine hiç girmedi — yani "eşik tek kaynakta" iddiası vitrin tarafında
// YANLIŞTI (audit P1-2).
//
// Kusur sessizdir: eşik 3'e çekildiğinde yönetim listesi ve dashboard yeni
// değere göre davranır, vitrin hâlâ 5'e göre "Son 4 ürün" der. İki yüzey
// müşteriye farklı aciliyet gösterir ve fark hiçbir yerde görünmez.
//
// ## Testin ayırt ediciliği
//
// Sunucu eşiği **3** döndürür ve stoğu **4** olan bir ürün kullanılır. Gömülü
// `5` duruyorsa 4 <= 5 olduğu için uyarı basılır ve test kırılır. Yalnız
// "uyarı görünüyor mu" diye sormak yetmezdi: 5 ile de 3 ile de görünen bir
// stok değeri seçilseydi test iki uygulamayı ayırt edemezdi.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import ProductDetailPage from "@/pages/store/ProductDetailPage";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

let rotalar: { esles: (url: string, method: string) => boolean; data: unknown }[] = [];
let eskiAdapter: unknown;

function sunucu(desen: string, data: unknown) {
  rotalar.unshift({ esles: (url) => url.split("?")[0].includes(desen), data });
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  rotalar = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    const rota = rotalar.find((r) => r.esles(url, config.method ?? "get"));
    // Eşleşmeyen uçlar için varsayılan DİZİ: sayfa yanında kategori/yorum
    // gibi liste uçları çağırıyor ve `{}` dönmek onların `.map`'ini
    // patlatıyordu (ürün hiç render olmuyordu).
    return {
      data: rota ? rota.data : [],
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

function urun(stock: number) {
  return {
    id: 1,
    slug: "geometri",
    title: "Geometri Soru Bankası",
    kind: "PHYSICAL",
    seller_type: "PLATFORM",
    price: "180.00",
    currency: "TRY",
    in_stock: stock > 0,
    stock,
    rating_count: 0,
    status: "ACTIVE",
    images: [],
    description: null,
  };
}

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  // `HelmetProvider` şart: `StoreLayout` SEO başlığı için `react-helmet-async`
  // kullanıyor ve sağlayıcı olmadan `HelmetDispatcher` render sırasında
  // patlıyor — sayfa hiç basılmıyor, gövde boş kalıyordu.
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/magaza/urun/geometri"]}>
          <Routes>
            <Route path="/magaza/urun/:slug" element={<ProductDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe("P1-2 · vitrin düşük stok eşiği sunucudan gelir", () => {
  it("sunucu eşiği 3 iken stoğu 4 olan üründe uyarı ÇIKMAZ", async () => {
    sunucu("/store/config", { low_stock_threshold: 3 });
    sunucu("/store/products/geometri", urun(4));

    sar();

    // Ürün yüklendi mi (uyarının yokluğunu ölçmeden önce sayfanın gerçekten
    // render olduğundan emin olunur; aksi hâlde test boş ekranda da geçerdi).
    expect(await screen.findByRole("button", { name: /sepete ekle/i })).toBeTruthy();
    expect(
      screen.queryByText(/Son 4 ürün/),
      "vitrin hâlâ kendi gömülü eşiğini (5) kullanıyor — sunucu 3 dedi, " +
        "stok 4 için uyarı basılmamalıydı"
    ).toBeNull();
  });

  it("sunucu eşiği 3 iken stoğu 2 olan üründe uyarı ÇIKAR", async () => {
    sunucu("/store/config", { low_stock_threshold: 3 });
    sunucu("/store/products/geometri", urun(2));

    sar();

    expect(await screen.findByText(/Son 2 ürün/)).toBeTruthy();
  });

  it("eşik bilinmiyorsa (config düşerse) uyarı basılmaz", async () => {
    // Yanlış eşikle "son N ürün" demek müşteriye uydurulmuş bir aciliyet
    // gösterir; bilinmiyorken susmak dürüsttür. "Stokta yok" bundan ayrıdır
    // ve eşik gerektirmez (aşağıdaki node).
    sunucu("/store/products/geometri", urun(2));

    sar();

    expect(await screen.findByRole("button", { name: /sepete ekle/i })).toBeTruthy();
    expect(screen.queryByText(/Son 2 ürün/)).toBeNull();
  });

  it("'Stokta yok' eşikten BAĞIMSIZ gösterilir", async () => {
    sunucu("/store/products/geometri", urun(0));

    sar();

    expect(await screen.findByText(/Stokta yok/)).toBeTruthy();
  });
});
