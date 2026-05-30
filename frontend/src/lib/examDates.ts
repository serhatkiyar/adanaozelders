// Yaklaşan sınav tarihleri (örnek/yaklaşık — güncellenebilir). Geri sayım için.
export interface ExamDate {
  name: string;
  date: string; // "YYYY-MM-DD"
}

export const EXAM_DATES: ExamDate[] = [
  { name: "LGS", date: "2026-06-07" },
  { name: "TYT", date: "2026-06-20" },
  { name: "AYT", date: "2026-06-21" },
  { name: "DGS", date: "2026-07-05" },
  { name: "KPSS Lisans", date: "2026-07-12" },
  { name: "ALES", date: "2026-05-31" },
];

export function daysUntil(dateIso: string): number {
  const target = new Date(`${dateIso}T00:00:00`).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / 86_400_000);
}

// Henüz gelmemiş sınavlar, tarihe göre artan.
export function upcomingExams(): (ExamDate & { days: number })[] {
  return EXAM_DATES.map((e) => ({ ...e, days: daysUntil(e.date) }))
    .filter((e) => e.days >= 0)
    .sort((a, b) => a.days - b.days);
}
