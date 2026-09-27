import { describe, expect, it } from "vitest";

import {
  donusum,
  imlecteYakinlastir,
  imlecYuzdesi,
  kaydir,
  kaymaSinirla,
  resimOrani,
  yakinlikSinirla,
} from "./paylasimYakinlastirma";

describe("paylaşım yakınlaştırma", () => {
  it("yakınlık 1–4 arasında kalır", () => {
    expect(yakinlikSinirla(0.5)).toBe(1);
    expect(yakinlikSinirla(2.5)).toBe(2.5);
    expect(yakinlikSinirla(9)).toBe(4);
  });

  it("1×'te kayma yok; 2×'te resim görünümü kaplayacak kadar kayar", () => {
    expect(kaymaSinirla({ x: 30, y: -30 }, 1)).toEqual({ x: 0, y: 0 });
    // 2×: yarı eksen 50 → en çok 25.
    expect(kaymaSinirla({ x: 30, y: -30 }, 2)).toEqual({ x: 25, y: -25 });
    // Letterbox: dikeyde resim yüzeyin yarısı → 2×'te dikey kayma yok.
    expect(kaymaSinirla({ x: 30, y: 30 }, 2, { x: 1, y: 0.5 })).toEqual({ x: 25, y: 0 });
  });

  it("contain oranı: geniş yüzeyde yatay boşluk", () => {
    const o = resimOrani(1600, 800, 1600, 1200);
    expect(o.x).toBeCloseTo(4 / 3 / 2);
    expect(o.y).toBe(1);
    expect(resimOrani(800, 800, 1600, 800)).toEqual({ x: 1, y: 0.5 });
    expect(resimOrani(0, 800, 1, 1)).toEqual({ x: 1, y: 1 });
  });

  it("imleç altındaki nokta sabit kalır", () => {
    // Merkezde yakınlaştırma kaymayı değiştirmez.
    expect(imlecteYakinlastir({ kayma: { x: 0, y: 0 }, onceki: 1, sonraki: 2, imlec: { x: 0, y: 0 } })).toEqual({ x: 0, y: 0 });
    // Sağ kenara (%+40) yakınlaştırma resmi sola kaydırır: 40 * (1/2 − 1) = −20.
    expect(
      imlecteYakinlastir({ kayma: { x: 0, y: 0 }, onceki: 1, sonraki: 2, imlec: { x: 40, y: 0 } }),
    ).toEqual({ x: -20, y: 0 });
  });

  it("sürükleme pikseli yüzey yüzdesine çevrilir ve ölçeğe bölünür", () => {
    expect(kaydir({ x: 0, y: 0 }, 100, 0, { w: 1000, h: 500 }, 2)).toEqual({ x: 5, y: 0 });
    expect(kaydir({ x: 0, y: 0 }, 100, 0, { w: 1000, h: 500 }, 1)).toEqual({ x: 0, y: 0 });
  });

  it("dönüşüm metni ve imleç yüzdesi", () => {
    expect(donusum(2, { x: 5, y: -3 })).toBe("scale(2) translate(5%, -3%)");
    expect(imlecYuzdesi(150, 50, { left: 100, top: 0, width: 100, height: 100 })).toEqual({ x: 0, y: 0 });
  });
});
