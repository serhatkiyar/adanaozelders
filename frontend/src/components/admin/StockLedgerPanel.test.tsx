// Ürün detayındaki defter bölümü — GERÇEK DOM davranışı.
//
// Mutasyon provasında dijital ürünün "stok defteri tutulmuyor" durumu
// kaldırıldığında hiçbir test kırılmadı: bileşenin hiç DOM testi yoktu. O
// mutasyonla dijital üründe boş bir tablo görünür ve operatör "hareket yok"
// diye okur — oysa defter TUTULMUYOR. İkisi çok farklı şeyler.
//
// Burada gerçek render edilir, gerçek istekler (adapter üzerinden) gözlenir.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { StockLedgerPanel } from "@/components/admin/StockLedgerPanel";

import type { AxiosRequestConfig } from "axios";

let istekler: string[] = [];
let eskiAdapter: unknown;
let yanitlar: Record<string, unknown> = {};

function sar(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  yanitlar = {};
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const yol = String(config.url);
    istekler.push(yol);
    const anahtar = Object.keys(yanitlar).find((k) => yol.includes(k));
    return {
      data: anahtar ? yanitlar[anahtar] : {},
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
});

const HAREKET = {
  id: 11,
  product_id: 5,
  sku: "FZK-000005",
  product_title: "Test Kitabı",
  qty_delta: -2,
  qty_after: 8,
  movement_type: "SALE",
  reason_code: "ORDER_PAID",
  ref_type: "order",
  ref_id: 77,
  ref_line_id: 91,
  actor_type: "SYSTEM",
  actor_id: null,
  note: null,
  created_at: "2027-03-03T10:00:00+00:00",
};

describe("dijital ürün", () => {
  it("defter TUTULMADIĞINI söyler ve hiç istek atmaz", async () => {
    sar(<StockLedgerPanel productId={5} kind="DIGITAL" />);

    expect(
      screen.getByText(/stok defteri tutulmuyor/i),
    ).toBeTruthy();
    // "Hareket yok" DEMEZ — o, boş defterin metnidir.
    expect(screen.queryByText(/stok hareketi yok/i)).toBeNull();
    // Sunucuya boşuna gidilmez.
    await new Promise((r) => setTimeout(r, 30));
    expect(istekler).toEqual([]);
  });
});

describe("fiziksel ürün", () => {
  beforeEach(() => {
    yanitlar = {
      "stock-movements": { rows: [HAREKET], total: 1, limit: 20, offset: 0 },
      "stock-verify": {
        consistent: true,
        product_id: 5,
        sku: "FZK-000005",
        product_title: "Test Kitabı",
        current_stock: 8,
        ledger_stock: 8,
        movement_count: 1,
        first_divergent_id: null,
        problems: [],
        tracked: true,
      },
    };
  });

  it("delta, sonraki stok, aktör ve kaynak referansını gösterir", async () => {
    sar(<StockLedgerPanel productId={5} kind="PHYSICAL" />);

    await waitFor(() => expect(screen.getByText("−2")).toBeTruthy());
    expect(screen.getByText("8")).toBeTruthy();              // qty_after
    expect(screen.getByText("Satış")).toBeTruthy();          // tür etiketi
    expect(screen.getByText("Sipariş ödendi")).toBeTruthy(); // gerekçe
    expect(screen.getByText("Sistem")).toBeTruthy();         // aktör
    expect(screen.getByText(/Sipariş #77 · satır 91/)).toBeTruthy();
  });

  it("tutarlı defterde sakin rozet gösterir, düzeltme butonu YOKTUR", async () => {
    sar(<StockLedgerPanel productId={5} kind="PHYSICAL" />);
    await waitFor(() => expect(screen.getByText("Defter tutarlı")).toBeTruthy());
    // Teşhis paketi: bulgu bir aksiyona dönüşmemeli.
    expect(screen.queryByRole("button", { name: /düzelt|onar|senkron/i })).toBeNull();
  });

  it("sapmada bulguyu beklenen/görülen ile birlikte yazar", async () => {
    yanitlar["stock-verify"] = {
      consistent: false,
      product_id: 5,
      sku: "FZK-000005",
      product_title: "Test Kitabı",
      current_stock: 99,
      ledger_stock: 8,
      movement_count: 2,
      first_divergent_id: 12,
      problems: [
        {
          code: "CHAIN_BREAK",
          message: "zincir kopuk",
          product_id: 5,
          sku: "FZK-000005",
          movement_id: 12,
          expected: 6,
          actual: 9,
        },
      ],
      tracked: true,
    };
    sar(<StockLedgerPanel productId={5} kind="PHYSICAL" />);

    await waitFor(() => expect(screen.getByText(/zincir kopuk/)).toBeTruthy());
    expect(screen.getByText(/Sapma var/)).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();   // beklenen
    expect(screen.getByText("9")).toBeTruthy();   // görülen
    expect(screen.queryByRole("button", { name: /düzelt|onar/i })).toBeNull();
  });

  it("liste hatasında BOŞ EKRAN değil hata durumu gösterir", async () => {
    apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
      if (String(config.url).includes("stock-movements")) {
        throw new Error("ağ hatası");
      }
      return {
        data: yanitlar["stock-verify"],
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      } as never;
    };
    sar(<StockLedgerPanel productId={5} kind="PHYSICAL" />);
    await waitFor(() =>
      expect(screen.getByText(/Stok hareketleri yüklenemedi/i)).toBeTruthy(),
    );
  });

  it("hareket yokken bunu AÇIKÇA söyler", async () => {
    yanitlar["stock-movements"] = { rows: [], total: 0, limit: 20, offset: 0 };
    sar(<StockLedgerPanel productId={5} kind="PHYSICAL" />);
    await waitFor(() =>
      expect(screen.getByText(/stok hareketi yok/i)).toBeTruthy(),
    );
  });
});
