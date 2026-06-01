import { describe, it, expect } from "vitest";
import { compile } from "./mathParse";

const at = (expr: string, x: number) => compile(expr)(x);

describe("compile — temel değerlendirme", () => {
  it("polinom", () => {
    expect(at("x^2", 3)).toBe(9);
    expect(at("x^2 - 3", 2)).toBe(1);
    expect(at("2*x + 1", 4)).toBe(9);
  });
  it("trigonometri (radyan)", () => {
    expect(at("sin(x)", 0)).toBe(0);
    expect(at("cos(x)", 0)).toBe(1);
    expect(at("sin(x)", Math.PI / 2)).toBeCloseTo(1, 10);
  });
  it("sabitler", () => {
    expect(at("pi", 0)).toBeCloseTo(Math.PI, 10);
    expect(at("e", 0)).toBeCloseTo(Math.E, 10);
  });
});

describe("öncelik ve birleşim", () => {
  it("-x^2 = -(x^2)", () => {
    expect(at("-x^2", 2)).toBe(-4);
  });
  it("üs sağ-birleşimli", () => {
    expect(at("2^3^2", 0)).toBe(512); // 2^(3^2)=2^9
  });
  it("işaretli üs", () => {
    expect(at("2^-1", 0)).toBe(0.5);
  });
  it("çarpma toplamadan önce", () => {
    expect(at("1 + 2*3", 0)).toBe(7);
  });
});

describe("örtük çarpım", () => {
  it("sayı-değişken", () => {
    expect(at("2x", 5)).toBe(10);
  });
  it("sayı-parantez", () => {
    expect(at("2(x+1)", 3)).toBe(8);
  });
  it("sayı-fonksiyon", () => {
    expect(at("3sin(x)", Math.PI / 2)).toBeCloseTo(3, 10);
  });
  it("parantez-parantez", () => {
    expect(at("(x+1)(x-1)", 3)).toBe(8); // x^2-1
  });
  it("2x^2 = 2*(x^2)", () => {
    expect(at("2x^2", 3)).toBe(18);
  });
});

describe("alan dışı / tanımsız", () => {
  it("sqrt(negatif) -> NaN", () => {
    expect(Number.isNaN(at("sqrt(x)", -1))).toBe(true);
  });
  it("1/0 -> Infinity", () => {
    expect(at("1/x", 0)).toBe(Infinity);
  });
  it("ln(negatif) -> NaN", () => {
    expect(Number.isNaN(at("ln(x)", -2))).toBe(true);
  });
});

describe("hatalı ifadeler throw eder", () => {
  it("boş", () => {
    expect(() => compile("")).toThrow();
  });
  it("yarım operatör", () => {
    expect(() => compile("x^")).toThrow();
  });
  it("kapanmayan parantez", () => {
    expect(() => compile("sin(x")).toThrow();
  });
  it("bilinmeyen sembol", () => {
    expect(() => compile("y + 1")).toThrow();
  });
  it("fonksiyon parantezsiz", () => {
    expect(() => compile("sin x")).toThrow();
  });
  it("geçersiz karakter", () => {
    expect(() => compile("x & 2")).toThrow();
  });
});
