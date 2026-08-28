import { MapContainer, Marker, TileLayer } from "react-leaflet";
import L from "leaflet";
import { tileSource } from "@/lib/mapTiles";

/** Salt-gösterim konum haritası — LibrariesMap'ten ayrıdır ve kasıtlı olarak
 *  KONTROL EDİLEMEZ: sürükleme/zoom/klavye kapalı, kontrol yok. Tek işi konumu
 *  göstermek; tıklanınca Google Haritalar'da açılır. Harita katmanı
 *  pointer-events'siz olduğundan tüm tıklamalar dıştaki bağlantıya gider. */

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="position:relative;width:28px;height:34px">
    <div style="position:absolute;inset:0;width:28px;height:28px;border-radius:9999px;background:#4f46e5;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.35)"></div>
    <div style="position:absolute;left:50%;top:25px;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid #fff;filter:drop-shadow(0 2px 1px rgba(15,23,42,.3))"></div>
  </div>`,
  iconSize: [28, 34],
  iconAnchor: [14, 34],
});

interface StaticLocationMapProps {
  lat: number;
  lng: number;
  /** Tıklanınca açılacak harita adresi (Google Haritalar). */
  href: string;
  height?: string;
  zoom?: number;
}

export function StaticLocationMap({
  lat,
  lng,
  href,
  height = "190px",
  zoom = 15,
}: StaticLocationMapProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Google Haritalar'da aç"
      className="group relative isolate block overflow-hidden rounded-xl ring-1 ring-slate-200 "
      style={{ height }}
    >
      {/* pointer-events-none: harita kendi başına etkileşim almaz → tıklama <a>'ya düşer. */}
      <div className="pointer-events-none h-full w-full">
        <MapContainer
          center={[lat, lng]}
          zoom={zoom}
          style={{ height: "100%", width: "100%" }}
          dragging={false}
          touchZoom={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          boxZoom={false}
          keyboard={false}
          zoomControl={false}
        >
          <TileLayer
            url={tileSource().url}
            attribution={tileSource().attribution}
            maxZoom={19}
          />
          <Marker position={[lat, lng]} icon={pinIcon} />
        </MapContainer>
      </div>

      {/* Hover'da niyeti belli et — harita bir bağlantı, oynatma alanı değil. */}
      <span className="pointer-events-none absolute inset-0 flex items-end justify-center bg-slate-900/0 pb-3 opacity-0 transition group-hover:bg-slate-900/10 group-hover:opacity-100">
        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-md ">
          Google Haritalar'da aç
        </span>
      </span>
    </a>
  );
}
