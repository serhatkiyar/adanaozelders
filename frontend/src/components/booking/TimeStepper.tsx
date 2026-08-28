import { useEffect } from "react";

/**
 * Saat/dakika artır-azalt seçici (büyük, dokunmatik dostu).
 * Saat 1'er, dakika 15'er adımla döner (00:00 … 23:45). Boşken 09:00'a düşer.
 * Hem ders rezervasyonu (BookingModal) hem çalışma alanı (StudySpaceSection) kullanır.
 */
export function TimeStepper({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [hStr, mStr] = (value || "09:00").split(":");
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;

  useEffect(() => {
    if (!value) onChange("09:00");
  }, [value, onChange]);

  const update = (newH: number, newM: number) => {
    let finalH = newH;
    let finalM = newM;
    if (finalH < 0) finalH = 23;
    if (finalH > 23) finalH = 0;
    if (finalM < 0) finalM = 45;
    if (finalM > 45) finalM = 0;
    onChange(`${String(finalH).padStart(2, "0")}:${String(finalM).padStart(2, "0")}`);
  };

  const arrowBtn =
    "rounded-xl bg-white p-1.5 text-slate-400 shadow-sm ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-600 hover:ring-indigo-200 ";

  return (
    <div className="flex items-center justify-center gap-4 rounded-2xl border-2 border-slate-200 bg-slate-50/50 p-4 ">
      {/* Saat */}
      <div className="flex flex-col items-center gap-2">
        <button type="button" onClick={() => update(h + 1, m)} className={arrowBtn}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <div className="w-14 text-center text-3xl font-black text-slate-800 ">
          {String(h).padStart(2, "0")}
        </div>
        <button type="button" onClick={() => update(h - 1, m)} className={arrowBtn}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      <div className="text-3xl font-black text-slate-300 pb-1">:</div>

      {/* Dakika */}
      <div className="flex flex-col items-center gap-2">
        <button type="button" onClick={() => update(h, m + 15)} className={arrowBtn}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <div className="w-14 text-center text-3xl font-black text-slate-800 ">
          {String(m).padStart(2, "0")}
        </div>
        <button type="button" onClick={() => update(h, m - 15)} className={arrowBtn}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
