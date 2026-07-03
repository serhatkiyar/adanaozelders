// Dağıtım turu rota haritası — depo + numaralı duraklar + rota çizgisi.
// Geometri varsa (VROOM/OSRM) gerçek yol polyline'ı, yoksa duraklar arası
// düz çizgi (haversine fallback) çizilir.
import { useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";
import L from "leaflet";

import { decodePolyline } from "@/lib/polyline";
import type { DeliveryRun, DeliveryStop } from "@/types";

function stopIcon(stop: DeliveryStop): L.DivIcon {
  const tone =
    stop.status === "DELIVERED"
      ? "background:#10b981"
      : stop.status === "FAILED"
        ? "background:#f43f5e"
        : stop.is_outlier
          ? "background:#f59e0b"
          : "background:#6366f1";
  return L.divIcon({
    className: "",
    html: `<div style="${tone};color:white;width:24px;height:24px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid white">${stop.sequence}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

const depotIcon = L.divIcon({
  className: "",
  html: `<div style="background:#0f172a;color:white;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"/></svg></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

export function DeliveryRouteMap({ run }: { run: DeliveryRun }) {
  const located = useMemo(
    () =>
      [...run.stops]
        .filter((s) => s.lat != null && s.lng != null)
        .sort((a, b) => a.sequence - b.sequence),
    [run.stops]
  );

  const line = useMemo<[number, number][]>(() => {
    if (run.route_geometry) return decodePolyline(run.route_geometry);
    // Geometri yok (haversine) → depo + duraklar arası düz çizgi.
    return [
      [run.depot_lat, run.depot_lng],
      ...located.map((s) => [s.lat!, s.lng!] as [number, number]),
    ];
  }, [run.route_geometry, run.depot_lat, run.depot_lng, located]);

  const bounds = useMemo(() => {
    const pts: [number, number][] = [
      [run.depot_lat, run.depot_lng],
      ...located.map((s) => [s.lat!, s.lng!] as [number, number]),
    ];
    return L.latLngBounds(pts).pad(0.15);
  }, [run.depot_lat, run.depot_lng, located]);

  if (located.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-slate-600">
      <MapContainer
        bounds={bounds}
        style={{ height: 320, width: "100%", zIndex: 0 }}
        attributionControl={false}
        scrollWheelZoom={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Polyline
          positions={line}
          pathOptions={{
            color: "#6366f1",
            weight: 4,
            opacity: 0.8,
            // Düz çizgi (yaklaşık) kesikli çizilir — gerçek yol sanılmasın.
            dashArray: run.route_geometry ? undefined : "6 8",
          }}
        />
        <Marker position={[run.depot_lat, run.depot_lng]} icon={depotIcon} />
        {located.map((s) => (
          <Marker key={s.id} position={[s.lat!, s.lng!]} icon={stopIcon(s)} />
        ))}
      </MapContainer>
    </div>
  );
}
