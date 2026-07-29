import { Suspense, lazy, useRef, useState } from "react";
import { ADANA_DISTRICTS } from "@/lib/districts";

/* Harita modalı TEMBEL yüklenir. Ana sayfanın arama kutusu bu bileşeni
   kullanıyor; doğrudan import edildiğinde Leaflet + react-leaflet + ilçe
   GeoJSON'u (~144 KB) giriş paketine giriyor ve HARİTAYI HİÇ AÇMAYAN
   ziyaretçiler dahil herkes indiriyordu. */
const DistrictMapModal = lazy(() =>
  import("@/components/DistrictMapModal").then((m) => ({
    default: m.DistrictMapModal,
  }))
);

/* ─────────────────────────────────────────────────────────────────────────
   Çoklu ilçe seçici. Tetik butonu seçimi özetler ("Tüm ilçeler" / "Seyhan" /
   "2 ilçe"). Tıklayınca açılan popover'da hızlı checkbox listesi + "Haritadan
   seç" (polygon'lu harita modalı). Popover `fixed` konumlanır → arama pill'inin
   overflow-hidden'ı kırpmaz; her arama çubuğuna stilini bozmadan girer.
   ──────────────────────────────────────────────────────────────────────── */

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** Tetik butonunun (bar'a uyan) sınıfları. */
  triggerClassName?: string;
}

export function DistrictSelect({ value, onChange, triggerClassName = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const label =
    value.length === 0
      ? "Tüm ilçeler"
      : value.length === 1
        ? value[0]
        : `${value.length} ilçe`;

  const toggle = (d: string) =>
    onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);

  const openPopover = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, left: r.left });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-label="İlçe"
        className={triggerClassName}
      >
        <span className={value.length === 0 ? "" : "font-semibold"}>{label}</span>
        <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && pos && (
        <>
          {/* dış tıklama yakalayıcı */}
          <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)} />
          <div
            style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: 224 }}
            className="z-[90] rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700"
          >
            {ADANA_DISTRICTS.map((d) => {
              const checked = value.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggle(d)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition ${
                      checked
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-slate-300 dark:border-slate-600"
                    }`}
                  >
                    {checked && (
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  {d}
                </button>
              );
            })}

            <div className="my-1 h-px bg-slate-100 dark:bg-slate-700" />

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setMapOpen(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              Haritadan seç
            </button>

            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700/50"
              >
                Seçimi temizle
              </button>
            )}
          </div>
        </>
      )}

      {/* Yalnız açıldığında yüklenir; kapalıyken hiçbir harita kodu inmez. */}
      {mapOpen && (
        <Suspense fallback={null}>
          <DistrictMapModal
            open
            value={value}
            onApply={onChange}
            onClose={() => setMapOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}

export default DistrictSelect;
