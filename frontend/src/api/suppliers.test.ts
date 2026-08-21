// Tedarikçi API katmanı — GÖNDERİLEN İSTEĞİN kendisi doğrulanır.
//
// `stock.test.ts` deseni: axios'un GERÇEK örneği kullanılır, yalnız **adapter**
// değiştirilir. Böylece URL kurulumu, parametre serileştirmesi ve gövde
// birlikte koşar; testin gördüğü şey ağa çıkacak isteğin ta kendisidir.
//
// Bu dosyanın koruduğu iki davranış tip sistemiyle YAKALANAMAZ:
//
// 1. **Boş token gövdeye KONMAZ.** Form açıldığında token kutusu her zaman
//    boştur (mevcut değer ön-doldurulmaz — sır ekranda görünmemeli). Kullanıcı
//    yalnız aralığı değiştirip kaydettiğinde `api_token: ""` gönderilirse
//    sunucu token'ı siler ve senkron SESSİZCE durur. Kutu boşsa alan hiç
//    gönderilmemeli.
// 2. **`reason` her yazma isteğinde vardır** (S8'in hedefi). Gerekçesiz istek
//    sunucuda 422 alır; kullanıcı "kaydedilmedi" der, sebebini göremez.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import {
  fetchSuppliers,
  linkSupplierProduct,
  listSupplierProducts,
  syncSupplier,
  unlinkSupplierProduct,
  updateSupplier,
} from "@/api/suppliers";

import type { AxiosRequestConfig } from "axios";

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
      headers: { "x-total-count": "0" },
      config,
    } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
});

function govde(): Record<string, unknown> {
  const ham = sonIstek?.data;
  if (!ham) return {};
  return typeof ham === "string" ? JSON.parse(ham) : (ham as Record<string, unknown>);
}

function params(): Record<string, unknown> {
  return (sonIstek?.params ?? {}) as Record<string, unknown>;
}

describe("liste", () => {
  it("tedarikçi listesi doğru yola gider", async () => {
    await fetchSuppliers();
    expect(sonIstek?.url).toBe("/store/admin/suppliers");
    expect(sonIstek?.method?.toLowerCase()).toBe("get");
  });
});

describe("ayar güncelleme", () => {
  it("boş token gövdeye KONMAZ", async () => {
    await updateSupplier(3, {
      stock_interval_seconds: 90,
      api_token: "",
      reason: "yalnız aralık",
    });

    const g = govde();
    expect("api_token" in g).toBe(false);
    expect(g.stock_interval_seconds).toBe(90);
    expect(g.reason).toBe("yalnız aralık");
  });

  it("yalnız boşluktan ibaret token da gönderilmez", async () => {
    await updateSupplier(3, { api_token: "   ", reason: "x" });
    expect("api_token" in govde()).toBe(false);
  });

  it("gerçek token gönderilir ve kırpılır", async () => {
    await updateSupplier(3, { api_token: "  eyJhbG.token.imza \n", reason: "kurulum" });
    expect(govde().api_token).toBe("eyJhbG.token.imza");
  });

  it("dokunulmayan alanlar gövdede yer almaz", async () => {
    // PATCH kısmi olmalı: gönderilmeyen alan sunucuda `exclude_unset` ile
    // korunur. Hepsini `undefined` olarak yollamak, şemaya bağlı olarak
    // mevcut ayarı sıfırlama riski taşır.
    await updateSupplier(3, { is_enabled: true, reason: "aç" });
    expect(Object.keys(govde()).sort()).toEqual(["is_enabled", "reason"]);
  });

  it("PATCH kullanılır", async () => {
    await updateSupplier(3, { is_enabled: false, reason: "kapat" });
    expect(sonIstek?.method?.toLowerCase()).toBe("patch");
    expect(sonIstek?.url).toBe("/store/admin/suppliers/3");
  });
});

describe("elle senkron", () => {
  it("kapsam gövdede gider", async () => {
    await syncSupplier(3, "price");
    expect(sonIstek?.url).toBe("/store/admin/suppliers/3/sync");
    expect(govde().scope).toBe("price");
  });

  it("varsayılan kapsam stoktur", async () => {
    // Yöneticinin en sık istediği şey stok tazeliğidir; fiyat döngüsü token
    // gerektirir ve saatlik ölçekte çalışır.
    await syncSupplier(3);
    expect(govde().scope).toBe("stock");
  });
});

describe("tedarikçi ürünleri", () => {
  it("eşleşmemişler filtresi gerçekten query'ye konur", async () => {
    await listSupplierProducts(3, { linked: false, limit: 25, offset: 50 });
    expect(sonIstek?.url).toBe("/store/admin/suppliers/3/products");
    expect(params()).toMatchObject({ linked: false, limit: 25, offset: 50 });
  });

  it("linked=false ile linked belirtilmemiş hâli AYRI isteklerdir", async () => {
    // `false` düşürülürse panel "eşleşmemişler" sekmesinde TÜM satırları
    // gösterir ve kullanıcı bağlı olanları yeniden bağlamaya çalışır.
    await listSupplierProducts(3, {});
    expect("linked" in params()).toBe(false);
  });

  it("arama metni query'ye konur", async () => {
    await listSupplierProducts(3, { q: "defter" });
    expect(params().q).toBe("defter");
  });
});

describe("bağlama / çözme", () => {
  it("bağlama isteği ürün ve gerekçe taşır", async () => {
    await linkSupplierProduct(3, 42, { product_id: 7, reason: "elle eşleştirme" });
    expect(sonIstek?.url).toBe("/store/admin/suppliers/3/products/42/link");
    expect(govde()).toEqual({ product_id: 7, reason: "elle eşleştirme" });
  });

  it("çözme isteği gerekçe taşır", async () => {
    await unlinkSupplierProduct(3, 42, { reason: "yanlış olmuş" });
    expect(sonIstek?.url).toBe("/store/admin/suppliers/3/products/42/unlink");
    expect(govde()).toEqual({ reason: "yanlış olmuş" });
  });
});
