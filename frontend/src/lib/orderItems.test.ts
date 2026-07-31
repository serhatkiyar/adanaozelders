import { describe, expect, it } from "vitest";

import {
  MISSING_ITEMS_TEXT,
  formatItemLine,
  hasItemDetail,
  itemsSummaryLine,
  totalQuantity,
} from "./orderItems";

describe("formatItemLine", () => {
  it("adet 1 ise adet gösterilmez", () => {
    expect(formatItemLine({ title: "TYT Matematik Soru Bankası", quantity: 1 })).toBe(
      "TYT Matematik Soru Bankası",
    );
  });

  it("adet 1'den büyükse gösterilir", () => {
    // Aynı üründen çok adet — kullanıcının açıkça istediği senaryo.
    expect(formatItemLine({ title: "Paragraf Denemeleri", quantity: 3 })).toBe(
      "Paragraf Denemeleri × 3",
    );
  });

  it("uzun başlık kırpılmaz (kırpma sunuma ait, veriye değil)", () => {
    const uzun = "A".repeat(200);
    expect(formatItemLine({ title: uzun, quantity: 2 })).toBe(`${uzun} × 2`);
  });

  it("boş/boşluklu başlık yerine anlaşılır bir metin döner", () => {
    expect(formatItemLine({ title: "", quantity: 1 })).toBe("Başlıksız ürün");
    expect(formatItemLine({ title: "   ", quantity: 2 })).toBe("Başlıksız ürün × 2");
  });
});

describe("totalQuantity", () => {
  it("adetleri toplar", () => {
    expect(totalQuantity([{ title: "A", quantity: 1 }, { title: "B", quantity: 3 }])).toBe(4);
  });

  it("boş/tanımsız girdide 0", () => {
    expect(totalQuantity([])).toBe(0);
    expect(totalQuantity(undefined)).toBe(0);
    expect(totalQuantity(null)).toBe(0);
  });
});

describe("hasItemDetail", () => {
  it("kalem varsa true", () => {
    expect(hasItemDetail([{ title: "A", quantity: 1 }])).toBe(true);
  });

  it("boş liste / tanımsız / dizi olmayan → false", () => {
    // Bu üç durum da "toplanacak bir şey yok" DEĞİL, "bilgi eksik" demektir.
    expect(hasItemDetail([])).toBe(false);
    expect(hasItemDetail(undefined)).toBe(false);
    expect(hasItemDetail(null)).toBe(false);
  });
});

describe("itemsSummaryLine", () => {
  it("çok satırlı siparişi tek satırda birleştirir", () => {
    expect(
      itemsSummaryLine([
        { title: "TYT Matematik", quantity: 2 },
        { title: "AYT Fizik", quantity: 1 },
      ]),
    ).toBe("TYT Matematik × 2 · AYT Fizik");
  });

  it("kalem yoksa eksik-veri metnini döner (sessiz boşluk yok)", () => {
    expect(itemsSummaryLine([])).toBe(MISSING_ITEMS_TEXT);
    expect(itemsSummaryLine(undefined)).toBe(MISSING_ITEMS_TEXT);
  });
});
