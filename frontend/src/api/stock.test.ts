// Defter API katmanı — GÖNDERİLEN İSTEĞİN kendisi doğrulanır.
//
// Mutasyon provasında `movement_type` filtresi query'den düşürüldüğünde HİÇBİR
// test kırılmadı: filtreler yalnız saf yardımcılarla ve tip düzeyinde
// sınanıyordu, "sunucuya ne gitti" hiç ölçülmüyordu. Kullanıcı ekranda türü
// seçer, liste değişmez ve bunu kimse fark etmez.
//
// Bu dosya axios'un GERÇEK örneğini kullanır ve yalnız **adapter**'ı değiştirir:
// böylece `temizle()` + axios parametre serileştirmesi + URL kurulumu birlikte
// koşar ve testin gördüğü şey ağa çıkacak olan isteğin ta kendisidir.
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { apiClient } from "@/api/axios";
import {
  fetchLedgerAudit,
  fetchProductStockMovements,
  fetchProductStockVerify,
  fetchStockMovements,
} from "@/api/stock";

import type { AxiosRequestConfig } from "axios";

let sonIstek: AxiosRequestConfig | null = null;
let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  sonIstek = null;
  // Adapter, axios'un isteği tam kurduğu NOKTADAN sonra çalışır: url, params ve
  // header'lar burada nihai hâlindedir.
  apiClient.defaults.adapter = async (config) => {
    sonIstek = config;
    return {
      data: { rows: [], total: 0, limit: 50, offset: 0 },
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

function params(): Record<string, unknown> {
  return (sonIstek?.params ?? {}) as Record<string, unknown>;
}

describe("gönderilen istek — genel hareket listesi", () => {
  it("her filtre query'ye KONUR", async () => {
    await fetchStockMovements({
      limit: 25,
      offset: 50,
      product_id: 7,
      sku: "FZK-000042",
      movement_type: "SALE",
      reason_code: "ORDER_PAID",
      actor_type: "ADMIN",
      actor_id: 3,
      ref_type: "order",
      ref_id: 99,
      date_from: "2027-01-01",
      date_to: "2027-02-01",
    });

    expect(sonIstek?.url).toBe("/store/admin/stock-movements");
    expect(params()).toEqual({
      limit: 25,
      offset: 50,
      product_id: 7,
      sku: "FZK-000042",
      movement_type: "SALE",
      reason_code: "ORDER_PAID",
      actor_type: "ADMIN",
      actor_id: 3,
      ref_type: "order",
      ref_id: 99,
      date_from: "2027-01-01",
      date_to: "2027-02-01",
    });
  });

  it("boş/tanımsız filtre query'yi KİRLETMEZ", async () => {
    // Boş dizgi gönderilirse sunucu "sku = ''" arar ve liste boşalır.
    await fetchStockMovements({
      limit: 10,
      sku: "",
      movement_type: undefined,
      reason_code: "",
    });
    expect(params()).toEqual({ limit: 10 });
  });

  it("her filtre TEK TEK gidiyor (biri düşerse yakalanır)", async () => {
    const tekiller: [string, unknown][] = [
      ["movement_type", "RETURN"],
      ["reason_code", "RETURN_ACCEPTED"],
      ["actor_type", "SYSTEM"],
      ["actor_id", 12],
      ["ref_type", "order_return"],
      ["ref_id", 5],
      ["sku", "DIJ-000007"],
      ["product_id", 4],
      ["date_from", "2027-03-03"],
      ["date_to", "2027-03-04"],
    ];
    for (const [alan, deger] of tekiller) {
      await fetchStockMovements({ [alan]: deger } as never);
      expect(params(), `"${alan}" query'ye konmadı`).toHaveProperty(alan, deger);
    }
  });
});

describe("gönderilen istek — ürün bazlı uçlar", () => {
  it("ürün id'si YOLA, filtreler query'ye gider", async () => {
    await fetchProductStockMovements(42, { limit: 5, movement_type: "SALE" });
    expect(sonIstek?.url).toBe("/store/admin/products/42/stock-movements");
    expect(params()).toEqual({ limit: 5, movement_type: "SALE" });
  });

  it("doğrulama ucu parametresiz çağrılır", async () => {
    await fetchProductStockVerify(42);
    expect(sonIstek?.url).toBe("/store/admin/products/42/stock-verify");
  });

  it("genel denetim yalnız sayfalama gönderir", async () => {
    await fetchLedgerAudit({ limit: 100, offset: 0 });
    expect(sonIstek?.url).toBe("/store/admin/stock-verify");
    expect(params()).toEqual({ limit: 100, offset: 0 });
  });
});

describe("yazma metodu kullanılmıyor", () => {
  it("defter uçlarına yalnız GET atılır", async () => {
    await fetchStockMovements({});
    expect((sonIstek?.method ?? "get").toLowerCase()).toBe("get");
    await fetchLedgerAudit({});
    expect((sonIstek?.method ?? "get").toLowerCase()).toBe("get");
  });
});
