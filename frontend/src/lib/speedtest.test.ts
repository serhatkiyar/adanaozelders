import { describe, expect, it } from "vitest";
import { clampMbps, formatMbps, formatPing, toMbps } from "@/lib/speedtest";

describe("toMbps", () => {
  it("bayt + saniyeden Mbps hesaplar", () => {
    // 1.000.000 bayt = 8.000.000 bit; 1 sn → 8 Mbps
    expect(toMbps(1_000_000, 1)).toBeCloseTo(8, 5);
    expect(toMbps(8_000_000, 1)).toBeCloseTo(64, 5);
    expect(toMbps(1_000_000, 0.5)).toBeCloseTo(16, 5);
  });

  it("geçersiz girdilerde 0 döner", () => {
    expect(toMbps(0, 1)).toBe(0);
    expect(toMbps(1000, 0)).toBe(0);
    expect(toMbps(1000, -1)).toBe(0);
  });
});

describe("clampMbps", () => {
  it("0..10000 aralığına çeker ve 2 ondalığa yuvarlar", () => {
    expect(clampMbps(-5)).toBe(0);
    expect(clampMbps(99999)).toBe(10000);
    expect(clampMbps(12.3456)).toBe(12.35);
  });
});

describe("format", () => {
  it("formatMbps: >=100 tam, <100 tek ondalık, null → —", () => {
    expect(formatMbps(150)).toBe("150 Mbps");
    expect(formatMbps(12.34)).toBe("12.3 Mbps");
    expect(formatMbps(null)).toBe("—");
  });
  it("formatPing: yuvarlar, null → —", () => {
    expect(formatPing(23.6)).toBe("24 ms");
    expect(formatPing(null)).toBe("—");
  });
});
