import { Link } from "react-router-dom";
import { Icon } from "@/components/AppIcon";
import { LibraryBookmarkButton } from "@/components/LibraryBookmarkButton";
import { PinIcon } from "@/components/PinIcon";
import { StarRating } from "@/components/StarRating";
import { amenityLabel } from "@/lib/amenities";
import { amenityIcon } from "@/lib/amenityIcons";
import { formatTRY } from "@/lib/money";
import { regionLabel } from "@/lib/region";
import { ROUTES } from "@/lib/routes";
import type { LibrarySearchOut } from "@/types";

export function LibraryCardCodexB({ library }: { library: LibrarySearchOut }) {
  const region = regionLabel(library.city, library.district, library.location_text);
  const amenities = library.amenities.slice(0, 4);
  const remaining = library.amenities.length - amenities.length;

  return (
    <Link
      to={ROUTES.library(library.slug)}
      className="group grid min-h-72 overflow-hidden rounded-2xl border border-slate-200 bg-white transition duration-300 hover:border-slate-300 hover:shadow-xl hover:shadow-slate-950/5 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]"
    >
      <div className="relative min-h-64 overflow-hidden border-b border-slate-200 bg-slate-100 md:min-h-full md:border-b-0 md:border-r">
        {library.cover_url ? (
          <img
            src={library.cover_url}
            alt={`${library.name} kapak görseli`}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.025] "
          />
        ) : (
          <div className="absolute inset-0 overflow-hidden bg-slate-100 ">
            <div className="absolute inset-x-[12%] top-[18%] h-px bg-slate-300 " />
            <div className="absolute inset-x-[12%] top-[38%] h-px bg-slate-300 " />
            <div className="absolute inset-x-[12%] top-[58%] h-px bg-slate-300 " />
            <div className="absolute inset-x-[12%] top-[78%] h-px bg-slate-300 " />
            <div className="absolute inset-y-[12%] left-[27%] w-px bg-slate-300 " />
            <div className="absolute inset-y-[12%] left-[50%] w-px bg-slate-300 " />
            <div className="absolute inset-y-[12%] left-[73%] w-px bg-slate-300 " />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="border border-slate-300 bg-slate-100 px-5 py-3 text-xs font-medium uppercase tracking-[0.22em] text-slate-500 ">
                Okuma · Çalışma
              </span>
            </div>
          </div>
        )}
        {library.logo_url && (
          <img
            src={library.logo_url}
            alt=""
            loading="lazy"
            className="absolute bottom-5 left-5 h-12 w-12 rounded-full border border-white bg-white object-cover shadow-sm "
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

      <div className="flex min-w-0 flex-col justify-between p-6 lg:p-7">
        <div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 ">
              Kütüphane
            </span>
            {library.open_now != null && (
              <span className={`text-xs font-semibold ${library.open_now ? "text-emerald-600 " : "text-rose-600 "}`}>
                {library.open_now ? "Şu an açık" : "Şu an kapalı"}
              </span>
            )}
          </div>
          <h3 className="mt-3 line-clamp-1 text-2xl font-semibold tracking-tight text-slate-950 ">
            {library.name}
          </h3>
          {region && (
            <p className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-slate-500 ">
              <PinIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-1">{region}</span>
              {library.distance_km != null && (
                <span className="shrink-0 text-slate-400 ">· {library.distance_km} km</span>
              )}
            </p>
          )}
          {library.description && (
            <p className="mt-5 line-clamp-2 text-sm leading-6 text-slate-600 ">
              {library.description}
            </p>
          )}
          {amenities.length > 0 && (
            <div className="mt-5 flex min-w-0 flex-wrap gap-x-4 gap-y-2 overflow-hidden text-xs text-slate-600 ">
              {amenities.map((amenity) => (
                <span key={amenity} className="flex shrink-0 items-center gap-1.5">
                  <Icon name={amenityIcon(amenity)} className="h-3.5 w-3.5" />
                  {amenityLabel(amenity)}
                </span>
              ))}
              {remaining > 0 && <span className="text-slate-500 ">+{remaining}</span>}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-end justify-between gap-4 border-t border-slate-200 pt-5 ">
          <div className="flex items-center gap-2">
            <StarRating value={library.rating_average} single size={18} />
            <span className="text-sm font-semibold text-slate-800 ">
              {library.rating_average != null ? library.rating_average.toFixed(1) : "Yeni"}
            </span>
            {library.rating_count > 0 && (
              <span className="text-xs text-slate-500 ">{library.rating_count} yorum</span>
            )}
          </div>
          {library.study_hourly_price != null ? (
            <div className="text-right">
              <span className="block text-base font-semibold text-slate-950 ">
                {formatTRY(library.study_hourly_price)}
              </span>
            </div>
          ) : library.capacity != null ? (
            <span className="text-xs text-slate-500 ">{library.capacity} kişilik</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
