import { describe, expect, it } from "vitest";

import {
  KANAL_HAZIRLIK_SURESI_MS,
  KOPUK_BEKLEME_SURESI_MS,
  beklemeSuresi,
  karsiVarMi,
  katilimKarari,
  rolOku,
} from "./bekleme";

const BASTA = { beklemeBasladi: false, sureDoldu: false };
const BEKLERKEN = { beklemeBasladi: true, sureDoldu: false };

describe("katilimKarari", () => {
  it("kanal yoksa beklemeden bağlanır (geri dönüş)", () => {
    expect(katilimKarari({ durum: "yok", karsiVar: false }, BASTA)).toBe("katil");
  });

  it("karşı taraf sayfadaysa doğrudan bağlanır", () => {
    expect(katilimKarari({ durum: "hazir", karsiVar: true }, BASTA)).toBe("katil");
  });

  it("karşı taraf yoksa bekler; hazır kanalda süre işlemez", () => {
    expect(katilimKarari({ durum: "hazir", karsiVar: false }, BASTA)).toBe("bekle");
    expect(beklemeSuresi("bekle", "hazir")).toBeNull();
  });

  it("bekleme sırasında kopunca uzun süre bekler, süre dolunca bağlanır", () => {
    const kopuk = { durum: "kopuk", karsiVar: false } as const;
    expect(katilimKarari(kopuk, BEKLERKEN)).toBe("bekle");
    expect(beklemeSuresi("bekle", "kopuk")).toBe(KOPUK_BEKLEME_SURESI_MS);
    expect(katilimKarari(kopuk, { beklemeBasladi: true, sureDoldu: true })).toBe("katil");
  });

  it("basıldığında kanal kopuksa kısa hazırlık, süre dolunca bağlanır", () => {
    const kopuk = { durum: "kopuk", karsiVar: false } as const;
    expect(katilimKarari(kopuk, BASTA)).toBe("hazirlaniyor");
    expect(beklemeSuresi("hazirlaniyor", "kopuk")).toBe(KANAL_HAZIRLIK_SURESI_MS);
    expect(katilimKarari(kopuk, { beklemeBasladi: false, sureDoldu: true })).toBe("katil");
  });

  it("kanal açılıyorsa hazırlanır, süre dolunca bağlanır", () => {
    const aciliyor = { durum: "aciliyor", karsiVar: false } as const;
    expect(katilimKarari(aciliyor, BASTA)).toBe("hazirlaniyor");
    expect(katilimKarari(aciliyor, { beklemeBasladi: false, sureDoldu: true })).toBe("katil");
  });
});

describe("karsiVarMi", () => {
  it("kendi başka sekmem ve rolü okunamayan karşı taraf sayılmaz", () => {
    expect(karsiVarMi(["ogrenci", null], "ogrenci")).toBe(false);
    expect(karsiVarMi([], "ogretmen")).toBe(false);
  });

  it("karşı rolden bağlantı varsa karşı taraf vardır", () => {
    expect(karsiVarMi(["ogrenci", "ogretmen"], "ogrenci")).toBe(true);
  });
});

describe("rolOku", () => {
  it("yalnız bilinen rolleri okur", () => {
    expect(rolOku({ rol: "ogretmen" })).toBe("ogretmen");
    expect(rolOku({ rol: "admin" })).toBeNull();
    expect(rolOku(undefined)).toBeNull();
  });
});
