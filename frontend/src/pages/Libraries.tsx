import { type CSSProperties, useMemo, useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  PAGE_PARAM,
  limitForPage,
  nextPageSearch,
  pageFromParam,
} from "@/lib/pagination";
import { DashboardShell } from "@/components/DashboardShell";
import { PublicShell } from "@/components/PublicShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { LibraryCard } from "@/components/LibraryCard";
import { LibrariesMap } from "@/components/LibrariesMap";
import { useLibrarySearch } from "@/hooks/useLibraries";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDebounce } from "@/hooks/useDebounce";
import { useAuthStore } from "@/store/authStore";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { Seo } from "@/components/Seo";
import { AMENITY_OPTIONS, amenityLabel } from "@/lib/amenities";
import { amenityIcon } from "@/lib/amenityIcons";
import { ROLE_IDS } from "@/types";
import { CategoryBar } from "@/components/CategoryBar";
import { BigSearch, CompactSearch } from "@/components/HeroSearch";
import { LIBRARY_TRENDING_SEARCHES } from "@/lib/trendingSearches";
import type { LibrarySearchParams } from "@/api/libraries";

type ViewMode = "list" | "map";
type LibrarySort = "rating" | "distance" | "";

const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: "", label: "Önerilen" },
  { value: "rating", label: "★ Puan" },
  { value: "distance", label: "📍 Yakınımda" },
];

const SEARCH_PLACEHOLDER = "Kütüphane veya semt ara…";

const FilterIconSvg = () => (
  <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clipRule="evenodd" />
  </svg>
);

/** Sayfa başına kütüphane sayısı. */
const PER_PAGE = 30;

export default function Libraries() {
  const token = useAuthStore((s) => s.token);
  const { data: currentUser } = useCurrentUser();
  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : currentUser?.role_id === ROLE_IDS.CLIENT
        ? STUDENT_NAV
        : undefined;

  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [view, setView] = useState<ViewMode>("list");
  const [district, setDistrict] = useState<string[]>(() => searchParams.getAll("district"));

  // Dış navigasyon (geri/ileri tuşu, link ile gelme) state'i günceller.
  // Guard: yalnız URL'deki değer mevcut state'ten farklıysa güncelle
  // (state→URL sync effect'iyle sonsuz döngüyü engeller).
  useEffect(() => {
    const qParam = searchParams.get("q") ?? "";
    const districtParams = searchParams.getAll("district");
    if (qParam !== q) setQ(qParam);
    if (JSON.stringify(districtParams) !== JSON.stringify(district))
      setDistrict(districtParams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [sort, setSort] = useState<LibrarySort>("");
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm] = useState<number>(25);
  const [geoLoading, setGeoLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Sayfa durumu URL'de (bkz. lib/pagination.ts) — paylaşılan bağlantı
  // karşı tarafta ilk sayfaya dönmesin, geri tuşu listeyi sıfırlamasın.
  const page = pageFromParam(searchParams.get(PAGE_PARAM));
  const limit = limitForPage(page, PER_PAGE);
  // Daralmış arama pill'ine tıklayınca geniş navbar'ı (kategoriler + büyük
  // arama) yerinde açar — eğitmen aramasındaki davranışın aynısı.
  const [searchOpen, setSearchOpen] = useState(false);

  const debouncedQ = useDebounce(q);
  const setSurface = useSurfaceStore((s) => s.setSurface);

  // /hesabim bağlama duyarlı navbar: son yüzey = keşif.
  useEffect(() => {
    setSurface("discover");
  }, [setSurface]);

  // ── URL ↔ state senkronizasyonu ──────────────────────────────────────
  // debouncedQ veya district değişince URL'i güncelle; sayfa yenilenince
  // güncel arama korunur. `replace` ile tarayıcı geçmişi spam'lenmez.
  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedQ.trim()) next.set("q", debouncedQ.trim());
    district.forEach((d) => next.append("district", d));
    setSearchParams(next, { replace: true });
  }, [debouncedQ, district, setSearchParams]);

  // "Yakınımda" sıralaması konum ister; reddedilirse sıralamayı geri al.
  const requestNearMe = (onFail?: () => void) => {
    if (!navigator.geolocation) {
      toast.error("Tarayıcınız konum servisini desteklemiyor.");
      onFail?.();
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
        onFail?.();
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  // Sıralama seçimi: "Yakınımda" ilk kez seçilince konum iste.
  const handleSortChange = (value: LibrarySort) => {
    setSort(value);
    if (value === "distance" && !nearMe) requestNearMe(() => setSort(""));
  };

  const toggleAmenity = (a: string) =>
    setAmenities((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );

  const params = useMemo<LibrarySearchParams>(() => {
    const p: LibrarySearchParams = { limit, offset: 0 };
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    if (district.length) p.district = district;
    if (amenities.length) p.amenities = amenities;
    // Konum yalnız "Yakınımda" sıralamasında uygulanır.
    if (sort === "distance" && nearMe) {
      p.lat = nearMe.lat;
      p.lng = nearMe.lng;
      p.radius_km = radiusKm;
      p.sort = "distance";
    } else if (sort === "rating") {
      p.sort = "rating";
    }
    return p;
  }, [debouncedQ, district, amenities, nearMe, radiusKm, sort, limit]);

  const { data, isLoading, isFetching, isError, error } = useLibrarySearch(params);

  // Harita görünümü liste sayfalamasına takılmamalı: aynı filtrelerle TÜM eşleşen
  // kütüphaneleri tek seferde çek (yalnız harita açıkken). Liste 30'arlı kalır.
  const mapParams = useMemo<LibrarySearchParams>(
    () => ({ ...params, limit: 500, offset: 0 }),
    [params]
  );
  const { data: mapData, isLoading: mapLoading } = useLibrarySearch(
    mapParams,
    view === "map"
  );

  // Geniş aramada arama butonuna basınca (q/district zaten canlı state'i
  // sürdüğü için) yalnızca geniş paneli kapat.
  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchOpen(false);
  };

  /* ── Navbar ortası ──
     Kapalı: kompakt arama pill'i (tıklayınca geniş hali açar).
     Açık:  kategori çubuğu (sekmeler başka sayfaya götürür). */
  const navCenter = (
    <div key={searchOpen ? "cats" : "compact"} className="w-full animate-in fade-in duration-300">
      {searchOpen ? (
        <CategoryBar active="kutuphaneler" />
      ) : (
        <div className="flex w-full justify-center">
          <CompactSearch
            active="kutuphaneler"
            placeholder={SEARCH_PLACEHOLDER}
            q={q}
            district={district}
            onOpen={() => setSearchOpen(true)}
          />
        </div>
      )}
    </div>
  );

  /* ── Navbar altı ──
     Açık: büyük arama hapı. Kapalı: sıralama + filtre chip çubuğu. */
  const bigSearchRow = (
    <div className="flex justify-center px-4 pb-3 pt-1 sm:px-6">
      <BigSearch
        q={q}
        setQ={setQ}
        district={district}
        setDistrict={setDistrict}
        showRemoteOption={false}
        onSubmit={submitSearch}
        placeholder={SEARCH_PLACEHOLDER}
        trending={LIBRARY_TRENDING_SEARCHES}
      />
    </div>
  );

  const filterBar = (
    <div className="flex justify-center w-full">
      <div
        className="flex items-center justify-center gap-2 overflow-x-auto px-6 pb-2.5 pt-3"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as CSSProperties}
      >
      {/* Filtreler (olanaklar) butonu */}
      <button
        onClick={() => setShowFilters(true)}
        className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold shadow-sm transition hover:shadow ${
          amenities.length > 0
            ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        }`}
      >
        <FilterIconSvg />
        Filtreler
        {amenities.length > 0 && (
          <span className="ml-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-indigo-600 px-1 text-[9px] font-bold text-white dark:bg-indigo-500">
            {amenities.length}
          </span>
        )}
      </button>

      <div className="h-5 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />

      {/* Sıralama chip'leri */}
      {SORT_OPTIONS.map((opt) => (
        <button
          key={opt.value || "default"}
          onClick={() => handleSortChange(opt.value)}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
            sort === opt.value
              ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600"
          }`}
        >
          {opt.label}
        </button>
      ))}

      {/* Aktif ilçe chip'leri */}
      {district.map((d) => (
        <button
          key={d}
          onClick={() => setDistrict((prev) => prev.filter((x) => x !== d))}
          className="shrink-0 inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
        >
          {d}
          <span aria-hidden className="ml-0.5 text-xs">✕</span>
        </button>
      ))}

      {/* Aktif olanak chip'leri */}
      {amenities.map((a) => (
        <button
          key={a}
          onClick={() => toggleAmenity(a)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
        >
          {(() => { const I = amenityIcon(a); return <I size={14} stroke={1.75} aria-hidden />; })()}
          {amenityLabel(a)}
          <span aria-hidden className="ml-0.5 text-xs">✕</span>
        </button>
      ))}
      </div>
    </div>
  );

  const navBottom = searchOpen ? bigSearchRow : filterBar;

  const content = (
    <>
      {/* Geniş arama açıkken sayfayı hafifçe karart; tıklayınca kapat. */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/10 animate-in fade-in duration-200"
          onClick={() => setSearchOpen(false)}
        />
      )}
      <div className="mx-auto max-w-[1100px] space-y-5">
        <Seo
          title="Kütüphaneler ve Etüt Merkezleri"
          description="Bölgendeki çalışma kütüphanelerini ve etüt merkezlerini keşfet — değerlendirmeler, konum ve çalışma saatleriyle."
        />

        {/* ── Liste/Harita geçişi ── */}
        <div className="flex flex-wrap items-end justify-end gap-3">
          {/* Liste / Harita geçişi */}
          <div className="flex rounded-full bg-slate-100 p-1 dark:bg-slate-800">
            {(["list", "map"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setView(m)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  view === m
                    ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-300"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
                }`}
              >
                {m === "list" ? "☰ Liste" : "🗺️ Harita"}
              </button>
            ))}
          </div>
        </div>

        {geoLoading && (
          <p className="text-xs font-medium text-indigo-600 animate-pulse">Konum bilgin alınıyor…</p>
        )}

        {/* ── Sonuçlar ── */}
        {isError ? (
          <div className="rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {getErrorMessage(error, "Kütüphaneler yüklenemedi.")}
          </div>
        ) : view === "map" ? (
          mapLoading && !mapData ? (
            <div className="h-[70vh] animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          ) : (
            <LibrariesMap libraries={mapData ?? []} />
          )
        ) : isLoading ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-60 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
              />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center dark:border-slate-700">
            <div className="text-4xl">📚</div>
            <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
              Kriterlere uyan kütüphane bulunamadı
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{data.length} kütüphane listeleniyor</span>
              {isFetching && <span className="animate-pulse">Güncelleniyor…</span>}
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.map((lib) => (
                <LibraryCard key={lib.id} library={lib} />
              ))}
            </div>
            {data.length === limit && (
              <div className="mt-2 flex justify-center">
                {/* Gerçek bağlantı: crawler takip edebilsin, kullanıcı yeni
                    sekmede açabilsin. Tıklama SPA içinde kalır. */}
                <Link
                  to={nextPageSearch(searchParams, page)}
                  className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-indigo-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-indigo-50 disabled:opacity-60 dark:bg-slate-800 dark:text-indigo-300 dark:ring-slate-700"
                >
                  {isFetching ? "Yükleniyor…" : "Daha fazla göster"}
                </Link>
              </div>
            )}
          </>
        )}

        {/* ── Filtre modalı (olanaklar) ── */}
        {showFilters && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-sm sm:items-center sm:p-6">
            <div className="absolute inset-0" onClick={() => setShowFilters(false)} />
            <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Olanaklar</h2>
                <button
                  onClick={() => setShowFilters(false)}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                  aria-label="Kapat"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
                  Aradığın özelliklere sahip mekânları süz.
                </p>
                <div className="flex flex-wrap gap-2">
                  {AMENITY_OPTIONS.map((a) => {
                    const active = amenities.includes(a);
                    return (
                      <button
                        key={a}
                        onClick={() => toggleAmenity(a)}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition ${
                          active
                            ? "bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-600"
                            : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
                        }`}
                      >
                        {(() => { const I = amenityIcon(a); return <I size={14} stroke={1.75} aria-hidden />; })()}
                        {amenityLabel(a)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 border-t border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50 sm:px-6 sm:py-5">
                <button
                  onClick={() => setAmenities([])}
                  className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700"
                >
                  Temizle
                </button>
                <button
                  onClick={() => setShowFilters(false)}
                  className="flex-[2] rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
                >
                  Sonuçları Göster
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return token ? (
    <DashboardShell title="Kütüphaneler" navItems={navItems} center={navCenter} bottom={navBottom}>
      {content}
    </DashboardShell>
  ) : (
    <PublicShell center={navCenter} bottom={navBottom}>
      {content}
    </PublicShell>
  );
}
