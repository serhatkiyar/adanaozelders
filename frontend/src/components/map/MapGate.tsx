import { useCallback, useEffect, useState } from "react";
import { useMapEvents } from "react-leaflet";

// Kilit/aç ile yönetilen Leaflet etkileşim handler'ları.
const HANDLERS = [
  "dragging",
  "scrollWheelZoom",
  "doubleClickZoom",
  "touchZoom",
  "boxZoom",
  "keyboard",
] as const;

/**
 * "Tıkla-etkinleştir" harita kapısı (Google Maps gömülü haritaları gibi).
 *
 * Amaç: sayfada gezerken (fare tekerleği / sürükleme) haritanın yanlışlıkla
 * kaymasını/zoom'lanmasını ve konum seçicide pinin oynamasını önlemek.
 *
 * Kullanım: `useMapGate()` ile state al → `<MapGestureController {...gate} />`'ı
 * MapContainer İÇİNE, `<MapGateHint active={gate.active} />`'ı haritanın üstündeki
 * konumlandırılmış (relative) sarmalayıcıya koy. Sarmalayıcıya `group` ekle.
 */
export function useMapGate() {
  const [active, setActive] = useState(false);
  const onActivate = useCallback(() => setActive(true), []);
  const onDeactivate = useCallback(() => setActive(false), []);

  // Sayfa (veya modal) kayınca haritayı yeniden kilitle — mobil + masaüstü ortak güvence.
  useEffect(() => {
    if (!active) return;
    const relock = () => setActive(false);
    window.addEventListener("scroll", relock, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", relock, { capture: true } as EventListenerOptions);
  }, [active]);

  return { active, onActivate, onDeactivate };
}

/** MapContainer İÇİNE konur: kilitliyken tüm gesture'ları kapatır, tıklayınca açar,
 *  fare haritadan çıkınca tekrar kilitler. */
export function MapGestureController({
  active,
  onActivate,
  onDeactivate,
}: {
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const map = useMapEvents({
    click() {
      if (!active) onActivate();
    },
  });

  // active değişince handler'ları aç/kapat.
  useEffect(() => {
    type Toggleable = { enable: () => void; disable: () => void };
    const handlers = map as unknown as Record<string, Toggleable | undefined>;
    for (const name of HANDLERS) {
      const handler = handlers[name];
      if (!handler) continue;
      if (active) handler.enable();
      else handler.disable();
    }
  }, [active, map]);

  // Fare haritadan çıkınca yeniden kilitle (masaüstü).
  useEffect(() => {
    const el = map.getContainer();
    const leave = () => onDeactivate();
    el.addEventListener("mouseleave", leave);
    return () => el.removeEventListener("mouseleave", leave);
  }, [map, onDeactivate]);

  return null;
}

/** Kilitliyken alt-ortada beliren "tıkla" ipucu çipi (tıklamayı engellemez). */
export function MapGateHint({
  active,
  label = "Hareket ettirmek için tıkla",
}: {
  active: boolean;
  label?: string;
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-2 z-[500] flex justify-center transition-opacity duration-200 ${
        active ? "opacity-0" : "opacity-100"
      }`}
    >
      <span className="rounded-full bg-slate-900/70 px-3 py-1 text-[11px] font-medium text-white shadow backdrop-blur-sm">
        🔒 {label}
      </span>
    </div>
  );
}
