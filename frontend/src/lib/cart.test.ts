import { describe, expect, it } from "vitest";
import {
  addToCart,
  cartCount,
  isSelected,
  removeItem,
  removeSelected,
  selectedSubtotal,
  setItemQuantity,
  toggleItemSelected,
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

  it("yeni satır varsayılan seçili gelir", () => {
    const items = addToCart([], product());
    expect(isSelected(items[0])).toBe(true);
  });

  it("toggleItemSelected seçimi ters çevirir", () => {
    let items = addToCart([], product());
    items = toggleItemSelected(items, 1);
    expect(isSelected(items[0])).toBe(false);
    items = toggleItemSelected(items, 1);
    expect(isSelected(items[0])).toBe(true);
  });

  it("selectedSubtotal yalnız seçili satırları toplar", () => {
    let items = addToCart([], product(), 2); // 1: 100×2 = 200, seçili
    items = addToCart(items, product({ id: 2, slug: "kalem" }), 1); // 2: 100, seçili
    expect(selectedSubtotal(items)).toBe(300);
    items = toggleItemSelected(items, 2); // 2'yi seçimden çıkar
    expect(selectedSubtotal(items)).toBe(200);
  });

  it("removeSelected seçilileri çıkarır, seçilmeyenleri tutar", () => {
    let items = addToCart([], product());
    items = addToCart(items, product({ id: 2, slug: "kalem" }));
    items = toggleItemSelected(items, 2); // 2 seçimsiz
    const remaining = removeSelected(items);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].product_id).toBe(2);
  });

  it("alanı olmayan eski satır seçili kabul edilir", () => {
    const legacy: CartItem = {
      product_id: 9,
      slug: "eski",
      title: "Eski",
      price: "50",
      kind: "PHYSICAL",
      quantity: 1,
    };
    expect(isSelected(legacy)).toBe(true);
    expect(selectedSubtotal([legacy])).toBe(50);
  });
});
