import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { Link } from "react-router-dom";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { ROUTES } from "@/lib/routes";
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
// beyaz çerçeve + gölge + alt işaretçi ile harita pini gibi durur.
function libraryIcon(lib: LibrarySearchOut): L.DivIcon {
  const initial = esc((lib.name?.trim()?.[0] ?? "?").toUpperCase());
  const img = lib.logo_url
    ? `<img src="${esc(lib.logo_url)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" onerror="this.remove()"/>`
    : "";
  const html = `
    <div style="position:relative;width:44px;height:52px">
      <div style="position:relative;width:44px;height:44px;border-radius:9999px;overflow:hidden;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;border:2px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.35)">
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
}

export function LibrariesMap({ libraries, height = "70vh" }: LibrariesMapProps) {
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

  return (
    <div
      // isolate: Leaflet'in iç panel/kontrolleri (z-index 400–1000) kendi stacking
      // context'inde kalsın; aksi halde sayfa header'ı/menülerin üstüne taşar.
      className="isolate overflow-hidden rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700"
      style={{ height }}
    >
      <MapContainer
        center={points[0] ?? ADANA}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <FitBounds points={points} />
        {located.map((lib) => (
          <Marker
            key={lib.id}
            position={[lib.location_lat as number, lib.location_lng as number]}
            icon={libraryIcon(lib)}
          >
            <Popup>
              <div className="min-w-[180px]">
                <p className="text-sm font-bold text-slate-900">{lib.name}</p>
                {lib.location_text && (
                  <p className="mt-0.5 text-xs text-slate-500">{lib.location_text}</p>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                  <span className="text-amber-500">★</span>
                  <span>
                    {lib.rating_average != null
                      ? lib.rating_average.toFixed(1)
                      : "Yeni"}
                  </span>
                  {lib.rating_count > 0 && (
                    <span className="text-slate-400">({lib.rating_count})</span>
                  )}
                  {lib.open_now != null && (
                    <span
                      className={
                        lib.open_now ? "text-emerald-600" : "text-rose-500"
                      }
                    >
                      • {lib.open_now ? "Açık" : "Kapalı"}
                    </span>
                  )}
                </div>
                <Link
                  to={ROUTES.library(lib.slug)}
                  className="mt-2 inline-block rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold !text-white hover:bg-indigo-700 hover:!text-white"
                >
                  Profili gör →
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
