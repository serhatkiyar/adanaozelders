import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV } from "@/lib/nav";
import { TutorCard } from "@/components/TutorCard";
import { useBookmarks } from "@/hooks/useBookmarks";
import { ROUTES } from "@/lib/routes";

export default function Favorites() {
  const { data, isLoading } = useBookmarks();

  return (
    <DashboardShell title="Favorilerim" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-[1050px] space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Favorilerim
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Kaydettiğin eğitmenleri buradan inceleyebilir ve profillerine ulaşabilirsin.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-52 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
              />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center dark:border-slate-700">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-indigo-500 dark:bg-slate-800 dark:text-indigo-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-7 w-7">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
              </svg>
            </div>
            <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
              Henüz favori eğitmenin yok
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Eğitmen kartındaki kaydet (bookmark) ikonuna dokunarak favorilerine ekleyebilirsin.
            </p>
            <Link
              to={ROUTES.tutors}
              className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Eğitmenleri keşfet
            </Link>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
              {data.length} favori eğitmen
            </p>
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {data.map((tutor) => (
                <TutorCard key={tutor.id} tutor={tutor} />
              ))}
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
