// Dağıtım turu rota haritası — depo + numaralı duraklar + rota çizgisi.
// Geometri varsa (VROOM/OSRM) gerçek yol polyline'ı, yoksa duraklar arası
// düz çizgi (haversine fallback) çizilir.
import { useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";
import L from "leaflet";

import { decodePolyline } from "@/lib/polyline";
import type { CourierPosition, DeliveryRun, DeliveryStop } from "@/types";
import { tileSource } from "@/lib/mapTiles";

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

const courierIcon = L.divIcon({
  className: "",
  html: `<div style="background:#6366f1;color:white;width:30px;height:30px;border-radius:9999px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"/></svg></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

export function DeliveryRouteMap({
  run,
  courier,
}: {
  run: DeliveryRun;
  /** Kuryenin canlı konumu (yalnız aktif turda; admin panel poll'lar). */
  courier?: CourierPosition | null;
}) {
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
        <TileLayer url={tileSource().url} attribution={tileSource().attribution} />
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
        {courier?.lat != null && courier?.lng != null && (
          <Marker position={[courier.lat, courier.lng]} icon={courierIcon} />
        )}
      </MapContainer>
    </div>
  );
}
