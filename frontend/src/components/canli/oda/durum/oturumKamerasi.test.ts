import { afterEach, describe, expect, it } from "vitest";

import {
  etkinOturumKamerasiAnahtari,
  kameraTercihiniKaydet,
  oturumKamerasiAnahtari,
  oturumKamerasiCoz,
  oturumKamerasiOku,
  oturumKamerasiYaz,
} from "./oturumKamerasi";

afterEach(() => {
  window.sessionStorage.clear();
  etkinOturumKamerasiAnahtari(null);
});

describe("oturum kamera tercihi", () => {
  it("anahtar ders + rol + kullanıcı; eksik parça → null", () => {
    expect(oturumKamerasiAnahtari(582, "TUTOR", 4)).toBe("canliDers.kamera.v1:582:TUTOR:4");
    expect(oturumKamerasiAnahtari(undefined, "TUTOR", 4)).toBeNull();
    expect(oturumKamerasiAnahtari(582, undefined, 4)).toBeNull();
    expect(oturumKamerasiAnahtari(582, "CLIENT", undefined)).toBeNull();
  });

  it("kayıt yoksa null (ilk giriş: çağıran mevcut varsayılanı kullanır)", () => {
    expect(oturumKamerasiOku("canliDers.kamera.v1:582:TUTOR:4")).toBeNull();
    expect(oturumKamerasiCoz("bozuk")).toBeNull();
  });

  it("kapatılan kamera yenilemeden sonra kapalı okunur; açık da açık", () => {
    const a = oturumKamerasiAnahtari(582, "TUTOR", 4);
    oturumKamerasiYaz(a, false);
    expect(oturumKamerasiOku(a)).toBe(false);
    oturumKamerasiYaz(a, true);
    expect(oturumKamerasiOku(a)).toBe(true);
  });

  it("başka ders / başka kullanıcı etkilenmez", () => {
    oturumKamerasiYaz(oturumKamerasiAnahtari(582, "TUTOR", 4), false);
    expect(oturumKamerasiOku(oturumKamerasiAnahtari(583, "TUTOR", 4))).toBeNull();
    expect(oturumKamerasiOku(oturumKamerasiAnahtari(582, "CLIENT", 6))).toBeNull();
  });

  it("ders içi düğme etkin anahtara yazar; anahtar yoksa hiçbir şey yazmaz", () => {
    kameraTercihiniKaydet(false);
    expect(window.sessionStorage.length).toBe(0);
    const a = oturumKamerasiAnahtari(582, "CLIENT", 6);
    etkinOturumKamerasiAnahtari(a);
    kameraTercihiniKaydet(false);
    expect(oturumKamerasiOku(a)).toBe(false);
  });

  it("sessionStorage fırlatırsa sessizce geçer", () => {
    const asil = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("kapalı");
      },
    });
    try {
      const a = oturumKamerasiAnahtari(582, "TUTOR", 4);
      expect(() => oturumKamerasiYaz(a, false)).not.toThrow();
      expect(oturumKamerasiOku(a)).toBeNull();
    } finally {
      if (asil) Object.defineProperty(window, "sessionStorage", asil);
    }
  });
});
