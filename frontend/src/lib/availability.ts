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
export function summarize(availability: Availability[]): {
  weekday: number;
  ranges: string;
}[] {
  const byDay = new Map<number, Availability[]>();
  for (const a of availability) {
    if (!byDay.has(a.weekday)) byDay.set(a.weekday, []);
    byDay.get(a.weekday)!.push(a);
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
