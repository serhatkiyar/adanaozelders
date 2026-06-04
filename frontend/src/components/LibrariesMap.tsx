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
      className="overflow-hidden rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700"
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
                  className="mt-2 inline-block rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
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
