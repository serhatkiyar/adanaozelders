// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  niceTickStep,
  formatTick,
  findRoots,
  worldToScreenX,
  worldToScreenY,
  screenToWorldX,
  screenToWorldY,
  type Viewport,
} from "./plotMath";

describe("niceTickStep", () => {
  it("güzel adımlar üretir (1/2/5 × 10ⁿ)", () => {
    expect(niceTickStep(20, 10)).toBe(2); // 20/10=2
    expect(niceTickStep(10, 10)).toBe(1);
    expect(niceTickStep(100, 10)).toBe(10);
    expect(niceTickStep(50, 10)).toBe(5);
  });
  it("küçük aralıkta ondalık adım", () => {
    expect(niceTickStep(1, 10)).toBeCloseTo(0.1, 10);
  });
  it("geçersiz aralıkta 1", () => {
    expect(niceTickStep(0)).toBe(1);
    expect(niceTickStep(-5)).toBe(1);
  });
});

describe("formatTick", () => {
  it("tam sayı adımda ondalık yok", () => {
    expect(formatTick(5, 1)).toBe("5");
    expect(formatTick(-3, 2)).toBe("-3");
  });
  it("ondalık adımda gerektiği kadar basamak", () => {
    expect(formatTick(0.5, 0.1)).toBe("0.5");
  });
  it("-0 temizlenir", () => {
    expect(formatTick(-0, 1)).toBe("0");
    expect(formatTick(-0.0, 0.1)).toBe("0.0");
  });
});

describe("dünya↔ekran dönüşümü", () => {
  const v: Viewport = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
  it("x ekseni", () => {
    expect(worldToScreenX(-10, v, 400)).toBe(0);
    expect(worldToScreenX(10, v, 400)).toBe(400);
    expect(worldToScreenX(0, v, 400)).toBe(200);
  });
  it("y ekseni ters çevrilir", () => {
    expect(worldToScreenY(10, v, 400)).toBe(0); // üst
    expect(worldToScreenY(-10, v, 400)).toBe(400); // alt
  });
  it("gidiş-dönüş tutarlı", () => {
    expect(screenToWorldX(worldToScreenX(3.5, v, 400), v, 400)).toBeCloseTo(3.5, 10);
    expect(screenToWorldY(worldToScreenY(-2.25, v, 400), v, 400)).toBeCloseTo(-2.25, 10);
  });
});

describe("findRoots", () => {
  it("x^2 - 3 köklerini bulur (±√3)", () => {
    const roots = findRoots((x) => x * x - 3, -10, 10, 2000);
    expect(roots.length).toBe(2);
    expect(roots[0]).toBeCloseTo(-Math.sqrt(3), 3);
    expect(roots[1]).toBeCloseTo(Math.sqrt(3), 3);
  });
  it("sin(x) için 0, ±π civarı kökler", () => {
    const roots = findRoots(Math.sin, -4, 4, 4000);
    expect(roots.some((r) => Math.abs(r) < 1e-2)).toBe(true);
    expect(roots.some((r) => Math.abs(r - Math.PI) < 1e-2)).toBe(true);
  });
  it("kök yoksa boş", () => {
    expect(findRoots((x) => x * x + 1, -10, 10).length).toBe(0);
  });
});
