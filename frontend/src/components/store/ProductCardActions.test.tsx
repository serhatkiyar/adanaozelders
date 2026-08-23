import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ProductCard } from "@/components/store/ProductCard";
import type { ProductSearchOut } from "@/types";

const product = {
  id: 8,
  slug: "ornek-roman",
  title: "Örnek Roman",
  price: "120.00",
  compare_at_price: null,
  cover_url: "/roman.webp",
  in_stock: true,
  rating_average: null,
  rating_count: 0,
  variant_count: 1,
} as unknown as ProductSearchOut;

function renderCard(showPurchaseAction?: boolean) {
  return render(
    <MemoryRouter>
      <ProductCard product={product} showPurchaseAction={showPurchaseAction} />
    </MemoryRouter>,
  );
}

describe("ProductCard satın alma aksiyonu", () => {
  it("arama ve liste kullanımları için varsayılan olarak sepete ekle gösterir", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "Sepete Ekle" })).toBeTruthy();
  });

  it("ana sayfa vitrin kullanımında sepete ekleyi gizler ama ürün bağlantısını korur", () => {
    renderCard(false);
    expect(screen.queryByRole("button", { name: "Sepete Ekle" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Örnek Roman" }).length).toBeGreaterThan(0);
  });
});
