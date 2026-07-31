import { Avatar } from "@/components/Avatar";
import { StarRating } from "@/components/StarRating";
import { useReviewsByTutor } from "@/hooks/useReviews";
import { useModalPanel } from "@/hooks/useModalA11y";
import { formatDateTime } from "@/lib/datetime";

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
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {tutorName} - Değerlendirmeler
          </h2>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-700"
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
                <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700" />
              ))}
            </div>
          ) : !reviews || reviews.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Henüz değerlendirme bulunmuyor.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {reviews.map((review) => {
                const name = review.client_name ?? "Anonim";
                return (
                  <div
                    key={review.id}
                    className="rounded-xl border border-slate-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={name} avatar_url={review.client_avatar_url} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {name}
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">
                            {formatDateTime(review.created_at)}
                          </span>
                        </div>
                        <div className="mt-1">
                          <StarRating value={review.rating} />
                        </div>
                        {review.comment_text && (
                          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                            {review.comment_text}
                          </p>
                        )}
                        {review.tutor_reply && (
                          <div className="mt-3 rounded-xl border-l-2 border-indigo-300 bg-indigo-50/60 px-4 py-3 dark:border-indigo-500/40 dark:bg-indigo-500/10">
                            <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                              Eğitmen yanıtı
                            </p>
                            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                              {review.tutor_reply}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
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
