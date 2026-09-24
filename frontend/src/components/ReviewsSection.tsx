import { ReactNode, useState } from "react";
import { Icon, type IconName } from "@/components/AppIcon";
import { Avatar } from "@/components/Avatar";
import { StarRating } from "@/components/StarRating";
import { degerlendirmeTarihi, toDistributionRows } from "@/lib/reviewStats";
import type { RatingDistribution } from "@/types";

/** Eğitmen ve kütüphane değerlendirmeleri için ortak, normalize edilmiş öğe. */
export interface ReviewItem {
  id: number;
  name: string;
  avatarUrl?: string | null;
  rating: number;
  text?: string | null;
  createdAt: string;
  /** Öğrenci içeriği düzenlediyse "Düzenlendi" tarihi. */
  editedAt?: string | null;
  /** Anonim: fotoğraf yerine nötr yer tutucu gösterilir. */
  anonymous?: boolean;
  /** Kütüphane: doğrulanmış ziyaretçi. */
  verified?: boolean;
}

interface ReviewsSectionProps {
  title?: string;
  average?: number | null;
  count: number;
  distribution?: RatingDistribution | null;
  /** Alt kriter ortalamaları (yalnız puan almış olanlar), özetin altında tek satır. */
  criteria?: { ad: string; ortalama: number }[];
  /** Zaten yüklü (ilk sayfa) değerlendirmeler. */
  reviews: ReviewItem[];
  /** Gömük gösterilecek kart sayısı (varsayılan 6). */
  previewCount?: number;
  /** CLIENT değerlendirme formu (opsiyonel). */
  form?: ReactNode;
  /** "Tümünü göster" — taşan değerlendirmeleri görüntüler (genelde modal). */
  onShowAll?: () => void;
  /** Her kartın altına ek aksiyon (ör. şikayet et). */
  renderItemAction?: (review: ReviewItem) => ReactNode;
  /** Verilirse ve hiç değerlendirme yoksa Preply deseni: görünür başlık
   *  (`title`) + çerçeveli kutuda bu metin (ör. "Dilan için değerlendirme yok"). */
  bosMetin?: string;
  /** Preply öğretmen profili düzeni: görünür başlık (`title`), büyük puan +
   *  rozet ve "N öğrenci değerlendirmesine göre". Dağılım çubukları burada
   *  değil "tümünü göster" penceresindedir (distribution verilmez). */
  baslikGoster?: boolean;
}

// Airbnb-tarzı gömük değerlendirme bölümü: özet + 5→1 dağılım + yorum ızgarası.
// Sakin/nötr palet (renk = aksiyon değil), saç-teli ayraç, bol boşluk.
export function ReviewsSection({
  title = "Değerlendirmeler",
  average,
  count,
  distribution,
  criteria = [],
  reviews,
  previewCount = 6,
  form,
  onShowAll,
  renderItemAction,
  bosMetin,
  baslikGoster = false,
}: ReviewsSectionProps) {
  if (count === 0 && bosMetin) {
    return (
      <section>
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        <div className="mt-4 rounded-lg border border-slate-200 px-6 py-7 text-center text-base text-slate-900">
          {bosMetin}
        </div>
      </section>
    );
  }

  const rows = toDistributionRows(distribution);
  const preview = reviews.slice(0, previewCount);
  const hasMore = count > preview.length;

  return (
    <section>
      {baslikGoster ? (
        <>
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          {count > 0 && average != null && (
            <>
              <BuyukPuan puan={average} className="mt-4" />
              <p className="mt-1 text-sm text-slate-500">
                {count} öğrenci değerlendirmesine göre
              </p>
            </>
          )}
        </>
      ) : (
      /* Özet başlık (kütüphane, öğretmen paneli) */
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
      )}
      {count > 0 && criteria.length > 0 && (
        <p className="mt-2 text-sm text-slate-600 ">
          {criteria.map((k, i) => (
            <span key={k.ad}>
              {i > 0 && <span className="text-slate-300"> · </span>}
              {k.ad}{" "}
              <span className="font-semibold tabular-nums text-slate-900">
                {k.ortalama.toFixed(1)}
              </span>
            </span>
          ))}
        </p>
      )}

      {/* Dağılım + yorum formu */}
      {((count > 0 && distribution) || form) && (
        <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,18rem)_1fr] md:gap-12">
          {count > 0 && distribution && (
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
        <div
          className={`${baslikGoster ? "mt-6" : "mt-10"} grid gap-x-12 gap-y-8 sm:grid-cols-2`}
        >
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
// ("Daha fazlasını göster" ile açılır). Alt kriterler kartta tekrarlanmaz.
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
      <YorumYazari review={review} size="md" />

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

      {action}
    </div>
  );
}

/** Yorum kartı başlığı: avatar (anonimse nötr yer tutucu) + ad + tarih satırı.
 *  Profil ızgarası ve "tümünü göster" penceresi aynı kuralı kullanır. */
export function YorumYazari({
  review,
  size,
}: {
  review: Pick<ReviewItem, "name" | "avatarUrl" | "anonymous" | "createdAt" | "editedAt">;
  size: "sm" | "md";
}) {
  return (
    <div className="flex items-center gap-3">
      {review.anonymous ? (
        <span
          aria-hidden
          className={`flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 ${
            size === "md" ? "h-11 w-11" : "h-9 w-9"
          }`}
        >
          <svg viewBox="0 0 20 20" className="h-1/2 w-1/2" fill="currentColor">
            <path d="M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0H3z" />
          </svg>
        </span>
      ) : (
        <Avatar name={review.name} avatar_url={review.avatarUrl} size={size} />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900 ">
          {review.name}
        </p>
        <p className="text-xs text-slate-400 ">
          {degerlendirmeTarihi(review.createdAt, review.editedAt)}
        </p>
      </div>
    </div>
  );
}

/** Büyük ortalama puan + yıldız rozeti (Preply "5 ⭐" düzeni). Profil
 *  bölümü ve "tümünü göster" penceresi aynı görünümü kullanır. */
export function BuyukPuan({ puan, className = "" }: { puan: number; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <span className="text-5xl font-bold leading-none tracking-tight text-slate-900 tabular-nums">
        {puan.toFixed(1)}
      </span>
      <span
        aria-hidden
        className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 ring-1 ring-amber-300"
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5 text-amber-500" fill="currentColor">
          <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
        </svg>
      </span>
    </div>
  );
}

/** Kriter ikonları — uygulama ikon seti (Fluent, AppIcon). */
const KRITER_IKONU: Record<string, IconName> = {
  Netlik: "commentQuote",
  Motivasyon: "emoji",
  Hazırlık: "edit",
};

/** Alt kriter kutucukları (Preply "Ders puanı"): puan + ad + ikon. Yalnız
 *  puan almış kriterler gelir (bkz. `kriterOrtalamalari`). */
export function KriterKutulari({ kriterler }: { kriterler: { ad: string; ortalama: number }[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {kriterler.map((k) => {
        const ikon = KRITER_IKONU[k.ad];
        return (
          <li key={k.ad} className="rounded-lg bg-slate-100 p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="text-lg font-bold leading-6 text-slate-900 tabular-nums">
                {k.ortalama.toFixed(1)}
              </span>
              {ikon && <Icon name={ikon} className="h-6 w-6 text-slate-800" />}
            </div>
            <p className="mt-2 text-base text-slate-900">{k.ad}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** "Ders puanı" bölümü — öğretmen profilinde değerlendirmelerin üstünde. */
export function DersPuani({ kriterler }: { kriterler: { ad: string; ortalama: number }[] }) {
  if (kriterler.length === 0) return null;
  return (
    <section>
      <h2 className="text-xl font-bold text-slate-900">Ders puanı</h2>
      <div className="mt-4">
        <KriterKutulari kriterler={kriterler} />
      </div>
    </section>
  );
}
