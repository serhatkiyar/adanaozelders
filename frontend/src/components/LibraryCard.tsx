import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { StarRating } from "@/components/StarRating";
import { LibraryBookmarkButton } from "@/components/LibraryBookmarkButton";
import { regionLabel } from "@/lib/region";
import { formatTRY } from "@/lib/money";
import { PinIcon } from "@/components/PinIcon";
import type { LibrarySearchOut } from "@/types";

export function LibraryCard({ library }: { library: LibrarySearchOut }) {
  return (
    <Link
      to={ROUTES.library(library.slug)}
      className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-slate-800 dark:ring-slate-700"
    >
      <div className="relative h-36 w-full overflow-hidden bg-gradient-to-br from-indigo-100 to-violet-100 dark:from-slate-700 dark:to-slate-800">
        {library.cover_url ? (
          <img
            src={library.cover_url}
            alt={library.name}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl">
            📚
          </div>
        )}
        {library.open_now != null && (
          <span
            className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${
              library.open_now
                ? "bg-emerald-500/95 text-white"
                : "bg-rose-500/95 text-white"
            }`}
          >
            {library.open_now ? "Şu an açık" : "Kapalı"}
          </span>
        )}
        {/* Favorile — kart bir Link olduğundan buton tıklamayı durdurur. */}
        <div className="absolute right-3 top-3 z-10">
          <LibraryBookmarkButton libraryId={library.id} size="lg" />
        </div>
        {library.distance_km != null && (
          <span className="absolute bottom-2 right-3 rounded-full bg-slate-900/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
            {library.distance_km} km
          </span>
        )}
        {library.logo_url && (
          <img
            src={library.logo_url}
            alt=""
            className="absolute bottom-2 left-3 h-11 w-11 rounded-full bg-white object-cover shadow-md ring-2 ring-white dark:ring-slate-800"
            loading="lazy"
          />
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-1 text-base font-bold text-slate-900 dark:text-white">
          {library.name}
        </h3>
        {regionLabel(library.city, library.district, library.location_text) && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <PinIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-1">
              {regionLabel(library.city, library.district, library.location_text)}
            </span>
          </p>
        )}

        <div className="mt-2 flex items-center gap-2">
          <StarRating value={library.rating_average} />
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {library.rating_average != null
              ? library.rating_average.toFixed(1)
              : "Yeni"}
          </span>
          {library.rating_count > 0 && (
            <span className="text-xs text-slate-400">
              ({library.rating_count} değerlendirme)
            </span>
          )}
        </div>

        {library.study_hourly_price != null && (
          <p className="mt-2 text-xs font-semibold text-violet-600 dark:text-violet-300">
            🪑 Çalışma alanı · {formatTRY(library.study_hourly_price)}/saat
          </p>
        )}
      </div>
    </Link>
  );
}
