// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  formatClock,
  formatDuration,
  phaseDurationMs,
  computeNextPhase,
  todayKey,
  DEFAULT_SETTINGS,
  type TimerSettings,
} from "./deepwork";

describe("formatClock", () => {
  it("milisaniyeyi MM:SS'e çevirir", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(25 * 60 * 1000)).toBe("25:00");
    expect(formatClock(65 * 1000)).toBe("01:05");
  });
  it("negatifi 00:00'a kırpar", () => {
    expect(formatClock(-5000)).toBe("00:00");
  });
});

describe("phaseDurationMs", () => {
  it("moda göre süre döndürür", () => {
    expect(phaseDurationMs("focus", DEFAULT_SETTINGS)).toBe(25 * 60 * 1000);
    expect(phaseDurationMs("short", DEFAULT_SETTINGS)).toBe(5 * 60 * 1000);
    expect(phaseDurationMs("long", DEFAULT_SETTINGS)).toBe(15 * 60 * 1000);
  });
  it("0 dk'da bile en az 1 sn", () => {
    const s: TimerSettings = { ...DEFAULT_SETTINGS, focusMin: 0 };
    expect(phaseDurationMs("focus", s)).toBe(1000);
  });
});

describe("computeNextPhase", () => {
  const s = { ...DEFAULT_SETTINGS, longEvery: 4 };

  it("odaktan sonra kısa molaya geçer ve sayacı artırır", () => {
    expect(computeNextPhase("focus", 0, s)).toEqual({ mode: "short", focusDone: 1 });
    expect(computeNextPhase("focus", 1, s)).toEqual({ mode: "short", focusDone: 2 });
  });

  it("longEvery'nin katında uzun molaya geçer", () => {
    expect(computeNextPhase("focus", 3, s)).toEqual({ mode: "long", focusDone: 4 });
    expect(computeNextPhase("focus", 7, s)).toEqual({ mode: "long", focusDone: 8 });
  });

  it("moladan sonra odağa döner (sayaç korunur)", () => {
    expect(computeNextPhase("short", 2, s)).toEqual({ mode: "focus", focusDone: 2 });
    expect(computeNextPhase("long", 4, s)).toEqual({ mode: "focus", focusDone: 4 });
  });

  it("longEvery=0 ise hep kısa mola (sıfıra bölme yok)", () => {
    const s0 = { ...DEFAULT_SETTINGS, longEvery: 0 };
    expect(computeNextPhase("focus", 3, s0)).toEqual({ mode: "short", focusDone: 4 });
  });
});

describe("todayKey", () => {
  it("YYYY-MM-DD üretir", () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(todayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("formatDuration", () => {
  it("saat/dakika/saniye biçimler", () => {
    expect(formatDuration(0)).toBe("0dk");
    expect(formatDuration(30)).toBe("30sn");
    expect(formatDuration(45 * 60)).toBe("45dk");
    expect(formatDuration(3600 + 5 * 60)).toBe("1s 5dk");
    expect(formatDuration(2 * 3600)).toBe("2s");
  });
});
