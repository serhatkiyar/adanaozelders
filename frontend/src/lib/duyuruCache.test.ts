import { beforeEach, describe, expect, it, vi } from "vitest";

import { oku, yaz } from "./duyuruCache";

const ORNEK = {
  metin: "Kampanya",
  link_url: "https://example.com",
  link_metni: "İncele",
  varyant: "bilgi" as const,
};

beforeEach(() => {
  localStorage.clear();
});

describe("lib/duyuruCache", () => {
  it("hiç yazılmamışsa `undefined` döner (ilk ziyaret)", () => {
    expect(oku()).toBeUndefined();
  });

  it("yazılan veri aynen okunur", () => {
    yaz(ORNEK);
    expect(oku()).toEqual(ORNEK);
  });

  it("`null` yazılırsa `null` okunur (aktif duyuru yok olarak bilinir — undefined ile KARIŞMAZ)", () => {
    yaz(null);
    expect(oku()).toBeNull();
    expect(oku()).not.toBeUndefined();
  });

  it("sonraki `yaz` çağrısı öncekini değiştirir", () => {
    yaz(ORNEK);
    yaz(null);
    expect(oku()).toBeNull();
  });

  it("bozuk JSON önbellekte varsa `undefined` döner (patlamaz)", () => {
    localStorage.setItem("duyuru-seridi:son", "{ bozuk json");
    expect(oku()).toBeUndefined();
  });

  it("localStorage erişimi patlarsa `oku` sessizce `undefined` döner", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("depolama kapalı");
    });
    expect(oku()).toBeUndefined();
    spy.mockRestore();
  });

  it("localStorage erişimi patlarsa `yaz` sessizce hiçbir şey yapmaz (throw etmez)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("depolama dolu");
    });
    expect(() => yaz(ORNEK)).not.toThrow();
    spy.mockRestore();
  });
});
