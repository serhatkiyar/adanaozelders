import { describe, expect, it } from "vitest";
import {
  summarize,
  weeklySchedule,
  minToHHMM,
  hhmmToMin,
  toBusinessHours,
} from "@/lib/availability";
import type { Availability } from "@/types";

const win = (weekday: number, start_minute: number, end_minute: number): Availability => ({
  weekday,
  start_minute,
  end_minute,
});

describe("minToHHMM / hhmmToMin", () => {
  it("dakikayı HH:mm'ye çevirir (sıfır dolgulu)", () => {
    expect(minToHHMM(0)).toBe("00:00");
    expect(minToHHMM(1080)).toBe("18:00");
    expect(minToHHMM(545)).toBe("09:05");
  });
  it("ters dönüşüm tutarlı", () => {
    expect(hhmmToMin("18:00")).toBe(1080);
    expect(hhmmToMin("09:05")).toBe(545);
  });
});

describe("summarize", () => {
  it("yalnız müsait günleri sıralı döndürür, pencereleri saate göre birleştirir", () => {
    const av = [win(2, 900, 1020), win(0, 1080, 1200), win(0, 540, 600)];
    const out = summarize(av);
    expect(out.map((s) => s.weekday)).toEqual([0, 2]);
    // 0. gün: erken pencere önce
    expect(out[0].ranges).toBe("09:00–10:00, 18:00–20:00");
    expect(out[1].ranges).toBe("15:00–17:00");
  });

  it("boş girişte boş dizi", () => {
    expect(summarize([])).toEqual([]);
  });
});

describe("weeklySchedule", () => {
  it("her zaman 7 gün döndürür (Pzt..Paz), boş günde ranges=null", () => {
    const out = weeklySchedule([win(0, 1080, 1200), win(5, 600, 720)]);
    expect(out).toHaveLength(7);
    expect(out.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(out[0].ranges).toBe("18:00–20:00");
    expect(out[1].ranges).toBeNull();
    expect(out[5].ranges).toBe("10:00–12:00");
    expect(out[6].ranges).toBeNull();
  });

  it("boş müsaitlikte 7 günün hepsi null", () => {
    const out = weeklySchedule([]);
    expect(out).toHaveLength(7);
    expect(out.every((d) => d.ranges === null)).toBe(true);
  });
});

describe("toBusinessHours", () => {
  it("Pazartesi=0 düzenini FullCalendar'ın Pazar=0 düzenine çevirir", () => {
    expect(toBusinessHours([win(0, 1080, 1200), win(6, 540, 1440)])).toEqual([
      { daysOfWeek: [1], startTime: "18:00", endTime: "20:00" },
      { daysOfWeek: [0], startTime: "09:00", endTime: "24:00" },
    ]);
  });
});
