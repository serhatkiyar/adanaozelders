import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { PublicShell } from "@/components/PublicShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { LibrariesMap } from "@/components/LibrariesMap";
import { ExamSessionsSection } from "@/components/ExamSessionsSection";
import { StudySpaceSection } from "@/components/StudySpaceSection";
import { StarRating } from "@/components/StarRating";
import { Seo } from "@/components/Seo";
import {
  useCreateLibraryReview,
  useLibraryDetail,
  useLibraryReviews,
} from "@/hooks/useLibraries";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";
import { getErrorMessage } from "@/lib/errors";
import { amenityIcon, amenityLabel } from "@/lib/amenities";
import {
  WEEKDAY_LABELS,
  formatHoursLine,
  jsDayToWeekday,
  normalizeWeek,
} from "@/lib/libraryHours";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";
import type { LibraryImageOut } from "@/types";

/** Google Maps yol tarifi linki: koordinat varsa onu, yoksa adres metnini hedef alır. */
function directionsUrl(lib: {
  location_lat?: number | null;
  location_lng?: number | null;
  location_text?: string | null;
  name: string;
}): string | null {
  const base = "https://www.google.com/maps/dir/?api=1&destination=";
  if (lib.location_lat != null && lib.location_lng != null) {
    return `${base}${lib.location_lat},${lib.location_lng}`;
  }
  const text = lib.location_text || lib.name;
  return text ? `${base}${encodeURIComponent(text)}` : null;
}

export default function LibraryDetail() {
  const { slug } = useParams<{ slug: string }>();
  const token = useAuthStore((s) => s.token);
  const { data: currentUser } = useCurrentUser();
  const { data: lib, isLoading, isError, error } = useLibraryDetail(slug);
  const { data: reviews } = useLibraryReviews(lib?.id);

  const isClient = currentUser?.role_id === ROLE_IDS.CLIENT;
  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : isClient
        ? STUDENT_NAV
        : undefined;

  const todayWeekday = jsDayToWeekday(new Date().getDay());

  const content = (() => {
    if (isLoading) {
      return (
        <div className="mx-auto max-w-[900px] space-y-4">
          <div className="h-56 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
        </div>
      );
    }
    if (isError || !lib) {
      return (
        <div className="mx-auto max-w-[900px]">
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

    return (
      <div className="mx-auto max-w-[900px] space-y-6">
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

        {/* ── Hero ── */}
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
          </div>
          <div className="p-5 sm:p-6">
            {lib.logo_url && (
              <img
                src={lib.logo_url}
                alt={`${lib.name} logosu`}
                className="relative z-10 -mt-16 mb-3 h-20 w-20 rounded-2xl bg-white object-cover shadow-lg ring-4 ring-white dark:bg-slate-800 dark:ring-slate-800"
              />
            )}
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{lib.name}</h1>
            {lib.location_text && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                📍 {lib.location_text}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <StarRating value={lib.rating_average} />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {lib.rating_average != null ? lib.rating_average.toFixed(1) : "Yeni"}
                </span>
                <span className="text-xs text-slate-400">
                  ({lib.rating_count} değerlendirme)
                </span>
              </div>
              {lib.capacity != null && (
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  🪑 {lib.capacity} kişilik
                </span>
              )}
            </div>

            {lib.description && (
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {lib.description}
              </p>
            )}

            {/* İletişim */}
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              {lib.phone && (
                <a href={`tel:${lib.phone}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                  📞 {lib.phone}
                </a>
              )}
              {lib.website && (
                <a
                  href={lib.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                >
                  🌐 Web sitesi
                </a>
              )}
            </div>

            {lib.amenities.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {lib.amenities.map((a) => (
                  <span
                    key={a}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  >
                    <span>{amenityIcon(a)}</span>
                    {amenityLabel(a)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Galeri ── */}
        {lib.images && lib.images.length > 0 && <LibraryGallery images={lib.images} />}

        {/* ── Çalışma saatleri + Harita ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
            <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">
              Çalışma Saatleri
            </h2>
            <ul className="space-y-1.5">
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
                      {isToday && " (Bugün)"}
                    </span>
                    <span className={closed ? "text-rose-500" : ""}>
                      {formatHoursLine(h)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Konum</h2>
              {directionsUrl(lib) && (
                <a
                  href={directionsUrl(lib)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
                >
                  🧭 Yol Tarifi Al
                </a>
              )}
            </div>
            {lib.location_lat != null && lib.location_lng != null ? (
              <LibrariesMap libraries={[lib]} height="260px" />
            ) : lib.location_text ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                📍 {lib.location_text}
              </p>
            ) : (
              <p className="text-sm text-slate-400">Konum bilgisi girilmemiş.</p>
            )}
          </div>
        </div>

        {/* ── Çalışma alanı rezervasyonu ── */}
        <StudySpaceSection library={lib} />

        {/* ── Deneme sınavları ── */}
        <ExamSessionsSection libraryId={lib.id} />

        {/* ── Değerlendirmeler ── */}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
          <h2 className="mb-4 text-base font-bold text-slate-900 dark:text-white">
            Değerlendirmeler ({lib.rating_count})
          </h2>

          {isClient && <ReviewForm libraryId={lib.id} />}

          <div className="mt-4 space-y-4">
            {reviews && reviews.length > 0 ? (
              reviews.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-slate-100 p-4 dark:border-slate-700"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
                        {(r.client_name ?? "?").charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {r.client_name ?? "Öğrenci"}
                      </span>
                    </div>
                    <StarRating value={r.rating} />
                  </div>
                  {r.comment_text && (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {r.comment_text}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-slate-400">
                Henüz değerlendirme yok. İlk değerlendirmeyi sen yap!
              </p>
            )}
          </div>
        </div>
      </div>
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

/* ── Galeri (grid + lightbox) ── */

function LibraryGallery({ images }: { images: LibraryImageOut[] }) {
  const [active, setActive] = useState<number | null>(null);

  const close = () => setActive(null);
  const step = (dir: -1 | 1) =>
    setActive((i) =>
      i == null ? i : (i + dir + images.length) % images.length
    );

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">
        Galeri
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {images.map((im, i) => (
          <button
            key={im.id}
            type="button"
            onClick={() => setActive(i)}
            className="group relative aspect-video overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-700 dark:ring-slate-600"
          >
            <img
              src={im.url}
              alt={im.caption ?? ""}
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            />
          </button>
        ))}
      </div>

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
        onError: (e) =>
          toast.error(getErrorMessage(e, "Değerlendirme eklenemedi.")),
      }
    );
  };

  return (
    <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/50">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        Bu kütüphaneyi değerlendir
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
