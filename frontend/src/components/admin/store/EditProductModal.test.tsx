import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { EditProductModal } from "@/components/admin/store/EditProductModal";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";

import type { AxiosRequestConfig } from "axios";

/**
 * Ürün yüklenemezse pencere sonsuza dek "Yükleniyor…" göstermemeli: hata
 * görünmeli, 404 dışındaki hatalarda "Yeniden dene" sunulmalı.
 */
let durum = 500;
let eskiAdapter: unknown;
let istekSayisi = 0;
let sonQc: QueryClient;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekSayisi = 0;
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    istekSayisi += 1;
    if (durum === 200) {
      const urunIstegi = /\/store\/admin\/products\/42$/.test(String(config.url));
      return {
        data: urunIstegi ? URUN : [],
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      } as never;
    }
    const hata = new Error("istek basarisiz") as Error & {
      isAxiosError: boolean;
      response: unknown;
      config: unknown;
    };
    hata.isAxiosError = true;
    hata.response = { status: durum, data: { detail: "x" }, headers: {}, config };
    hata.config = config;
    throw hata;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
});

const URUN = {
  id: 42,
  slug: "ornek",
  title: "Örnek Ürün",
  kind: "PHYSICAL",
  seller_type: "PLATFORM",
  price: "100.00",
  currency: "TRY",
  in_stock: true,
  rating_count: 0,
  cover_url: null,
  images: [],
};

function Ekran() {
  const yuzey = useDuzenlemeYuzeyi<number, void>();
  const { ac } = yuzey;
  useEffect(() => ac(42), [ac]);
  return <EditProductModal yuzey={yuzey} onSaved={() => {}} />;
}

function sar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  sonQc = qc;
  return render(
    <QueryClientProvider client={qc}>
      <Ekran />
    </QueryClientProvider>,
  );
}

describe("EditProductModal · hata durumu", () => {
  it("sunucu hatasında 'Yükleniyor…' yerine hata ve 'Yeniden dene' gösterir", async () => {
    durum = 500;
    sar();
    expect(await screen.findByText("Ürün yüklenemedi")).toBeTruthy();
    expect(screen.queryByText("Yükleniyor…")).toBeNull();
    const once = istekSayisi;
    fireEvent.click(screen.getByRole("button", { name: "Yeniden dene" }));
    await screen.findByText("Ürün yüklenemedi");
    expect(istekSayisi).toBeGreaterThan(once);
  });

  it("404'te 'Ürün bulunamadı' der", async () => {
    durum = 404;
    sar();
    expect(await screen.findByText("Ürün bulunamadı")).toBeTruthy();
    expect(screen.queryByText("Yükleniyor…")).toBeNull();
  });

  it("arka plan tazelemesi düşerse açık form sökülmez", async () => {
    durum = 200;
    sar();
    expect(await screen.findByDisplayValue("Örnek Ürün")).toBeTruthy();
    durum = 500;
    await act(() => sonQc.invalidateQueries({ queryKey: ["store", "admin", "product"] }));
    expect(screen.getByDisplayValue("Örnek Ürün")).toBeTruthy();
    expect(screen.queryByText("Ürün yüklenemedi")).toBeNull();
  });
});
