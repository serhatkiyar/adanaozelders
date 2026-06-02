import { describe, expect, it } from "vitest";
import { addDays, buildHeatmap, heatLevel, todayISO, weekdayMon } from "./habit";

describe("habit date helpers", () => {
  it("todayISO formats local date as YYYY-MM-DD", () => {
    // 2 Haziran 2026, öğlen — TZ kaymasına dayanıklı olsun diye saat 12.
    expect(todayISO(new Date(2026, 5, 2, 12, 0))).toBe("2026-06-02");
  });

  it("addDays handles month/year rollover", () => {
    expect(addDays("2026-06-02", 1)).toBe("2026-06-03");
    expect(addDays("2026-06-02", -1)).toBe("2026-06-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("weekdayMon: Monday=0 … Sunday=6", () => {
    expect(weekdayMon("2026-06-01")).toBe(0); // Pazartesi
    expect(weekdayMon("2026-06-02")).toBe(1); // Salı
    expect(weekdayMon("2026-06-07")).toBe(6); // Pazar
  });
});

describe("buildHeatmap", () => {
  const today = "2026-06-02"; // Salı
  const grid = buildHeatmap({ "2026-06-01": 1, "2026-06-02": 3 }, 4, today);

  it("returns `weeks` columns of 7 days", () => {
    expect(grid).toHaveLength(4);
    expect(grid.every((c) => c.length === 7)).toBe(true);
  });

  it("last column is the current week, starting Monday", () => {
    const lastWeek = grid[3];
    expect(lastWeek[0].date).toBe("2026-06-01"); // Pazartesi
    expect(lastWeek[0].count).toBe(1);
    expect(lastWeek[1].date).toBe("2026-06-02"); // bugün
    expect(lastWeek[1].count).toBe(3);
  });

  it("flags days after today as future", () => {
    const lastWeek = grid[3];
    expect(lastWeek[1].future).toBe(false); // bugün
    expect(lastWeek[2].future).toBe(true); // yarın
  });
});

describe("heatLevel", () => {
  it("maps count/target ratio to 0-4", () => {
    expect(heatLevel(0, 3)).toBe(0);
    expect(heatLevel(1, 3)).toBe(2);
    expect(heatLevel(2, 3)).toBe(3);
    expect(heatLevel(3, 3)).toBe(4);
    expect(heatLevel(5, 3)).toBe(4);
  });
});
