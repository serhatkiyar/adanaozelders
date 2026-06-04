import { useMemo, useState } from "react";
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
  const [radiusKm, setRadiusKm] = useState<number>(25);
  const [geoLoading, setGeoLoading] = useState(false);
  const [limit, setLimit] = useState(30);

  const debouncedQ = useDebounce(q);

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

  const toggleAmenity = (a: string) =>
    setAmenities((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );

  const params = useMemo<LibrarySearchParams>(() => {
    const p: LibrarySearchParams = { limit, offset: 0 };
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    if (amenities.length) p.amenities = amenities;
    if (nearMe) {
      p.lat = nearMe.lat;
      p.lng = nearMe.lng;
      p.radius_km = radiusKm;
    }
    if (sort) p.sort = sort;
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

      {/* ── Arama + yakınımda ── */}
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
        <button
          onClick={() => (nearMe ? setNearMe(null) : requestNearMe())}
          disabled={geoLoading}
          className={`flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold shadow-sm ring-1 transition active:scale-95 ${
            nearMe
              ? "bg-indigo-600 text-white ring-indigo-600"
              : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
          }`}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          {geoLoading ? "Konum alınıyor…" : nearMe ? "Yakınımda ✓" : "Yakınımda"}
        </button>
        {nearMe && (
          <select
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            className="h-11 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value={5}>5 km</option>
            <option value={10}>10 km</option>
            <option value={25}>25 km</option>
            <option value={50}>50 km</option>
          </select>
        )}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "rating" | "distance" | "")}
          className="h-11 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="">Önerilen</option>
          <option value="rating">★ Puana göre</option>
          {nearMe && <option value="distance">📍 Yakınlığa göre</option>}
        </select>
      </div>

      {/* ── Olanak filtreleri ── */}
      <div className="flex flex-wrap gap-2">
        {AMENITY_OPTIONS.map((a) => {
          const active = amenities.includes(a);
          return (
            <button
              key={a}
              onClick={() => toggleAmenity(a)}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "bg-indigo-600 text-white ring-1 ring-indigo-600"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
              }`}
            >
              <span>{amenityIcon(a)}</span>
              {amenityLabel(a)}
            </button>
          );
        })}
      </div>

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
