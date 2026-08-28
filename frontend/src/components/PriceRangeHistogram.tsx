import { useEffect, useMemo, useState } from "react";

/* ─────────────────────────────────────────────────────────────────────────
   Airbnb tarzı fiyat aralığı histogramı + çift-uçlu slider.
   Gerçek veriyle çalışır: `rates` eşleşen eğitmenlerin saatlik ücretleridir
   (backend /tutors/price-histogram). Histogram bu dağılımı çizer; iki tutamak
   ve "Minimum/Maksimum" kutuları aralığı seçer.

   Üst sınır domain maksimumundayken "limitsiz" kabul edilir → max boş ("") döner
   (mevcut Marketplace mantığıyla uyumlu). Alt sınır domain minimumundaysa min
   boş döner.
   ──────────────────────────────────────────────────────────────────────── */

const BIN_COUNT = 34;

interface Props {
  /** Eşleşen eğitmenlerin saatlik ücretleri (ham). */
  rates: number[];
  loading?: boolean;
  /** Seçili min/max (string; boş = sınır yok) — Marketplace state'iyle aynı. */
  minRate: string;
  maxRate: string;
  onChange: (min: string, max: string) => void;
}

function roundTo(value: number, step: number, dir: "down" | "up"): number {
  const fn = dir === "down" ? Math.floor : Math.ceil;
  return fn(value / step) * step;
}

export function PriceRangeHistogram({
  rates,
  loading = false,
  minRate,
  maxRate,
  onChange,
}: Props) {
  // Domain gerçek ücret dağılımından türetilir; sınırlar temiz görünsün diye 10'a
  // yuvarlanır ama slider/kutular 1'er 1'er SERBEST artar (step = 1).
  const step = 1;
  const { domainMin, domainMax } = useMemo(() => {
    if (!rates.length) {
      return { domainMin: 0, domainMax: 2000 };
    }
    const lo = Math.min(...rates);
    const hi = Math.max(...rates);
    let dMin = roundTo(lo, 10, "down");
    let dMax = roundTo(hi, 10, "up");
    if (dMax - dMin < 10) dMax = dMin + 10; // dağılım tek noktada toplanmışsa
    return { domainMin: dMin, domainMax: dMax };
  }, [rates]);

  // Histogram kovaları (bins).
  const bins = useMemo(() => {
    const counts = new Array(BIN_COUNT).fill(0);
    const span = domainMax - domainMin || 1;
    for (const r of rates) {
      const idx = Math.min(
        BIN_COUNT - 1,
        Math.max(0, Math.floor(((r - domainMin) / span) * BIN_COUNT))
      );
      counts[idx] += 1;
    }
    return counts;
  }, [rates, domainMin, domainMax]);

  const maxCount = Math.max(1, ...bins);

  // Seçili sayısal değerler (boş → domain ucu).
  const selMin = minRate ? Number(minRate) : domainMin;
  const selMax = maxRate ? Number(maxRate) : domainMax;

  const span = domainMax - domainMin || 1;
  const pct = (v: number) => ((v - domainMin) / span) * 100;
  const pctMin = pct(Math.max(domainMin, Math.min(selMin, domainMax)));
  const pctMax = pct(Math.max(domainMin, Math.min(selMax, domainMax)));

  // — Slider değişimleri —
  const emitMin = (raw: number) => {
    const v = Math.min(Math.max(raw, domainMin), selMax - step);
    onChange(v <= domainMin ? "" : String(v), maxRate);
  };
  const emitMax = (raw: number) => {
    const v = Math.max(Math.min(raw, domainMax), selMin + step);
    onChange(minRate, v >= domainMax ? "" : String(v));
  };

  // — Metin kutuları (yerel düzenleme tamponu) —
  // Kullanıcı yazarken grafik CANLI güncellenir; düzenleme sırasında prop'tan
  // gelen senkron metni ezmesin diye odak (focus) varken senkron atlanır.
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [minFocused, setMinFocused] = useState(false);
  const [maxFocused, setMaxFocused] = useState(false);
  useEffect(() => {
    if (!minFocused) setMinText(minRate ? String(selMin) : String(domainMin));
  }, [minRate, selMin, domainMin, minFocused]);
  useEffect(() => {
    if (!maxFocused) setMaxText(maxRate ? String(selMax) : "");
  }, [maxRate, selMax, maxFocused]);

  // Her tuş vuruşunda hem metni hem grafiği günceller.
  const handleMinText = (raw: string) => {
    const t = raw.replace(/[^\d]/g, "");
    setMinText(t);
    if (t === "") onChange("", maxRate);
    else emitMin(Number(t));
  };
  const handleMaxText = (raw: string) => {
    const t = raw.replace(/[^\d]/g, "");
    setMaxText(t);
    if (t === "") onChange(minRate, "");
    else emitMax(Number(t));
  };

  return (
    <div>
      {loading ? (
        <div className="h-[88px] w-full animate-pulse rounded-xl bg-slate-100 " />
      ) : (
        <>
          {/* Histogram + slider — tutamaklar taban çizgisi (y=0 ekseni) üstünde durur;
              gri/renkli kısmın birleştiği noktada. Taban çizgisi aynı zamanda
              slider'ın rayıdır (seçili aralıkta indigo, dışında gri). */}
          <div className="relative mb-4 flex h-[88px] items-end gap-[2px] px-0.5">
            {/* sürekli düz taban çizgisi (nötr) */}
            <div className="pointer-events-none absolute inset-x-0.5 bottom-0 h-[2px] rounded-full bg-slate-200 " />
            {/* seçili aralıktaki taban çizgisi (vurgulu) */}
            <div
              className="pointer-events-none absolute bottom-0 h-[2px] rounded-full bg-indigo-500 "
              style={{ left: `${pctMin}%`, right: `${100 - pctMax}%` }}
            />
            {bins.map((count, i) => {
              const binStart = domainMin + (span * i) / BIN_COUNT;
              const binEnd = domainMin + (span * (i + 1)) / BIN_COUNT;
              const center = (binStart + binEnd) / 2;
              const active = center >= selMin && center <= selMax;
              if (count === 0) {
                // Boş aralık: bar çizme — taban çizgisi düz kalsın.
                return <div key={i} className="flex-1" />;
              }
              return (
                <div
                  key={i}
                  className={`relative z-10 flex-1 rounded-t-[3px] ${
                    active
                      ? "bg-indigo-500 "
                      : "bg-slate-200 "
                  }`}
                  style={{ height: `${6 + (count / maxCount) * 58}%` }}
                />
              );
            })}

            {/* Çift tutamak — taban çizgisine ortalanır (bottom-0 + translate-y-1/2) */}
            <div className="absolute inset-x-0 bottom-0 z-20 h-8 translate-y-1/2">
              <input
                type="range"
                className="price-range__input"
                min={domainMin}
                max={domainMax}
                step={step}
                value={Math.min(selMin, domainMax)}
                onChange={(e) => emitMin(Number(e.target.value))}
                aria-label="Minimum fiyat"
                style={{ zIndex: selMin > domainMax - step * 2 ? 5 : 3 }}
              />
              <input
                type="range"
                className="price-range__input"
                min={domainMin}
                max={domainMax}
                step={step}
                value={Math.max(selMax, domainMin)}
                onChange={(e) => emitMax(Number(e.target.value))}
                aria-label="Maksimum fiyat"
                style={{ zIndex: 4 }}
              />
            </div>
          </div>

          {/* Minimum / Maksimum kutuları — biri solda biri sağda, arası boşluk */}
          <div className="mt-4 flex items-end justify-between gap-4">
            <label className="w-[44%]">
              <span className="mb-1 block text-xs font-medium text-slate-500 ">
                Minimum
              </span>
              <div className="flex items-center gap-1 rounded-full border border-slate-300 px-4 py-2.5 focus-within:border-slate-900 ">
                <span className="text-sm text-slate-400">TL</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={minText}
                  onFocus={() => setMinFocused(true)}
                  onChange={(e) => handleMinText(e.target.value)}
                  onBlur={() => setMinFocused(false)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className="w-full bg-transparent text-sm font-medium text-slate-900 outline-none "
                />
              </div>
            </label>
            <label className="w-[44%]">
              <span className="mb-1 block text-right text-xs font-medium text-slate-500 ">
                Maksimum
              </span>
              <div className="flex items-center gap-1 rounded-full border border-slate-300 px-4 py-2.5 focus-within:border-slate-900 ">
                <span className="text-sm text-slate-400">TL</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={`${domainMax}+`}
                  value={maxText}
                  onFocus={() => setMaxFocused(true)}
                  onChange={(e) => handleMaxText(e.target.value)}
                  onBlur={() => setMaxFocused(false)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className="w-full bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 "
                />
              </div>
            </label>
          </div>

          {!rates.length && (
            <p className="mt-2 text-xs text-slate-400 ">
              Bu kriterlerde ücret dağılımı bulunamadı.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default PriceRangeHistogram;
