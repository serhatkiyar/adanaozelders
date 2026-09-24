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

export function LibraryCardCodex({ library }: { library: LibrarySearchOut }) {
  const region = regionLabel(
    library.city,
    library.district,
    library.location_text,
  );
  const visibleAmenities = library.amenities.slice(0, 4);
  const remainingAmenities = library.amenities.length - visibleAmenities.length;

  return (
    <Link
      to={ROUTES.library(library.slug)}
      className="group grid overflow-hidden rounded-2xl border border-slate-200 bg-white transition duration-200 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-950/5 sm:grid-cols-[12rem_minmax(0,1fr)]"
    >
      <div className="relative min-h-44 overflow-hidden border-b border-slate-200 bg-slate-100 sm:min-h-full sm:border-b-0 sm:border-r ">
        {library.cover_url ? (
          <img
            src={library.cover_url}
            alt={`${library.name} kapak görseli`}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover grayscale-[15%] transition duration-500 group-hover:scale-[1.03] group-hover:grayscale-0 "
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400 ">
            <Icon name="libraryBooks" className="h-10 w-10" />
            <span className="text-[11px] font-medium uppercase tracking-[0.18em]">
              Görsel yakında
            </span>
          </div>
        )}

        {library.logo_url && (
          <img
            src={library.logo_url}
            alt=""
            loading="lazy"
            className="absolute bottom-3 left-3 h-11 w-11 rounded-full border border-white/80 bg-white object-cover shadow-sm "
          />
        )}

        <div
          className="absolute right-3 top-3 z-10"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <LibraryBookmarkButton libraryId={library.id} size="lg" />
        </div>
      </div>

      <div className="flex min-w-0 flex-col p-5 sm:p-6">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="line-clamp-1 text-lg font-semibold tracking-tight text-slate-950 ">
              {library.name}
            </h3>
            {region && (
              <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-slate-500 ">
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
            <span
              className={`mt-1 shrink-0 text-xs font-semibold ${
                library.open_now
                  ? "text-emerald-600 "
                  : "text-rose-600 "
              }`}
            >
              <span aria-hidden="true">● </span>
              {library.open_now ? "Şu an açık" : "Şu an kapalı"}
            </span>
          )}
        </div>

        {library.description && (
          <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-600 ">
            {library.description}
          </p>
        )}

        {visibleAmenities.length > 0 && (
          <div className="mt-4 flex min-w-0 items-center gap-x-4 gap-y-2 overflow-hidden text-xs text-slate-600 ">
            {visibleAmenities.map((amenity) => (
              <span key={amenity} className="flex shrink-0 items-center gap-1.5">
                <Icon name={amenityIcon(amenity)} className="h-[13px] w-[13px]" />
                {amenityLabel(amenity)}
              </span>
            ))}
            {remainingAmenities > 0 && (
              <span className="shrink-0 font-medium text-slate-500 ">
                +{remainingAmenities}
              </span>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-slate-200 pt-4 ">
          <div className="flex items-center gap-2">
            <StarRating value={library.rating_average} single size={18} />
            <span className="text-sm font-semibold text-slate-800 ">
              {library.rating_average != null
                ? library.rating_average.toFixed(1)
                : "Yeni"}
            </span>
            {library.rating_count > 0 && (
              <span className="text-xs text-slate-500 ">
                {library.rating_count} değerlendirme
              </span>
            )}
          </div>

          <div className="text-right">
            {library.study_hourly_price != null ? (
              <>
                <span className="block text-base font-semibold text-slate-950 ">
                  {formatTRY(library.study_hourly_price)}
                </span>
              </>
            ) : library.capacity != null ? (
              <span className="text-xs text-slate-500 ">
                {library.capacity} kişilik kapasite
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}
