import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV } from "@/lib/nav";
import { TutorCard } from "@/components/TutorCard";
import { SubjectMegaMenu } from "@/components/SubjectMegaMenu";
import { useTutorSearch } from "@/hooks/useTutorSearch";
import { useDebounce } from "@/hooks/useDebounce";
import { getErrorMessage } from "@/lib/errors";
import { Gender, TeachingMode, TutorSort } from "@/types";
import type { TutorSearchParams } from "@/api/tutors";

/* ─── options ─────────────────────────────────────────── */

const SORT_OPTIONS: { value: TutorSort; label: string }[] = [
  { value: TutorSort.RELEVANCE, label: "Önerilen" },
  { value: TutorSort.RATING_DESC, label: "★ Puana göre" },
  { value: TutorSort.PRICE_ASC, label: "₺ Ucuzdan pahalıya" },
  { value: TutorSort.PRICE_DESC, label: "₺ Pahalıdan ucuza" },
];

const MODE_OPTIONS: { value: TeachingMode; label: string }[] = [
  { value: TeachingMode.ONLINE, label: "Uzaktan" },
  { value: TeachingMode.IN_PERSON, label: "Yüzyüze" },
];

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: Gender.FEMALE, label: "Kadın" },
  { value: Gender.MALE, label: "Erkek" },
];

/* ─── main page ─────────────────────────────────────────── */

export default function Marketplace() {
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [subjects, setSubjects] = useState<string[]>(() =>
    searchParams.getAll("subject")
  );

  useEffect(() => {
    const qParam = searchParams.get("q");
    const subjectParams = searchParams.getAll("subject");
    if (qParam !== null) setQ(qParam);
    if (subjectParams.length) setSubjects(subjectParams);
  }, [searchParams]);
  const [minRate, setMinRate] = useState("");
  const [maxRate, setMaxRate] = useState("");
  const [sort, setSort] = useState<TutorSort>(TutorSort.RELEVANCE);
  const [modes, setModes] = useState<TeachingMode[]>([]);
  const [gender, setGender] = useState<Gender | "">("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [limit, setLimit] = useState(20);

  const toggleMode = (m: TeachingMode) =>
    setModes((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );

  const addSubject = (s: string) =>
    setSubjects((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  const removeSubject = (s: string) =>
    setSubjects((prev) => prev.filter((x) => x !== s));

  const debouncedQ = useDebounce(q);
  const debouncedMin = useDebounce(minRate);
  const debouncedMax = useDebounce(maxRate);
  const debouncedMinAge = useDebounce(minAge);
  const debouncedMaxAge = useDebounce(maxAge);

  const params = useMemo<TutorSearchParams>(() => {
    const p: TutorSearchParams = { limit, offset: 0, sort };
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    if (subjects.length) p.subject = subjects;
    const min = Number(debouncedMin);
    const max = Number(debouncedMax);
    if (debouncedMin && !Number.isNaN(min) && min >= 0) p.min_rate = min;
    if (debouncedMax && !Number.isNaN(max) && max >= 0) p.max_rate = max;
    if (modes.length) p.mode = modes;
    if (gender) p.gender = gender;
    const minA = Number(debouncedMinAge);
    const maxA = Number(debouncedMaxAge);
    if (debouncedMinAge && !Number.isNaN(minA) && minA >= 0) p.min_age = minA;
    if (debouncedMaxAge && !Number.isNaN(maxA) && maxA >= 0) p.max_age = maxA;
    return p;
  }, [
    subjects,
    debouncedQ,
    debouncedMin,
    debouncedMax,
    sort,
    modes,
    gender,
    debouncedMinAge,
    debouncedMaxAge,
    limit,
  ]);

  const { data, isLoading, isFetching, isError, error } = useTutorSearch(params);

  const hasFilters =
    !!q || subjects.length > 0 || !!minRate || !!maxRate || modes.length > 0 ||
    !!gender || !!minAge || !!maxAge || sort !== TutorSort.RELEVANCE;

  const clearAll = () => {
    setQ("");
    setSubjects([]);
    setMinRate("");
    setMaxRate("");
    setSort(TutorSort.RELEVANCE);
    setModes([]);
    setGender("");
    setMinAge("");
    setMaxAge("");
    setLimit(20);
  };

  return (
    <DashboardShell title="Marketplace" navItems={STUDENT_NAV}>
      {/* Subject mega menu */}
      <div className="-mx-4 -mt-4 mb-6 bg-slate-700 px-4 py-2 dark:bg-slate-950 sm:-mx-6 sm:-mt-6 sm:px-6">
        <SubjectMegaMenu value="" onSelect={addSubject} />
      </div>

      <div className="mx-auto max-w-6xl space-y-4">
        {/* ── Search bar ── */}
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

        {/* ── Selected subjects ── */}
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

        {/* ── Filter bar ── */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
          {/* Sort pills */}
          <div className="flex flex-wrap items-center gap-1.5">
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

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Teaching mode pills */}
          <div className="flex items-center gap-1.5">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => toggleMode(opt.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  modes.includes(opt.value)
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Price range */}
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-slate-400">₺</span>
              <input
                type="number"
                min={0}
                value={minRate}
                onChange={(e) => setMinRate(e.target.value)}
                placeholder="Min"
                className="w-20 rounded-xl border border-slate-200 bg-white py-1.5 pl-6 pr-2 text-xs text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
              />
            </div>
            <span className="text-xs text-slate-400">—</span>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-slate-400">₺</span>
              <input
                type="number"
                min={0}
                value={maxRate}
                onChange={(e) => setMaxRate(e.target.value)}
                placeholder="Max"
                className="w-20 rounded-xl border border-slate-200 bg-white py-1.5 pl-6 pr-2 text-xs text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
              />
            </div>
          </div>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Gender pills */}
          <div className="flex items-center gap-1.5">
            {GENDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() =>
                  setGender((g) => (g === opt.value ? "" : opt.value))
                }
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  gender === opt.value
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Age range */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">Yaş</span>
            <input
              type="number"
              min={0}
              max={120}
              value={minAge}
              onChange={(e) => setMinAge(e.target.value)}
              placeholder="Min"
              className="w-16 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
            />
            <span className="text-xs text-slate-400">—</span>
            <input
              type="number"
              min={0}
              max={120}
              value={maxAge}
              onChange={(e) => setMaxAge(e.target.value)}
              placeholder="Max"
              className="w-16 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
            />
          </div>

          {/* Clear filters */}
          {hasFilters && (
            <>
              <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
              <button
                onClick={clearAll}
                className="text-xs font-medium text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
              >
                Temizle
              </button>
            </>
          )}
        </div>

        {/* ── Results ── */}
        <div>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-52 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
                />
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
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Filtrelerini değiştirerek tekrar dene
              </p>
              {hasFilters && (
                <button
                  onClick={clearAll}
                  className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  Tüm filtreleri temizle
                </button>
              )}
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
                  <TutorCard key={tutor.id} tutor={tutor} />
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
    </DashboardShell>
  );
}
