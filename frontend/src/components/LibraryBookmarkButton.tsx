import {
  useLibraryBookmarks,
  useToggleLibraryBookmark,
} from "@/hooks/useLibraryBookmarks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROLE_IDS } from "@/types";

interface LibraryBookmarkButtonProps {
  libraryId: number;
  size?: "sm" | "md";
  /** Detay sayfasında metinli (genişletilmiş) varyant. */
  withLabel?: boolean;
}

export function LibraryBookmarkButton({
  libraryId,
  size = "sm",
  withLabel = false,
}: LibraryBookmarkButtonProps) {
  const { data: user } = useCurrentUser();
  const { data: bookmarks } = useLibraryBookmarks();
  const toggle = useToggleLibraryBookmark();

  // Yalnız öğrenciler favorileyebilir (anonim/eğitmen/admin'e gösterme).
  if (user?.role_id !== ROLE_IDS.CLIENT) return null;

  const bookmarked = !!bookmarks?.some((l) => l.id === libraryId);

  const click = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
            ? "bg-rose-50 text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30"
            : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-600"
        }`}
      >
        {icon}
        {bookmarked ? "Favoride" : "Favorile"}
      </button>
    );
  }

  const dim = size === "md" ? "h-9 w-9" : "h-8 w-8";
  return (
    <button
      type="button"
      onClick={click}
      disabled={toggle.isPending}
      aria-label={bookmarked ? "Favorilerden çıkar" : "Favorilere ekle"}
      title={bookmarked ? "Favorilerden çıkar" : "Favorilere ekle"}
      aria-pressed={bookmarked}
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full shadow-sm transition active:scale-90 disabled:opacity-50 ${
        bookmarked
          ? "bg-rose-500 text-white hover:bg-rose-600"
          : "bg-white/90 text-slate-600 backdrop-blur hover:bg-white hover:text-rose-500 dark:bg-slate-800/90 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {icon}
    </button>
  );
}
