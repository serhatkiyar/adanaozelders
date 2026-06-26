import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRecentlyViewedProducts,
  recordViewedProduct,
  clearRecentlyViewedProducts,
} from "./recentlyViewedProducts";
import type { ProductSearchOut } from "@/types";

function prod(id: number): ProductSearchOut {
  return {
    id,
    slug: `urun-${id}`,
    title: `Ürün ${id}`,
    kind: "PHYSICAL",
    seller_type: "PLATFORM",
    price: "100.00",
    currency: "TRY",
    in_stock: true,
    rating_count: 0,
  } as ProductSearchOut;
}

// jsdom about:blank opaque origin'inde localStorage erişimi hata verir → Map-tabanlı
// stub kullan (lib gerçek tarayıcıda gerçek localStorage'ı kullanır).
const _store = new Map<string, string>();
beforeEach(() => {
  _store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => _store.get(k) ?? null,
    setItem: (k: string, v: string) => void _store.set(k, v),
    removeItem: (k: string) => void _store.delete(k),
    clear: () => _store.clear(),
  });
});

describe("recentlyViewedProducts", () => {
  it("boşken boş döner", () => {
    expect(getRecentlyViewedProducts()).toEqual([]);
  });

  it("kaydedilen ürün başa gelir", () => {
    recordViewedProduct(prod(1));
    recordViewedProduct(prod(2));
    expect(getRecentlyViewedProducts().map((p) => p.id)).toEqual([2, 1]);
  });

  it("aynı ürün tekrar bakılınca öne taşınır, mükerrer olmaz", () => {
    recordViewedProduct(prod(1));
    recordViewedProduct(prod(2));
    recordViewedProduct(prod(1));
    expect(getRecentlyViewedProducts().map((p) => p.id)).toEqual([1, 2]);
  });

  it("en fazla 12 kayıt tutar", () => {
    for (let i = 1; i <= 15; i++) recordViewedProduct(prod(i));
    const ids = getRecentlyViewedProducts().map((p) => p.id);
    expect(ids).toHaveLength(12);
    expect(ids[0]).toBe(15); // en son bakılan başta
  });

  it("temizleme listeyi sıfırlar", () => {
    recordViewedProduct(prod(1));
    clearRecentlyViewedProducts();
    expect(getRecentlyViewedProducts()).toEqual([]);
  });
});
