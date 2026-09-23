import { YorumYazari } from "@/components/ReviewsSection";
import { StarRating } from "@/components/StarRating";
import { useReviewsByTutor } from "@/hooks/useReviews";
import { useModalPanel } from "@/hooks/useModalA11y";
import { reviewOutToItem } from "@/lib/reviewStats";

interface ReviewListModalProps {
  tutorId: number;
  tutorName: string;
  onClose: () => void;
}

export function ReviewListModal({ tutorId, tutorName, onClose }: ReviewListModalProps) {
  const { data: reviews, isLoading } = useReviewsByTutor(tutorId);
  // Esc + arka plan kaydırma kilidi + ODAK TUZAĞI (eskiden yalnız ilk ikisi vardı).
  const panelRef = useModalPanel({ onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm sm:p-6">
      <div
        ref={panelRef}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 "
        role="dialog"
        aria-modal="true"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 ">
          <h2 className="text-lg font-bold text-slate-900 ">
            {tutorName} - Değerlendirmeler
          </h2>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 "
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100 " />
              ))}
            </div>
          ) : !reviews || reviews.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-slate-500 ">
                Henüz değerlendirme bulunmuyor.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {reviews.map((review) => {
                const item = reviewOutToItem(review);
                return (
                  <div
                    key={review.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 "
                  >
                    <YorumYazari review={item} size="sm" />
                    <div className="mt-2">
                      <StarRating value={review.rating} />
                    </div>
                    {review.comment_text && (
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600 ">
                        {review.comment_text}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
