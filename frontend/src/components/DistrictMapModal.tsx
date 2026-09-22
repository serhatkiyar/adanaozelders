import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import geoRaw from "@/lib/adanaDistrictsGeo.json";
import { tileSource } from "@/lib/mapTiles";

/* ─────────────────────────────────────────────────────────────────────────
   İlçe seçim haritası (modal). Adana metropol ilçelerinin sınırları polygon
   olarak çizilir; tıklayınca seçim toggle olur (yeşil = seçili, gri = değil).
   Çoklu seçim. "Uygula" ile seçilenler üst bileşene döner.

   Yakınlaştırınca polygon centroid'ine sabitlenen etiketler kadrajdan çıkıp
   "hangi ilçedeyim" belirsizleşiyordu. Çözüm (Leaflet choropleth standardı):
   viewport'a SABİT bir bilgi kutusu (HUD), fareyle gezilen ya da harita
   merkezindeki ilçeyi her zaman gösterir (zoom'dan bağımsız). Centroid
   etiketleri yalnız genel görünüm (düşük zoom) için kalır.
   ──────────────────────────────────────────────────────────────────────── */

const GEO = geoRaw as unknown as FeatureCollection<Geometry, { name: string }>;

// Tüm stillerde ortak className → CSS ile yumuşak geçiş (`.district-poly`, index.css).
const SELECTED_STYLE: L.PathOptions = {
  className: "district-poly",
  color: "#059669", // emerald-600
  weight: 2,
  fillColor: "#10b981", // emerald-500
  fillOpacity: 0.45,
};
const UNSELECTED_STYLE: L.PathOptions = {
  className: "district-poly",
  color: "#94a3b8", // slate-400
  weight: 1.5,
  fillColor: "#cbd5e1", // slate-300
  fillOpacity: 0.12,
};
// Hover vurgusu: seçilmemişte indigo (="seç"), seçilide koyu yeşil (="kaldır").
const UNSELECTED_HOVER: L.PathOptions = {
  className: "district-poly",
  color: "#C2410C", // --marka
  weight: 3,
  fillColor: "#EA580C", // --marka-mid
  fillOpacity: 0.4,
};
const SELECTED_HOVER: L.PathOptions = {
  className: "district-poly",
  color: "#047857", // emerald-700
  weight: 3,
  fillColor: "#10b981",
  fillOpacity: 0.68,
};
// Etiketlerin okunamayacağı kadar üst üste bindiği zoom seviyesinde gizle;
// o noktada "hangi alandayım" sorusunu HUD kutusu yanıtlar.
const LABEL_MAX_ZOOM = 12;

/* ── Nokta-poligon içinde mi (ray casting) — harita merkezindeki ilçeyi bulmak için ── */
function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInPolygon(x: number, y: number, poly: number[][][]): boolean {
  if (!poly.length || !pointInRing(x, y, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(x, y, poly[k])) return false; // delik
  return true;
}
function districtAt(lng: number, lat: number): string | null {
  for (const f of GEO.features) {
    const g = f.geometry;
    if (g.type === "Polygon" && pointInPolygon(lng, lat, g.coordinates as number[][][]))
      return f.properties.name;
    if (
      g.type === "MultiPolygon" &&
      (g.coordinates as number[][][][]).some((p) => pointInPolygon(lng, lat, p))
    )
      return f.properties.name;
  }
  return null;
}

function FitBounds() {
  const map = useMap();
  useEffect(() => {
    const layer = L.geoJSON(GEO as any);
    const b = layer.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [24, 24] });
    // yalnız ilk açılışta sınırlara otur
  }, [map]);
  return null;
}

/** Harita hareket/zoom'unda: merkezdeki ilçeyi ve zoom seviyesini üst bileşene bildirir. */
function MapWatcher({
  onCenter,
  onZoom,
}: {
  onCenter: (name: string | null) => void;
  onZoom: (z: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const update = () => {
      const c = map.getCenter();
      onCenter(districtAt(c.lng, c.lat));
      onZoom(map.getZoom());
    };
    update();
    map.on("moveend zoomend", update);
    return () => {
      map.off("moveend zoomend", update);
    };
  }, [map, onCenter, onZoom]);
  return null;
}

interface Props {
  open: boolean;
  value: string[];
  onApply: (next: string[]) => void;
  onClose: () => void;
}

export function DistrictMapModal({ open, value, onApply, onClose }: Props) {
  const [draft, setDraft] = useState<string[]>(value);
  const [hovered, setHovered] = useState<string | null>(null);
  const [centerName, setCenterName] = useState<string | null>(null);
  const [zoom, setZoom] = useState(11);

  useEffect(() => {
    if (open) {
      setDraft(value);
      setHovered(null);
    }
  }, [open, value]);

  // draft/zoom değişince GeoJSON katmanını yeniden çiz (stil + etiket görünürlüğü).
  const showLabels = zoom <= LABEL_MAX_ZOOM;
  const geoKey = useMemo(
    () => `${showLabels ? "L" : "-"}|${draft.slice().sort().join("|")}`,
    [draft, showLabels]
  );

  const onCenter = useCallback((n: string | null) => setCenterName(n), []);
  const onZoom = useCallback((z: number) => setZoom(z), []);

  if (!open) return null;

  const toggle = (name: string) =>
    setDraft((prev) =>
      prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]
    );

  // HUD'da gösterilecek aktif ilçe: önce fareyle gezilen, yoksa harita merkezindeki.
  const active = hovered ?? centerName;
  const activeSelected = active ? draft.includes(active) : false;

  // Portal → document.body. Navbar'daki backdrop-blur, fixed elemanlar için
  // kapsayıcı blok oluşturduğundan modal aksi halde viewport'a göre değil
  // navbar'a göre konumlanıp ekranın dışına taşıyordu.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 ">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 ">
          <div>
            <h2 className="text-lg font-bold text-slate-900 ">Haritadan ilçe seç</h2>
            <p className="mt-0.5 text-xs text-slate-500 ">
              İlçelere tıklayarak seç (yeşil), birden fazla seçebilirsin.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 "
            aria-label="Kapat"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="relative h-[58vh] w-full">
          {/* Sabit bilgi kutusu (HUD): zoom ne olursa olsun hangi ilçede olduğunu gösterir */}
          <div className="pointer-events-none absolute right-3 top-3 z-[1000] max-w-[70%]">
            <div className="flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 shadow-md ring-1 ring-slate-200 backdrop-blur-sm ">
              <svg className="h-4 w-4 shrink-0 text-marka-metin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0118 0z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              {active ? (
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 ">
                  {active}
                  {activeSelected && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 ">
                      Seçili
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-sm font-medium text-slate-500 ">
                  Haritada gezin
                </span>
              )}
            </div>
          </div>

          <MapContainer
            center={[37.0, 35.32]}
            zoom={11}
            scrollWheelZoom
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution={tileSource().attribution}
              url={tileSource().url}
            />
            <FitBounds />
            <MapWatcher onCenter={onCenter} onZoom={onZoom} />
            <GeoJSON
              key={geoKey}
              data={GEO as any}
              // Stil tamamen state'ten sürülür (hover + seçim). react-leaflet her
              // render'da style'ı yeniden uyguladığından, hover'ı burada bilmek
              // şart — yoksa setHovered render'ında vurgu anında sıfırlanır.
              style={(feature) => {
                const name = (feature as Feature<Geometry, { name: string }>).properties.name;
                const selected = draft.includes(name);
                if (name === hovered) return selected ? SELECTED_HOVER : UNSELECTED_HOVER;
                return selected ? SELECTED_STYLE : UNSELECTED_STYLE;
              }}
              onEachFeature={(feature, layer) => {
                const name = (feature as Feature<Geometry, { name: string }>).properties.name;
                if (showLabels) {
                  layer.bindTooltip(name, {
                    permanent: true,
                    direction: "center",
                    className: "district-label",
                  });
                }
                layer.on({
                  click: () => toggle(name),
                  mouseover: (e) => {
                    setHovered(name);
                    (e.target as L.Path).bringToFront();
                  },
                  mouseout: () => setHovered((h) => (h === name ? null : h)),
                });
              }}
            />
          </MapContainer>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 ">
          <button
            onClick={() => setDraft([])}
            disabled={draft.length === 0}
            className="text-sm font-semibold text-slate-500 transition hover:text-slate-700 disabled:opacity-40 "
          >
            Temizle
          </button>
          <button
            onClick={() => {
              onApply(draft);
              onClose();
            }}
            className="rounded-xl bg-marka px-5 py-2.5 text-sm font-semibold text-marka-fg shadow-sm shadow-marka/20 transition hover:bg-marka-hover active:scale-95"
          >
            {draft.length ? `${draft.length} ilçeyi uygula` : "Tüm ilçeler"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default DistrictMapModal;
