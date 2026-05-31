import { describe, it, expect } from "vitest";
import { formatLastSeen, localInputToIso } from "@/lib/datetime";

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

describe("localInputToIso", () => {
  it("UTC ('Z' ekli) ISO üretir", () => {
    expect(localInputToIso("2026-06-01T14:30")).toMatch(/Z$/);
  });
});
