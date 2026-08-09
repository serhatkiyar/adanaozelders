// İP-16 — çalışma ekranı aralık önizlemesi için kısa Türkçe süre biçimi.
// Girdi dakikadır: "1dk", "10dk", "3sa", "4g", "3.2ay", "1.5yıl".

const DAY_MIN = 1440;
const MONTH_DAYS = 30.44; // ortalama ay
const YEAR_DAYS = 365.25;

function trimmed(value: number): string {
  // 3.0 → "3", 3.2 → "3.2"
  const s = value.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function formatIntervalMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) return "<1dk";
  if (minutes < 60) return `${Math.round(minutes)}dk`;
  if (minutes < DAY_MIN) return `${Math.round(minutes / 60)}sa`;
  const days = minutes / DAY_MIN;
  if (days < 31) return `${Math.round(days)}g`;
  const months = days / MONTH_DAYS;
  if (months < 12) return `${trimmed(months)}ay`;
  return `${trimmed(days / YEAR_DAYS)}yıl`;
}
