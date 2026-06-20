// İnternet hız testi için saf hesaplama yardımcıları (ölçüm api/speedtest.ts'te).

/** Aktarılan bayt + saniyeden Mbps. (bytes*8 bit) / saniye / 1e6. */
export function toMbps(bytes: number, seconds: number): number {
  if (seconds <= 0 || bytes <= 0) return 0;
  return (bytes * 8) / seconds / 1_000_000;
}

/** Sunucu sınırlarıyla (0..10000) uyumlu, 2 ondalığa yuvarlanmış Mbps. */
export function clampMbps(value: number): number {
  const v = Math.max(0, Math.min(10000, value));
  return Math.round(v * 100) / 100;
}

/** Mbps'i okunabilir metne çevirir (ör. "94.2 Mbps"). null → "—". */
export function formatMbps(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(value >= 100 ? 0 : 1)} Mbps`;
}

export function formatPing(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${Math.round(ms)} ms`;
}
