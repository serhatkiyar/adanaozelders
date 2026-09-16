import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { LibraryBookmarkButton } from "@/components/LibraryBookmarkButton";
import { regionLabel } from "@/lib/region";
import { formatTRY } from "@/lib/money";
import { amenityLabel } from "@/lib/amenities";
import { amenityIcon } from "@/lib/amenityIcons";
import type { LibrarySearchOut } from "@/types";
import { IconBooks, IconStarFilled } from "@tabler/icons-react";

const VISIBLE_AMENITIES = 3;

/** Kütüphane kartı — "sakin" varyant: kutu yerine boşluk, rozet yerine satır ritmi.
 *  Kart çerçevesizdir; görsel dışında hiçbir dolgu/gölge yoktur, hiyerarşi tipografiyle kurulur. */
export function LibraryCardCalm({ library }: { library: LibrarySearchOut }) {
  const region = regionLabel(library.city, library.district, library.location_text);
  const amenities = library.amenities.slice(0, VISIBLE_AMENITIES);
  const overflow = library.amenities.length - amenities.length;

  return (
    <Link to={ROUTES.library(library.slug)} className="group flex flex-col">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-100 ">
        {library.cover_url ? (
          <img
            src={library.cover_url}
            alt={library.name}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <IconBooks size={32} stroke={1.5} className="text-slate-300 " aria-hidden />
          </div>
        )}

        {/* Favorile — kart bir Link olduğundan buton tıklamayı durdurur. */}
        <div className="absolute right-2.5 top-2.5 z-10">
          <LibraryBookmarkButton libraryId={library.id} size="lg" />
        </div>

        {library.logo_url && (
          <img
            src={library.logo_url}
            alt=""
            className="absolute bottom-2.5 left-2.5 h-9 w-9 rounded-full bg-white object-cover ring-1 ring-black/5 "
            loading="lazy"
          />
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-3">
        <h3 className="line-clamp-1 flex-1 text-[15px] font-semibold text-slate-900 ">
          {library.name}
        </h3>
        {library.rating_average != null ? (
          <span className="flex shrink-0 items-center gap-1 text-[13px] text-slate-700 ">
            <IconStarFilled size={11} className="text-slate-900 " aria-hidden />
            {library.rating_average.toFixed(1)}
            {library.rating_count > 0 && (
              <span className="text-slate-400 ">
                ({library.rating_count})
              </span>
            )}
          </span>
        ) : (
          <span className="shrink-0 text-[13px] text-slate-400 ">
            Yeni
          </span>
        )}
      </div>

      <p className="mt-0.5 line-clamp-1 text-[13px] text-slate-500 ">
        {region ?? "Konum belirtilmemiş"}
        {library.distance_km != null && (
          <span className="text-slate-400 ">
            {" · "}
            {library.distance_km} km
          </span>
        )}
      </p>

      {amenities.length > 0 && (
        <p className="mt-1.5 flex items-center gap-3 text-[13px] text-slate-500 ">
          {amenities.map((slug) => (
            <span key={slug} className="flex items-center gap-1">
              {(() => { const I = amenityIcon(slug); return <I size={13} stroke={1.75} aria-hidden />; })()}
              <span className="line-clamp-1">{amenityLabel(slug)}</span>
            </span>
          ))}
          {overflow > 0 && (
            <span className="shrink-0 text-slate-400 ">
              +{overflow}
            </span>
          )}
        </p>
      )}

      {(library.open_now != null || library.study_hourly_price != null) && (
        <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3 text-[13px] ">
          {library.open_now != null && (
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  library.open_now
                    ? "bg-emerald-500"
                    : "bg-slate-300 "
                }`}
              />
              <span
                className={
                  library.open_now
                    ? "font-medium text-emerald-700 "
                    : "text-slate-400 "
                }
              >
                {library.open_now ? "Şu an açık" : "Kapalı"}
              </span>
            </span>
          )}
          {library.study_hourly_price != null && (
            <span className="ml-auto text-slate-500 ">
              <span className="font-semibold text-slate-900 ">
                {formatTRY(library.study_hourly_price)}
              </span>
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
