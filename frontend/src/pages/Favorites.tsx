import { useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV } from "@/lib/nav";
import { TutorCard } from "@/components/TutorCard";
import { LibraryCard } from "@/components/LibraryCard";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useLibraryBookmarks } from "@/hooks/useLibraryBookmarks";
import { ROUTES } from "@/lib/routes";

type Tab = "tutors" | "libraries";

export default function Favorites() {
  const [tab, setTab] = useState<Tab>("tutors");
  const { data: tutors, isLoading: tutorsLoading } = useBookmarks();
  const { data: libraries, isLoading: librariesLoading } = useLibraryBookmarks();

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "tutors", label: "Eğitmenler", count: tutors?.length ?? 0 },
    { key: "libraries", label: "Kütüphaneler", count: libraries?.length ?? 0 },
  ];

  return (
    <DashboardShell title="Favorilerim" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-[1050px] space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Favorilerim
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Kaydettiğin eğitmenleri ve kütüphaneleri buradan inceleyebilirsin.
          </p>
        </div>

        {/* ── Sekmeler ── */}
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                tab === t.key
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className="ml-1.5 text-xs text-slate-400">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {tab === "tutors" ? (
          <TutorsTab data={tutors} isLoading={tutorsLoading} />
        ) : (
          <LibrariesTab data={libraries} isLoading={librariesLoading} />
        )}
      </div>
    </DashboardShell>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-52 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
        />
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
  ctaTo,
  ctaLabel,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  ctaTo: string;
  ctaLabel: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center dark:border-slate-700">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-indigo-500 dark:bg-slate-800 dark:text-indigo-400">
        {icon}
      </div>
      <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
        {title}
      </p>
      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p>
      <Link
        to={ctaTo}
        className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

function TutorsTab({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useBookmarks>["data"];
  isLoading: boolean;
}) {
  if (isLoading) return <GridSkeleton />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-7 w-7">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
          </svg>
        }
        title="Henüz favori eğitmenin yok"
        hint="Eğitmen kartındaki kaydet ikonuna dokunarak favorilerine ekleyebilirsin."
        ctaTo={ROUTES.tutors}
        ctaLabel="Eğitmenleri keşfet"
      />
    );
  }
  return (
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
  );
}

function LibrariesTab({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useLibraryBookmarks>["data"];
  isLoading: boolean;
}) {
  if (isLoading) return <GridSkeleton />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-7 w-7">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
          </svg>
        }
        title="Henüz favori kütüphanen yok"
        hint="Kütüphane kartındaki kalp ikonuna dokunarak favorilerine ekleyebilirsin."
        ctaTo={ROUTES.libraries}
        ctaLabel="Kütüphaneleri keşfet"
      />
    );
  }
  return (
    <>
      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
        {data.length} favori kütüphane
      </p>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((library) => (
          <LibraryCard key={library.id} library={library} />
        ))}
      </div>
    </>
  );
}
