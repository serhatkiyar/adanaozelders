import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PublicShell } from "@/components/PublicShell";
import { TutorCard } from "@/components/TutorCard";
import { SubjectMegaMenu } from "@/components/SubjectMegaMenu";
import { useTutorSearch } from "@/hooks/useTutorSearch";
import { useDebounce } from "@/hooks/useDebounce";
import { getErrorMessage } from "@/lib/errors";
import { TutorSort } from "@/types";
import type { TutorSearchParams } from "@/api/tutors";

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

  useEffect(() => {
    const qp = searchParams.get("q");
    const sp = searchParams.getAll("subject");
    if (qp !== null) setQ(qp);
    if (sp.length) setSubjects(sp);
  }, [searchParams]);

  const debouncedQ = useDebounce(q);

  const addSubject = (s: string) =>
    setSubjects((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
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
      {/* Subject mega menu strip */}
      <div className="-mx-4 -mt-4 mb-6 bg-slate-700 px-4 py-2 dark:bg-slate-950 sm:-mx-6 sm:-mt-6 sm:px-6">
        <SubjectMegaMenu value="" onSelect={addSubject} />
      </div>

      <div className="mx-auto max-w-6xl space-y-4">
        {/* Login CTA banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3.5 text-white">
          <p className="text-sm font-medium">
            Eğitmenleri keşfet. Rezervasyon ve mesaj için ücretsiz hesap aç.
          </p>
          <div className="flex shrink-0 gap-2">
            <Link
              to="/login"
              className="rounded-xl bg-white/15 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/25"
            >
              Giriş Yap
            </Link>
            <Link
              to="/register"
              className="rounded-xl bg-white px-3 py-1.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50"
            >
              Kayıt Ol
            </Link>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
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
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500 dark:focus:border-indigo-500"
          />
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

        {/* Sort pills */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSort(opt.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                sort === opt.value
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.map((tutor) => (
                  <TutorCard
                    key={tutor.id}
                    tutor={tutor}
                    hrefBase="/egitmen"
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
    </PublicShell>
  );
}
