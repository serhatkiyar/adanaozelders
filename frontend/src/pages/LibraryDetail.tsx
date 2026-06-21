import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { PublicShell } from "@/components/PublicShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { LibrariesMap } from "@/components/LibrariesMap";
import { ExamSessionsSection } from "@/components/ExamSessionsSection";
import { LibrarySpeedTestSection } from "@/components/LibrarySpeedTestSection";
import { LibraryReservationModal } from "@/components/LibraryReservationModal";
import { StarRating } from "@/components/StarRating";
import { LibraryBookmarkButton } from "@/components/LibraryBookmarkButton";
import { ShareButton } from "@/components/ShareButton";
import { Seo } from "@/components/Seo";
import { ReviewsSection, type ReviewItem } from "@/components/ReviewsSection";
import {
  useCreateLibraryReview,
  useLibraryDetail,
  useLibraryRatingDistribution,
  useLibraryReviews,
} from "@/hooks/useLibraries";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";
import { getErrorMessage } from "@/lib/errors";
import { AmenityTagGrid } from "@/components/AmenityTagGrid";
import {
  WEEKDAY_LABELS,
  formatHoursLine,
  jsDayToWeekday,
  normalizeWeek,
} from "@/lib/libraryHours";
import { ROUTES } from "@/lib/routes";
import { regionLabel } from "@/lib/region";
import { PinIcon } from "@/components/PinIcon";
import { ROLE_IDS } from "@/types";
import type {
  LibraryDetailOut,
  LibraryImageOut,
  LibraryReviewOut,
} from "@/types";

/** Google Haritalar linki: place_id varsa işletmenin gerçek profil sayfasını açar;
 * yoksa koordinat/adresle konumu gösterir (eski davranış). */
function mapViewUrl(lib: {
  location_lat?: number | null;
  location_lng?: number | null;
  location_text?: string | null;
  google_place_id?: string | null;
  name: string;
}): string | null {
  const base = "https://www.google.com/maps/search/?api=1&query=";
  if (lib.google_place_id) {
    // query yine de zorunlu; ad'ı veririz, query_place_id tam profile sabitler.
    return `${base}${encodeURIComponent(lib.name)}&query_place_id=${lib.google_place_id}`;
  }
  if (lib.location_lat != null && lib.location_lng != null) {
    return `${base}${lib.location_lat},${lib.location_lng}`;
  }
  const text = lib.location_text || lib.name;
  return text ? `${base}${encodeURIComponent(text)}` : null;
}

/* ── Küçük satır-içi ikonlar (premium ince çizgi) ── */
const ClockIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className} aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 2" />
  </svg>
);
const PhoneIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
  </svg>
);

/** Bölüm başlığı — küçük, harf-aralıklı, büyük harf. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
      {children}
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons@latest/iconfont/tabler-icons.css" />
    </h2>
  );
}

const cardCls =
  "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700";

export default function LibraryDetail() {
  const { slug } = useParams<{ slug: string }>();
  const token = useAuthStore((s) => s.token);
  const { data: currentUser } = useCurrentUser();
  const { data: lib, isLoading, isError, error } = useLibraryDetail(slug);
  const { data: reviews } = useLibraryReviews(lib?.id);
  const { data: ratingDist } = useLibraryRatingDistribution(lib?.id);

  const isClient = currentUser?.role_id === ROLE_IDS.CLIENT;
  const isTutor = currentUser?.role_id === ROLE_IDS.TUTOR;
  // Öğrenci ve eğitmen kütüphaneyle mesajlaşabilir (açık).
  const canMessage = isClient || isTutor;
  const navItems = isTutor ? TUTOR_NAV : isClient ? STUDENT_NAV : undefined;

  const todayWeekday = jsDayToWeekday(new Date().getDay());
  const [showReviews, setShowReviews] = useState(false);
  const [showReserve, setShowReserve] = useState(false);

  const content = (() => {
    if (isLoading) {
      return (
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="h-64 animate-pulse rounded-3xl bg-slate-100 dark:bg-slate-800" />
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            <div className="h-72 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800 lg:col-span-2" />
          </div>
        </div>
      );
    }
    if (isError || !lib) {
      return (
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {getErrorMessage(error, "Kütüphane bulunamadı.")}
          </div>
          <Link
            to={ROUTES.libraries}
            className="mt-4 inline-block text-sm font-semibold text-indigo-600 hover:underline"
          >
            ← Tüm kütüphaneler
          </Link>
        </div>
      );
    }

    const week = normalizeWeek(lib.hours);
    const today = week.find((h) => h.weekday === todayWeekday);
    const avgLabel = lib.rating_average != null ? lib.rating_average.toFixed(1) : "Yeni";
    const region = regionLabel(lib.city, lib.district, lib.location_text);

    return (
      <>
        <div className="mx-auto max-w-6xl space-y-5">
          <Seo
            title={lib.name}
            description={
              lib.description ??
              `${lib.name} — çalışma kütüphanesi. Konum, çalışma saatleri ve değerlendirmeler.`
            }
          />

          <Link
            to={ROUTES.libraries}
            className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
          >
            ← Tüm kütüphaneler
          </Link>

          {/* ── Hero (orijinal tasarım — dokunulmadı) ── */}
          <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
            <div className="relative h-48 w-full bg-gradient-to-br from-indigo-100 to-violet-100 sm:h-60 dark:from-slate-700 dark:to-slate-800">
              {lib.cover_url ? (
                <img src={lib.cover_url} alt={lib.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-6xl">📚</div>
              )}
              {lib.open_now != null && (
                <span
                  className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-semibold text-white shadow ${
                    lib.open_now ? "bg-emerald-500" : "bg-rose-500"
                  }`}
                >
                  {lib.open_now ? "Şu an açık" : "Şu an kapalı"}
                </span>
              )}
              <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
                <ShareButton title={lib.name} heading="Kütüphaneyi paylaş" size="md" overlay />
                <LibraryBookmarkButton libraryId={lib.id} size="md" />
              </div>
            </div>
            <div className="p-5 sm:p-6">
              {lib.logo_url && (
                <img
                  src={lib.logo_url}
                  alt={`${lib.name} logosu`}
                  className="relative z-10 -mt-16 mb-3 h-20 w-20 rounded-full bg-white object-cover shadow-lg ring-4 ring-white dark:bg-slate-800 dark:ring-slate-800"
                />
              )}
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{lib.name}</h1>
              {region && (
                <p className="mt-1 flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                  <PinIcon className="h-4 w-4 shrink-0" />
                  {region}
                </p>
              )}
              {/* Ortalama puan — tıklanınca değerlendirmeler modal'da açılır */}
              <button
                type="button"
                onClick={() => setShowReviews(true)}
                className="group mt-2 inline-flex items-center gap-1.5 rounded-lg py-1 text-left"
              >
                <StarRating value={lib.rating_average} />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {avgLabel}
                </span>
                <span className="text-xs text-slate-400 underline-offset-2 group-hover:text-indigo-600 group-hover:underline dark:group-hover:text-indigo-300">
                  ({lib.rating_count} değerlendirme)
                </span>
              </button>

              {lib.description && (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {lib.description}
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowReserve(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-transform hover:scale-105"
                >
                  Rezervasyon Yap
                </button>
                {canMessage && (
                  <Link
                    to={ROUTES.messageWith(lib.id, lib.name, "LIBRARY")}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                    </svg>
                    Mesaj Gönder
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* ── İki kolon: sol = bilgi, sağ = içerik (mobilde içerik önce) ── */}
          <div className="grid items-start gap-5 lg:grid-cols-3">
            {/* Sağ / ana içerik */}
            <div className="order-1 space-y-5 lg:order-2 lg:col-span-2">
              {lib.images && lib.images.length > 0 && <LibraryGallery images={lib.images} />}

              {/* Yaklaşan denemeler — deneme olmasa da kart kendi içinde "yok" gösterir */}
              <ExamSessionsSection libraryId={lib.id} />

              {/* İnternet hız testi (wifi) — çalıştır + kütüphaneye kaydet */}
              <LibrarySpeedTestSection libraryId={lib.id} canRecord={isClient} />
            </div>

            {/* Sol / bilgi kolonu */}
            <div className="order-2 space-y-5 lg:order-1 lg:col-span-1">
              {/* Genel Bilgi */}
              <div className={cardCls}>
                <SectionLabel>Genel Bilgi</SectionLabel>
                <div className="space-y-4">
                  {(lib.open_now != null || today) && (
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 text-slate-400 dark:text-slate-500">
                        <ClockIcon />
                      </span>
                      <div className="min-w-0">
                        {lib.open_now != null && (
                          <p
                            className={`flex items-center gap-1.5 text-sm font-semibold ${
                              lib.open_now
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-500 dark:text-rose-400"
                            }`}
                          >
                            <span className={`h-2 w-2 rounded-full ${lib.open_now ? "bg-emerald-500" : "bg-rose-500"}`} />
                            {lib.open_now ? "Şu an açık" : "Şu an kapalı"}
                          </p>
                        )}
                        {today && (
                          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                            Bugün {formatHoursLine(today)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {lib.phone && (
                    <a
                      href={`tel:${lib.phone}`}
                      className="flex items-center gap-3 text-sm text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-300"
                    >
                      <span className="text-slate-400 dark:text-slate-500">
                        <PhoneIcon />
                      </span>
                      <span className="font-medium">{lib.phone}</span>
                    </a>
                  )}

                  {lib.location_text && (
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 text-slate-400 dark:text-slate-500">
                        <PinIcon className="h-5 w-5" />
                      </span>
                      <p className="text-sm text-slate-600 dark:text-slate-300">{lib.location_text}</p>
                    </div>
                  )}
                </div>

                {lib.location_lat != null && lib.location_lng != null ? (
                  <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                    <LibrariesMap libraries={[lib]} height="190px" enablePanel={false} />
                  </div>
                ) : null}
                {mapViewUrl(lib) && (
                  <a
                    href={mapViewUrl(lib)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-transform hover:scale-105"
                  >
                    Haritada Görüntüle
                  </a>
                )}
              </div>

              {/* Çalışma Saatleri */}
              <div className={cardCls}>
                <SectionLabel>Çalışma Saatleri</SectionLabel>
                <ul className="space-y-1">
                  {week.map((h) => {
                    const isToday = h.weekday === todayWeekday;
                    const closed = h.is_closed || h.open_minute == null;
                    return (
                      <li
                        key={h.weekday}
                        className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
                          isToday
                            ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                            : "text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        <span>
                          {WEEKDAY_LABELS[h.weekday]}
                          {isToday && " (bugün)"}
                        </span>
                        <span className={closed ? "font-medium text-rose-500" : ""}>
                          {formatHoursLine(h)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Olanaklar (emojisiz — sade çipler; ortak AmenityTagGrid) */}
              {lib.amenities.length > 0 && (
                <div className={cardCls}>
                  <SectionLabel>Olanaklar</SectionLabel>
                  <AmenityTagGrid amenities={lib.amenities} />
                </div>
              )}
            </div>
          </div>

          {/* Değerlendirmeler (Airbnb-tarzı: özet + dağılım + yorum ızgarası) */}
          <div className={cardCls}>
            <ReviewsSection
              average={lib.rating_average}
              count={lib.rating_count}
              distribution={ratingDist}
              reviews={(reviews ?? []).map(
                (r): ReviewItem => ({
                  id: r.id,
                  name: r.client_name ?? "Anonim",
                  avatarUrl: r.client_avatar_url,
                  rating: r.rating,
                  text: r.comment_text,
                  createdAt: r.created_at,
                  verified: r.verified,
                })
              )}
              form={isClient ? <ReviewForm libraryId={lib.id} /> : undefined}
              onShowAll={() => setShowReviews(true)}
            />
          </div>
        </div>

        {/* ── Modallar ── */}
        {showReviews && (
          <ReviewsModal
            lib={lib}
            reviews={reviews}
            isClient={isClient}
            onClose={() => setShowReviews(false)}
          />
        )}
        {showReserve && (
          <LibraryReservationModal library={lib} onClose={() => setShowReserve(false)} />
        )}
      </>
    );
  })();

  return token ? (
    <DashboardShell title="Kütüphane" navItems={navItems}>
      {content}
    </DashboardShell>
  ) : (
    <PublicShell>{content}</PublicShell>
  );
}

/* ── Fotoğraflar (grid + lightbox) ── */

/** Tek galeri karesi: kapsayıcının verdiği boyutu doldurur; opsiyonel "+N" örtüsü. */
function GalleryTile({
  im,
  onClick,
  className = "",
  overlay,
}: {
  im: LibraryImageOut;
  onClick: () => void;
  className?: string;
  overlay?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-700 dark:ring-slate-600 ${className}`}
    >
      <img
        src={im.url}
        alt={im.caption ?? ""}
        loading="lazy"
        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
      />
      {overlay && (
        <span className="absolute inset-0 flex items-center justify-center bg-slate-900/55 text-xl font-bold text-white backdrop-blur-[1px] transition group-hover:bg-slate-900/65">
          {overlay}
        </span>
      )}
    </button>
  );
}

function LibraryGallery({ images }: { images: LibraryImageOut[] }) {
  const [active, setActive] = useState<number | null>(null);

  const close = () => setActive(null);
  const step = (dir: -1 | 1) =>
    setActive((i) => (i == null ? i : (i + dir + images.length) % images.length));

  return (
    <div className={cardCls}>
      <SectionLabel>Fotoğraflar</SectionLabel>
      {images.length >= 5 ? (
        // Çok fotoğrafta sabit-yükseklikli hero mozaik: 1 büyük + 4 küçük; fazlası
        // son karede "+N" rozetiyle lightbox'ı açar (yükseklik foto sayısından bağımsız).
        <div className="grid h-72 grid-cols-4 grid-rows-2 gap-2.5 sm:h-96">
          <GalleryTile
            im={images[0]}
            onClick={() => setActive(0)}
            className="col-span-2 row-span-2 h-full"
          />
          {images.slice(1, 5).map((im, idx) => (
            <GalleryTile
              key={im.id}
              im={im}
              onClick={() => setActive(idx + 1)}
              className="h-full"
              overlay={
                idx === 3 && images.length > 5 ? `+${images.length - 5}` : undefined
              }
            />
          ))}
        </div>
      ) : (
        // ≤4 fotoğraf: basit ızgara (zaten taşmaz).
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {images.map((im, i) => (
            <GalleryTile
              key={im.id}
              im={im}
              onClick={() => setActive(i)}
              className="aspect-video"
            />
          ))}
        </div>
      )}

      {active != null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/90 p-4"
          onClick={close}
        >
          <button
            type="button"
            onClick={close}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl text-white transition hover:bg-white/20"
            aria-label="Kapat"
          >
            ✕
          </button>
          {images.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              className="absolute left-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-2xl text-white transition hover:bg-white/20 sm:left-6"
              aria-label="Önceki"
            >
              ‹
            </button>
          )}
          <figure onClick={(e) => e.stopPropagation()} className="max-w-4xl">
            <img
              src={images[active].url}
              alt={images[active].caption ?? ""}
              className="max-h-[80vh] w-auto rounded-2xl object-contain"
            />
            {images[active].caption && (
              <figcaption className="mt-3 text-center text-sm text-slate-200">
                {images[active].caption}
              </figcaption>
            )}
            <p className="mt-1 text-center text-xs text-slate-400">
              {active + 1} / {images.length}
            </p>
          </figure>
          {images.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              className="absolute right-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-2xl text-white transition hover:bg-white/20 sm:right-6"
              aria-label="Sonraki"
            >
              ›
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Değerlendirmeler modalı ── */

function ReviewsModal({
  lib,
  reviews,
  isClient,
  onClose,
}: {
  lib: LibraryDetailOut;
  reviews: LibraryReviewOut[] | undefined;
  isClient: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Değerlendirmeler</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"
            aria-label="Kapat"
          >
            ✕
          </button>
        </div>

        {/* Özet */}
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-900/40">
          <StarRating value={lib.rating_average} />
          <span className="text-xl font-bold text-slate-900 dark:text-white">
            {lib.rating_average != null ? lib.rating_average.toFixed(1) : "Yeni"}
          </span>
          <span className="text-sm text-slate-400">· {lib.rating_count} değerlendirme</span>
        </div>

        {isClient && <ReviewForm libraryId={lib.id} />}

        {reviews && reviews.length > 0 ? (
          <div className="mt-4 space-y-3">
            {reviews.map((r) => (
              <div
                key={r.id}
                className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100 dark:bg-slate-900/40 dark:ring-slate-700"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
                      {(r.client_name ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {r.client_name ?? "Öğrenci"}
                      </span>
                      {r.verified && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          ✓ Doğrulanmış ziyaretçi
                        </span>
                      )}
                    </div>
                  </div>
                  <StarRating value={r.rating} />
                </div>
                {r.comment_text && (
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{r.comment_text}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 py-12 text-center dark:border-slate-700">
            <div className="text-3xl">⭐</div>
            <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              Henüz değerlendirme yok
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {isClient ? "İlk değerlendirmeyi sen yap!" : "Henüz kimse değerlendirme yapmamış."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Değerlendirme formu (yalnız CLIENT) ── */

function ReviewForm({ libraryId }: { libraryId: number }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const create = useCreateLibraryReview(libraryId);

  const submit = () => {
    if (rating < 1) {
      toast.error("Lütfen 1-5 arası puan verin.");
      return;
    }
    create.mutate(
      { rating, comment_text: text.trim() || null },
      {
        onSuccess: () => {
          toast.success("Değerlendirmen eklendi, teşekkürler!");
          setRating(0);
          setText("");
        },
        onError: (e) => toast.error(getErrorMessage(e, "Değerlendirme eklenemedi.")),
      }
    );
  };

  return (
    <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/50">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        Bu kütüphaneyi değerlendir
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Yorumun herkese görünür; ancak yıldız puanı ortalamaya yalnız burada{" "}
        <span className="font-medium">doğrulanmış ziyaretin</span> (deneme/çalışma kaydı)
        varsa katılır.
      </p>
      <div className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => setRating(i)}
            className={`text-2xl transition ${
              i <= rating ? "text-amber-400" : "text-slate-300 dark:text-slate-600"
            }`}
            aria-label={`${i} yıldız`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Deneyimini paylaş (opsiyonel)…"
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
      />
      <button
        onClick={submit}
        disabled={create.isPending}
        className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {create.isPending ? "Gönderiliyor…" : "Değerlendir"}
      </button>
    </div>
  );
}
