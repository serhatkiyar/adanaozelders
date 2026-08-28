import { type CSSProperties, useMemo, useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { TutorCard } from "@/components/TutorCard";
import { PriceRangeHistogram } from "@/components/PriceRangeHistogram";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useTutorSearch, useTutorPriceHistogram } from "@/hooks/useTutorSearch";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDebounce } from "@/hooks/useDebounce";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { Gender, ROLE_IDS, TeachingMode, TutorSort } from "@/types";
import type { TutorSearchParams } from "@/api/tutors";
import { CategoryBar } from "@/components/CategoryBar";
import { BigSearch, CompactSearch } from "@/components/HeroSearch";
import { TRENDING_SEARCHES } from "@/lib/trendingSearches";

/* ─── options ─────────────────────────────────────────── */

const SORT_OPTIONS: { value: TutorSort; label: string }[] = [
  { value: TutorSort.RELEVANCE, label: "Sıralama: Önerilen" },
  { value: TutorSort.RATING_DESC, label: "Sıralama: En Yüksek Puan" },
  { value: TutorSort.PRICE_ASC, label: "Sıralama: En Düşük Fiyat" },
];

const MODE_ALL = "ALL" as const;
const MODE_SEGMENTS: { value: TeachingMode | typeof MODE_ALL; label: string }[] = [
  { value: MODE_ALL, label: "Tümü" },
  { value: TeachingMode.ONLINE, label: "Uzaktan" },
  { value: TeachingMode.IN_PERSON, label: "Yüzyüze" },
];

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: Gender.FEMALE, label: "Kadın" },
  { value: Gender.MALE, label: "Erkek" },
];

/* ─── icon helpers ─────────────────────────────────────── */

const FilterIconSvg = () => (
  <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clipRule="evenodd" />
  </svg>
);

/* ─── main page ─────────────────────────────────────────── */

export default function Marketplace() {
  const { data: currentUser } = useCurrentUser();
  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : currentUser?.role_id === ROLE_IDS.CLIENT
        ? STUDENT_NAV
        : undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [district, setDistrict] = useState<string[]>(() => searchParams.getAll("district"));
  const [subjects, setSubjects] = useState<string[]>(() => searchParams.getAll("subject"));
  const [exam, setExam] = useState(() => searchParams.get("exam") ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pricePopoverOpen, setPricePopoverOpen] = useState(false);
  const [pricePopoverPos, setPricePopoverPos] = useState<{top: number, left: number} | null>(null);
  const pricePopoverRef = useRef<HTMLButtonElement>(null);

  const setSurface = useSurfaceStore((s) => s.setSurface);

  // /hesabim bağlama duyarlı navbar: son yüzey = keşif.
  useEffect(() => {
    setSurface("discover");
  }, [setSurface]);

  const togglePricePopover = () => {
    if (pricePopoverOpen) {
      setPricePopoverOpen(false);
      return;
    }
    const r = pricePopoverRef.current?.getBoundingClientRect();
    if (r) {
      setPricePopoverPos({ top: r.bottom + 8, left: r.left });
    }
    setPricePopoverOpen(true);
  };

  // Dış navigasyon (geri/ileri, link) state'i günceller.
  // Guard: yalnız farklıysa güncelle (state→URL sync ile döngü engeli).
  useEffect(() => {
    const qParam = searchParams.get("q") ?? "";
    const subjectParams = searchParams.getAll("subject");
    const examParam = searchParams.get("exam") ?? "";
    const districtParams = searchParams.getAll("district");
    if (qParam !== q) setQ(qParam);
    if (JSON.stringify(subjectParams) !== JSON.stringify(subjects))
      setSubjects(subjectParams);
    if (JSON.stringify(districtParams) !== JSON.stringify(district))
      setDistrict(districtParams);
    if (examParam !== exam) setExam(examParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const [minRate, setMinRate] = useState("");
  const [maxRate, setMaxRate] = useState("");
  const [sort, setSort] = useState<TutorSort>(TutorSort.RELEVANCE);
  const [modes, setModes] = useState<TeachingMode[]>(() =>
    searchParams
      .getAll("mode")
      .filter((m): m is TeachingMode => (Object.values(TeachingMode) as string[]).includes(m)) as TeachingMode[]
  );
  const [gender, setGender] = useState<Gender | "">("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [limit, setLimit] = useState(20);
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

  const modeSegment: TeachingMode | typeof MODE_ALL = modes[0] ?? MODE_ALL;
  const selectMode = (v: TeachingMode | typeof MODE_ALL) =>
    setModes(v === MODE_ALL ? [] : [v]);
  const isAllMode = modes.length === 0;

  const removeSubject = (s: string) =>
    setSubjects((prev) => prev.filter((x) => x !== s));

  const debouncedQ = useDebounce(q);

  // ── URL ↔ state senkronizasyonu ──────────────────────────────────────
  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedQ.trim()) next.set("q", debouncedQ.trim());
    subjects.forEach((s) => next.append("subject", s));
    district.forEach((d) => next.append("district", d));
    modes.forEach((m) => next.append("mode", m));
    if (exam.trim()) next.set("exam", exam.trim());
    setSearchParams(next, { replace: true });
  }, [debouncedQ, subjects, district, modes, exam, setSearchParams]);

  const debouncedMin = useDebounce(minRate);
  const debouncedMax = useDebounce(maxRate);
  const debouncedMinAge = useDebounce(minAge);
  const debouncedMaxAge = useDebounce(maxAge);

  const params = useMemo<TutorSearchParams>(() => {
    const p: TutorSearchParams = { limit, offset: 0, sort };
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    if (subjects.length) p.subject = subjects;
    if (district.length) p.district = district;
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
    subjects, exam, district, debouncedQ, debouncedMin, debouncedMax,
    sort, modes, gender, debouncedMinAge, debouncedMaxAge, limit, nearMe, radiusKm,
  ]);

  const { data, isLoading, isFetching, isError, error } = useTutorSearch(params);

  const histParams = useMemo(() => {
    const p: Parameters<typeof useTutorPriceHistogram>[0] = {};
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    if (subjects.length) p.subject = subjects;
    if (district.length) p.district = district;
    if (modes.length) p.mode = modes;
    if (gender) p.gender = gender;
    const minA = Number(debouncedMinAge);
    const maxA = Number(debouncedMaxAge);
    if (debouncedMinAge && !Number.isNaN(minA) && minA >= 0) p.min_age = minA;
    if (debouncedMaxAge && !Number.isNaN(maxA) && maxA >= 0) p.max_age = maxA;
    if (nearMe) { p.lat = nearMe.lat; p.lng = nearMe.lng; p.radius_km = radiusKm; }
    return p;
  }, [debouncedQ, subjects, district, modes, gender, debouncedMinAge, debouncedMaxAge, nearMe, radiusKm]);

  const { data: rateDist, isLoading: histLoading } = useTutorPriceHistogram(histParams, showFilters);

  const hasModalFilters =
    !!minRate || !!maxRate || !!gender || !!minAge || !!maxAge || !!nearMe;

  const hasFilters =
    !!q || district.length > 0 || subjects.length > 0 || !!exam || !!minRate ||
    !!maxRate || modes.length > 0 || !!gender || !!minAge || !!maxAge;

  const clearAll = () => {
    setQ(""); setDistrict([]); setSubjects([]); setExam("");
    setMinRate(""); setMaxRate(""); setSort(TutorSort.RELEVANCE);
    setModes([]); setGender(""); setMinAge(""); setMaxAge("");
    setLimit(20);
  };

  // Geniş aramada arama butonuna basınca (q/district zaten canlı state'i
  // sürdüğü için) yalnızca geniş paneli kapat.
  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchOpen(false);
  };

  /* ── Navbar ortası ──
     Kapalı: kompakt arama pill'i (tıklayınca geniş hali açar).
     Açık:  ana sayfadaki kategori çubuğu (sekmeler başka sayfaya götürür). */
  const navCenter = (
    <div key={searchOpen ? "cats" : "compact"} className="w-full animate-in fade-in duration-300">
      {searchOpen ? (
        <CategoryBar active="egitmenler" />
      ) : (
        <div className="flex w-full justify-center">
          <CompactSearch
            active="egitmenler"
            placeholder="Ders ara… (ör. Lise Matematik)"
            q={q}
            district={district}
            remote={modeSegment === TeachingMode.ONLINE}
            onOpen={() => setSearchOpen(true)}
          />
        </div>
      )}
    </div>
  );

  /* ── Navbar altı ──
     Açık: ana sayfadaki büyük arama hapı. Kapalı: filtre çubuğu. */
  const bigSearchRow = (
    <div className="flex justify-center px-4 pb-3 pt-1 sm:px-6">
      <BigSearch
        q={q}
        setQ={setQ}
        district={district}
        setDistrict={setDistrict}
        remote={modeSegment === TeachingMode.ONLINE}
        setRemote={(v) => selectMode(v ? TeachingMode.ONLINE : MODE_ALL)}
        onSubmit={submitSearch}
        placeholder="Ders ara… (ör. Lise Matematik)"
        trending={TRENDING_SEARCHES}
      />
    </div>
  );

  const filterBar = (
    <div className="flex justify-center w-full">
      <div
        className="flex items-center justify-center gap-2 overflow-x-auto px-6 pb-2.5 pt-3"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as CSSProperties}
      >
      {/* Filtreler butonu */}
      <button
        onClick={() => setShowFilters(true)}
        className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold shadow-sm transition hover:shadow ${
          hasModalFilters
            ? "border-slate-900 bg-slate-900 text-white "
            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 "
        }`}
      >
        <FilterIconSvg />
        Filtreler
        {hasModalFilters && (
          <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold text-white ">
            ✓
          </span>
        )}
      </button>

      <div className="h-5 w-px shrink-0 bg-slate-200 " />

      {/* Sıralama açılır menüsü */}
      <div className="relative shrink-0">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as TutorSort)}
          className={`appearance-none rounded-full border px-3.5 py-1.5 pr-8 text-sm font-medium outline-none transition focus:ring-2 focus:ring-indigo-500/20 ${
            sort !== TutorSort.RELEVANCE
              ? "border-slate-900 bg-slate-900 text-white "
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 "
          }`}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${sort !== TutorSort.RELEVANCE ? 'text-white ' : 'text-slate-400 '}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>

      <div className="h-5 w-px shrink-0 bg-slate-200 " />

      {/* Fiyat Popover Butonu */}
      <div className="relative shrink-0">
        <button
          ref={pricePopoverRef}
          type="button"
          onClick={togglePricePopover}
          className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
            minRate || maxRate
              ? "border-slate-900 bg-slate-900 text-white "
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 "
          }`}
        >
          {minRate || maxRate ? `${minRate || "0"} TL - ${maxRate ? `${maxRate} TL` : "Üstü"}` : "Fiyat"}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={pricePopoverOpen ? "rotate-180 transition-transform" : "transition-transform"}><path d="M6 9l6 6 6-6"/></svg>
        </button>
        
        {pricePopoverOpen && pricePopoverPos && (
          <>
            <div className="fixed inset-0 z-[80]" onClick={() => setPricePopoverOpen(false)} />
            <div 
              style={{ position: "fixed", top: pricePopoverPos.top, left: pricePopoverPos.left }}
              className="z-[90] w-80 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:w-96"
            >
              <h3 className="mb-4 font-semibold text-slate-900 ">Fiyat Aralığı (Saatlik)</h3>
              <PriceRangeHistogram
                rates={rateDist ?? []}
                loading={histLoading}
                minRate={minRate}
                maxRate={maxRate}
                onChange={(mn, mx) => { setMinRate(mn); setMaxRate(mx); }}
              />
            </div>
          </>
        )}
      </div>

      <div className="h-5 w-px shrink-0 bg-slate-200 " />

      {/* Ders şekli açılır menüsü */}
      <div className="relative shrink-0">
        <select
          value={modeSegment}
          onChange={(e) => selectMode(e.target.value as any)}
          className={`appearance-none rounded-full border px-3.5 py-1.5 pr-8 text-sm font-medium outline-none transition focus:ring-2 focus:ring-indigo-500/20 ${
            !isAllMode
              ? "border-slate-900 bg-slate-900 text-white "
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 "
          }`}
        >
          <option value={MODE_ALL}>Eğitim Şekli</option>
          <option value={TeachingMode.ONLINE}>Uzaktan</option>
          <option value={TeachingMode.IN_PERSON}>Yüzyüze</option>
        </select>
        <div className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${!isAllMode ? 'text-white ' : 'text-slate-400 '}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>

      {/* Aktif sınav chip'i */}
      {exam && (
        <button
          onClick={() => setExam("")}
          className="shrink-0 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3.5 py-1.5 text-sm font-medium text-amber-700 transition hover:bg-amber-100 "
        >
          {exam}
          <span aria-hidden className="ml-0.5 text-xs">✕</span>
        </button>
      )}

      {/* Aktif ders chip'leri */}
      {subjects.map((s) => (
        <button
          key={s}
          onClick={() => removeSubject(s)}
          className="shrink-0 inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 "
        >
          {s}
          <span aria-hidden className="ml-0.5 text-xs">✕</span>
        </button>
      ))}
      </div>
    </div>
  );

  const navBottom = searchOpen ? bigSearchRow : filterBar;

  return (
    <DashboardShell title="Eğitmen Bul" navItems={navItems} center={navCenter} bottom={navBottom}>
      {/* Geniş arama açıkken sayfayı hafifçe karart; tıklayınca kapat. */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/10 animate-in fade-in duration-200"
          onClick={() => setSearchOpen(false)}
        />
      )}
      <div className="mx-auto max-w-[1050px] pt-4">
        {/* ── Sonuçlar ── */}
        <div>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-52 animate-pulse rounded-2xl bg-slate-100 " />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100 ">
              <span>⚠</span>
              {getErrorMessage(error, "Eğitmenler yüklenemedi.")}
            </div>
          ) : !data || data.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center ">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl ">
                🔍
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700 ">
                Kriterlere uyan eğitmen bulunamadı
              </p>
              <p className="mt-1 text-xs text-slate-400 ">
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
              <div className="mb-3 flex items-center gap-2 text-xs text-slate-400 ">
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
                    className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-indigo-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-indigo-50 active:scale-95 disabled:opacity-60 "
                  >
                    {isFetching ? "Yükleniyor…" : "Daha fazla göster"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Filtre Modalı ── */}
      {showFilters && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-6">
          <div className="absolute inset-0" onClick={() => setShowFilters(false)} />
          <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 animate-in slide-in-from-bottom-4 duration-200 sm:zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 ">
              <h2 className="text-lg font-bold text-slate-900 ">Filtrele</h2>
              <button
                onClick={() => setShowFilters(false)}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-8 overflow-y-auto p-6">
              {/* Ders işleme şekli */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-900 ">Ders İşleme Şekli</h3>
                <SegmentedControl options={MODE_SEGMENTS} value={modeSegment} onChange={selectMode} />
              </div>

              {/* Konum */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-900 ">Mesafe</h3>
                <div className="relative">
                  <select
                    value={nearMe ? radiusKm : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) { setNearMe(null); return; }
                      setRadiusKm(Number(val));
                      if (!nearMe) requestNearMe();
                    }}
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 "
                  >
                    <option value="">Farketmez (Her Yer)</option>
                    <option value="5">En fazla 5 km</option>
                    <option value="10">En fazla 10 km</option>
                    <option value="25">En fazla 25 km</option>
                    <option value="50">En fazla 50 km</option>
                    <option value="100">En fazla 100 km</option>
                  </select>
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </div>
                {geoLoading && <p className="mt-2 animate-pulse text-xs font-medium text-indigo-600">Konum alınıyor…</p>}
                {nearMe && !geoLoading && <p className="mt-2 text-xs font-medium text-emerald-600">✓ Konumunuz kullanılıyor</p>}
              </div>

              {/* Fiyat aralığı */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 ">Fiyat Aralığı</h3>
                <p className="mb-4 mt-0.5 text-xs text-slate-500 ">Saatlik ders ücreti</p>
                <PriceRangeHistogram
                  rates={rateDist ?? []}
                  loading={histLoading}
                  minRate={minRate}
                  maxRate={maxRate}
                  onChange={(mn, mx) => { setMinRate(mn); setMaxRate(mx); }}
                />
              </div>

              {/* Cinsiyet */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-slate-900 ">Cinsiyet</h3>
                <div className="flex flex-wrap gap-2">
                  {GENDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setGender((g) => (g === opt.value ? "" : opt.value))}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        gender === opt.value
                          ? "bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-600"
                          : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 "
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:px-6 sm:py-5">
              <button
                onClick={clearAll}
                className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 "
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
