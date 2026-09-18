// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeZoom, containedRect, type ZoomInput } from "./imageZoom";

/** 400×400 kutuda 200×400 doğal orana sahip dik (portre) görsel → 200 genişlik, yatay ortalı. */
const base: ZoomInput = {
  cursorX: 200,
  cursorY: 200,
  imgLeft: 0,
  imgTop: 0,
  imgWidth: 400,
  imgHeight: 400,
  naturalWidth: 200,
  naturalHeight: 400,
  boxLeft: 0,
  boxTop: 0,
  panelWidth: 400,
  panelHeight: 400,
  zoom: 2,
};

describe("containedRect", () => {
  it("portre görseli yatayda ortalar (letterbox)", () => {
    const r = containedRect(base);
    expect(r).toEqual({ left: 100, top: 0, width: 200, height: 400 });
  });

  it("kare görsel kutuyu doldurur", () => {
    const r = containedRect({ ...base, naturalWidth: 500, naturalHeight: 500 });
    expect(r).toEqual({ left: 0, top: 0, width: 400, height: 400 });
  });
});

describe("computeZoom", () => {
  it("çizilen görselin dışındaki imleçte null döner (letterbox alanı dahil)", () => {
    // x=50 letterbox'ta (çizilen alan 100..300)
    expect(computeZoom({ ...base, cursorX: 50 })).toBeNull();
    expect(computeZoom({ ...base, cursorX: 350 })).toBeNull();
  });

  it("merkezde lens imlece ortalanır ve panel bg lens bölgesini gösterir", () => {
    const z = computeZoom(base)!;
    // lens: panel/zoom = 200×200, ama görsel 200 genişlikte → lensWidth=200 (tam genişlik)
    expect(z.lensWidth).toBe(200);
    expect(z.lensHeight).toBe(200);
    expect(z.lensLeft).toBe(100); // görselin sol kenarı
    expect(z.lensTop).toBe(100); // 200 - 200/2
    expect(z.bgWidth).toBe(400); // 200 * 2
    expect(z.bgHeight).toBe(800);
    expect(z.bgX).toBe(-0); // lens görselin solunda başlıyor
    expect(z.bgY).toBe(-200); // (100-0)*2
  });

  it("kenara yakın imleçte lens görsel içinde kalır (clamp)", () => {
    const z = computeZoom({ ...base, cursorY: 390 })!;
    expect(z.lensTop).toBe(200); // 400-200 → alt kenara dayanır
    expect(z.bgY).toBe(-400);
  });

  it("lens konumu hero kutusuna göredir (boxLeft/boxTop düşülür)", () => {
    const z = computeZoom({
      ...base,
      imgLeft: 500,
      boxLeft: 480,
      cursorX: 700,
    })!;
    // çizilen alan 600..800; imleç 700 merkez → lensX viewport 600 → box'a göre 120
    expect(z.lensLeft).toBe(120);
  });

  it("geçersiz girdilerde null", () => {
    expect(computeZoom({ ...base, zoom: 0 })).toBeNull();
    expect(computeZoom({ ...base, panelWidth: 0 })).toBeNull();
  });
});
