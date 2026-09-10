import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { StarRating } from "@/components/StarRating";
import { LibraryBookmarkButton } from "@/components/LibraryBookmarkButton";
import { regionLabel } from "@/lib/region";
import type { LibrarySearchOut } from "@/types";

/**
 * Kütüphane kartı — eğitmen kartıyla AYNI anatomi (kullanıcı kararı, 29 Ağu):
 * çerçevesiz kart, yuvarlatılmış kare görsel, altta gradyan üzerinde beyaz
 * ad + konum, görselin dışında puan satırı. Hover'da yakınlaşma YOK.
 */
export function LibraryCard({ library }: { library: LibrarySearchOut }) {
  const hasRatings = library.rating_count > 0;
  const bolge = regionLabel(library.city, library.district, library.location_text);
  const konum = [bolge, library.distance_km != null ? `~${library.distance_km} km` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      to={ROUTES.library(library.slug)}
      // `h-full`: eğitmen kartında VARDI, burada YOKTU. Aynı satırdaki
      // kartlar içeriğe göre farklı yükseklikte bitiyordu; ızgarada alt
      // kenarlar hizasız kalıyordu.
      className="group mx-auto flex h-full w-full max-w-[310px] flex-col transition duration-300"
    >
      {/* ── Görsel alanı ── */}
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-gradient-to-br from-marka-soft to-marka-line ">
        {library.cover_url ? (
          <img
            src={library.cover_url}
            alt={library.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          /* Kapak yokken EĞİTMEN KARTIYLA AYNI çözüm: baş harf bloğu
             (11 Eyl 2026). Burada 📚 emojisi duruyordu ve 310px'lik kartın
             ortasında 36px'lik bir emoji, kapağın yüklenmediği izlenimi
             veriyordu — kullanıcı: *"kütüphane arama sonucu sayfası
             eğitmenlerdeki kadar düzgün değil"*. Emoji ayrıca her platformda
             başka çiziliyor.

             Harf YUKARIDA durur: ortalanmışken iki satırlık kütüphane adının
             tam arkasına geliyor ve ikisi birbirini okunmaz kılıyordu
             (ölçüldü, 10 Eyl 2026). Alt %35 başlığa ayrılmış durumda. */
          <div
            aria-hidden
            className="flex h-[65%] w-full items-center justify-center text-4xl font-semibold text-marka-metin"
          >
            {library.name.charAt(0).toLocaleUpperCase("tr")}
          </div>
        )}

        {library.open_now != null && (
          <span
            className={`absolute left-4 top-4 z-10 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${
              library.open_now
                ? "bg-emerald-500/95 text-white"
                : "bg-rose-500/95 text-white"
            }`}
          >
            {library.open_now ? "Şu an açık" : "Kapalı"}
          </span>
        )}

        {/* Favorile — kart bir Link olduğundan buton tıklamayı durdurur. */}
        <div className="absolute right-1 top-1 md:right-3 md:top-3 z-10">
          <LibraryBookmarkButton libraryId={library.id} size="md" />
        </div>

        {/* Alt gradyan maskesi */}
        <div className="absolute inset-x-0 bottom-0 h-[65%] bg-gradient-to-t from-black/85 via-black/35 to-transparent opacity-90 transition-opacity duration-300 group-hover:opacity-100" />

        {/* Görsel üstündeki metin. Eğitmen kartındaki xl, KISA bir ön ad
            içindir; kütüphanenin uzun tam adı aynı boyutta kart kaplıyordu.
            Optik denge için base + iki satır. Logo overlay'i sıkıştırdığı
            için kalktı. */}
        <div className="absolute bottom-4 left-4 right-4 flex flex-col">
          <p className="line-clamp-2 text-base font-bold leading-snug text-white drop-shadow-md">
            {library.name}
          </p>
          {konum && (
            <div className="mt-0.5 flex items-center text-xs font-medium text-white/90 drop-shadow-md">
              <span className="line-clamp-1">{konum}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Alt kısım ── */}
      <div className="flex flex-col px-1 pb-1 pt-3">
        <ul className="flex items-center gap-2 text-xs font-medium text-slate-700 ">
          <li className="flex items-center gap-1">
            <StarRating value={library.rating_average ?? 0} single={true} />
            <span className="text-xs font-bold text-slate-900">
              {hasRatings ? (library.rating_average ?? 0).toFixed(1) : "Yeni"}
            </span>
            {hasRatings && (
              <span className="text-slate-500 ">
                ({library.rating_count} değerlendirme)
              </span>
            )}
          </li>
        </ul>
      </div>
    </Link>
  );
}
