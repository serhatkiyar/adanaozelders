import { describe, expect, it } from "vitest";

import {
  birakincaKademe,
  gorunurAlan,
  kademeYuksekligi,
  onizlemeGerekli,
  onizlemeMetni,
} from "./sohbetCekmecesi";

describe("kademeYuksekligi", () => {
  it.each([
    [844, 338, 796],
    [390, 260, 342],
    [500, 260, 452],
    [250, 202, 202],
  ])("alan %i: yarım %i, tam %i", (alan, yarim, tam) => {
    expect(kademeYuksekligi("yarim", alan)).toBe(yarim);
    expect(kademeYuksekligi("tam", alan)).toBe(tam);
    expect(kademeYuksekligi("kapali", alan)).toBe(0);
  });
});

describe("gorunurAlan", () => {
  it("visualViewport yoksa pencerenin tamamı", () => {
    expect(gorunurAlan(844, null)).toEqual({ yukseklik: 844, alt: 0, klavyeAcik: false });
  });
  it("klavye alttan örtünce alt kayma ve klavye açık", () => {
    expect(gorunurAlan(844, { height: 500, offsetTop: 0 })).toEqual({
      yukseklik: 500,
      alt: 344,
      klavyeAcik: true,
    });
    expect(gorunurAlan(844, { height: 500, offsetTop: 100 }).alt).toBe(244);
  });
  it("küçük örtü (adres çubuğu) klavye sayılmaz", () => {
    expect(gorunurAlan(844, { height: 780, offsetTop: 0 })).toEqual({
      yukseklik: 780,
      alt: 64,
      klavyeAcik: false,
    });
  });
});

describe("birakincaKademe", () => {
  // 844: yarım 338, tam 796.
  it("yavaş bırakış en yakın kademeye", () => {
    expect(birakincaKademe(100, 0, 844)).toBe("kapali");
    expect(birakincaKademe(300, 0, 844)).toBe("yarim");
    expect(birakincaKademe(600, 0, 844)).toBe("tam");
  });
  it("hızlı fiske yön kadar kademe atlar", () => {
    expect(birakincaKademe(400, 1, 844)).toBe("tam");
    expect(birakincaKademe(200, 1, 844)).toBe("yarim");
    expect(birakincaKademe(700, -1, 844)).toBe("yarim");
    expect(birakincaKademe(300, -1, 844)).toBe("kapali");
  });
});

describe("onizlemeGerekli", () => {
  const a = { okunmamis: 1, zaman: "2026-09-26T10:00:00Z" };
  const b = { okunmamis: 2, zaman: "2026-09-26T10:01:00Z" };
  it("ilk yüklemede önizleme yok", () => {
    expect(onizlemeGerekli(null, b, false)).toBe(false);
  });
  it("okunmamış arttı ve son mesaj değişti, sohbet kapalı: evet", () => {
    expect(onizlemeGerekli(a, b, false)).toBe(true);
    expect(onizlemeGerekli({ okunmamis: 0, zaman: null }, a, false)).toBe(true);
  });
  it("sohbet açık, sayı azaldı ya da son mesaj aynı: hayır", () => {
    expect(onizlemeGerekli(a, b, true)).toBe(false);
    expect(onizlemeGerekli(b, a, false)).toBe(false);
    expect(onizlemeGerekli(a, { ...a, okunmamis: 3 }, false)).toBe(false);
  });
});

describe("onizlemeMetni", () => {
  it("boşlukları tekler, uzun metni 80 karakterde keser", () => {
    expect(onizlemeMetni("  merhaba \n\n hocam ")).toBe("merhaba hocam");
    const uzun = "a".repeat(100);
    const m = onizlemeMetni(uzun);
    expect(m).toHaveLength(80);
    expect(m.endsWith("…")).toBe(true);
    expect(onizlemeMetni(null)).toBe("");
  });
});
