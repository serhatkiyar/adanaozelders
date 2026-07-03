// Sipariş canlı takibi (teslimat Faz C) — kurye dağıtımdayken sipariş
// detayında harita + "kaç durak önde / tahmini varış" şeridi gösterir.
// Konum ~15 sn'de bir tazelenir (poll); kurye sinyali kesikse yalnız ev pini kalır.
import { useMemo } from "react";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import L from "leaflet";

import { useOrderTracking } from "@/hooks/useDelivery";
import { formatEta } from "@/lib/polyline";
import type { OrderOut } from "@/types";

const homeIcon = L.divIcon({
  className: "",
  html: `<div style="background:#0f172a;color:white;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"/></svg></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const courierIcon = L.divIcon({
  className: "",
  html: `<div style="background:#6366f1;color:white;width:32px;height:32px;border-radius:9999px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"/></svg></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

export function OrderTrackingSection({ order }: { order: OrderOut }) {
  // Takip yalnız fiziksel + ödenmiş siparişte anlamlı (iptal/iade hariç).
  const relevant =
    order.has_physical &&
    order.payment_status === "PAID" &&
    (order.status === "PAID" || order.status === "SHIPPED" || order.status === "DELIVERED");
  const { data: t } = useOrderTracking(relevant ? order.id : null);

  const bounds = useMemo(() => {
    if (!t) return null;
    const pts: [number, number][] = [];
    if (t.ship_lat != null && t.ship_lng != null) pts.push([t.ship_lat, t.ship_lng]);
    if (t.courier_lat != null && t.courier_lng != null)
      pts.push([t.courier_lat, t.courier_lng]);
    return pts.length ? L.latLngBounds(pts).pad(0.3) : null;
  }, [t]);

  if (!relevant || !t) return null;

  if (t.status === "FAILED") {
    return (
      <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        Kuryemiz bugün adresinde sana ulaşamadı — teslimat yeniden planlanacak.
        Sorun yaşarsan destek ile iletişime geçebilirsin.
      </div>
    );
  }

  if (t.status !== "EN_ROUTE") return null;

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
        </span>
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          Kuryemiz dağıtımda
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t.stops_ahead != null && t.stops_ahead > 0
            ? `Senden önce ${t.stops_ahead} teslimat var`
            : "Sıradaki teslimat sensin"}
          {t.eta && ` · tahmini varış ~${formatEta(t.eta)}`}
        </p>
        {t.courier_age_seconds != null && (
          <span className="ml-auto text-[11px] text-slate-400 dark:text-slate-500">
            son sinyal {t.courier_age_seconds < 5 ? "az önce" : `${t.courier_age_seconds} sn önce`}
          </span>
        )}
      </div>
      {(t.ship_lat != null || t.courier_lat != null) && bounds && (
        <MapContainer
          bounds={bounds}
          style={{ height: 280, width: "100%", zIndex: 0 }}
          attributionControl={false}
          scrollWheelZoom={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {t.ship_lat != null && t.ship_lng != null && (
            <Marker position={[t.ship_lat, t.ship_lng]} icon={homeIcon} />
          )}
          {t.courier_lat != null && t.courier_lng != null && (
            <Marker position={[t.courier_lat, t.courier_lng]} icon={courierIcon} />
          )}
        </MapContainer>
      )}
    </div>
  );
}
