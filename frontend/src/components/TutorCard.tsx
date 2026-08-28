import { Link } from "react-router-dom";
import type { TutorSearchOut } from "@/types";
import { BookmarkButton } from "@/components/BookmarkButton";
import { StarRating } from "@/components/StarRating";
import { parseMoney, formatTRY } from "@/lib/money";
import { ROUTES, tutorSlug } from "@/lib/routes";

interface TutorCardProps {
  tutor: TutorSearchOut;
  showBookmark?: boolean;
  /**
   * Ücretli öne çıkarma kartı. Etiket zorunludur ve metni "Reklam"dır —
   * Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği ücretli
   * yerleşimin ayırt edilebilir olmasını şart koşar. "Sponsorlu" ya da
   * "Öne çıkan" bu yükümlülüğü tek başına karşılamaz.
   */
  featured?: boolean;
}

export function TutorCard({
  tutor,
  showBookmark = true,
  featured = false,
}: TutorCardProps) {
  const hasRatings = tutor.rating_count > 0;
  const rate = parseMoney(tutor.hourly_rate);
  
  const locationText = tutor.distance_km != null
    ? `~${tutor.distance_km} km`
    : tutor.teaching_mode === "ONLINE"
      ? "Uzaktan (webcam)"
      : tutor.district || "Yüzyüze & Uzaktan";
    
  const mainSubject = tutor.subjects?.[0] || "Özel Ders";
  // Superprof usually only shows first name
  const firstName = tutor.full_name.split(" ")[0];

  return (
    <Link
      to={ROUTES.tutor(tutorSlug(tutor))}
      className="group flex flex-col transition duration-300 mx-auto w-full max-w-[310px]"
    >
      {/* ── Picture Area ── */}
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-slate-100 ">
        <img 
          src={tutor.avatar_url || "https://ui-avatars.com/api/?name=" + encodeURIComponent(tutor.full_name) + "&background=c7d2fe&color=3730a3&size=400"} 
          alt={tutor.full_name} 
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          loading="lazy"
        />
        
        {/* Reklam etiketi — yasal zorunluluk, karttan ayrılamaz */}
        {featured && (
          <span className="absolute left-4 top-4 z-10 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-slate-700 shadow-sm">
            Reklam
          </span>
        )}

        {/* Bookmark top right */}
        {showBookmark && (
          <div className="absolute right-4 top-4 z-10">
            <BookmarkButton tutorId={tutor.id} size="lg" />
          </div>
        )}

        {/* Gradient Mask at bottom */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100" />
        
        {/* Text Container over image */}
        <div className="absolute bottom-4 left-4 right-4 flex flex-col">
          <p className="text-xl font-bold text-white drop-shadow-md">
            {firstName}
          </p>
          <div className="mt-0.5 flex items-center text-xs font-medium text-white/90 drop-shadow-md">
            <span>{locationText}</span>
          </div>
        </div>
      </div>

      {/* ── Bottom Part ── */}
      <div className="flex flex-col pt-3 pb-1 px-1">
        {/* Badges: Rating & Status */}
        <ul className="flex items-center gap-2 text-xs font-medium text-slate-700 ">
          <li className="flex items-center gap-1">
            <StarRating value={tutor.rating_average ?? 0} single={true} />
            <span className="font-bold text-slate-900 text-xs">
              {hasRatings ? (tutor.rating_average ?? 0).toFixed(1) : "Yeni"}
            </span>
            {hasRatings && (
              <span className="text-slate-500 ">
                ({tutor.rating_count} yorum)
              </span>
            )}
          </li>
        </ul>
        
        <h3 className="mt-1 line-clamp-2 min-h-[40px] text-sm leading-snug text-slate-800 ">
          {tutor.headline || tutor.bio || `${mainSubject} alanında uzman eğitmen ile derslere hemen başlayın.`}
        </h3>

        {/* Pricing */}
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-baseline text-slate-900 ">
            <span className="text-sm font-bold">
              {rate !== null ? formatTRY(rate) : "Ücret belirtilmemiş"}
            </span>
            {rate !== null && (
              <span className="text-[11px] font-bold">/saat</span>
            )}
          </div>
          {/* İlk ders ücretsiz etiketi — yalnız eğitmen sunuyorsa */}
          {tutor.first_lesson_free !== false && (
            <div className="flex items-center text-[11px] font-bold text-emerald-600 ">
              İlk ders ücretsiz
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

