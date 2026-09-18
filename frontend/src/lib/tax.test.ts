// @vitest-environment node
import { describe, expect, it } from "vitest";
import { orandanYuzde, yuzdedenOran } from "./tax";

/**
 * Formdaki yüzde ↔ sunucudaki oran dönüşümü.
 *
 * Bu testlerin asıl işi kayan nokta ve birim karışıklığını kovalamaktır:
 * `18 / 100` JavaScript'te `0.18000000000000002` üretir ve o değer
 * `Numeric(5,4)` kolonuna yazılamaz; `20` yazan bir yönetici ise ürünü
 * %2000 KDV ile kaydedebilirdi.
 */
describe("yuzdedenOran", () => {
  it("tam sayı yüzdeyi orana çevirir", () => {
    expect(yuzdedenOran("20")).toEqual({ ok: true, oran: "0.2000", hata: null });
  });

  it("kayan nokta artığı bırakmaz", () => {
    // 18 / 100 = 0.18000000000000002 — ham bölme Numeric(5,4)'e yazılamazdı.
    expect(yuzdedenOran("18").oran).toBe("0.1800");
    expect(yuzdedenOran("1").oran).toBe("0.0100");
  });

  it("sıfır oranı KABUL eder (muafiyet açıkça seçilebilmeli)", () => {
    expect(yuzdedenOran("0")).toEqual({ ok: true, oran: "0.0000", hata: null });
  });

  it("ondalık yüzdeyi ve virgülü kabul eder", () => {
    expect(yuzdedenOran("1,5").oran).toBe("0.0150");
    expect(yuzdedenOran("%10").oran).toBe("0.1000");
    expect(yuzdedenOran(" 8 ").oran).toBe("0.0800");
  });

  it("boş girdiyi reddeder — 'girilmedi' ile '%0' aynı şey değildir", () => {
    expect(yuzdedenOran("").ok).toBe(false);
    expect(yuzdedenOran("   ").ok).toBe(false);
  });

  it("sayı olmayanı reddeder", () => {
    expect(yuzdedenOran("abc").ok).toBe(false);
  });

  it("aralık dışını reddeder", () => {
    expect(yuzdedenOran("-1").ok).toBe(false);
    expect(yuzdedenOran("100").ok).toBe(false);
    expect(yuzdedenOran("2000").ok).toBe(false);
  });

  it("sınıra çok yakın değeri kabul eder", () => {
    expect(yuzdedenOran("99.99").oran).toBe("0.9999");
  });
});

describe("orandanYuzde", () => {
  it("oranı okunur yüzdeye çevirir", () => {
    expect(orandanYuzde("0.2000")).toBe("20");
    expect(orandanYuzde(0.18)).toBe("18");
    expect(orandanYuzde("0.0150")).toBe("1.5");
  });

  it("sıfır oranı '0' gösterir (girilmiş bir karardır)", () => {
    expect(orandanYuzde("0.0000")).toBe("0");
  });

  it("oran yoksa BOŞ döner — girilmemiş oran '%0' gibi gösterilmez", () => {
    expect(orandanYuzde(null)).toBe("");
    expect(orandanYuzde(undefined)).toBe("");
    expect(orandanYuzde("")).toBe("");
  });

  it("gidiş-dönüş değeri korur", () => {
    for (const yuzde of ["0", "1", "8", "10", "18", "20", "1.5"]) {
      const oran = yuzdedenOran(yuzde);
      expect(oran.ok).toBe(true);
      expect(orandanYuzde(oran.oran)).toBe(yuzde);
    }
  });
});
