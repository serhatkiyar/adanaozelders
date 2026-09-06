import { useNavigate } from "react-router-dom";
import {
  useLibraryBookmarks,
  useToggleLibraryBookmark,
} from "@/hooks/useLibraryBookmarks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { setPendingFavorite } from "@/lib/pendingFavorite";
import { alisverisYapabilir } from "@/lib/roles";

interface LibraryBookmarkButtonProps {
  libraryId: number;
  size?: "sm" | "md" | "lg";
  /** Detay sayfasında metinli (genişletilmiş) varyant. */
  withLabel?: boolean;
}

export function LibraryBookmarkButton({
  libraryId,
  size = "sm",
  withLabel = false,
}: LibraryBookmarkButtonProps) {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const { data: bookmarks } = useLibraryBookmarks();
  const toggle = useToggleLibraryBookmark();

  // Favorileyebilen roller: üye VE eğitmen (ÜK-6 · docs/urun-kararlari.md).
  // Eğitmenin isteği sunucuda gölge `Client`e çevrilir; admin/operatör/kurye
  // 403 alacağı için düğme onlara HÂLÂ gösterilmez.
  // Anonim ziyaretçiye gösterilir → tıklayınca giriş modalı açılır.
  if (user && !alisverisYapabilir(user.role_id)) return null;

  const bookmarked = !!bookmarks?.some((l) => l.id === libraryId);

  const click = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      // Niyeti sakla: giriş tamamlanınca PendingFavoriteApplier uygular.
      setPendingFavorite({ type: "library", id: libraryId });
      navigate("?modal=login");
      return;
    }
    toggle.mutate({ libraryId, bookmarked });
  };

  const icon = (
    <svg
      viewBox="0 0 24 24"
      fill={bookmarked ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      className={size === "md" ? "h-5 w-5" : "h-4 w-4"}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
      />
    </svg>
  );

  if (withLabel) {
    return (
      <button
        type="button"
        onClick={click}
        disabled={toggle.isPending}
        aria-pressed={bookmarked}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold shadow-sm transition active:scale-95 disabled:opacity-50 ${
          bookmarked
            ? "bg-rose-50 text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100 "
            : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 "
        }`}
      >
        {icon}
        {bookmarked ? "Favoride" : "Favorile"}
      </button>
    );
  }

  const glyph =
    size === "lg" ? "h-8 w-8" : size === "md" ? "h-7 w-7" : "h-6 w-6";
  return (
    <button
      type="button"
      onClick={click}
      disabled={toggle.isPending}
      aria-label={bookmarked ? "Favorilerden çıkar" : "Favorilere ekle"}
      title={bookmarked ? "Favorilerden çıkar" : "Favorilere ekle"}
      aria-pressed={bookmarked}
      className="shrink-0 transition active:scale-90 hover:scale-110 disabled:opacity-50"
    >
      {/* Airbnb tarzı kalp: dolgu (pasif: yarı saydam siyah / aktif: rose) +
          beyaz kenar + görsel üzerinde okunurluk için gölge.
          `BookmarkButton` ile AYNI değerler — ikisi de aynı kart yüzeyinde
          yan yana çıkıyor, ayrışırlarsa göze çarpar. */}
      <svg
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        className={`${glyph} stroke-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] transition-colors ${
          bookmarked ? "fill-rose-500" : "fill-black/30"
        }`}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
        />
      </svg>
    </button>
  );
}
