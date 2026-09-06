import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { navForRole } from "@/lib/nav";
import { TutorCard } from "@/components/TutorCard";
import { LibraryCard } from "@/components/LibraryCard";
import { LibrariesMap } from "@/components/LibrariesMap";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLibraryBookmarks } from "@/hooks/useLibraryBookmarks";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { useUiPrefsStore } from "@/store/uiPrefsStore";
import { ROUTES } from "@/lib/routes";

type View = "index" | "tutors" | "libraries" | "recent";

type Tile = { img?: string | null; label?: string | null };

export default function Favorites() {
  // Sayfa artık iki rolde açılıyor (ÜK-6); yan menü sabit `UYE_NAV` kalsaydı
  // eğitmen kendi menüsü yerine üye menüsünü görürdü.
  const { data: user } = useCurrentUser();
  const [view, setView] = useState<View>("index");
  const { data: tutors, isLoading: tutorsLoading } = useBookmarks();
  const { data: libraries, isLoading: librariesLoading } = useLibraryBookmarks();
  const showRecent = useUiPrefsStore((s) => s.showRecentlyViewed);
  const recent = useRecentlyViewed();

  const tutorTiles: Tile[] =
    tutors?.map((t) => ({ img: t.avatar_url, label: t.full_name?.charAt(0) })) ??
    [];
  const libraryTiles: Tile[] =
    libraries?.map((l) => ({ img: l.cover_url, label: l.name?.charAt(0) })) ?? [];
  const recentTiles: Tile[] = recent.map((t) => ({
    img: t.avatar_url,
    label: t.full_name?.charAt(0),
  }));

  const backToIndex = () => setView("index");

  return (
    <DashboardShell title="Favoriler" navItems={navForRole(user?.role_id)}>
      <div className="mx-auto max-w-[1050px]">
        {view === "index" && (
          <>
            <h1 className="mb-8 mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Favoriler
            </h1>
            <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
              <CollectionCard
                title="Eğitmenler"
                subtitle={countLabel(tutors?.length, "kayıtlı eğitmen")}
                tiles={tutorTiles}
                icon={<BookmarkIcon />}
                onClick={() => setView("tutors")}
              />
              <CollectionCard
                title="Kütüphaneler"
                subtitle={countLabel(libraries?.length, "kayıtlı kütüphane")}
                tiles={libraryTiles}
                icon={<HeartIcon />}
                onClick={() => setView("libraries")}
              />
              {showRecent && recent.length > 0 && (
                <CollectionCard
                  title="Son görüntülenenler"
                  subtitle={countLabel(recent.length, "eğitmen")}
                  tiles={recentTiles}
                  icon={<ClockIcon />}
                  onClick={() => setView("recent")}
                />
              )}
            </div>
          </>
        )}

        {view === "tutors" && (
          <Detail
            title="Eğitmenler"
            count={countLabel(tutors?.length, "kayıtlı eğitmen")}
            onBack={backToIndex}
          >
            <TutorsTab data={tutors} isLoading={tutorsLoading} />
          </Detail>
        )}

        {view === "libraries" && (
          <Detail
            title="Kütüphaneler"
            count={countLabel(libraries?.length, "kayıtlı kütüphane")}
            onBack={backToIndex}
          >
            <LibrariesTab data={libraries} isLoading={librariesLoading} />
          </Detail>
        )}

        {view === "recent" && (
          <Detail
            title="Son görüntülenenler"
            count={countLabel(recent.length, "eğitmen")}
            onBack={backToIndex}
          >
            {recent.length === 0 ? (
              <EmptyState
                icon={<ClockIcon className="h-7 w-7" />}
                title="Henüz bir eğitmen görüntülemedin"
                hint="İncelediğin eğitmenler burada birikir."
                ctaTo={ROUTES.tutors}
                ctaLabel="Eğitmenleri keşfet"
              />
            ) : (
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {recent.map((tutor) => (
                  <TutorCard key={tutor.id} tutor={tutor} />
                ))}
              </div>
            )}
          </Detail>
        )}
      </div>
    </DashboardShell>
  );
}

function countLabel(n: number | undefined, unit: string): string {
  return `${n ?? 0} ${unit}`;
}

/* ─── Koleksiyon kapak kartı (Airbnb tarzı kare) ─── */

function CollectionCard({
  title,
  subtitle,
  tiles,
  icon,
  onClick,
}: {
  title: string;
  subtitle: string;
  tiles: Tile[];
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="group text-left">
      <div className="aspect-square w-full overflow-hidden rounded-2xl ring-1 ring-slate-100 transition group-hover:ring-slate-300 ">
        <CoverMosaic tiles={tiles} icon={icon} />
      </div>
      <p className="mt-3 truncate text-[15px] font-semibold text-slate-900 ">
        {title}
      </p>
      <p className="text-sm text-slate-500 ">{subtitle}</p>
    </button>
  );
}

function CoverMosaic({ tiles, icon }: { tiles: Tile[]; icon: ReactNode }) {
  const items = tiles.slice(0, 4);

  if (items.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 ">
        {icon}
      </div>
    );
  }
  if (items.length === 1) {
    return <MosaicTile tile={items[0]} big />;
  }
  return (
    <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-0.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <MosaicTile key={i} tile={items[i]} />
      ))}
    </div>
  );
}

// Fotoğrafsız öğeler için Airbnb tarzı renkli monogram (baş harf) paleti.
const MONOGRAMS = [
  "bg-rose-200 text-rose-700",
  "bg-amber-200 text-amber-800",
  "bg-emerald-200 text-emerald-800",
  "bg-sky-200 text-sky-800",
  "bg-violet-200 text-violet-800",
  "bg-fuchsia-200 text-fuchsia-800",
  "bg-teal-200 text-teal-800",
  "bg-orange-200 text-orange-800",
];

function monogram(label?: string | null): string {
  if (!label) return "bg-slate-200 text-slate-500 ";
  return MONOGRAMS[label.charCodeAt(0) % MONOGRAMS.length];
}

function MosaicTile({ tile, big = false }: { tile?: Tile; big?: boolean }) {
  if (tile?.img) {
    return (
      <img
        src={tile.img}
        alt=""
        aria-hidden
        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
      />
    );
  }
  return (
    <div
      className={`flex h-full w-full items-center justify-center font-bold ${monogram(
        tile?.label
      )} ${big ? "text-6xl" : "text-2xl"}`}
    >
      {tile?.label ? tile.label.toUpperCase() : ""}
    </div>
  );
}

/* ─── Detay (geri + başlık + içerik) ─── */

function Detail({
  title,
  count,
  onBack,
  children,
}: {
  title: string;
  count: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Favorilere dön"
          className="-ml-2 rounded-full p-2 text-slate-600 transition hover:bg-slate-100 "
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {title}
          </h1>
          <p className="text-sm text-slate-500 ">{count}</p>
        </div>
      </div>
      {children}
    </>
  );
}

/* ─── Ortak parçalar ─── */

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-52 animate-pulse rounded-2xl bg-slate-100 "
        />
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
  ctaTo,
  ctaLabel,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  ctaTo: string;
  ctaLabel: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center ">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-marka-metin ">
        {icon}
      </div>
      <p className="mt-4 text-sm font-medium text-slate-700 ">
        {title}
      </p>
      <p className="mt-1 text-xs text-slate-400 ">{hint}</p>
      <Link
        to={ctaTo}
        className="mt-4 rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

function TutorsTab({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useBookmarks>["data"];
  isLoading: boolean;
}) {
  if (isLoading) return <GridSkeleton />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<BookmarkIcon className="h-7 w-7" />}
        title="Henüz favori eğitmenin yok"
        hint="Eğitmen kartındaki kaydet ikonuna dokunarak favorilerine ekleyebilirsin."
        ctaTo={ROUTES.tutors}
        ctaLabel="Eğitmenleri keşfet"
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((tutor) => (
        <div key={tutor.id} className="relative">
          <SavedBadge />
          <TutorCard tutor={tutor} />
        </div>
      ))}
    </div>
  );
}

// Favorilerde olduğunu net belli eden rozet (kart sol-üstünde).
function SavedBadge() {
  return (
    <span className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-marka-metin shadow-sm ring-1 ring-black/5 ">
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
      </svg>
      Kaydedildi
    </span>
  );
}

function LibrariesTab({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useLibraryBookmarks>["data"];
  isLoading: boolean;
}) {
  const [mapView, setMapView] = useState(false);
  const [query, setQuery] = useState("");
  if (isLoading) return <GridSkeleton />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<HeartIcon className="h-7 w-7" />}
        title="Henüz favori kütüphanen yok"
        hint="Kütüphane kartındaki kalp ikonuna dokunarak favorilerine ekleyebilirsin."
        ctaTo={ROUTES.libraries}
        ctaLabel="Kütüphaneleri keşfet"
      />
    );
  }
  const hasLocated = data.some(
    (l) => l.location_lat != null && l.location_lng != null
  );
  const norm = (s: string) => s.toLocaleLowerCase("tr");
  const filtered = query.trim()
    ? data.filter((l) => norm(l.name ?? "").includes(norm(query)))
    : data;

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        {/* Liste görünümünde her zaman açık arama çubuğu */}
        {!mapView && (
          <div className="min-w-0 flex-1">
            <ExpandableSearch value={query} onChange={setQuery} defaultOpen />
          </div>
        )}
        {hasLocated && (
          <div className="ml-auto inline-flex rounded-xl bg-slate-100 p-1 ">
            <ViewToggle active={!mapView} onClick={() => setMapView(false)}>
              Liste
            </ViewToggle>
            <ViewToggle active={mapView} onClick={() => setMapView(true)}>
              Harita
            </ViewToggle>
          </div>
        )}
      </div>
      {mapView && hasLocated ? (
        <div className="relative overflow-hidden rounded-2xl ring-1 ring-slate-100 ">
          <LibrariesMap libraries={filtered} height="65vh" />
          {/* Harita üzerinde sağ üstte: başta ikon, tıklayınca genişleyen arama */}
          <div className="absolute right-3 top-3 z-[1000]">
            <ExpandableSearch value={query} onChange={setQuery} />
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-500 ">
          “{query}” ile eşleşen favori kütüphane yok.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((library) => (
            <div key={library.id} className="relative">
              <SavedBadge />
              <LibraryCard library={library} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Başta ikon (harita), tıklayınca genişleyen arama kutusu. defaultOpen ile liste
// görünümünde sürekli açık.
function ExpandableSearch({
  value,
  onChange,
  defaultOpen = false,
}: {
  value: string;
  onChange: (v: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || !!value);

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Kütüphane ara"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-600 shadow ring-1 ring-slate-200 transition hover:bg-slate-50 "
      >
        <SearchIcon />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-full bg-white px-3 shadow ring-1 ring-slate-200 ">
      <span className="text-slate-400">
        <SearchIcon />
      </span>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Kütüphane ara"
        className="w-full min-w-0 bg-transparent py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 "
      />
      {value && (
        <button
          type="button"
          aria-label="Temizle"
          onClick={() => onChange("")}
          className="text-slate-400 transition hover:text-slate-600 "
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      {!defaultOpen && (
        <button
          type="button"
          aria-label="Aramayı kapat"
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          className="shrink-0 rounded-full px-1 text-xs font-semibold text-slate-400 transition hover:text-slate-600 "
        >
          Kapat
        </button>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
    </svg>
  );
}

function ViewToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
        active
          ? "bg-white text-slate-900 shadow-sm "
          : "text-slate-500 hover:text-slate-700 "
      }`}
    >
      {children}
    </button>
  );
}

/* ─── ikonlar ─── */

function BookmarkIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
    </svg>
  );
}

function HeartIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
    </svg>
  );
}

function ClockIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}
