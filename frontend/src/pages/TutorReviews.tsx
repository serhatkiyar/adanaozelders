import { useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { ReviewsSection } from "@/components/ReviewsSection";
import { ReportModal } from "@/components/ReportModal";
import { useMyTutorProfile } from "@/hooks/useTutorProfile";
import {
  useReviewsByTutor,
  useTutorRatingDistribution,
} from "@/hooks/useReviews";
import { getErrorMessage } from "@/lib/errors";
import { ErrorState } from "@/components/admin/ui/PageState";
import { kriterOrtalamalari, reviewOutToItem } from "@/lib/reviewStats";
import { ACIKLAMA, ETIKET } from "@/components/pano/stil";

/**
 * DEĞERLENDİRMELER — eğitmenin ALDIĞI yorumlar (panel şeridi sekmesi).
 *
 * Bu ekran yeni; daha önce eğitmenin yorumlarını göreceği tek yer kendi ilan
 * sayfasıydı (`TutorProfile`), yani öğrencinin gördüğü ekran. Panel şeridi
 * kurulunca kendi yüzeyine çıkarıldı.
 *
 * Öğretmen yanıtı özelliği kaldırıldı (23 Eyl 2026); öğretmen yorumu yalnız
 * görür ve gerekirse şikayet eder. Anonim yorumda yazar kimliği sunucudan hiç
 * gelmez.
 */
export default function TutorReviews() {
  const { data: ilan, isLoading: ilanYukleniyor } = useMyTutorProfile();
  const tutorId = ilan?.id ?? 0;

  const {
    data: reviews,
    isLoading,
    isError,
    error,
    refetch,
  } = useReviewsByTutor(tutorId);
  const { data: dist } = useTutorRatingDistribution(tutorId);

  const [raporHedefi, setRaporHedefi] = useState<{
    id: number;
    label: string;
  } | null>(null);

  const items = (reviews ?? []).map(reviewOutToItem);

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
          <ErrorState
            description={getErrorMessage(error, "Değerlendirmeler yüklenemedi.")}
            onRetry={() => void refetch()}
          />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-20 text-center">
            <p className={ETIKET}>Henüz değerlendirme almadın</p>
            <p className={`mt-2 max-w-md ${ACIKLAMA}`}>
              Tamamlanan her dersten sonra öğrencin puan ve yorum bırakabilir;
              yazdıkları burada görünür.
            </p>
          </div>
        ) : (
          <ReviewsSection
            average={dist?.average}
            count={dist?.count ?? items.length}
            distribution={dist}
            criteria={kriterOrtalamalari(dist)}
            reviews={items}
            // Panelde "tümünü göster" modalı yok: bu sayfanın kendisi tam
            // liste. Sunucu ilk 50 yorumu döner (useReviewsByTutor).
            previewCount={items.length}
            renderItemAction={(item) => (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() =>
                    setRaporHedefi({
                      id: item.id,
                      label: item.anonymous
                        ? "Anonim Öğrenci değerlendirmesi"
                        : `${item.name} kişisinin değerlendirmesi`,
                    })
                  }
                  className="text-xs font-medium text-slate-400 transition hover:text-rose-600"
                >
                  ⚐ Şikayet et
                </button>
              </div>
            )}
          />
        )}
        {raporHedefi && (
          <ReportModal
            targetType="REVIEW"
            targetId={raporHedefi.id}
            targetLabel={raporHedefi.label}
            onClose={() => setRaporHedefi(null)}
          />
        )}
      </div>
    </DashboardShell>
  );
}
