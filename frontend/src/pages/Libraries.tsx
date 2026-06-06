import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { Seo } from "@/components/Seo";
import { AMENITY_OPTIONS, amenityIcon, amenityLabel } from "@/lib/amenities";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";
import type { LibrarySearchParams } from "@/api/libraries";

type ViewMode = "list" | "map";

export default function Libraries() {
  const token = useAuthStore((s) => s.token);
  const { data: currentUser } = useCurrentUser();
  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : currentUser?.role_id === ROLE_IDS.CLIENT
        ? STUDENT_NAV
        : undefined;

  const [q, setQ] = useState("");
  const [view, setView] = useState<ViewMode>("list");
  const [amenities, setAmenities] = useState<string[]>([]);
  const [sort, setSort] = useState<"rating" | "distance" | "">("");
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm] = useState<number>(25);
  const [geoLoading, setGeoLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(30);

  const debouncedQ = useDebounce(q);

  // "Yakınlığa göre" sıralaması konum ister; reddedilirse sıralamayı geri al.
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

  // Sıralama seçimi: "Yakınlığa göre" ilk kez seçilince konum iste.
  const handleSortChange = (value: "rating" | "distance" | "") => {
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
    if (amenities.length) p.amenities = amenities;
    // Konum yalnız "Yakınlığa göre" sıralamasında uygulanır.
    if (sort === "distance" && nearMe) {
      p.lat = nearMe.lat;
      p.lng = nearMe.lng;
      p.radius_km = radiusKm;
      p.sort = "distance";
    } else if (sort === "rating") {
      p.sort = "rating";
    }
    return p;
  }, [debouncedQ, amenities, nearMe, radiusKm, sort, limit]);

  const { data, isLoading, isFetching, isError, error } = useLibrarySearch(params);

  const content = (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <Seo
        title="Kütüphaneler ve Etüt Merkezleri"
        description="Bölgendeki çalışma kütüphanelerini ve etüt merkezlerini keşfet — değerlendirmeler, konum ve çalışma saatleriyle."
      />

      {/* ── Başlık ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Kütüphaneler & Etüt Merkezleri
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Bölgendeki çalışma mekânlarını keşfet, haritada gör, değerlendir.
          </p>
          <Link
            to={ROUTES.libraryRegister}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
          >
            🏛️ Mekânın mı var? Ücretsiz listele →
          </Link>
        </div>
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

      {/* ── Arama + Sıralama + Filtreler ── */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex h-11 flex-1 overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-indigo-300 dark:bg-slate-800 dark:ring-slate-700">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Kütüphane adı veya semt ara…"
            className="flex-1 bg-transparent px-5 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
          />
        </div>
        {/* Sıralama dropdown'ı + Filtreler butonu yan yana */}
        <div className="flex shrink-0 gap-3">
          <select
            value={sort}
            onChange={(e) => handleSortChange(e.target.value as "rating" | "distance" | "")}
            className="h-11 flex-1 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 sm:flex-none"
          >
            <option value="">Önerilen</option>
            <option value="rating">★ Puana göre</option>
            <option value="distance">📍 Yakınlığa göre</option>
          </select>
          <button
            onClick={() => setShowFilters(true)}
            className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z" clipRule="evenodd" />
            </svg>
            Filtreler
            {amenities.length > 0 && (
              <span className="ml-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">
                {amenities.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {geoLoading && (
        <p className="text-xs font-medium text-indigo-600 animate-pulse">Konum bilgin alınıyor…</p>
      )}

      {/* Seçili olanaklar (modalda seçilir, burada özetlenip kaldırılabilir) */}
      {amenities.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {amenities.map((a) => (
            <button
              key={a}
              onClick={() => toggleAmenity(a)}
              className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
            >
              <span>{amenityIcon(a)}</span>
              {amenityLabel(a)}
              <span aria-hidden>✕</span>
            </button>
          ))}
          <button
            onClick={() => setAmenities([])}
            className="rounded-full px-2.5 py-1 text-xs font-medium text-slate-400 underline-offset-2 transition hover:text-slate-600 hover:underline dark:hover:text-slate-300"
          >
            Temizle
          </button>
        </div>
      )}

      {/* ── Sonuçlar ── */}
      {isError ? (
        <div className="rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {getErrorMessage(error, "Kütüphaneler yüklenemedi.")}
        </div>
      ) : view === "map" ? (
        isLoading ? (
          <div className="h-[70vh] animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
        ) : (
          <LibrariesMap libraries={data ?? []} />
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
              <button
                onClick={() => setLimit((l) => l + 30)}
                disabled={isFetching}
                className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-indigo-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-indigo-50 disabled:opacity-60 dark:bg-slate-800 dark:text-indigo-300 dark:ring-slate-700"
              >
                {isFetching ? "Yükleniyor…" : "Daha fazla göster"}
              </button>
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
                      <span>{amenityIcon(a)}</span>
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
  );

  return token ? (
    <DashboardShell title="Kütüphaneler" navItems={navItems}>
      {content}
    </DashboardShell>
  ) : (
    <PublicShell>{content}</PublicShell>
  );
}
