import { Suspense, lazy, useRef, useState } from "react";
import { SEARCH_PRIMARY_DISTRICTS, SEARCH_MORE_DISTRICTS } from "@/lib/districts";
import { yerAra, yerEtiketi, yerinIlceleri, type YerSecimi } from "@/lib/yerArama";

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
   Çoklu yer seçici (sonuç sayfalarının navbar hapı). Tetik butonu seçimi
   özetler ("Tüm yerler" / "Seyhan" / "2 ilçe" / "Reşatbey, Seyhan").

   8 Eyl 2026: içindeki "Uzaktan Eğitim" checkbox'ı KALDIRILDI. Ders şekli bir
   YER seçicisinin içinde yaşamamalı — kullanıcının "kafa karıştırıcı" dediği
   tasarımın kaynaklarından biri buydu; üstelik yalnız uzaktanı ifade
   edebiliyor, yüz yüzenin karşılığı bulunmuyordu. Şekil artık kendi alanında
   (`AramaSecicileri.tsx`).

   Tıklayınca açılan popover'da ilçeler düz liste halinde (açılır menü yok) +
   "Diğer ilçeleri görüntüle" ile geri kalan (daha az nüfuslu) ilçeler açılır.
   Altta "Seçimi temizle" + "Tamam". Popover `fixed` konumlanır → arama
   pill'inin overflow-hidden'ı kırpmaz; her arama çubuğuna stilini bozmadan girer.
   ──────────────────────────────────────────────────────────────────────── */

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** Tetik butonunun (bar'a uyan) sınıfları. */
  triggerClassName?: string;
  /** Görünür etiketin id'si. Tetikleyici bir <button>; ona `<label htmlFor>`
   *  bağlanamaz, erişilebilir ad `aria-labelledby` ile verilir. */
  triggerLabelledBy?: string;
  /** Seçili mahalle çapası (bkz. lib/yerArama.ts). Verilmezse yalnız ilçe
   *  seçimi çalışır — eski davranış korunur. */
  yer?: YerSecimi | null;
  onYerChange?: (v: YerSecimi | null) => void;
}

export function DistrictSelect({
  value,
  onChange,
  triggerClassName = "",
  triggerLabelledBy,
  yer = null,
  onYerChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [showMore, setShowMore] = useState(false);
  // Mahalle araması: kutu boşken bugünkü ilçe listesi, yazınca yer önerileri.
  const [ara, setAra] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const label =
    yer?.tur === "mahalle"
      ? yerEtiketi(yer)
      : value.length > 0
        ? value.length === 1
          ? value[0]
          : `${value.length} ilçe`
        : "İlçe seçin";

  const toggle = (d: string) => {
    // İlçe kutusuna dokunmak mahalle çapasını geçersiz kılar: kutuda
    // "Reşatbey" yazarken başka bir ilçenin işaretli kalması, kullanıcının
    // gördüğü ile aranan şeyi ayırırdı.
    onYerChange?.(null);
    onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);
  };

  const yerSec = (secim: YerSecimi) => {
    if (secim.tur === "mahalle") {
      onYerChange?.(secim);
      onChange([secim.ilce]);
    } else {
      onYerChange?.(null);
      onChange(yerinIlceleri(secim));
    }
    setAra("");
    setOpen(false);
  };

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
        // Görünür başlık varsa erişilebilir ad ONDAN gelir; `aria-label` ile
        // ikisi birlikte olursa ekran okuyucu görünen başlığı yok sayar.
        aria-labelledby={triggerLabelledBy}
        aria-label={triggerLabelledBy ? undefined : "İlçe"}
        className={triggerClassName}
      >
        <span className={value.length > 0 || yer ? "font-semibold" : ""}>{label}</span>
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
            {onYerChange && (
              <div className="shrink-0 border-b border-slate-100 p-1.5">
                <input
                  type="text"
                  value={ara}
                  onChange={(e) => setAra(e.target.value)}
                  placeholder="Mahalle veya ilçe ara"
                  aria-label="Mahalle veya ilçe ara"
                  className="w-full rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-marka-focus/30"
                />
              </div>
            )}

            <div className="min-h-0 overflow-y-auto p-1.5">
              {/* Yazılıyorsa YER önerileri; kutu boşken bugünkü ilçe listesi.
                  Mahalle tek seçimdir (bir konum çapasıdır), ilçeler çoklu
                  seçim olmaya devam eder. */}
              {ara.trim() ? (
                yerAra(ara, 30).map((y) => (
                  <button
                    key={`${y.secim.tur}:${y.altBaslik}:${y.baslik}`}
                    type="button"
                    onClick={() => yerSec(y.secim)}
                    className="flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition hover:bg-slate-50"
                  >
                    <span className="text-sm text-slate-800">{y.baslik}</span>
                    <span className="text-xs text-slate-400">{y.altBaslik}</span>
                  </button>
                ))
              ) : (
                <>
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
                  className="flex w-full items-center rounded-xl px-3 py-1.5 text-left text-xs font-medium text-marka-soft-fg transition hover:bg-marka-soft "
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
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-marka-soft-fg transition hover:bg-marka-soft "
                  >
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    Haritadan seç
                  </button>
                </>
              )}
                </>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5 border-t border-slate-100 p-1.5 ">
              {(value.length > 0 || yer) && (
                <button
                  type="button"
                  onClick={() => {
                    onChange([]);
                    onYerChange?.(null);
                  }}
                  className="flex-1 rounded-xl px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-slate-50 "
                >
                  Seçimi temizle
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-xl bg-marka px-3 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover"
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
            ? "border-marka bg-marka text-marka-fg"
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
