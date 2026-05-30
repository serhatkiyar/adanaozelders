// Backend Decimal alanları (hourly_rate, price, budget_*) JSON'da STRING döner (örn. "250.5").
// Bu yüzden number'a güvenli çevirip tr-TR biçiminde gösteriyoruz.

export function parseMoney(
  value: string | number | null | undefined
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// "₺1.250,50" — sadece tutar.
export function formatTRY(
  value: string | number | null | undefined,
  fallback = "—"
): string {
  const n = parseMoney(value);
  if (n === null) return fallback;
  return `₺${n.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

// "₺250 / saat" — saatlik ücret etiketi.
export function formatRate(
  value: string | number | null | undefined,
  fallback = "Ücret belirtilmemiş"
): string {
  const n = parseMoney(value);
  if (n === null) return fallback;
  return `${formatTRY(n)} / saat`;
}
