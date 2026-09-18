// @vitest-environment node
import { describe, it, expect } from "vitest";
import { daysUntil, weatherKind, WEATHER_LABEL } from "@/lib/navbarWidget";

describe("daysUntil — sınav geri sayımı", () => {
  it("aynı gün için 0 döner (saat fark etmez)", () => {
    const now = new Date(2026, 5, 20, 23, 30); // 20 Haziran 23:30
    expect(daysUntil("2026-06-20", now)).toBe(0);
  });

  it("gelecekteki tarihe kalan tam günü verir", () => {
    const now = new Date(2026, 5, 4, 9, 0); // 4 Haziran
    expect(daysUntil("2026-06-20", now)).toBe(16);
  });

  it("geçmiş tarih için negatif döner", () => {
    const now = new Date(2026, 5, 21, 0, 0);
    expect(daysUntil("2026-06-20", now)).toBe(-1);
  });
});

describe("weatherKind — WMO kodu eşlemesi", () => {
  it("açık/bulutlu/yağmur/kar/sis/fırtına kategorilerine ayırır", () => {
    expect(weatherKind(0)).toBe("clear");
    expect(weatherKind(3)).toBe("cloud");
    expect(weatherKind(48)).toBe("fog");
    expect(weatherKind(63)).toBe("rain");
    expect(weatherKind(81)).toBe("rain");
    expect(weatherKind(75)).toBe("snow");
    expect(weatherKind(86)).toBe("snow");
    expect(weatherKind(95)).toBe("storm");
  });

  it("her kategori için Türkçe etiket vardır", () => {
    for (const kind of ["clear", "cloud", "rain", "snow", "storm", "fog"] as const) {
      expect(WEATHER_LABEL[kind]).toBeTruthy();
    }
  });
});
