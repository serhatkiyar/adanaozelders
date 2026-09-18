// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  formatLastSeen,
  formatResponseTime,
  istanbulInputToIso,
  localInputToIso,
} from "@/lib/datetime";

describe("istanbulInputToIso", () => {
  it("Türkiye duvar-saatini sabit +03:00 ile UTC'ye çevirir (tarayıcı tz'inden bağımsız)", () => {
    // 14:00 Türkiye = 11:00 UTC, her zaman.
    expect(istanbulInputToIso("2026-06-25T14:00")).toBe("2026-06-25T11:00:00.000Z");
    expect(istanbulInputToIso("2026-01-10T09:30")).toBe("2026-01-10T06:30:00.000Z");
  });
  it("gün sınırını doğru taşır", () => {
    // 01:00 Türkiye = önceki gün 22:00 UTC.
    expect(istanbulInputToIso("2026-06-25T01:00")).toBe("2026-06-24T22:00:00.000Z");
  });
});

const agoMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe("formatLastSeen", () => {
  it("null -> 'Hiç görülmedi'", () => {
    expect(formatLastSeen(null)).toBe("Hiç görülmedi");
  });
  it("şimdi -> 'az önce'", () => {
    expect(formatLastSeen(new Date().toISOString())).toContain("az önce");
  });
  it("5 dk önce -> 'dk önce'", () => {
    expect(formatLastSeen(agoMin(5))).toContain("dk önce");
  });
  it("3 saat önce -> 'saat önce'", () => {
    expect(formatLastSeen(agoMin(180))).toContain("saat önce");
  });
});

describe("formatResponseTime", () => {
  it("null/negatif/geçersiz -> '—'", () => {
        // 7 Eyl 2026 (ÜK-7): gösterge uzun tireden (—) düz tireye döndü.
    // İddianın anlamı aynı, yalnız beklenen karakter değişti.
    expect(formatResponseTime(null)).toBe("-");
    expect(formatResponseTime(undefined)).toBe("-");
    expect(formatResponseTime(-5)).toBe("-");
    expect(formatResponseTime(Number.NaN)).toBe("-");
  });
  it("dakika aralığı", () => {
    expect(formatResponseTime(300)).toBe("~5 dk");
    // çok kısa süre en az 1 dk gösterir
    expect(formatResponseTime(20)).toBe("~1 dk");
  });
  it("saat aralığı", () => {
    expect(formatResponseTime(2 * 3600)).toBe("~2 saat");
  });
  it("gün aralığı", () => {
    expect(formatResponseTime(3 * 86_400)).toBe("~3 gün");
  });
});

describe("localInputToIso", () => {
  it("UTC ('Z' ekli) ISO üretir", () => {
    expect(localInputToIso("2026-06-01T14:30")).toMatch(/Z$/);
  });
});
