import { describe, expect, it } from "vitest";
import {
  addToCart,
  cartCount,
  removeItem,
  setItemQuantity,
  type CartItem,
} from "@/lib/cart";
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

describe("cart pure logic", () => {
  it("aynı fiziksel ürünü eklemek miktarı artırır", () => {
    let items: CartItem[] = [];
    items = addToCart(items, product());
    items = addToCart(items, product());
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
  });

  it("dijital ürün tek adetle sınırlı", () => {
    const digital = product({ id: 2, slug: "not", kind: "DIGITAL" });
    let items = addToCart([], digital);
    items = addToCart(items, digital);
    expect(items[0].quantity).toBe(1);
  });

  it("setItemQuantity 0 satırı kaldırır", () => {
    const items = addToCart([], product());
    expect(setItemQuantity(items, 1, 0)).toHaveLength(0);
  });

  it("removeItem satırı siler", () => {
    const items = addToCart([], product());
    expect(removeItem(items, 1)).toHaveLength(0);
  });

  it("cartCount tüm miktarları toplar", () => {
    let items = addToCart([], product(), 3);
    items = addToCart(items, product({ id: 2, slug: "kalem" }), 2);
    expect(cartCount(items)).toBe(5);
  });
});
