import { useNavigate } from "react-router-dom";
import { useBookmarks, useToggleBookmark } from "@/hooks/useBookmarks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { setPendingFavorite } from "@/lib/pendingFavorite";
import { ROLE_IDS } from "@/types";

interface BookmarkButtonProps {
  tutorId: number;
  size?: "sm" | "md" | "lg";
  /**
   * Düz (fotoğrafsız) bir zemin üzerinde mi duruyor? true iken tema-güvenli
   * nötr kalp; false (varsayılan) iken görsel üzerinde Airbnb tarzı
   * yarı-saydam dolgu + beyaz kenar + gölge.
   */
  onSolid?: boolean;
}

export function BookmarkButton({
  tutorId,
  size = "sm",
  onSolid = false,
}: BookmarkButtonProps) {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const { data: bookmarks } = useBookmarks();
  const toggle = useToggleBookmark();
  const bookmarked = !!bookmarks?.some((t) => t.id === tutorId);

  // Yalnız öğrenciler favorileyebilir; eğitmen/admin'e gösterme.
  // Anonim ziyaretçiye gösterilir → tıklayınca giriş modalı açılır.
  if (user && user.role_id !== ROLE_IDS.CLIENT) return null;

  const icon =
    size === "lg" ? "h-8 w-8" : size === "md" ? "h-7 w-7" : "h-6 w-6";

  // Airbnb tarzı kalp: dolgu (pasif/aktif) + okunurluk için kenar/gölge.
  const fillCls = onSolid
    ? bookmarked
      ? "fill-rose-500 stroke-rose-500"
      : "fill-slate-300 stroke-slate-300 dark:fill-slate-600 dark:stroke-slate-600"
    : bookmarked
      ? "fill-rose-500 stroke-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
      : "fill-black/50 stroke-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]";

  return (
    <button
      type="button"
      aria-label={bookmarked ? "Favorilerden çıkar" : "Favorilere ekle"}
      title={bookmarked ? "Favorilerden çıkar" : "Favorilere ekle"}
      aria-pressed={bookmarked}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!user) {
          // Niyeti sakla: giriş tamamlanınca PendingFavoriteApplier uygular.
          setPendingFavorite({ type: "tutor", id: tutorId });
          navigate("?modal=login");
          return;
        }
        toggle.mutate({ tutorId, bookmarked });
      }}
      disabled={toggle.isPending}
      className="shrink-0 transition active:scale-90 hover:scale-110 disabled:opacity-50"
    >
      <svg
        viewBox="0 0 24 24"
        strokeWidth={2}
        className={`${icon} transition-colors ${fillCls}`}
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
