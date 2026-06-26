import { describe, it, expect } from "vitest";
import { parseMoney, formatTRY, formatTL, formatRate } from "@/lib/money";

describe("parseMoney", () => {
  it("string sayıyı number'a çevirir", () => {
    expect(parseMoney("250.5")).toBe(250.5);
    expect(parseMoney(99)).toBe(99);
  });
  it("null/undefined/boş için null", () => {
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
  it("geçersiz değer için null", () => {
    expect(parseMoney("abc")).toBeNull();
  });
});

describe("formatTRY", () => {
  it("₺ ile biçimler (tam sayı)", () => {
    expect(formatTRY(250)).toBe("₺250");
  });
  it("ondalığı tr-TR (virgül) ile gösterir", () => {
    expect(formatTRY(99.99)).toContain("99,99");
  });
  it("null için fallback", () => {
    expect(formatTRY(null)).toBe("—");
    expect(formatTRY(null, "yok")).toBe("yok");
  });
});

describe("formatTL", () => {
  it("'TL' son ekiyle biçimler (tam sayı)", () => {
    expect(formatTL(250)).toBe("250 TL");
  });
  it("ondalığı tr-TR (virgül) ile gösterir", () => {
    expect(formatTL(99.99)).toBe("99,99 TL");
  });
  it("binlik ayracı uygular", () => {
    expect(formatTL(1250)).toBe("1.250 TL");
  });
  it("null için fallback", () => {
    expect(formatTL(null)).toBe("—");
    expect(formatTL(null, "yok")).toBe("yok");
  });
});

describe("formatRate", () => {
  it("'/ saat' ekler", () => {
    expect(formatRate(250)).toContain("/ saat");
  });
  it("null için açıklayıcı fallback", () => {
    expect(formatRate(null)).toBe("Ücret belirtilmemiş");
  });
});
