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
import { ACIKLAMA, ETIKET } from "@/components/pano/stil";

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
          <div className="space-y-4">
            <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-base leading-6 text-red-700">
            {getErrorMessage(error, "Değerlendirmeler yüklenemedi.")}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-20 text-center">
            <p className={ETIKET}>Henüz değerlendirme almadın</p>
            <p className={`mt-2 max-w-md ${ACIKLAMA}`}>
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
