import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROLE_IDS } from "@/types";
import { ROUTES } from "@/lib/routes";

export default function Learn() {
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : STUDENT_NAV;

  return (
    <DashboardShell title="Öğren" navItems={navItems}>
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Öğren</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Kendi başına çalışmana yardımcı araçlar.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* Kelime Kartları */}
          <Link
            to={ROUTES.flashcards}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-600 p-6 text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold">Kelime Kartları</h2>
              <p className="mt-1 text-sm text-indigo-100">
                Aralıklı tekrar (SRS) ile kalıcı öğrenme. Kendi destelerini oluştur,
                her gün tekrarla.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
                Başla
                <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </Link>

          {/* Zamanlayıcı (Derin Çalışma) */}
          <Link
            to={ROUTES.deepwork}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-600 p-6 text-white shadow-lg shadow-emerald-500/20 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <circle cx="12" cy="13" r="8" strokeLinecap="round" strokeLinejoin="round" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4l2.5 2.5M9 2h6" />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold">Zamanlayıcı</h2>
              <p className="mt-1 text-sm text-emerald-50">
                Pomodoro tekniğiyle derin çalış: odak/mola döngüleri, sesli uyarı,
                bildirim ve günlük odak istatistiği.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
                Başla
                <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </Link>

          {/* Grafik Çizici */}
          <Link
            to={ROUTES.grapher}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-600 to-cyan-600 p-6 text-white shadow-lg shadow-sky-500/20 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7c-3 0-3 8-6 8s-3-6-6-6" />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold">Grafik Çizici</h2>
              <p className="mt-1 text-sm text-sky-50">
                TYT/AYT için fonksiyon grafikleri: formülü yaz, çizdir, yakınlaştır,
                kökleri gör ve PNG olarak indir.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
                Başla
                <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </Link>

          {/* Yakında gelecek araçlar */}
          {["Notlarım", "Mini Testler"].map((label) => (
            <div
              key={label}
              className="relative flex flex-col rounded-3xl border border-dashed border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold text-slate-700 dark:text-slate-200">
                {label}
              </h2>
              <span className="mt-2 inline-block w-fit rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                Yakında
              </span>
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
