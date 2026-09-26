import { describe, expect, it } from "vitest";

import { onizlemeGerekli, onizlemeMetni } from "./sohbetCekmecesi";

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
