import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { StoreHomeSections } from "@/components/store/StoreHomeSections";
import type { StoreHomeSectionPublic } from "@/types";

const imageSection: StoreHomeSectionPublic = {
  id: 4,
  title: "Okuma seçkileri",
  description: "Bu ayın kitapları",
  section_type: "IMAGE_GRID",
  link_url: "/magaza?q=roman",
  link_label: "Tüm romanlar",
  products: [],
  image_tiles: [{
    image_url: "/images/roman.webp",
    label: "Romanlar",
    alt_text: "Roman kitapları seçkisi",
    link_url: "/magaza?category=3",
  }],
};

const recentlyViewedSection: StoreHomeSectionPublic = {
  id: 9,
  title: "Son görüntülediklerin",
  description: "",
  section_type: "RECENTLY_VIEWED",
  link_url: null,
  link_label: "Tümünü gör",
  products: [],
  image_tiles: [],
};

describe("StoreHomeSections", () => {
  it("başlık, bölüm bağlantısı ve görsel bağlantısını API verisinden gösterir", () => {
    render(<MemoryRouter><StoreHomeSections sections={[imageSection]} /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Okuma seçkileri" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Tüm romanlar/i }).getAttribute("href")).toBe("/magaza?q=roman");
    expect(screen.getByRole("link", { name: /Roman kitapları seçkisi/i }).getAttribute("href")).toBe("/magaza?category=3");
    expect(screen.getByRole("img", { name: "Roman kitapları seçkisi" }).getAttribute("src")).toBe("/images/roman.webp");
  });

  it("API boşsa kendiliğinden sahte bölüm üretmez", () => {
    const { container } = render(<MemoryRouter><StoreHomeSections sections={[]} /></MemoryRouter>);
    expect(container.childElementCount).toBe(0);
  });

  it("kişisel vitrini API sırasındaki yerde tarayıcı geçmişinden doldurur", () => {
    localStorage.setItem("recently_viewed_products", JSON.stringify([{
      id: 21,
      slug: "ornek-kitap",
      title: "Örnek Kitap",
      kind: "PHYSICAL",
      seller_type: "PLATFORM",
      tutor_id: null,
      tutor_name: null,
      price: "120.00",
      compare_at_price: null,
      currency: "TRY",
      cover_url: null,
      in_stock: true,
      category_id: null,
      rating_count: 0,
      rating_average: null,
    }]));

    render(
      <MemoryRouter>
        <StoreHomeSections sections={[recentlyViewedSection, imageSection]} />
      </MemoryRouter>,
    );

    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(["Son görüntülediklerin", "Okuma seçkileri"]);
    expect(screen.getAllByRole("link", { name: /Örnek Kitap/i })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Sepete Ekle/i })).toBeNull();
    localStorage.clear();
  });

  it("geçmiş boşsa kişisel vitrini çizmez", () => {
    localStorage.clear();
    const { container } = render(
      <MemoryRouter>
        <StoreHomeSections sections={[recentlyViewedSection]} />
      </MemoryRouter>,
    );
    expect(container.childElementCount).toBe(0);
  });
});
