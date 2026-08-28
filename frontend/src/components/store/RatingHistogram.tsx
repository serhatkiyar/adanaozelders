import { StarRating } from "@/components/StarRating";
import type { RatingDistribution } from "@/types";

/**
 * Ürün puan dağılımı: solda büyük ortalama + yıldız + toplam, sağda 5→1 yıldız
 * çubukları (oransal). Backend `fetchProductRatingDistribution` verisini basar.
 */
export function RatingHistogram({ data }: { data: RatingDistribution }) {
  const total = data.count;
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
      {/* Özet */}
      <div className="flex shrink-0 flex-col items-center justify-center sm:w-40">
        <span className="text-4xl font-bold text-slate-900 ">
          {(data.average ?? 0).toFixed(1)}
        </span>
        <StarRating value={data.average ?? 0} />
        <span className="mt-1 text-sm text-slate-500 ">
          {total} değerlendirme
        </span>
      </div>

      {/* Çubuklar */}
      <div className="flex-1 space-y-1.5">
        {[5, 4, 3, 2, 1].map((star) => {
          const n = data.distribution[String(star)] ?? 0;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <div key={star} className="flex items-center gap-3 text-sm">
              <span className="w-6 shrink-0 text-slate-500 ">{star}★</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 ">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-9 shrink-0 text-right text-xs text-slate-400">{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
