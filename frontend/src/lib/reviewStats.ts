// Değerlendirme dağılımı için saf yardımcılar (Airbnb-tarzı 5→1 çubuklar).
import type { RatingDistribution } from "@/types";

export interface DistributionRow {
  /** Yıldız (5'ten 1'e). */
  star: number;
  count: number;
  /** Toplam içindeki yüzde (0..100); toplam 0 ise 0. */
  pct: number;
}

/**
 * `RatingDistribution`'ı 5→1 sıralı satırlara çevirir (her yıldız için adet +
 * yüzde). Eksik/boş girdide tüm satırlar 0 döner.
 */
export function toDistributionRows(
  dist?: RatingDistribution | null
): DistributionRow[] {
  const map = dist?.distribution ?? {};
  const rows = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: Number(map[String(star)] ?? 0) || 0,
  }));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return rows.map((r) => ({
    ...r,
    pct: total > 0 ? (r.count / total) * 100 : 0,
  }));
}
