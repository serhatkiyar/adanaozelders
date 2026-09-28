// SEO yardımcıları: site sabitleri, kanonik URL üretimi, açıklama kırpma.
// Kanonik base: prod'da `VITE_SITE_URL`; verilmezse çalışma anında origin.

import { isAxiosError } from "axios";

export const SITE_NAME = "Adana Özel Ders";

export const DEFAULT_DESCRIPTION =
  "Adana Özel Ders'te alanında uzman öğretmenlerle TYT, AYT, LGS, KPSS ve daha fazlası için online veya yüz yüze özel ders al.";

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

/**
 * Detay sayfası sorgusunun dizinleme açısından durumu.
 *
 * `noindex` YALNIZ `not_found`ta basılır. Geçici API/ağ/5xx hatasında
 * (`temporary_error`) geçerli bir sayfa, Googlebot'un tam o anki çizimi
 * yüzünden dizinden düşmemeli; o durumda meta hiç basılmaz (uydurulmaz).
 * Veri de hata da yoksa sorgu hiç açılmamıştır (geçersiz id/slug): adres bir
 * kayda çıkmıyor → `not_found`.
 */
export type DetayDurumu = "loading" | "not_found" | "temporary_error" | "success";

/** Sunucu kaydın olmadığını söyledi mi (404/410)? Ağ hatası ve 5xx DEĞİL. */
export function bulunamadiMi(error: unknown): boolean {
  const durum = isAxiosError(error) ? error.response?.status : undefined;
  return durum === 404 || durum === 410;
}

export function detayDurumu(sorgu: {
  isLoading: boolean;
  data: unknown;
  error: unknown;
}): DetayDurumu {
  if (sorgu.isLoading) return "loading";
  if (sorgu.data) return "success";
  if (!sorgu.error) return "not_found";
  return bulunamadiMi(sorgu.error) ? "not_found" : "temporary_error";
}
