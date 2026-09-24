import { KART_IZGARASI } from "@/components/kartIzgarasi";
import { useEffect } from "react";
import { Link } from "react-router-dom";

import { TutorCard } from "@/components/TutorCard";
import { useFeaturedTutors } from "@/hooks/useTutorSearch";
import type { FeaturedTutorParams } from "@/api/tutors";
import { ROUTES } from "@/lib/routes";

/**
 * Blokta gösterilebilecek en fazla ilan.
 *
 * Sunucu (`core/promotion_packages.py::SLOT_LIMIT`) zaten bu sınırı uygular;
 * buradaki sayı bilinçli bir İKİNCİ savunmadır. Sınır bir ürün taahhüdüdür
 * ("arama sonuçlarının kaçı reklam olabilir") ve sıralama ölçütleri sayfasında
 * yayımlanır — uca ileride bir `limit` parametresi eklenirse arayüzün sessizce
 * taşmaması gerekir. İki sayı ayrışırsa sunucudaki kazanır: fazlası kesilir.
 */
const MAX_SLOTS = 3;

interface FeaturedTutorBlockProps {
  /** Arama ile AYNI filtreler — reklam, aranan dersle ilgisiz olamaz. */
  params: FeaturedTutorParams;
  /** Yalnız ilk sayfada çizilir; sonraki sayfalarda hiç istenmez. */
  enabled?: boolean;
  showBookmark?: boolean;
  /** Organik listeden düşürülecek id'leri çağırana bildirir. */
  onIds?: (ids: number[]) => void;
}

/**
 * Ücretli öne çıkarma bloğu.
 *
 * Organik sıralama BU BLOKTAN etkilenmez: liste ayrı bir uçtan gelir ve
 * `search_tutors` promosyon tablosuna hiçbir koşulda bakmaz. Blok yalnız
 * eşleşen bir reklam varsa çizilir — boşken başlık da çıkmaz.
 *
 * Etiket ve sıralama kriterleri bağlantısı yasal yükümlülüktür:
 * ücretli yerleşim ayırt edilebilir olmalı ve sıralama ölçütleri
 * erişilebilir biçimde açıklanmalıdır.
 */
export function FeaturedTutorBlock({
  params,
  enabled = true,
  showBookmark = true,
  onIds,
}: FeaturedTutorBlockProps) {
  const { data } = useFeaturedTutors(params, enabled);
  const tutors = (data ?? []).slice(0, MAX_SLOTS);

  // Id bildirimi bir yan etkidir; render sırasında değil commit sonrası.
  const ids = tutors.map((t) => t.id).join(",");
  useEffect(() => {
    onIds?.(ids ? ids.split(",").map(Number) : []);
    // `onIds` her render'da yeni referans olabildiği için bağımlılıkta
    // bilinçli olarak yalnız id dizisi var.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (!enabled || tutors.length === 0) return null;

  return (
    <section aria-label="Reklam" className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold tracking-wide text-slate-500">
          Reklam
        </span>
        <Link
          to={ROUTES.rankingCriteria}
          className="text-xs text-slate-400 underline-offset-2 transition hover:text-slate-600 hover:underline"
        >
          Sıralama nasıl belirleniyor?
        </Link>
      </div>

      <div className={KART_IZGARASI}>
        {tutors.map((tutor) => (
          <TutorCard
            key={tutor.id}
            tutor={tutor}
            featured
            showBookmark={showBookmark}
          />
        ))}
      </div>

      {/* Kutu değil, saç teli çizgi: blok organik listeden ayrılır ama
          sayfaya ikinci bir çerçeve eklemez. */}
      <div className="mt-8 h-px w-full bg-slate-200" />
    </section>
  );
}
