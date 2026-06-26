import { describe, expect, it } from "vitest";
import { buildSpecRows, hasSpecs } from "./productSpecs";

describe("buildSpecRows", () => {
  it("künye boşsa boş döner", () => {
    expect(buildSpecRows({})).toEqual([]);
    expect(hasSpecs({})).toBe(false);
  });

  it("yalnız dolu alanları sıralı döndürür", () => {
    const rows = buildSpecRows({ isbn: "9786051949291", author: "Kolektif" });
    // Sıra SPEC_ORDER'a göre: Yazar, sonra ISBN.
    expect(rows.map((r) => r.label)).toEqual(["Yazar", "ISBN / Barkod"]);
    expect(rows[0].value).toBe("Kolektif");
    expect(hasSpecs({ author: "Kolektif" })).toBe(true);
  });

  it("sayısal alanları string'e çevirir; 0 dahil edilir", () => {
    const rows = buildSpecRows({ page_count: 360, publication_year: 2022 });
    expect(rows).toEqual([
      { key: "page_count", label: "Sayfa sayısı", value: "360" },
      { key: "publication_year", label: "Basım yılı", value: "2022" },
    ]);
  });

  it("null/boş/boşluk-only değerleri eler", () => {
    const rows = buildSpecRows({
      author: null,
      publisher: "   ",
      language: "Türkçe",
    });
    expect(rows.map((r) => r.label)).toEqual(["Dil"]);
  });

  it("tam künyeyi doğru sırayla verir", () => {
    const rows = buildSpecRows({
      author: "Özgür Bula",
      publisher: "3D Yayınları",
      isbn: "9786051949291",
      page_count: 360,
      dimensions: "20 x 27",
      publication_year: 2022,
      edition: "1. Basım",
      language: "Türkçe",
      cover_type: "İnce Kapak",
    });
    expect(rows.map((r) => r.label)).toEqual([
      "Yazar",
      "Yayınevi",
      "ISBN / Barkod",
      "Sayfa sayısı",
      "Ebat",
      "Basım yılı",
      "Baskı",
      "Dil",
      "Kapak tipi",
    ]);
  });
});
