import { Icon } from "@/components/AppIcon";
import { Modal } from "@/components/ui/Modal";
import {
  BuyukPuan,
  KriterKutulari,
  YorumYazari,
} from "@/components/ReviewsSection";
import { StarRating } from "@/components/StarRating";
import { useReviewsByTutor, useTutorRatingDistribution } from "@/hooks/useReviews";
import {
  kriterOrtalamalari,
  reviewOutToItem,
  toDistributionRows,
} from "@/lib/reviewStats";

interface ReviewListModalProps {
  tutorId: number;
  tutorName: string;
  onClose: () => void;
}

const BASLIK = "Öğrencilerim hakkımda ne diyor?";

/**
 * "Tümünü göster" penceresi (Preply düzeni): büyük puan + 5→1 dağılım (adetli),
 * alt kriter kutucukları, ardından çizgiyle ayrılmış tam yorum listesi.
 * Profil ve pencere aynı sorguları paylaşır (React Query önbelleği).
 */
export function ReviewListModal({ tutorId, tutorName, onClose }: ReviewListModalProps) {
  const { data: reviews, isLoading } = useReviewsByTutor(tutorId);
  const { data: ozet } = useTutorRatingDistribution(tutorId);
  const adet = ozet?.count ?? reviews?.length ?? 0;
  const satirlar = toDistributionRows(ozet);
  const kriterler = kriterOrtalamalari(ozet);

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={`${tutorName} için değerlendirmeler`}
      hideCloseButton
      panelClassName="max-h-[92vh] w-full max-w-[840px] overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-lg sm:p-8"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{BASLIK}</h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus"
        >
          <span className="sr-only">Kapat</span>
          <Icon name="dismiss" className="h-5 w-5" />
        </button>
      </div>

      {adet > 0 && ozet?.average != null && (
        <div className="mt-5 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-10">
          <div>
            <BuyukPuan puan={ozet.average} />
            <p className="mt-2 text-sm text-slate-500">{adet} değerlendirme</p>
          </div>
          <ul className="space-y-1.5" aria-label="Puan dağılımı">
            {satirlar.map((s) => (
              <li key={s.star} className="flex items-center gap-3 text-sm text-slate-900">
                <span className="w-3 shrink-0 text-right tabular-nums">{s.star}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full border border-slate-900 bg-white">
                  <span className="block h-full bg-slate-900" style={{ width: `${s.pct}%` }} />
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-slate-500">
                  ({s.count})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {kriterler.length > 0 && (
        <div className="mt-6">
          <KriterKutulari kriterler={kriterler} />
        </div>
      )}

      <h3 className="mt-8 text-xl font-bold text-slate-900">{adet} değerlendirme</h3>

      {isLoading ? (
        <div className="mt-4 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : !reviews || reviews.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Henüz değerlendirme yok.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-200">
          {reviews.map((review) => (
            <li key={review.id} className="py-5">
              <YorumYazari review={reviewOutToItem(review)} size="md" />
              <div className="mt-3">
                <StarRating value={review.rating} size={18} />
              </div>
              {review.comment_text && (
                <p className="mt-2 whitespace-pre-line text-base leading-relaxed text-slate-800">
                  {review.comment_text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
