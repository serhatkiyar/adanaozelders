import { ReactNode, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { StarRating } from "@/components/StarRating";
import { formatDate } from "@/lib/datetime";
import { toDistributionRows } from "@/lib/reviewStats";
import type { RatingDistribution } from "@/types";

/** Eğitmen ve kütüphane değerlendirmeleri için ortak, normalize edilmiş öğe. */
export interface ReviewItem {
  id: number;
  name: string;
  avatarUrl?: string | null;
  rating: number;
  text?: string | null;
  createdAt: string;
  /** Eğitmen yanıtı (varsa). */
  reply?: string | null;
  /** Kütüphane: doğrulanmış ziyaretçi. */
  verified?: boolean;
}

interface ReviewsSectionProps {
  title?: string;
  average?: number | null;
  count: number;
  distribution?: RatingDistribution | null;
  /** Zaten yüklü (ilk sayfa) değerlendirmeler. */
  reviews: ReviewItem[];
  /** Gömük gösterilecek kart sayısı (varsayılan 6). */
  previewCount?: number;
  /** CLIENT değerlendirme formu (opsiyonel). */
  form?: ReactNode;
  /** "Tümünü göster" — taşan değerlendirmeleri görüntüler (genelde modal). */
  onShowAll?: () => void;
  /** Her kartın altına ek aksiyon (ör. eğitmen yanıtı düzenleyici). */
  renderItemAction?: (review: ReviewItem) => ReactNode;
}

// Airbnb-tarzı gömük değerlendirme bölümü: özet + 5→1 dağılım + yorum ızgarası.
// Sakin/nötr palet (renk = aksiyon değil), saç-teli ayraç, bol boşluk.
export function ReviewsSection({
  title = "Değerlendirmeler",
  average,
  count,
  distribution,
  reviews,
  previewCount = 6,
  form,
  onShowAll,
  renderItemAction,
}: ReviewsSectionProps) {
  const rows = toDistributionRows(distribution);
  const preview = reviews.slice(0, previewCount);
  const hasMore = count > preview.length;

  return (
    <section>
      {/* Özet başlık */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900 ">
          <svg viewBox="0 0 20 20" className="h-6 w-6 text-amber-400" fill="currentColor" aria-hidden>
            <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
          </svg>
          {count > 0 && average != null ? average.toFixed(1) : "-"}
        </h2>
        <span className="text-base text-slate-500 ">
          {count > 0
            ? `· ${count} değerlendirme`
            : "· Henüz değerlendirme yok"}
        </span>
      </div>

      {/* Dağılım + yorum formu */}
      {(count > 0 || form) && (
        <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,18rem)_1fr] md:gap-12">
          {count > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700 ">
                Genel puan
              </p>
              <ul className="space-y-1.5">
                {rows.map((row) => (
                  <li key={row.star} className="flex items-center gap-3">
                    <span className="w-3 shrink-0 text-right text-xs tabular-nums text-slate-500 ">
                      {row.star}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 ">
                      <div
                        className="h-full rounded-full bg-slate-800 "
                        style={{ width: `${row.pct}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {form && <div className="md:pt-1">{form}</div>}
        </div>
      )}

      {/* Yorum kartları */}
      {preview.length > 0 && (
        <div className="mt-10 grid gap-x-12 gap-y-8 sm:grid-cols-2">
          {preview.map((r) => (
            <ReviewCard key={r.id} review={r} action={renderItemAction?.(r)} />
          ))}
        </div>
      )}

      {/* Tümünü göster */}
      {hasMore && onShowAll && (
        <button
          type="button"
          onClick={onShowAll}
          className="mt-10 rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 "
        >
          {count} değerlendirmenin tümünü göster
        </button>
      )}

      {/* title yalnızca a11y/SEO için gizli başlık olarak da kullanılabilir */}
      <span className="sr-only">{title}</span>
    </section>
  );
}

// Tek yorum kartı: avatar + ad + tarih, yıldız, 4 satıra kırpılan metin
// ("Daha fazlasını göster" ile açılır) ve varsa eğitmen yanıtı.
function ReviewCard({
  review,
  action,
}: {
  review: ReviewItem;
  action?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = review.text?.trim();
  const long = (text?.length ?? 0) > 240;

  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar name={review.name} avatar_url={review.avatarUrl} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 ">
            {review.name}
          </p>
          <p className="text-xs text-slate-400 ">
            {formatDate(review.createdAt)}
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <StarRating value={review.rating} />
        {review.verified && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 ">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 0 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z"
                clipRule="evenodd"
              />
            </svg>
            Doğrulanmış
          </span>
        )}
      </div>

      {text && (
        <>
          <p
            className={`mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600 ${
              expanded ? "" : "line-clamp-4"
            }`}
          >
            {text}
          </p>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-sm font-semibold text-slate-900 underline underline-offset-2 "
            >
              {expanded ? "Daha az göster" : "Daha fazlasını göster"}
            </button>
          )}
        </>
      )}

      {review.reply && (
        <div className="mt-3 rounded-xl border-l-2 border-slate-300 bg-slate-50 px-4 py-3 ">
          <p className="text-xs font-semibold text-slate-700 ">
            Eğitmen yanıtı
          </p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600 ">
            {review.reply}
          </p>
        </div>
      )}

      {action}
    </div>
  );
}
