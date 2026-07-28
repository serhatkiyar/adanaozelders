import { describe, expect, it } from "vitest";
import {
  MAX_PAGE,
  PAGE_PARAM,
  limitForPage,
  nextPageSearch,
  pageFromParam,
  withPage,
} from "@/lib/pagination";

describe("pageFromParam", () => {
  it("geçerli sayfa numarasını okur", () => {
    expect(pageFromParam("3")).toBe(3);
  });

  it("eksik/geçersiz değerde ilk sayfaya düşer", () => {
    // Kullanıcıya hata göstermek yerine ilk sayfayı vermek doğru davranış.
    for (const bad of [null, undefined, "", "abc", "0", "-2", "NaN"]) {
      expect(pageFromParam(bad)).toBe(1);
    }
  });

  it("ondalık değeri aşağı yuvarlar", () => {
    expect(pageFromParam("2.9")).toBe(2);
  });

  it("aşırı büyük değeri sınırlar", () => {
    // Aksi halde sunucuya devasa limit giderdi (bot/kazara bağlantı).
    expect(pageFromParam("999999")).toBe(MAX_PAGE);
  });
});

describe("limitForPage", () => {
  it("kümülatif limit üretir (sonsuz kaydırma hissi korunur)", () => {
    expect(limitForPage(1, 20)).toBe(20);
    expect(limitForPage(3, 20)).toBe(60);
    expect(limitForPage(2, 30)).toBe(60);
  });

  it("sıfır/negatif sayfada en az bir sayfalık veri döner", () => {
    expect(limitForPage(0, 20)).toBe(20);
    expect(limitForPage(-5, 20)).toBe(20);
  });
});

describe("withPage", () => {
  it("ilk sayfada parametreyi URL'den siler", () => {
    const p = new URLSearchParams("q=matematik&sayfa=3");
    expect(withPage(p, 1).toString()).toBe("q=matematik");
  });

  it("sonraki sayfalarda parametreyi yazar", () => {
    const p = new URLSearchParams("q=matematik");
    expect(withPage(p, 2).get(PAGE_PARAM)).toBe("2");
  });

  it("mevcut filtreleri korur", () => {
    const p = new URLSearchParams("q=fizik&district=Seyhan&district=Cukurova");
    const out = withPage(p, 2);
    expect(out.getAll("district")).toEqual(["Seyhan", "Cukurova"]);
    expect(out.get("q")).toBe("fizik");
  });

  it("girdiyi değiştirmez (saf)", () => {
    const p = new URLSearchParams("q=a");
    withPage(p, 5);
    expect(p.has(PAGE_PARAM)).toBe(false);
  });
});

describe("nextPageSearch", () => {
  it("bir sonraki sayfanın query string'ini üretir", () => {
    const p = new URLSearchParams("q=kimya");
    const out = nextPageSearch(p, 2);
    expect(out.startsWith("?")).toBe(true);
    expect(new URLSearchParams(out).get(PAGE_PARAM)).toBe("3");
    expect(new URLSearchParams(out).get("q")).toBe("kimya");
  });
});
