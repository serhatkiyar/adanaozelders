// Değerlendirme dağılımı için saf yardımcılar (Airbnb-tarzı 5→1 çubuklar).
import type { ReviewItem } from "@/components/ReviewsSection";
import { formatDate } from "@/lib/datetime";
import type { RatingDistribution, ReviewOut, TutorRatingSummary } from "@/types";

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

/** Anonim değerlendirmenin herkese görünen yazar adı. */
export const ANONIM_OGRENCI = "Anonim Öğrenci";

/**
 * Değerlendirme tarih satırı: "12 Eylül 2026" ya da sonradan düzenlendiyse
 * "12 Eylül 2026 · Düzenlendi 20 Eylül 2026". İkinci tarih yalnız
 * `edited_at`'ten gelir (moderasyon gibi sistem işlemleri onu değiştirmez).
 */
export function degerlendirmeTarihi(
  createdAt: string,
  editedAt?: string | null
): string {
  const olusturma = formatDate(createdAt);
  return editedAt ? `${olusturma} · Düzenlendi ${formatDate(editedAt)}` : olusturma;
}

/** Öğretmen değerlendirmesini `ReviewsSection` öğesine çevirir; anonimse ad
 *  "Anonim Öğrenci" olur ve fotoğraf gösterilmez. */
export function reviewOutToItem(r: ReviewOut): ReviewItem {
  return {
    id: r.id,
    name: r.is_anonymous ? ANONIM_OGRENCI : r.client_name ?? ANONIM_OGRENCI,
    avatarUrl: r.is_anonymous ? null : r.client_avatar_url,
    anonymous: r.is_anonymous,
    rating: r.rating,
    text: r.comment_text,
    createdAt: r.created_at,
    editedAt: r.edited_at,
  };
}

/** Özet satırı için alt kriter ortalamaları; yalnız puan almış kriterler döner. */
export function kriterOrtalamalari(
  ozet?: TutorRatingSummary | null
): { ad: string; ortalama: number }[] {
  if (!ozet) return [];
  const kriterler: [string, number | null | undefined][] = [
    ["Netlik", ozet.clarity_average],
    ["Motivasyon", ozet.motivation_average],
    ["Hazırlık", ozet.preparation_average],
  ];
  return kriterler.flatMap(([ad, ortalama]) =>
    ortalama == null ? [] : [{ ad, ortalama }]
  );
}
