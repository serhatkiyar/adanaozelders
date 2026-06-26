import { describe, expect, it } from "vitest";
import {
  favoritesCount,
  isFavorite,
  removeFavorite,
  toggleFavorite,
  type FavoriteItem,
} from "@/lib/favorites";
import type { ProductSearchOut } from "@/types";

function product(over: Partial<ProductSearchOut> = {}): ProductSearchOut {
  return {
    id: 1,
    slug: "kitap",
    title: "Kitap",
    kind: "PHYSICAL",
    seller_type: "PLATFORM",
    price: "100.00",
    currency: "TRY",
    in_stock: true,
    rating_count: 0,
    ...over,
  };
}

describe("favorites pure logic", () => {
  it("toggle önce ekler, tekrar çağrılınca çıkarır", () => {
    let items: FavoriteItem[] = [];
    items = toggleFavorite(items, product());
    expect(items).toHaveLength(1);
    items = toggleFavorite(items, product());
    expect(items).toHaveLength(0);
  });

  it("toggle yeni öğeyi başa ekler", () => {
    let items = toggleFavorite([], product());
    items = toggleFavorite(items, product({ id: 2, slug: "kalem" }));
    expect(items[0].id).toBe(2);
  });

  it("isFavorite varlığı doğru raporlar", () => {
    const items = toggleFavorite([], product());
    expect(isFavorite(items, 1)).toBe(true);
    expect(isFavorite(items, 99)).toBe(false);
  });

  it("aynı ürün iki kez eklenmez (idempotent toggle-on)", () => {
    let items = toggleFavorite([], product());
    // İkinci toggle çıkardığı için tekrar ekleyerek tek kalmayı doğrula
    items = toggleFavorite(items, product()); // çıkar
    items = toggleFavorite(items, product()); // ekle
    expect(items.filter((i) => i.id === 1)).toHaveLength(1);
  });

  it("removeFavorite öğeyi siler, favoritesCount sayar", () => {
    let items = toggleFavorite([], product());
    items = toggleFavorite(items, product({ id: 2, slug: "kalem" }));
    expect(favoritesCount(items)).toBe(2);
    expect(removeFavorite(items, 1)).toHaveLength(1);
  });
});
