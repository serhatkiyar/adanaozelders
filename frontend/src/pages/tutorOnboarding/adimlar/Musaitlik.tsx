import { useId } from "react";

import { PlainButton } from "@/components/ui/PlainButton";
import { WEEKDAYS_LONG, hhmmToMin, minToHHMM } from "@/lib/availability";

import type { AdimProps } from "./ortak";

const GIRDI =
  "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

/**
 * Adım 6 — haftalık müsaitlik pencereleri.
 *
 * Atlanabilir bir adım: pencere yoksa öğrenci herhangi bir saati talep eder ve
 * eğitmen tek tek onaylar. Zorunlu tutmak, henüz programını bilmeyen yeni
 * eğitmeni akışın ortasında tıkardı.
 */
export function AdimMusaitlik({ d, guncelle }: AdimProps) {
  const uid = useId();

  const degistir = (i: number, yama: Partial<(typeof d.availability)[number]>) =>
    guncelle({
      availability: d.availability.map((w, idx) =>
        idx === i ? { ...w, ...yama } : w,
      ),
    });

  return (
    <div className="space-y-4">
      {d.availability.length === 0 && (
        <p className="text-[14px] leading-relaxed text-slate-500">
          Şu an bir pencere yok. Bu hâliyle öğrenciler sana istedikleri saat için
          talep gönderebilir, sen de tek tek onaylarsın.
        </p>
      )}

      {d.availability.map((w, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`${uid}-gun-${i}`}>
            {i + 1}. pencerenin günü
          </label>
          <select
            id={`${uid}-gun-${i}`}
            value={w.weekday}
            onChange={(e) => degistir(i, { weekday: Number(e.target.value) })}
            className={`${GIRDI} min-w-[130px] flex-1`}
          >
            {WEEKDAYS_LONG.map((g, gi) => (
              <option key={gi} value={gi}>
                {g}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor={`${uid}-bas-${i}`}>
            {i + 1}. pencerenin başlangıcı
          </label>
          <input
            id={`${uid}-bas-${i}`}
            type="time"
            value={minToHHMM(w.start_minute)}
            onChange={(e) =>
              degistir(i, { start_minute: hhmmToMin(e.target.value) })
            }
            className={GIRDI}
          />
          <span aria-hidden="true" className="text-slate-400">
            –
          </span>
          <label className="sr-only" htmlFor={`${uid}-bit-${i}`}>
            {i + 1}. pencerenin bitişi
          </label>
          <input
            id={`${uid}-bit-${i}`}
            type="time"
            value={minToHHMM(w.end_minute)}
            onChange={(e) =>
              degistir(i, { end_minute: hhmmToMin(e.target.value) })
            }
            className={GIRDI}
          />

          <PlainButton
            onClick={() =>
              guncelle({
                availability: d.availability.filter((_, idx) => idx !== i),
              })
            }
            aria-label={`${WEEKDAYS_LONG[w.weekday]} ${minToHHMM(w.start_minute)} penceresini sil`}
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:text-rose-600"
          >
            Sil
          </PlainButton>
        </div>
      ))}

      <PlainButton
        onClick={() =>
          guncelle({
            availability: [
              ...d.availability,
              { weekday: 0, start_minute: 9 * 60, end_minute: 18 * 60 },
            ],
          })
        }
        className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-[14px] font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800"
      >
        + Zaman aralığı ekle
      </PlainButton>
    </div>
  );
}
