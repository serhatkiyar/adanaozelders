// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FAQ, allFaqItems, getFaqCategory } from "@/lib/faqContent";

/**
 * SSS içeriği pazarlama metni değil, destek yükünü azaltan referanstır.
 * Bu testler biçimsel tutarlılığı korur: kırık anchor, boş cevap veya
 * çift id, canlıda sessizce bozuk bir sayfa üretir.
 */
describe("faqContent", () => {
  it("her kategoride en az bir soru var", () => {
    expect(FAQ.length).toBeGreaterThanOrEqual(4);
    for (const cat of FAQ) {
      expect(cat.items.length).toBeGreaterThan(0);
    }
  });

  it("her sorunun anchor'ı, metni ve dolu cevabı var", () => {
    for (const item of allFaqItems()) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.question.length).toBeGreaterThan(8);
      expect(item.answer.length).toBeGreaterThan(0);
      for (const p of item.answer) {
        expect(p.trim().length).toBeGreaterThan(20);
      }
    }
  });

  it("id'ler benzersiz (anchor çakışması sayfayı bozar)", () => {
    const ids = allFaqItems().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);

    const catIds = FAQ.map((c) => c.id);
    expect(new Set(catIds).size).toBe(catIds.length);
  });

  it("kategori id ile bulunabiliyor", () => {
    expect(getFaqCategory("iade")?.title).toBeTruthy();
    expect(getFaqCategory("olmayan")).toBeUndefined();
  });

  it("yasal olarak kritik konular kapsanmış", () => {
    // Bu dördü olmadan sayfanın varlık sebebi kalmaz: cayma hakkı, kısmi iade,
    // hesap silme ve veri indirme kullanıcıya AÇIKÇA anlatılmalı.
    const ids = allFaqItems().map((i) => i.id);
    expect(ids).toContain("cayma-hakki");
    expect(ids).toContain("kismi-iade");
    expect(ids).toContain("hesap-silme");
    expect(ids).toContain("verilerim");
  });

  it("cayma hakkı cevabı 14 gün ve koşulsuzluğu söylüyor", () => {
    const item = allFaqItems().find((i) => i.id === "cayma-hakki")!;
    const text = item.answer.join(" ");
    expect(text).toContain("14 gün");
    expect(text.toLowerCase()).toContain("gerekçe");
  });
});
