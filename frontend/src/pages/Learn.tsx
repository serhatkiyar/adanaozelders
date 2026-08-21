import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { navForRole, STUDENT_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROUTES } from "@/lib/routes";
import { DENEMELER_ACIK } from "@/lib/ozellikBayraklari";
import { YakindaRozeti } from "@/components/YakindaRozeti";

export default function Learn() {
  const { data: user } = useCurrentUser();
  const navItems = navForRole(user?.role_id) ?? STUDENT_NAV;

  return (
    <DashboardShell title="Öğren" navItems={navItems}>
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Öğren</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Kendi başına çalışmana yardımcı araçlar.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* Aralıklı Tekrar (FSRS) — eski SM-2 "Kelime Kartları" kartının yerini aldı */}
          <Link
            to={ROUTES.srs}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 to-cyan-700 p-6 text-white shadow-lg shadow-teal-500/20 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold">Aralıklı Tekrar</h2>
              <p className="mt-1 text-sm text-teal-50">
                FSRS algoritmasıyla tam zamanında tekrar: desteler, cloze ve yazarak
                cevaplama, günlük kuyruk ve istatistik.
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

          {/* Alışkanlıklar */}
          <Link
            to={ROUTES.habits}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 p-6 text-white shadow-lg shadow-amber-500/20 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 0 0 .495-7.467 5.99 5.99 0 0 0-1.925 3.546 5.974 5.974 0 0 1-2.133-1A3.75 3.75 0 0 0 12 18Z" />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold">Alışkanlıklar</h2>
              <p className="mt-1 text-sm text-amber-50">
                Çalışma disiplinini kur: günlük/haftalık hedefler, seri (streak) takibi
                ve ısı haritasıyla istikrarını gör.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
                Başla
                <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </Link>

          {/* Görevlerim */}
          <Link
            to={ROUTES.tasks}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-pink-500 to-rose-600 p-6 text-white shadow-lg shadow-pink-500/20 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold">Görevlerim</h2>
              <p className="mt-1 text-sm text-pink-50">
                Tamamlaman gereken ödevleri, hedefleri ve yapılacakları takip et. Planlı çalış.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
                Başla
                <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </Link>

          {/* Sorularım */}
          <Link
            to={ROUTES.questions}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-fuchsia-600 to-purple-600 p-6 text-white shadow-lg shadow-purple-500/20 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold">Sorularım</h2>
              <p className="mt-1 text-sm text-fuchsia-50">
                Çözemediğin soruları sor, uzman eğitmenlerden adım adım destek al.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
                Başla
                <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </Link>
          {/* Denemelerim — bölüm donduruldu (bkz. lib/ozellikBayraklari.ts).
              Kart menüde GÖRÜNÜR kalır ama bağlantı değildir. */}
          {DENEMELER_ACIK ? (
          <Link
            to={ROUTES.exams}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-700 p-6 text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9z" />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold">Denemelerim</h2>
              <p className="mt-1 text-sm text-indigo-50">
                Girdiğin deneme sınavlarını kaydet, netlerini ve ilerlemeni analiz et.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
                Başla
                <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </Link>
          ) : (
          <span
            aria-disabled="true"
            tabIndex={-1}
            className="group relative block cursor-default overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-700 p-6 text-white opacity-60 shadow-lg shadow-indigo-500/20"
          >
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9z" />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold">Denemelerim</h2>
              <p className="mt-1 text-sm text-indigo-50">
                Girdiğin deneme sınavlarını kaydet, netlerini ve ilerlemeni analiz et.
              </p>
              <YakindaRozeti className="mt-4 !bg-white/20 !text-white" />
            </div>
          </span>
          )}

          {/* Takvim */}
          <Link
            to={ROUTES.calendar}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-500 to-blue-600 p-6 text-white shadow-lg shadow-blue-500/20 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                </svg>
              </span>
              <h2 className="mt-4 text-lg font-bold">Takvim</h2>
              <p className="mt-1 text-sm text-blue-50">
                Tüm derslerini, ödevlerini ve deneme sınavlarını takvim üzerinde görerek programını yönet.
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
                Başla
                <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </Link>
        </div>
      </div>
    </DashboardShell>
  );
}
