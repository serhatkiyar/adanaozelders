import { DashboardShell } from "@/components/DashboardShell";
import { ReviewsSection, type ReviewItem } from "@/components/ReviewsSection";
import { EgitmenYanitAksiyonu } from "@/components/EgitmenYanitAksiyonu";
import { useMyTutorProfile } from "@/hooks/useTutorProfile";
import {
  useReplyToReview,
  useReviewsByTutor,
  useTutorRatingDistribution,
} from "@/hooks/useReviews";
import { getErrorMessage } from "@/lib/errors";
import { ADSIZ_UYE } from "@/lib/roles";

/**
 * DEĞERLENDİRMELER — eğitmenin ALDIĞI yorumlar (panel şeridi sekmesi).
 *
 * Bu ekran yeni; daha önce eğitmenin yorumlarını göreceği tek yer kendi ilan
 * sayfasıydı (`TutorProfile`), yani öğrencinin gördüğü ekran. Yanıt yazmak da
 * oradan yapılıyordu. Panel şeridi kurulunca kendi yüzeyine çıkarıldı.
 *
 * Veri ve yanıt akışı yeniden yazılmadı: `useReviewsByTutor`,
 * `useTutorRatingDistribution`, `useReplyToReview` ve `ReviewsSection` zaten
 * vardı; yanıt düzenleyicisi `EgitmenYanitAksiyonu`'na çıkarılıp iki yüzeyde
 * paylaşıldı.
 */
export default function TutorReviews() {
  const { data: ilan, isLoading: ilanYukleniyor } = useMyTutorProfile();
  const tutorId = ilan?.id ?? 0;

  const {
    data: reviews,
    isLoading,
    isError,
    error,
  } = useReviewsByTutor(tutorId);
  const { data: dist } = useTutorRatingDistribution(tutorId);
  const replyMutation = useReplyToReview(tutorId);

  const items: ReviewItem[] = (reviews ?? []).map((r) => ({
    id: r.id,
    name: r.client_name ?? ADSIZ_UYE,
    avatarUrl: r.client_avatar_url,
    rating: r.rating,
    text: r.comment_text,
    createdAt: r.created_at,
    reply: r.tutor_reply,
  }));

  return (
    <DashboardShell title="Değerlendirmeler" genislik="orta">
      <div className="pb-12">
        {ilanYukleniyor || isLoading ? (
          <div className="space-y-3">
            <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100">
            {getErrorMessage(error, "Değerlendirmeler yüklenemedi.")}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center">
            <p className="text-sm font-medium text-slate-700">
              Henüz değerlendirme almadın
            </p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
              Tamamlanan her dersten sonra öğrencin puan ve yorum bırakabilir;
              yazdıkları burada görünür ve buradan yanıtlarsın.
            </p>
          </div>
        ) : (
          <ReviewsSection
            average={dist?.average}
            count={dist?.count ?? items.length}
            distribution={dist}
            reviews={items}
            // Panelde "tümünü göster" modalı yok: bu sayfanın kendisi tam
            // liste. Sunucu ilk 50 yorumu döner (useReviewsByTutor).
            previewCount={items.length}
            renderItemAction={(item) =>
              item.reply ? null : (
                <EgitmenYanitAksiyonu
                  reviewId={item.id}
                  replyMutation={replyMutation}
                />
              )
            }
          />
        )}
      </div>
    </DashboardShell>
  );
}
