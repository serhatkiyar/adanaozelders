import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { Link } from "react-router-dom";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { ROUTES } from "@/lib/routes";
import { LibraryMapPanel } from "@/components/LibraryMapPanel";
import { useMapGate, MapGestureController, MapGateHint } from "@/components/map/MapGate";
import type { LibrarySearchOut } from "@/types";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const ADANA: [number, number] = [37.029003, 35.820839];

// HTML enjeksiyonuna karşı küçük kaçış (isim/URL data'mızdan gelse de güvenli olsun).
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

// Yuvarlak "logo-pin": logo varsa görsel, yoksa (veya 404'te) baş harf;
// beyaz çerçeve + gölge + alt işaretçi ile harita pini gibi durur. Seçiliyken
// indigo halka + büyür (öne çıkar).
function libraryIcon(lib: LibrarySearchOut, selected = false): L.DivIcon {
  const initial = esc((lib.name?.trim()?.[0] ?? "?").toUpperCase());
  const img = lib.logo_url
    ? `<img src="${esc(lib.logo_url)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" onerror="this.remove()"/>`
    : "";
  const ring = selected
    ? "0 0 0 3px #6366f1, 0 4px 10px rgba(15,23,42,.4)"
    : "0 2px 6px rgba(15,23,42,.35)";
  const scale = selected ? "transform:scale(1.12);transform-origin:bottom center;" : "";
  const html = `
    <div style="position:relative;width:44px;height:52px;${scale}">
      <div style="position:relative;width:44px;height:44px;border-radius:9999px;overflow:hidden;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;border:2px solid #fff;box-shadow:${ring}">
        <span>${initial}</span>${img}
      </div>
      <div style="position:absolute;left:50%;top:41px;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #fff;filter:drop-shadow(0 2px 1px rgba(15,23,42,.25))"></div>
    </div>`;
  return L.divIcon({
    html,
    className: "lib-pin",
    iconSize: [44, 52],
    iconAnchor: [22, 52], // alt işaretçi ucu = koordinat
    popupAnchor: [0, -46],
  });
}

// Seçilen kütüphaneye yumuşak uçuş; panel solu kapattığından merkezi sağa kaydır.
function FlyToSelected({ lib }: { lib: LibrarySearchOut | null }) {
  const map = useMap();
  useEffect(() => {
    if (lib?.location_lat == null || lib.location_lng == null) return;
    const zoom = Math.max(map.getZoom(), 15);
    const offX = window.innerWidth >= 640 ? 190 : 0; // panel genişliğinin ~yarısı
    const pt = map.project([lib.location_lat, lib.location_lng], zoom).subtract([offX, 0]);
    map.flyTo(map.unproject(pt, zoom), zoom, { duration: 0.6 });
  }, [lib, map]);
  return null;
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14, { animate: true });
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
  }, [points, map]);
  return null;
}

interface LibrariesMapProps {
  libraries: LibrarySearchOut[];
  height?: string;
  /** Marker'a tıklayınca Google Maps tarzı yan panel aç (varsayılan). Tek
   *  kütüphane gösteren detay sayfasında `false` → eski sade popup. */
  enablePanel?: boolean;
}

export function LibrariesMap({
  libraries,
  height = "70vh",
  enablePanel = true,
}: LibrariesMapProps) {
  const [selected, setSelected] = useState<LibrarySearchOut | null>(null);
  const [satellite, setSatellite] = useState(false);
  const gate = useMapGate();

  const located = useMemo(
    () =>
      libraries.filter(
        (l) => l.location_lat != null && l.location_lng != null
      ),
    [libraries]
  );
  const points = useMemo<[number, number][]>(
    () => located.map((l) => [l.location_lat as number, l.location_lng as number]),
    [located]
  );

  // Filtre/arama sonuçları değişince, seçili artık listede yoksa paneli kapat.
  // (Referansı değiştirmeyiz → arka plan refetch'inde harita gereksiz uçmaz;
  //  panel zaten useLibraryDetail ile güncel veriyi çeker.)
  useEffect(() => {
    if (selected && !located.some((l) => l.id === selected.id)) setSelected(null);
  }, [located, selected]);

  return (
    <div
      // isolate: Leaflet'in iç panel/kontrolleri (z-index 400–1000) kendi stacking
      // context'inde kalsın; aksi halde sayfa header'ı/menülerin üstüne taşar.
      // relative: yan panel haritanın üzerine konumlansın.
      className="relative isolate overflow-hidden rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700"
      style={{ height }}
    >
      <MapContainer
        center={points[0] ?? ADANA}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
      >
        <MapGestureController {...gate} />
        {satellite ? (
          <TileLayer
            key="satellite"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution='Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics'
            maxZoom={19}
          />
        ) : (
          <TileLayer
            key="osm"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
        )}
        <FitBounds points={points} />
        {enablePanel && <FlyToSelected lib={selected} />}
        {located.map((lib) => (
          <Marker
            key={lib.id}
            position={[lib.location_lat as number, lib.location_lng as number]}
            icon={libraryIcon(lib, enablePanel && selected?.id === lib.id)}
            eventHandlers={enablePanel ? { click: () => setSelected(lib) } : undefined}
          >
            {!enablePanel && (
              <Popup>
                <div className="min-w-[180px]">
                  <p className="text-sm font-bold text-slate-900">{lib.name}</p>
                  {lib.location_text && (
                    <p className="mt-0.5 text-xs text-slate-500">{lib.location_text}</p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                    <span className="text-amber-500">★</span>
                    <span>
                      {lib.rating_average != null ? lib.rating_average.toFixed(1) : "Yeni"}
                    </span>
                    {lib.rating_count > 0 && (
                      <span className="text-slate-400">({lib.rating_count})</span>
                    )}
                    {lib.open_now != null && (
                      <span className={lib.open_now ? "text-emerald-600" : "text-rose-500"}>
                        • {lib.open_now ? "Açık" : "Kapalı"}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Link
                      to={ROUTES.library(lib.slug)}
                      className="inline-block rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold !text-white hover:bg-indigo-700 hover:!text-white"
                    >
                      Profili gör →
                    </Link>
                    <a
                      href={
                        lib.google_place_id
                          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lib.name)}&query_place_id=${lib.google_place_id}`
                          : `https://www.google.com/maps/search/?api=1&query=${lib.location_lat},${lib.location_lng}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold !text-slate-700 hover:bg-slate-200 hover:!text-slate-900"
                    >
                      🗺️ Haritada Görüntüle
                    </a>
                  </div>
                </div>
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>

      <MapGateHint active={gate.active} />

      {/* Harita ↔ Uydu geçişi (sağ-alt; arama sağ-üstte) */}
      <button
        type="button"
        onClick={() => setSatellite((s) => !s)}
        className="absolute bottom-3 right-3 z-[1000] rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow ring-1 ring-black/10 transition hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-white/10 dark:hover:bg-slate-700"
      >
        {satellite ? "Harita" : "Uydu"}
      </button>

      {enablePanel && selected && (
        <LibraryMapPanel library={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
