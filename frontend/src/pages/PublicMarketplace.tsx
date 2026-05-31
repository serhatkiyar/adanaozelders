import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PublicShell } from "@/components/PublicShell";
import { TutorCard } from "@/components/TutorCard";
import { useTutorSearch } from "@/hooks/useTutorSearch";
import { useDebounce } from "@/hooks/useDebounce";
import { getErrorMessage } from "@/lib/errors";
import { TutorSort } from "@/types";
import type { TutorSearchParams } from "@/api/tutors";
import { ROUTES } from "@/lib/routes";

const SORT_OPTIONS: { value: TutorSort; label: string }[] = [
  { value: TutorSort.RELEVANCE, label: "Önerilen" },
  { value: TutorSort.RATING_DESC, label: "★ Puana göre" },
  { value: TutorSort.PRICE_ASC, label: "₺ Ucuzdan pahalıya" },
  { value: TutorSort.PRICE_DESC, label: "₺ Pahalıdan ucuza" },
];

export default function PublicMarketplace() {
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [subjects, setSubjects] = useState<string[]>(() =>
    searchParams.getAll("subject")
  );
  const [sort, setSort] = useState<TutorSort>(TutorSort.RELEVANCE);
  const [limit, setLimit] = useState(20);
  const [showFilters, setShowFilters] = useState(false);
  const hasFilters = sort !== TutorSort.RELEVANCE;

  useEffect(() => {
    const qp = searchParams.get("q");
    const sp = searchParams.getAll("subject");
    if (qp !== null) setQ(qp);
    if (sp.length) setSubjects(sp);
  }, [searchParams]);

  const debouncedQ = useDebounce(q);

  const removeSubject = (s: string) =>
    setSubjects((p) => p.filter((x) => x !== s));

  const params = useMemo<TutorSearchParams>(() => {
    const p: TutorSearchParams = { limit, offset: 0, sort };
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    if (subjects.length) p.subject = subjects;
    return p;
  }, [debouncedQ, subjects, sort, limit]);

  const { data, isLoading, isFetching, isError, error } = useTutorSearch(params);

  return (
    <PublicShell title="Keşfet">
      <div className="mx-auto max-w-[1050px] space-y-4">
        {/* Login CTA banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3.5 text-white">
          <p className="text-sm font-medium">
            Eğitmenleri keşfet. Ders talebi ve mesaj için ücretsiz hesap aç.
          </p>
          <div className="flex shrink-0 gap-2">
            <Link
              to="?modal=login"
              className="rounded-xl bg-white/15 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/25"
            >
              Giriş Yap
            </Link>
            <Link
              to={ROUTES.register}
              className="rounded-xl bg-white px-3 py-1.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
            >
              Kayıt Ol
            </Link>
          </div>
        </div>

        {/* Search bar & Filter Button */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
              </svg>
            </span>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Eğitmen, konu veya alan ara…"
              className="w-full h-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500 dark:focus:border-indigo-500"
            />
          </div>
          <button
            onClick={() => setShowFilters(true)}
            className="btn-neon-hover flex shrink-0 items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition active:scale-95 dark:text-slate-200 dark:ring-slate-700"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clipRule="evenodd" />
            </svg>
            <span className="hidden sm:inline">Filtrele</span>
            {hasFilters && (
              <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                ✓
              </span>
            )}
          </button>
        </div>

        {/* Selected subjects */}
        {subjects.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {subjects.map((s) => (
              <button
                key={s}
                onClick={() => removeSubject(s)}
                className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
              >
                {s}
                <span aria-hidden>✕</span>
              </button>
            ))}
          </div>
        )}



        {/* Results */}
        <div>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-52 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-800/30">
              <span>⚠</span>
              {getErrorMessage(error, "Eğitmenler yüklenemedi.")}
            </div>
          ) : !data || data.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center dark:border-slate-700">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">
                🔍
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
                Kriterlere uyan eğitmen bulunamadı
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
                <span>{data.length} eğitmen listeleniyor</span>
                {isFetching && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                    Güncelleniyor
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {data.map((tutor) => (
                  <TutorCard
                    key={tutor.id}
                    tutor={tutor}
                    showBookmark={false}
                  />
                ))}
              </div>
              {data.length === limit && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setLimit((l) => l + 20)}
                    disabled={isFetching}
                    className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-indigo-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-indigo-50 active:scale-95 disabled:opacity-60 dark:bg-slate-800 dark:text-indigo-300 dark:ring-slate-700 dark:hover:bg-slate-700"
                  >
                    {isFetching ? "Yükleniyor…" : "Daha fazla göster"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Filter Modal ── */}
      {showFilters && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-4 sm:p-6 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="absolute inset-0" onClick={() => setShowFilters(false)} />
          <div className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 dark:bg-slate-800 dark:ring-slate-700 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Filtrele ve Sırala</h2>
              <button
                onClick={() => setShowFilters(false)}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {/* Sıralama */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Sıralama</h3>
                <div className="flex flex-wrap gap-2">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSort(opt.value)}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        sort === opt.value
                          ? "bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-600"
                          : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Login Banner in Modal */}
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/5">
                <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-300">Daha fazla filtre mi arıyorsunuz?</h3>
                <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-400">
                  Konum, cinsiyet, ders işleme şekli ve daha birçok filtre için ücretsiz hesap oluşturun.
                </p>
                <Link
                  to="?modal=register"
                  className="mt-3 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                  onClick={() => setShowFilters(false)}
                >
                  Kayıt Ol
                </Link>
              </div>

            </div>

            <div className="border-t border-slate-100 p-4 sm:px-6 sm:py-5 dark:border-slate-700 flex gap-3 bg-slate-50 dark:bg-slate-800/50">
              <button
                onClick={() => setSort(TutorSort.RELEVANCE)}
                className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700"
              >
                Temizle
              </button>
              <button
                onClick={() => setShowFilters(false)}
                className="flex-[2] rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-500/20 transition hover:bg-indigo-700 active:scale-95"
              >
                Sonuçları Göster
              </button>
            </div>
          </div>
        </div>
      )}
    </PublicShell>
  );
}
