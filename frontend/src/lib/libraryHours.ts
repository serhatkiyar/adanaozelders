// Kütüphane çalışma saatleri için saf yardımcılar (Vitest'li).
import type { LibraryHours } from "@/types";

// 0=Pazartesi … 6=Pazar (Python date.weekday() ile aynı).
export const WEEKDAY_LABELS = [
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
  "Pazar",
] as const;

export const WEEKDAY_SHORT = [
  "Pzt",
  "Sal",
  "Çar",
  "Per",
  "Cum",
  "Cmt",
  "Paz",
] as const;

/** Gece yarısından itibaren dakikayı "HH:MM"e çevirir (08:30). */
export function minuteToHHMM(minute: number | null | undefined): string {
  if (minute == null) return "";
  const m = Math.max(0, Math.min(1440, minute));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** "HH:MM" (HTML time input) → gece yarısından itibaren dakika. Geçersizse null. */
export function hhmmToMinute(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Tek bir günün okunur saat metni: "08:00 – 22:00" veya "Kapalı". */
export function formatHoursLine(h: LibraryHours): string {
  if (h.is_closed || h.open_minute == null || h.close_minute == null) {
    return "Kapalı";
  }
  return `${minuteToHHMM(h.open_minute)} – ${minuteToHHMM(h.close_minute)}`;
}

/** Pazartesi=0 başlangıçlı, eksik günleri "Kapalı" sayan 7'li dizi döndürür. */
export function normalizeWeek(hours: LibraryHours[]): LibraryHours[] {
  const byDay = new Map<number, LibraryHours>();
  for (const h of hours) byDay.set(h.weekday, h);
  return Array.from({ length: 7 }, (_, weekday) =>
    byDay.get(weekday) ?? { weekday, is_closed: true, open_minute: null, close_minute: null }
  );
}

/** JS Date.getDay() (0=Pazar) → bizim haftamız (0=Pazartesi). */
export function jsDayToWeekday(jsDay: number): number {
  return (jsDay + 6) % 7;
}
