import { useBookmarks, useToggleBookmark } from "@/hooks/useBookmarks";

interface BookmarkButtonProps {
  tutorId: number;
  size?: "sm" | "md";
}

export function BookmarkButton({ tutorId, size = "sm" }: BookmarkButtonProps) {
  const { data: bookmarks } = useBookmarks();
  const toggle = useToggleBookmark();
  const bookmarked = !!bookmarks?.some((t) => t.id === tutorId);

  const dim = size === "md" ? "h-9 w-9" : "h-8 w-8";
  const icon = size === "md" ? "h-5 w-5" : "h-4 w-4";

  return (
    <button
      type="button"
      aria-label={bookmarked ? "Favorilerden çıkar" : "Favorilere ekle"}
      title={bookmarked ? "Favorilerden çıkar" : "Favorilere ekle"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle.mutate({ tutorId, bookmarked });
      }}
      disabled={toggle.isPending}
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-50 ${
        bookmarked
          ? "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-400"
          : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={bookmarked ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={2}
        className={icon}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
        />
      </svg>
    </button>
  );
}
