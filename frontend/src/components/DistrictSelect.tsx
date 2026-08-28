import { Suspense, lazy, useRef, useState } from "react";
import { SEARCH_PRIMARY_DISTRICTS, SEARCH_MORE_DISTRICTS } from "@/lib/districts";

/* Harita modalı TEMBEL yüklenir. Ana sayfanın arama kutusu bu bileşeni
   kullanıyor; doğrudan import edildiğinde Leaflet + react-leaflet + ilçe
   GeoJSON'u (~144 KB) giriş paketine giriyor ve HARİTAYI HİÇ AÇMAYAN
   ziyaretçiler dahil herkes indiriyordu. Buton şu an gizli (bkz. SHOW_MAP_OPTION)
   ama modal alt yapısı hazır kalsın diye kod duruyor. */
const DistrictMapModal = lazy(() =>
  import("@/components/DistrictMapModal").then((m) => ({
    default: m.DistrictMapModal,
  }))
);

/** "Haritadan seç" şu an gizli — tek yerden geri açılabilsin diye bayrak. */
const SHOW_MAP_OPTION = false;

/* ─────────────────────────────────────────────────────────────────────────
   Çoklu ilçe seçici. Tetik butonu seçimi özetler ("Tüm ilçeler" / "Seyhan" /
   "2 ilçe" / "Uzaktan Eğitim"). Tıklayınca açılan popover'da en üstte "Uzaktan
   Eğitim" checkbox'ı, ardından ilçeler düz liste halinde (açılır menü yok) +
   "Diğer ilçeleri görüntüle" ile geri kalan (daha az nüfuslu) ilçeler açılır.
   Altta "Seçimi temizle" + "Tamam". Popover `fixed` konumlanır → arama
   pill'inin overflow-hidden'ı kırpmaz; her arama çubuğuna stilini bozmadan girer.
   ──────────────────────────────────────────────────────────────────────── */

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** "Uzaktan Eğitim" checkbox'ı — yalnız eğitmen aramasında anlamlı (kütüphanede yok). */
  remote?: boolean;
  onRemoteChange?: (next: boolean) => void;
  /** Uzaktan Eğitim seçeneğini göster/gizle (kütüphane aramasında anlamsız). */
  showRemoteOption?: boolean;
  /** Tetik butonunun (bar'a uyan) sınıfları. */
  triggerClassName?: string;
}

export function DistrictSelect({
  value,
  onChange,
  remote = false,
  onRemoteChange,
  showRemoteOption = true,
  triggerClassName = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [showMore, setShowMore] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const label =
    value.length > 0
      ? value.length === 1
        ? value[0]
        : `${value.length} ilçe`
      : remote
        ? "Uzaktan Eğitim"
        : "Tüm ilçeler";

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
        <span className={value.length > 0 || remote ? "font-semibold" : ""}>{label}</span>
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
            className="z-[90] flex max-h-[70vh] flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-100 "
          >
            <div className="min-h-0 overflow-y-auto p-1.5">
              {showRemoteOption && (
                <>
                  <CheckboxRow
                    label="Uzaktan Eğitim"
                    checked={remote}
                    onClick={() => onRemoteChange?.(!remote)}
                  />
                  <div className="my-1 h-px bg-slate-100 " />
                </>
              )}

              {SEARCH_PRIMARY_DISTRICTS.map((d) => (
                <CheckboxRow key={d} label={d} checked={value.includes(d)} onClick={() => toggle(d)} />
              ))}

              {showMore &&
                SEARCH_MORE_DISTRICTS.map((d) => (
                  <CheckboxRow key={d} label={d} checked={value.includes(d)} onClick={() => toggle(d)} />
                ))}

              {!showMore && (
                <button
                  type="button"
                  onClick={() => setShowMore(true)}
                  className="flex w-full items-center rounded-xl px-3 py-1.5 text-left text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 "
                >
                  Diğer ilçeleri görüntüle
                </button>
              )}

              {SHOW_MAP_OPTION && (
                <>
                  <div className="my-1 h-px bg-slate-100 " />
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setMapOpen(true);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 "
                  >
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    Haritadan seç
                  </button>
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5 border-t border-slate-100 p-1.5 ">
              {(value.length > 0 || remote) && (
                <button
                  type="button"
                  onClick={() => {
                    onChange([]);
                    onRemoteChange?.(false);
                  }}
                  className="flex-1 rounded-xl px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-slate-50 "
                >
                  Seçimi temizle
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                Tamam
              </button>
            </div>
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

/** Popover'daki tek bir checkbox satırı (ilçe veya "Uzaktan Eğitim"). */
function CheckboxRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 "
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition ${
          checked
            ? "border-indigo-600 bg-indigo-600 text-white"
            : "border-slate-300 "
        }`}
      >
        {checked && (
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}

export default DistrictSelect;
