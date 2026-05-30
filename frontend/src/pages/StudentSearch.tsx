import { useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { TUTOR_NAV } from "@/lib/nav";
import { ClientCard } from "@/components/ClientCard";
import { useClientSearch } from "@/hooks/useClientProfile";
import { useDebounce } from "@/hooks/useDebounce";
import { getErrorMessage } from "@/lib/errors";
import { Gender } from "@/types";
import type { ClientSearchParams } from "@/api/clients";

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: Gender.FEMALE, label: "Kadın" },
  { value: Gender.MALE, label: "Erkek" },
];

export default function StudentSearch() {
  const [q, setQ] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");

  const debouncedQ = useDebounce(q);
  const debouncedMinAge = useDebounce(minAge);
  const debouncedMaxAge = useDebounce(maxAge);

  const params = useMemo<ClientSearchParams>(() => {
    const p: ClientSearchParams = { limit: 24, offset: 0 };
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    if (gender) p.gender = gender;
    const minA = Number(debouncedMinAge);
    const maxA = Number(debouncedMaxAge);
    if (debouncedMinAge && !Number.isNaN(minA) && minA >= 0) p.min_age = minA;
    if (debouncedMaxAge && !Number.isNaN(maxA) && maxA >= 0) p.max_age = maxA;
    return p;
  }, [debouncedQ, gender, debouncedMinAge, debouncedMaxAge]);

  const { data, isLoading, isFetching, isError, error } = useClientSearch(params);

  const hasFilters = !!q || !!gender || !!minAge || !!maxAge;

  const clearAll = () => {
    setQ("");
    setGender("");
    setMinAge("");
    setMaxAge("");
  };

  return (
    <DashboardShell title="Öğrenci Ara" navItems={TUTOR_NAV}>
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
            placeholder="İsim veya kullanıcı adı ara…"
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500 dark:focus:border-indigo-500"
          />
        </div>

        {/* ── Filter bar ── */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
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
                  className="h-44 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
                />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-800/30">
              <span>⚠</span>
              {getErrorMessage(error, "Öğrenciler yüklenemedi.")}
            </div>
          ) : !data || data.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center dark:border-slate-700">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">
                🔍
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
                Kriterlere uyan öğrenci bulunamadı
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Aramayı veya filtreleri değiştirerek tekrar dene
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
                <span>{data.length} öğrenci listeleniyor</span>
                {isFetching && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                    Güncelleniyor
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.map((client) => (
                  <ClientCard key={client.id} client={client} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
