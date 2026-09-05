/**
 * Ürün detay sayfası — fiyat / kargo / teslimat / sepet onayı kabul matrisi.
 *
 * Bu dosyanın nöbet ettiği kararlar tek tek gerekçelidir:
 *
 *   - **Üstü çizili fiyat SERBEST alandan gelmez.** `compare_at_price` yönetici
 *     tarafından elle girilir ve indirim iddiasının dayanağı olamaz; dayanak
 *     fiyat geçmişinden türetilen `legal_compare_price`tır. Serbest alanın
 *     yeniden gösterilmeye başlaması sessiz bir mevzuat ihlali olurdu.
 *   - **Kargo ve teslimat ürün sayfasında yazar.** İkisinin de ödeme adımına
 *     bırakılması ölçülmüş bir terk sebebi.
 *   - **Tedarikçiden temin edilen üründe TESLİM SÖZÜ VERİLMEZ.** Hazırlık
 *     süresi bilinmiyor; "yarın kapında" tutulamayacak bir söz olurdu.
 *   - **Sepete ekleme onayı kendiliğinden kapanmaz** ve üç yolu da açık tutar.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import ProductDetailPage from "@/pages/store/ProductDetailPage";
import { PATHS } from "@/lib/routes";
import { useCartStore } from "@/store/cartStore";
import { useToastStore } from "@/store/toastStore";

import type { AxiosRequestConfig } from "axios";

const YUK = { timeout: 4000 };

interface Istek {
  method: string;
  url: string;
}

let istekler: Istek[] = [];
let rotalar: { esles: (i: Istek) => boolean; data: unknown }[] = [];
let eskiAdapter: unknown;

function sunucu(desen: string | RegExp, data: unknown) {
  rotalar.unshift({
    esles: (i) => {
      const yol = i.url.split("?")[0];
      return typeof desen === "string" ? yol.includes(desen) : desen.test(yol);
    },
    data,
  });
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  rotalar = [];
  useCartStore.setState({ items: [], couponCode: null });
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
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
  useToastStore.setState({ toasts: [] });
  useCartStore.setState({ items: [], couponCode: null });
});

function urunDetayi(over: Record<string, unknown> = {}) {
  return {
    id: 101,
    slug: "fosforlu-sari",
    title: "Fosforlu Kalem",
    kind: "PHYSICAL",
    seller_type: "PLATFORM",
    price: "45.00",
    currency: "TRY",
    in_stock: true,
    stock: 12,
    rating_count: 0,
    status: "ACTIVE",
    images: [],
    variants: null,
    ...over,
  };
}

function detaySunucusu(
  urun: Record<string, unknown>,
  teslimat: unknown = null
) {
  sunucu("/store/config", {
    low_stock_threshold: 5,
    shipping_free_threshold: "500.0",
    shipping_flat_fee: "49.9",
  });
  sunucu("/store/categories", []);
  sunucu("/store/delivery-info", teslimat);
  sunucu(/\/store\/products$/, []);
  sunucu(/\/reviews\/distribution$/, { count: 0, average: null, distribution: {} });
  sunucu(/\/reviews$/, []);
  sunucu(/\/store\/products\/[^/]+$/, urun);
}

function detayAc(yol = "/magaza/urun/fosforlu-sari") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.storeProduct} element={<ProductDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

const baslikBekle = () =>
  screen.findByRole("heading", { name: "Fosforlu Kalem" }, YUK);

describe("fiyat bloğu", () => {
  it("üstü çizili fiyat YASAL referanstan gelir, serbest alandan DEĞİL", async () => {
    detaySunucusu(
      urunDetayi({
        // Yönetici 999 girmiş (serbest alan) ama geçmişten türetilen dayanak 60.
        compare_at_price: "999.00",
        legal_compare_price: "60.00",
        price_reference_days: 10,
      })
    );
    detayAc();
    await baslikBekle();

    expect(screen.getByText("60 TL")).toBeTruthy();
    expect(screen.queryByText("999 TL")).toBeNull();
  });

  it("indirim oranını METİN olarak da yazar (renk tek başına bilgi taşımaz)", async () => {
    detaySunucusu(
      urunDetayi({ legal_compare_price: "60.00", price_reference_days: 10 })
    );
    detayAc();
    await baslikBekle();
    expect(screen.getByText("%25 indirim")).toBeTruthy();
  });

  it("referans penceresini SUNUCUDAN okur, kendi sabitini taşımaz", async () => {
    detaySunucusu(
      urunDetayi({ legal_compare_price: "60.00", price_reference_days: 10 })
    );
    detayAc();
    await baslikBekle();
    expect(screen.getByText(/son 10 günün en düşük fiyatı/)).toBeTruthy();
  });

  it("dayanak yoksa üstü çizili fiyat HİÇ gösterilmez", async () => {
    detaySunucusu(urunDetayi({ compare_at_price: "999.00", legal_compare_price: null }));
    detayAc();
    await baslikBekle();
    expect(screen.queryByText(/indirim/)).toBeNull();
    expect(screen.queryByText("999 TL")).toBeNull();
  });

  it("KDV dâhil ibaresi yazar", async () => {
    detaySunucusu(urunDetayi());
    detayAc();
    await baslikBekle();
    expect(screen.getByText(/KDV dâhil/)).toBeTruthy();
  });
});

describe("kargo satırı", () => {
  it("eşik altında ücreti ve ücretsiz kargoya kalanı yazar", async () => {
    detaySunucusu(urunDetayi({ price: "45.00" }));
    detayAc();
    await baslikBekle();
    expect(screen.getByText(/Kargo 49,9 TL/)).toBeTruthy();
    expect(screen.getByText(/455 TL daha ekleyin/)).toBeTruthy();
  });

  it("eşiği geçen üründe ücretsiz kargo yazar", async () => {
    detaySunucusu(urunDetayi({ price: "600.00" }));
    detayAc();
    await baslikBekle();
    expect(screen.getByText("Kargo ücretsiz")).toBeTruthy();
  });

  it("eşiği SUNUCUDAN okur — istemci kendi kopyasını taşımaz", async () => {
    // Sunucu eşiği 100'e çekerse vitrin de 100'e göre konuşmalı.
    sunucu("/store/config", {
      low_stock_threshold: 5,
      shipping_free_threshold: "100.0",
      shipping_flat_fee: "9.9",
    });
    sunucu("/store/categories", []);
    sunucu("/store/delivery-info", null);
    sunucu(/\/store\/products$/, []);
    sunucu(/\/reviews\/distribution$/, { count: 0, average: null, distribution: {} });
    sunucu(/\/reviews$/, []);
    sunucu(/\/store\/products\/[^/]+$/, urunDetayi({ price: "45.00" }));

    detayAc();
    await baslikBekle();
    await waitFor(() => {
      expect(screen.getByText(/Kargo 9,9 TL/)).toBeTruthy();
    });
    expect(screen.getByText(/55 TL daha ekleyin/)).toBeTruthy();
  });

  it("dijital üründe kargo satırı hiç çizilmez", async () => {
    detaySunucusu(urunDetayi({ kind: "DIGITAL", stock: null }));
    detayAc();
    await baslikBekle();
    expect(screen.queryByText(/Kargo/)).toBeNull();
  });
});

describe("teslimat sözü", () => {
  const TESLIMAT = {
    cutoff_hour: 16,
    promised_date_now: "2099-01-02",
    countdown_seconds: 5400,
    districts: [],
  };

  it("kendi stoğumuzdaki üründe tarih + geri sayım yazar", async () => {
    detaySunucusu(urunDetayi({ fulfillment: "OWN" }), TESLIMAT);
    detayAc();
    await baslikBekle();
    await waitFor(() => {
      expect(screen.getByText(/içinde sipariş ver/)).toBeTruthy();
    });
  });

  it("TEDARİKÇİDEN temin edilen üründe söz VERİLMEZ", async () => {
    // Hazırlık süresi bilinmiyor; tarih yazmak tutulamayacak bir söz olurdu.
    detaySunucusu(urunDetayi({ fulfillment: "SUPPLIER" }), TESLIMAT);
    detayAc();
    await baslikBekle();
    expect(screen.queryByText(/içinde sipariş ver/)).toBeNull();
  });

  it("dijital üründe teslimat sözü yazılmaz", async () => {
    detaySunucusu(urunDetayi({ kind: "DIGITAL", stock: null }), TESLIMAT);
    detayAc();
    await baslikBekle();
    expect(screen.queryByText(/içinde sipariş ver/)).toBeNull();
  });
});

describe("sepete ekleme onayı", () => {
  it("eklenen ürünü ve ara toplamı gösterir", async () => {
    detaySunucusu(urunDetayi());
    detayAc();
    await baslikBekle();

    fireEvent.click(screen.getByRole("button", { name: "Sepete Ekle" }));

    const pencere = await screen.findByRole("dialog", { name: "Sepete eklendi" });
    // Hangi ürünün eklendiği yazar; fiyat hem satırda hem ara toplamda geçer.
    expect(within(pencere).getByText("Fosforlu Kalem")).toBeTruthy();
    expect(within(pencere).getByText("Ara toplam")).toBeTruthy();
    expect(within(pencere).getAllByText("45 TL").length).toBeGreaterThan(0);
  });

  it("üç yolu da açık tutar", async () => {
    detaySunucusu(urunDetayi());
    detayAc();
    await baslikBekle();
    fireEvent.click(screen.getByRole("button", { name: "Sepete Ekle" }));

    const pencere = await screen.findByRole("dialog", { name: "Sepete eklendi" });
    expect(within(pencere).getByRole("link", { name: "Ödemeye geç" })).toBeTruthy();
    expect(within(pencere).getByRole("link", { name: "Sepeti gör" })).toBeTruthy();
    expect(
      within(pencere).getByRole("button", { name: "Alışverişe devam et" })
    ).toBeTruthy();
  });

  it("ücretsiz kargoya kalan tutarı gösterir", async () => {
    detaySunucusu(urunDetayi({ price: "45.00" }));
    detayAc();
    await baslikBekle();
    fireEvent.click(screen.getByRole("button", { name: "Sepete Ekle" }));

    const pencere = await screen.findByRole("dialog", { name: "Sepete eklendi" });
    expect(
      within(pencere).getByText(/455 TL daha ekleyin/)
    ).toBeTruthy();
  });

  it("'Alışverişe devam et' pencereyi kapatır ama sepeti BOŞALTMAZ", async () => {
    detaySunucusu(urunDetayi());
    detayAc();
    await baslikBekle();
    fireEvent.click(screen.getByRole("button", { name: "Sepete Ekle" }));

    const pencere = await screen.findByRole("dialog", { name: "Sepete eklendi" });
    fireEvent.click(within(pencere).getByRole("button", { name: "Alışverişe devam et" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Sepete eklendi" })).toBeNull();
    });
    expect(useCartStore.getState().items).toHaveLength(1);
  });
});

describe("marka ve nitelikler", () => {
  it("marka satırı başlığın üstünde görünür", async () => {
    detaySunucusu(urunDetayi({ brand: "Faber-Castell" }));
    detayAc();
    await baslikBekle();
    expect(screen.getByText("Faber-Castell")).toBeTruthy();
  });

  it("marka yoksa satır çizilmez", async () => {
    detaySunucusu(urunDetayi());
    detayAc();
    await baslikBekle();
    expect(screen.queryByText("Faber-Castell")).toBeNull();
  });

  it("yönetilen nitelikler künye tablosunda görünür", async () => {
    // Bu alan yönetimden uzun süredir GİRİLEBİLİYOR ama vitrine hiç çıkmıyordu.
    detaySunucusu(
      urunDetayi({
        attributes: [
          { definition_name: "Kağıt Cinsi", label: "80 gr", sort_order: 0 },
        ],
      })
    );
    detayAc();
    await baslikBekle();
    expect(screen.getByText("Kağıt Cinsi")).toBeTruthy();
    expect(screen.getByText("80 gr")).toBeTruthy();
  });
});
