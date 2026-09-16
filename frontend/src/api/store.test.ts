// Sipariş listesi sunucu sayfalaması — GÖNDERİLEN İSTEĞİN kendisi doğrulanır.
//
// `listOrdersAdmin` "korunan" dosyadaki dar istisna: yalnız EKLEME. Bu dosya
// iki şeyi kanıtlar — (1) `offset` verildiğinde isteğe gerçekten eklendiği,
// (2) verilmediğinde bugünkü (bu paketten ÖNCEki) davranışın birebir aynı
// kaldığı: `offset` anahtarı isteğe HİÇ girmiyor. İkincisi geriye dönük
// uyum kanıtı — eski panelin `OrdersPanel.tsx`si `useAdminOrders(durum)`
// çağırır ve bu asla `offset` göndermemeliydi (bkz. `backend/api/routers/
// store.py` `list_orders_admin`: `offset: int = Query(default=0, ...)`,
// göndermemek zaten sunucu varsayılanıyla aynı sonucu verir).
import type { AxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { listOrdersAdmin } from "@/api/store";

let sonIstek: AxiosRequestConfig | null = null;
let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  sonIstek = null;
  apiClient.defaults.adapter = async (config) => {
    sonIstek = config;
    return {
      data: [],
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

describe("listOrdersAdmin — gönderilen istek", () => {
  it("offset verilmediğinde istekte offset anahtarı HİÇ olmaz (geriye dönük uyum)", async () => {
    await listOrdersAdmin();

    expect(params()).not.toHaveProperty("offset");
    expect(params().limit).toBe(100);
  });

  it("statusFilter + limit verilip offset verilmediğinde de offset eklenmez", async () => {
    await listOrdersAdmin("PAID", 20);

    expect(params().status).toBe("PAID");
    expect(params().limit).toBe(20);
    expect(params()).not.toHaveProperty("offset");
  });

  it("offset verildiğinde isteğe GERÇEKTEN eklenir", async () => {
    await listOrdersAdmin(undefined, 20, 40);

    expect(params().limit).toBe(20);
    expect(params().offset).toBe(40);
  });

  it("offset 0 iken de (ilk sayfa) açıkça gönderilir — 0 'verilmedi' ile karıştırılmaz", async () => {
    await listOrdersAdmin(undefined, 20, 0);

    expect(params().offset).toBe(0);
  });
});
