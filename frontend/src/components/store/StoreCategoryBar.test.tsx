import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { StoreCategoryBar } from "@/components/store/StoreCategoryBar";

const useCategories = vi.fn();

vi.mock("@/hooks/useStore", () => ({
  useCategories: () => useCategories(),
}));

describe("StoreCategoryBar", () => {
  it("özel ders bağlantısını site ana sayfasına yönlendirir", () => {
    useCategories.mockReturnValue({ data: [] });

    render(
      <MemoryRouter initialEntries={["/magaza"]}>
        <StoreCategoryBar />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Mağaza gezinmesi" })).toBeTruthy();
    // Kullanıcı kararı (29 Ağu): mağazadan özel ders tarafına geçiş ana
    // sayfadan başlar (/egitmenler "gereksiz bir yere atıyor" bulundu).
    expect(screen.getByRole("link", { name: "Özel Ders Al" }).getAttribute("href")).toBe("/");
  });

  it("ürün kategorilerinin yanında görünmeye devam eder", () => {
    useCategories.mockReturnValue({
      data: [{ id: 10, name: "Sınav Kitapları", slug: "sinav-kitaplari", parent_id: null }],
    });

    render(
      <MemoryRouter initialEntries={["/magaza"]}>
        <StoreCategoryBar />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Sınav Kitapları" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Özel Ders Al" })).toBeTruthy();
    expect(screen.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "Tümü",
      "Özel Ders Al",
      "Sınav Kitapları",
    ]);
  });
});
