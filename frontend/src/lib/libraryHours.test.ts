import { describe, expect, it } from "vitest";
import {
  formatHoursLine,
  jsDayToWeekday,
  minuteToHHMM,
  normalizeWeek,
} from "./libraryHours";
import type { LibraryHours } from "@/types";

describe("minuteToHHMM", () => {
  it("formats minutes from midnight", () => {
    expect(minuteToHHMM(0)).toBe("00:00");
    expect(minuteToHHMM(510)).toBe("08:30");
    expect(minuteToHHMM(1320)).toBe("22:00");
  });
  it("returns empty for null", () => {
    expect(minuteToHHMM(null)).toBe("");
    expect(minuteToHHMM(undefined)).toBe("");
  });
});

describe("formatHoursLine", () => {
  it("renders open range", () => {
    expect(
      formatHoursLine({ weekday: 0, is_closed: false, open_minute: 480, close_minute: 1320 })
    ).toBe("08:00 – 22:00");
  });
  it("renders Kapalı when closed or missing", () => {
    expect(formatHoursLine({ weekday: 0, is_closed: true })).toBe("Kapalı");
    expect(
      formatHoursLine({ weekday: 0, is_closed: false, open_minute: null, close_minute: null })
    ).toBe("Kapalı");
  });
});

describe("normalizeWeek", () => {
  it("fills missing days as closed, ordered Mon..Sun", () => {
    const input: LibraryHours[] = [
      { weekday: 2, is_closed: false, open_minute: 540, close_minute: 1080 },
    ];
    const week = normalizeWeek(input);
    expect(week).toHaveLength(7);
    expect(week[0].is_closed).toBe(true);
    expect(week[2].open_minute).toBe(540);
    expect(week.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("jsDayToWeekday", () => {
  it("maps JS Sunday(0) to 6 and Monday(1) to 0", () => {
    expect(jsDayToWeekday(0)).toBe(6);
    expect(jsDayToWeekday(1)).toBe(0);
    expect(jsDayToWeekday(6)).toBe(5);
  });
});
