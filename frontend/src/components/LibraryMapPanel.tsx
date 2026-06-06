import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLibraryDetail } from "@/hooks/useLibraries";
import { StarRating } from "@/components/StarRating";
import { ShareButton } from "@/components/ShareButton";
import { LibraryBookmarkButton } from "@/components/LibraryBookmarkButton";
import { PinIcon } from "@/components/PinIcon";
import { amenityIcon, amenityLabel } from "@/lib/amenities";
import {
  WEEKDAY_LABELS,
  formatHoursLine,
  jsDayToWeekday,
  normalizeWeek,
} from "@/lib/libraryHours";
import { ROUTES } from "@/lib/routes";
import { regionLabel } from "@/lib/region";
import { absoluteUrl } from "@/lib/seo";
import { formatTRY } from "@/lib/money";
import type { LibrarySearchOut } from "@/types";

/** Google Maps yol tarifi: koordinat varsa onu, yoksa adres metnini hedefler. */
function directionsUrl(lib: LibrarySearchOut): string {
  const base = "https://www.google.com/maps/dir/?api=1&destination=";
  if (lib.location_lat != null && lib.location_lng != null) {
    return `${base}${lib.location_lat},${lib.location_lng}`;
  }
  return `${base}${encodeURIComponent(lib.location_text || lib.name)}`;
}

/**
 * Harita işaretçisine tıklanınca soldan açılan, Google Maps tarzı mekân paneli.
 * Çekirdek bilgiyi arama verisinden (anında) gösterir; saat/iletişim/galeri için
 * `useLibraryDetail` ile zenginleştirir (gelene kadar kısmi gösterim, layout zıplamaz).
 */
export function LibraryMapPanel({
  library,
  onClose,
}: {
  library: LibrarySearchOut;
  onClose: () => void;
}) {
  const { data: detail } = useLibraryDetail(library.slug);
  const [hoursOpen, setHoursOpen] = useState(false);

  const region = regionLabel(library.city, library.district, library.location_text);
  const banner = library.cover_url ?? detail?.images?.[0]?.url ?? null;

  const week = detail ? normalizeWeek(detail.hours) : null;
  const todayWeekday = jsDayToWeekday(new Date().getDay());
  const todayHours = week?.find((h) => h.weekday === todayWeekday) ?? null;

  return (
    <div className="animate-panel-left absolute inset-y-0 left-0 z-[1100] flex w-full max-w-[380px] flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900">
      {/* Üst aksiyonlar — kaydırmadan bağımsız, panele sabit (hep erişilir) */}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
        <ShareButton
          title={library.name}
          heading="Kütüphaneyi paylaş"
          url={absoluteUrl(ROUTES.library(library.slug))}
          size="md"
          overlay
        />
        <LibraryBookmarkButton libraryId={library.id} size="md" />
        <button
          onClick={onClose}
          aria-label="Kapat"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur transition hover:bg-black/50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── İçerik — banner dahil hepsi birlikte kaydırılır ── */}
      <div className="flex-1 overflow-y-auto">
        {/* Banner */}
        <div className="relative h-36 bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-slate-700 dark:to-slate-800">
          {banner ? (
            <img src={banner} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-5xl">📚</div>
          )}
          {library.open_now != null && (
            <span
              className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white shadow ${
                library.open_now ? "bg-emerald-500" : "bg-rose-500"
              }`}
            >
              {library.open_now ? "Şu an açık" : "Şu an kapalı"}
            </span>
          )}
        </div>

        <div className="p-4">
          {/* Logo banner'a biner; isim ve bölge altında (profil hero düzeni) */}
          {library.logo_url && (
            <img
              src={library.logo_url}
              alt=""
              className="-mt-12 mb-2 h-16 w-16 rounded-full bg-white object-cover shadow-lg ring-4 ring-white dark:ring-slate-900"
            />
          )}
          <h2 className="text-lg font-bold leading-tight text-slate-900 dark:text-white">
            {library.name}
          </h2>
          {region && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <PinIcon className="h-3.5 w-3.5 shrink-0" />
              {region}
            </p>
          )}

          {/* Puan + mesafe */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <StarRating value={library.rating_average} />
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              {library.rating_average != null ? library.rating_average.toFixed(1) : "Yeni"}
            </span>
            {library.rating_count > 0 && (
              <span className="text-slate-400">({library.rating_count} değerlendirme)</span>
            )}
            {library.distance_km != null && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {library.distance_km.toFixed(1)} km
              </span>
            )}
          </div>

          {/* Aksiyon butonları (Google Maps tarzı ikon + etiket) */}
          <div className="mt-4 flex gap-2">
            <PanelAction icon="🧭" label="Yol tarifi" href={directionsUrl(library)} external primary />
            <PanelAction
              label="Profil"
              to={ROUTES.library(library.slug)}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              }
            />
            {detail?.phone && <PanelAction icon="📞" label="Ara" href={`tel:${detail.phone}`} />}
            {detail?.website && <PanelAction icon="🌐" label="Site" href={detail.website} external />}
          </div>

          {/* Çalışma saatleri (açık/kapalı + bugün; tıkla → tüm hafta) */}
          {library.open_now != null && (
            <div className="mt-4">
              <button
                onClick={() => setHoursOpen((o) => !o)}
                disabled={!week}
                className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm transition hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-800 dark:disabled:hover:bg-slate-800/60"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-slate-400">🕑</span>
                  <span
                    className={
                      library.open_now
                        ? "font-semibold text-emerald-600 dark:text-emerald-400"
                        : "font-semibold text-rose-500"
                    }
                  >
                    {library.open_now ? "Açık" : "Kapalı"}
                  </span>
                  {todayHours && (
                    <span className="truncate text-slate-500 dark:text-slate-400">
                      · Bugün {formatHoursLine(todayHours)}
                    </span>
                  )}
                </span>
                {week && (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${hoursOpen ? "rotate-180" : ""}`}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                  </svg>
                )}
              </button>
              {hoursOpen && week && (
                <ul className="mt-2 space-y-1 px-1">
                  {week.map((h) => (
                    <li
                      key={h.weekday}
                      className={`flex justify-between text-xs ${
                        h.weekday === todayWeekday
                          ? "font-semibold text-slate-900 dark:text-white"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      <span>{WEEKDAY_LABELS[h.weekday]}</span>
                      <span className={h.is_closed || h.open_minute == null ? "text-rose-500" : ""}>
                        {formatHoursLine(h)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Tam adres */}
          {library.location_text && (
            <div className="mt-4 flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
              <PinIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>{library.location_text}</span>
            </div>
          )}

          {/* Fiyat / kapasite */}
          {(library.study_hourly_price || library.capacity != null) && (
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {library.study_hourly_price && (
                <span className="rounded-lg bg-violet-50 px-2.5 py-1 font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                  Saatlik çalışma: {formatTRY(library.study_hourly_price)}
                </span>
              )}
              {library.capacity != null && (
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {library.capacity} kişilik
                </span>
              )}
            </div>
          )}

          {/* Olanaklar */}
          {library.amenities.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {library.amenities.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  <span>{amenityIcon(a)}</span>
                  {amenityLabel(a)}
                </span>
              ))}
            </div>
          )}

          {/* Açıklama */}
          {library.description && (
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-600 line-clamp-4 dark:text-slate-300">
              {library.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* Google Maps tarzı dikey aksiyon (ikon + etiket); Link veya harici/dahili anchor. */
function PanelAction({
  icon,
  label,
  href,
  to,
  external,
  primary,
}: {
  icon: ReactNode;
  label: string;
  href?: string;
  to?: string;
  external?: boolean;
  primary?: boolean;
}) {
  const cls = "flex flex-1 flex-col items-center gap-1.5";
  const inner = (
    <>
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full text-lg transition ${
          primary
            ? "bg-indigo-600 text-white hover:bg-indigo-700"
            : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        }`}
      >
        {icon}
      </span>
      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">{label}</span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <a href={href} className={cls} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {inner}
    </a>
  );
}
