// Alışkanlık ısı haritası için saf yardımcılar. TZ kaymasını önlemek için
// tüm tarih aritmetiği "YYYY-MM-DD" dizgileri üzerinden (UTC) yapılır.

export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  const dt = parseISO(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

/** Haftanın günü: 0=Pazartesi … 6=Pazar. */
export function weekdayMon(s: string): number {
  return (parseISO(s).getUTCDay() + 6) % 7;
}

function mondayOf(s: string): string {
  return addDays(s, -weekdayMon(s));
}

export interface HeatCell {
  date: string;
  count: number;
  future: boolean;
}

/** GitHub tarzı ısı haritası: `weeks` sütun × 7 satır (Pzt→Paz). Son sütun
 * içinde bulunulan haftadır; gelecekteki günler `future: true` ile işaretlenir. */
export function buildHeatmap(
  recent: Record<string, number>,
  weeks: number,
  today: string
): HeatCell[][] {
  const startMonday = addDays(mondayOf(today), -(weeks - 1) * 7);
  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(startMonday, w * 7 + d);
      col.push({ date, count: recent[date] ?? 0, future: date > today });
    }
    cols.push(col);
  }
  return cols;
}

/** Sayaç/hedef oranına göre 0–4 yoğunluk kademesi (renk tonu için). */
export function heatLevel(count: number, target: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  const ratio = count / Math.max(1, target);
  if (ratio >= 1) return 4;
  if (ratio >= 0.66) return 3;
  if (ratio >= 0.33) return 2;
  return 1;
}
