// SEO yardımcıları: site sabitleri, kanonik URL üretimi, açıklama kırpma.
// Kanonik base: prod'da `VITE_SITE_URL`; verilmezse çalışma anında origin.

export const SITE_NAME = "Adana Özel Ders";

export const DEFAULT_DESCRIPTION =
  "Adana Özel Ders — alanında uzman eğitmenlerle TYT, AYT, LGS, KPSS ve daha fazlası için online veya yüz yüze özel ders al.";

/** Site kök URL'i (sonunda `/` olmadan). */
export function siteUrl(): string {
  const env = import.meta.env.VITE_SITE_URL as string | undefined;
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** Göreli path'i mutlak URL'e çevirir; zaten mutlaksa olduğu gibi döner. */
export function absoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return siteUrl();
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = siteUrl();
  return `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** Meta açıklamasını tek satıra indirger ve ~160 karakterde güvenle kırpar. */
export function clampDescription(
  text: string | null | undefined,
  max = 160
): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return DEFAULT_DESCRIPTION;
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
