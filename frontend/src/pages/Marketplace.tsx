import { useMemo, useRef, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { TutorCard } from "@/components/TutorCard";
import { useTutorSearch } from "@/hooks/useTutorSearch";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDebounce } from "@/hooks/useDebounce";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { Gender, ROLE_IDS, TeachingMode, TutorSort } from "@/types";
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
  // Bu sayfa /egitmenler'in oturum içi (panel chrome'lu) halidir; nav rol bazlı.
  const { data: currentUser } = useCurrentUser();
  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : currentUser?.role_id === ROLE_IDS.CLIENT
        ? STUDENT_NAV
        : undefined;
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [subjects, setSubjects] = useState<string[]>(() =>
    searchParams.getAll("subject")
  );
  // Sınav bağlamı (TYT/AYT/KPSS…) — ana sayfadan gelir; sert filtre değil, boost.
  const [exam, setExam] = useState(() => searchParams.get("exam") ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const qParam = searchParams.get("q");
    const subjectParams = searchParams.getAll("subject");
    const examParam = searchParams.get("exam");
    if (qParam !== null) setQ(qParam);
    if (subjectParams.length) setSubjects(subjectParams);
    setExam(examParam ?? "");
  }, [searchParams]);
  const [minRate, setMinRate] = useState("");
  const [maxRate, setMaxRate] = useState("");
  const [sort, setSort] = useState<TutorSort>(TutorSort.RELEVANCE);
  const [modes, setModes] = useState<TeachingMode[]>([]);
  const [gender, setGender] = useState<Gender | "">("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [limit, setLimit] = useState(20);
  // "Yakınımdaki eğitmenler": tarayıcı konumu + yarıçap (km).
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(25);
  const [geoLoading, setGeoLoading] = useState(false);

  const requestNearMe = () => {
    if (!navigator.geolocation) {
      toast.error("Tarayıcınız konum servisini desteklemiyor.");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNearMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoLoading(false);
      },
      () => {
        toast.error("Konum alınamadı. Lütfen izin verin.");
        setGeoLoading(false);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  const toggleMode = (m: TeachingMode) =>
    setModes((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
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
    if (exam.trim()) p.exam = exam.trim();
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
    if (nearMe) {
      p.lat = nearMe.lat;
      p.lng = nearMe.lng;
      p.radius_km = radiusKm;
    }
    return p;
  }, [
    subjects,
    exam,
    debouncedQ,
    debouncedMin,
    debouncedMax,
    sort,
    modes,
    gender,
    debouncedMinAge,
    debouncedMaxAge,
    limit,
    nearMe,
    radiusKm,
  ]);

  const { data, isLoading, isFetching, isError, error } = useTutorSearch(params);

  const hasFilters =
    !!q || subjects.length > 0 || !!exam || !!minRate || !!maxRate || modes.length > 0 ||
    !!gender || !!minAge || !!maxAge || sort !== TutorSort.RELEVANCE;

  const clearAll = () => {
    setQ("");
    setSubjects([]);
    setExam("");
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
    <DashboardShell title="Eğitmen Bul" navItems={navItems}>
      <div className="mx-auto max-w-[1050px] space-y-4">
        {/* ── Search bar (landing stili pill) & Filter Button ── */}
        <div className="flex gap-2">
          <div className="group flex h-11 flex-1 overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-slate-300 focus-within:ring-2 focus-within:ring-indigo-300 dark:bg-slate-800 dark:shadow-none dark:ring-slate-700 dark:hover:ring-slate-600 dark:focus-within:ring-indigo-500">
            <input
              ref={searchInputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Konu, sınav veya eğitmen ara… (ör. TYT Matematik)"
              className="flex-1 bg-transparent px-5 text-sm sm:text-base text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500"
            />
            <button
              type="button"
              aria-label="Ara"
              onClick={() => searchInputRef.current?.focus()}
              className="flex w-20 sm:w-24 shrink-0 cursor-pointer items-center justify-center bg-gradient-to-r from-indigo-600 to-violet-600 text-white transition hover:from-indigo-700 hover:to-violet-700 active:scale-95"
            >
              <svg className="h-7 w-7 -translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
              </svg>
            </button>
          </div>
          <button
            onClick={() => setShowFilters(true)}
            className="btn-neon-hover flex h-11 shrink-0 items-center gap-2 rounded-full px-5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition active:scale-95 dark:text-slate-200 dark:ring-slate-700"
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

        {/* ── Selected subjects + sınav bağlamı ── */}
        {(subjects.length > 0 || !!exam) && (
          <div className="flex flex-wrap gap-2">
            {exam && (
              <button
                onClick={() => setExam("")}
                title="Sınav bağlamı (sıralamayı etkiler)"
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25"
              >
                {exam}
                <span aria-hidden>✕</span>
              </button>
            )}
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



        {/* ── Results ── */}
        <div>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
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
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
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

              {/* Konum */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Mesafe (Uzaklık)</h3>
                <div className="relative">
                  <select
                    value={nearMe ? radiusKm : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        setNearMe(null);
                        return;
                      }
                      setRadiusKm(Number(val));
                      if (!nearMe) requestNearMe();
                    }}
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-indigo-500"
                  >
                    <option value="">Farketmez (Her Yer)</option>
                    <option value="5">Bana en fazla 5 km uzaklıkta</option>
                    <option value="10">Bana en fazla 10 km uzaklıkta</option>
                    <option value="25">Bana en fazla 25 km uzaklıkta</option>
                    <option value="50">Bana en fazla 50 km uzaklıkta</option>
                    <option value="100">Bana en fazla 100 km uzaklıkta</option>
                  </select>
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </div>
                {geoLoading && <p className="mt-2 text-xs font-medium text-indigo-600 animate-pulse">Konum bilginiz alınıyor...</p>}
                {nearMe && !geoLoading && <p className="mt-2 text-xs font-medium text-emerald-600">✓ Konumunuz kullanılıyor</p>}
              </div>

              {/* Eğitim Modu */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Ders İşleme Şekli</h3>
                <div className="flex flex-wrap gap-2">
                  {MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => toggleMode(opt.value)}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        modes.includes(opt.value)
                          ? "bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-600"
                          : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fiyat */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Maksimum Saatlik Ücret</h3>
                  <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                    {maxRate && Number(maxRate) < 2000 ? `₺${maxRate}` : "Limitsiz"}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2000"
                  step="50"
                  value={maxRate || 2000}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (val >= 2000) setMaxRate("");
                    else setMaxRate(e.target.value);
                  }}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-indigo-600 dark:bg-slate-700"
                />
                <div className="mt-2 flex justify-between text-xs font-medium text-slate-400">
                  <span>₺0</span>
                  <span>₺5000+</span>
                </div>
              </div>

              {/* Cinsiyet */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Cinsiyet</h3>
                <div className="flex flex-wrap gap-2">
                  {GENDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setGender((g) => (g === opt.value ? "" : opt.value))}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        gender === opt.value
                          ? "bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-600"
                          : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

            </div>

            <div className="border-t border-slate-100 p-4 sm:px-6 sm:py-5 dark:border-slate-700 flex gap-3 bg-slate-50 dark:bg-slate-800/50">
              <button
                onClick={clearAll}
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
    </DashboardShell>
  );
}
