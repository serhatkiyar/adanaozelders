import { describe, expect, it } from "vitest";

import { categoryChain, isBookCategory, suggestedVariantTitle } from "./variants";

const KATEGORILER = [
  { id: 1, parent_id: null, slug: "sinav-kitaplari" },
  { id: 2, parent_id: 1, slug: "yks-kitaplari" },
  { id: 3, parent_id: null, slug: "kirtasiye" },
  { id: 4, parent_id: 3, slug: "kalemler" },
];
const KITAP_KOKLERI = ["kitap", "sinav-kitaplari", "okula-yardimci"];

describe("categoryChain", () => {
  it("yapraktan köke zinciri kurar", () => {
    expect(categoryChain(KATEGORILER, 2).map((c) => c.slug)).toEqual([
      "yks-kitaplari",
      "sinav-kitaplari",
    ]);
  });

  it("kategorisiz için boş döner", () => {
    expect(categoryChain(KATEGORILER, null)).toEqual([]);
    expect(categoryChain(KATEGORILER, 999)).toEqual([]);
  });

  it("parent döngüsünde sonsuza girmez", () => {
    const dongulu = [
      { id: 1, parent_id: 2, slug: "a" },
      { id: 2, parent_id: 1, slug: "b" },
    ];
    expect(categoryChain(dongulu, 1).map((c) => c.slug)).toEqual(["a", "b"]);
  });
});

describe("isBookCategory", () => {
  it("kitap kökü altındaki yaprakta true — yaprak slug'ı kitapla ilgisiz olsa da", () => {
    expect(isBookCategory(KATEGORILER, 2, KITAP_KOKLERI)).toBe(true);
  });

  it("kırtasiye zincirinde false", () => {
    expect(isBookCategory(KATEGORILER, 4, KITAP_KOKLERI)).toBe(false);
  });

  it("kategorisiz ürün kitap sayılmaz", () => {
    expect(isBookCategory(KATEGORILER, null, KITAP_KOKLERI)).toBe(false);
  });

  it("sözlük boşsa (config yüklenemedi) hiçbir kategori kitap sayılmaz — alanları gizlemek yerine sunucu 409'una güvenilir", () => {
    expect(isBookCategory(KATEGORILER, 2, [])).toBe(false);
  });
});

describe("suggestedVariantTitle", () => {
  it("tek eksende 'Grup - Değer'", () => {
    expect(suggestedVariantTitle("Fosforlu Kalem", "Sarı")).toBe(
      "Fosforlu Kalem - Sarı"
    );
  });
  it("iki eksende değerleri / ile birleştirir", () => {
    expect(suggestedVariantTitle("Defter", "Çizgili", "A4")).toBe(
      "Defter - Çizgili / A4"
    );
  });
});
