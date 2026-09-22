import type { Availability } from "@/types";

// 0=Pazartesi … 6=Pazar (backend weekday ile aynı).
export const WEEKDAYS_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
export const WEEKDAYS_LONG = [
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
  "Pazar",
];

export function minToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function hhmmToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
}

// JS Date.getDay() (0=Pazar) -> bizim weekday (0=Pazartesi).
export function jsDayToWeekday(jsDay: number): number {
  return (jsDay + 6) % 7;
}

// "YYYY-MM-DD" -> weekday (yerel), tz kaymasından kaçınmak için parçalardan kurar.
export function weekdayOfDateStr(dateStr: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return jsDayToWeekday(new Date(y, mo - 1, d).getDay());
}

// Aynı güne ait pencereleri "18:00–22:00" gibi birleştirip etiketler döndürür.
// Yalnız müsaitlik OLAN günleri döndürür (sıralı).
export function summarize(availability: Availability[]): {
  weekday: number;
  ranges: string;
}[] {
  const byDay = new Map<number, Availability[]>();
  for (const a of availability) {
    const day = byDay.get(a.weekday);
    if (day) {
      day.push(a);
      continue;
    }
    byDay.set(a.weekday, [a]);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekday, list]) => ({
      weekday,
      ranges: list
        .sort((x, y) => x.start_minute - y.start_minute)
        .map((r) => `${minToHHMM(r.start_minute)}–${minToHHMM(r.end_minute)}`)
        .join(", "),
    }));
}

// Wyzant tarzı haftalık çizelge: 7 günün TAMAMI (Pzt..Paz), müsait olmayan
// gün için ranges=null. Profilde tablo olarak gösterilir.
export function weeklySchedule(availability: Availability[]): {
  weekday: number;
  ranges: string | null;
}[] {
  const byDay = new Map(summarize(availability).map((s) => [s.weekday, s.ranges]));
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    ranges: byDay.get(weekday) ?? null,
  }));
}

/**
 * Haftalık şablon → FullCalendar `businessHours` (takvim zemini).
 *
 * FullCalendar'ın `daysOfWeek` alanı JS düzenindedir (0=Pazar); bizim
 * `weekday` 0=Pazartesi. Tip bilerek yerel tanımlı: bu dosya takvim
 * paketini import etmez, FullCalendar yalnız takvim sayfasının chunk'ında kalır.
 */
export function toBusinessHours(
  availability: Availability[] | null | undefined
): { daysOfWeek: number[]; startTime: string; endTime: string }[] {
  return (availability ?? []).map((a) => ({
    daysOfWeek: [(a.weekday + 1) % 7],
    startTime: minToHHMM(a.start_minute),
    endTime: minToHHMM(a.end_minute),
  }));
}
