import { Link } from "react-router-dom";
import { LibraryBookmarkButton } from "@/components/LibraryBookmarkButton";
import { PinIcon } from "@/components/PinIcon";
import { StarRating } from "@/components/StarRating";
import { amenityLabel } from "@/lib/amenities";
import { amenityIcon } from "@/lib/amenityIcons";
import { formatTRY } from "@/lib/money";
import { regionLabel } from "@/lib/region";
import { ROUTES } from "@/lib/routes";
import type { LibrarySearchOut } from "@/types";

export function LibraryCardCodexA({ library }: { library: LibrarySearchOut }) {
  const region = regionLabel(library.city, library.district, library.location_text);
  const amenities = library.amenities.slice(0, 3);
  const remaining = library.amenities.length - amenities.length;
  const initial = library.name.trim().charAt(0).toLocaleUpperCase("tr-TR");

  return (
    <Link
      to={ROUTES.library(library.slug)}
      className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white transition duration-300 hover:border-slate-300 hover:shadow-xl hover:shadow-slate-950/5 "
    >
      <div className="relative aspect-[16/10] overflow-hidden border-b border-slate-200 bg-slate-100 ">
        {library.cover_url ? (
          <img
            src={library.cover_url}
            alt={`${library.name} kapak görseli`}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025] "
          />
        ) : (
          <div className="relative flex h-full items-center justify-center overflow-hidden bg-stone-100 ">
            <span className="select-none font-serif text-[7rem] font-light leading-none text-stone-300 sm:text-[9rem]">
              {initial}
            </span>
            <div className="absolute inset-x-8 bottom-7 border-t border-stone-300 " />
            <span className="absolute bottom-3 left-8 text-[10px] font-medium uppercase tracking-[0.24em] text-stone-500 ">
              Kütüphane
            </span>
          </div>
        )}

        {library.logo_url && (
          <img
            src={library.logo_url}
            alt=""
            loading="lazy"
            className="absolute bottom-4 left-5 h-12 w-12 rounded-full border border-white bg-white object-cover shadow-sm "
          />
        )}
        <div
          className="absolute right-4 top-4 z-10"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <LibraryBookmarkButton libraryId={library.id} size="lg" />
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="line-clamp-1 text-xl font-semibold tracking-tight text-slate-950 ">
              {library.name}
            </h3>
            {region && (
              <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-sm text-slate-500 ">
                <PinIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="line-clamp-1">{region}</span>
                {library.distance_km != null && (
                  <span className="shrink-0 text-slate-400 ">
                    · {library.distance_km} km
                  </span>
                )}
              </p>
            )}
          </div>
          {library.open_now != null && (
            <span className={`mt-1 shrink-0 text-xs font-semibold ${library.open_now ? "text-emerald-600 " : "text-rose-600 "}`}>
              {library.open_now ? "Açık" : "Kapalı"}
            </span>
          )}
        </div>

        {amenities.length > 0 && (
          <div className="mt-5 flex min-w-0 items-center gap-4 overflow-hidden text-xs text-slate-600 ">
            {amenities.map((amenity) => (
              <span key={amenity} className="flex shrink-0 items-center gap-1.5">
                {(() => { const I = amenityIcon(amenity); return <I size={14} stroke={1.75} aria-hidden />; })()}
                {amenityLabel(amenity)}
              </span>
            ))}
            {remaining > 0 && <span className="shrink-0 text-slate-500 ">+{remaining}</span>}
          </div>
        )}

        <div className="mt-5 flex items-end justify-between gap-4 border-t border-slate-200 pt-4 ">
          <div className="flex items-center gap-2">
            <StarRating value={library.rating_average} single size={18} />
            <span className="text-sm font-semibold text-slate-800 ">
              {library.rating_average != null ? library.rating_average.toFixed(1) : "Yeni"}
            </span>
            {library.rating_count > 0 && (
              <span className="text-xs text-slate-500 ">({library.rating_count})</span>
            )}
          </div>
          {library.study_hourly_price != null ? (
            <p className="text-right text-sm font-semibold text-slate-950 ">
              {formatTRY(library.study_hourly_price)}
              <span className="ml-1 font-normal text-slate-500 ">/ saat</span>
            </p>
          ) : library.capacity != null ? (
            <p className="text-xs text-slate-500 ">{library.capacity} kişilik</p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
