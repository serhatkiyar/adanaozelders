import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import geoRaw from "@/lib/adanaDistrictsGeo.json";

/* ─────────────────────────────────────────────────────────────────────────
   İlçe seçim haritası (modal). Adana metropol ilçelerinin sınırları polygon
   olarak çizilir; tıklayınca seçim toggle olur (yeşil = seçili, gri = değil).
   Çoklu seçim. "Uygula" ile seçilenler üst bileşene döner.
   ──────────────────────────────────────────────────────────────────────── */

const GEO = geoRaw as unknown as FeatureCollection<Geometry, { name: string }>;

const SELECTED_STYLE: L.PathOptions = {
  color: "#059669", // emerald-600
  weight: 2,
  fillColor: "#10b981", // emerald-500
  fillOpacity: 0.45,
};
const UNSELECTED_STYLE: L.PathOptions = {
  color: "#94a3b8", // slate-400
  weight: 1.5,
  fillColor: "#cbd5e1", // slate-300
  fillOpacity: 0.12,
};

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

interface Props {
  open: boolean;
  value: string[];
  onApply: (next: string[]) => void;
  onClose: () => void;
}

export function DistrictMapModal({ open, value, onApply, onClose }: Props) {
  const [draft, setDraft] = useState<string[]>(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  // draft değişince GeoJSON katmanını yeniden çizmek için key.
  const geoKey = useMemo(() => draft.slice().sort().join("|"), [draft]);

  if (!open) return null;

  const toggle = (name: string) =>
    setDraft((prev) =>
      prev.includes(name) ? prev.filter((d) => d !== name) : [...prev, name]
    );

  // Portal → document.body. Navbar'daki backdrop-blur, fixed elemanlar için
  // kapsayıcı blok oluşturduğundan modal aksi halde viewport'a göre değil
  // navbar'a göre konumlanıp ekranın dışına taşıyordu.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Haritadan ilçe seç</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              İlçelere tıklayarak seç (yeşil) — birden fazla seçebilirsin.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            aria-label="Kapat"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="h-[58vh] w-full">
          <MapContainer
            center={[37.0, 35.32]}
            zoom={11}
            scrollWheelZoom
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds />
            <GeoJSON
              key={geoKey}
              data={GEO as any}
              style={(feature) =>
                feature && draft.includes((feature as Feature<Geometry, { name: string }>).properties.name)
                  ? SELECTED_STYLE
                  : UNSELECTED_STYLE
              }
              onEachFeature={(feature, layer) => {
                const name = (feature as Feature<Geometry, { name: string }>).properties.name;
                layer.bindTooltip(name, {
                  permanent: true,
                  direction: "center",
                  className: "district-label",
                });
                layer.on({
                  click: () => toggle(name),
                  mouseover: (e) => (e.target as L.Path).setStyle({ fillOpacity: 0.55 }),
                  mouseout: (e) =>
                    (e.target as L.Path).setStyle(
                      draft.includes(name) ? SELECTED_STYLE : UNSELECTED_STYLE
                    ),
                });
              }}
            />
          </MapContainer>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-800/50">
          <button
            onClick={() => setDraft([])}
            disabled={draft.length === 0}
            className="text-sm font-semibold text-slate-500 transition hover:text-slate-700 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Temizle
          </button>
          <button
            onClick={() => {
              onApply(draft);
              onClose();
            }}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-500/20 transition hover:bg-indigo-700 active:scale-95"
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
