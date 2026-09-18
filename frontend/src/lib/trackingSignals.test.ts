// @vitest-environment node
import { describe, expect, it } from "vitest";

import { stopsAheadIncreased, windowWidened } from "./trackingSignals";

describe("stopsAheadIncreased (PDS E8)", () => {
  it("gerçek artışta true", () => {
    expect(stopsAheadIncreased(2, 4)).toBe(true);
  });
  it("azalış/eşitlik false (normal ilerleme)", () => {
    expect(stopsAheadIncreased(4, 2)).toBe(false);
    expect(stopsAheadIncreased(3, 3)).toBe(false);
  });
  it("ilk yükleme (prev yok) false", () => {
    expect(stopsAheadIncreased(null, 5)).toBe(false);
    expect(stopsAheadIncreased(undefined, 5)).toBe(false);
  });
});

describe("windowWidened (PDS §2.2 — pencere yalnız daralır)", () => {
  const a = "2026-07-10T15:00:00Z";
  const b = "2026-07-10T16:00:00Z";
  it("geç biten yeni pencere → genişleme/kayma, uyar", () => {
    expect(windowWidened(a, b, a, "2026-07-10T17:00:00Z")).toBe(true);
  });
  it("daralan pencere → uyarı yok", () => {
    expect(windowWidened(a, b, "2026-07-10T15:20:00Z", "2026-07-10T15:50:00Z")).toBe(
      false,
    );
  });
  it("eksik veri false", () => {
    expect(windowWidened(null, b, a, b)).toBe(false);
    expect(windowWidened(a, b, a, "geçersiz")).toBe(false);
  });
});
