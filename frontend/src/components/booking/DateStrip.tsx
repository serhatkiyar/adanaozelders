import { ScrollableRow } from "@/components/ScrollableRow";
import { WEEKDAYS_SHORT, weekdayOfDateStr } from "@/lib/availability";

const MONTHS_SHORT = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

export interface UpcomingDay {
  /** "YYYY-MM-DD" (yerel) */
  value: string;
  dayNum: number;
  month: string;
  weekday: string;
  /** "Bugün" / "Yarın" / kısa gün adı */
  label: string;
}

/** Yerel tarihi tz kaymasından koruyarak "YYYY-MM-DD" üretir. */
function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Bugünden başlayarak `count` günlük seçilebilir tarih listesi (yerel). */
export function buildUpcomingDays(count = 14): UpcomingDay[] {
  const base = new Date();
  const days: UpcomingDay[] = [];
  for (let i = 0; i < count; i++) {
    // Gün aritmetiğini Date kurucusu ile yap (DST/ms kaymasından kaçın).
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const value = toDateStr(d);
    const wd = weekdayOfDateStr(value);
    days.push({
      value,
      dayNum: d.getDate(),
      month: MONTHS_SHORT[d.getMonth()],
      weekday: WEEKDAYS_SHORT[wd],
      label: i === 0 ? "Bugün" : i === 1 ? "Yarın" : WEEKDAYS_SHORT[wd],
    });
  }
  return days;
}

/**
 * Yatay kaydırılabilir tarih kartı şeridi (14 gün). Seçili kart vurgulanır.
 * Hem ders rezervasyonu hem çalışma alanı rezervasyonunda kullanılır.
 */
export function DateStrip({
  value,
  onChange,
  days,
}: {
  value: string;
  onChange: (v: string) => void;
  days: UpcomingDay[];
}) {
  return (
    <div className="-mx-1 px-1">
      <ScrollableRow className="gap-3 pb-2 snap-x" showArrows>
        {days.map((d) => {
          const active = value === d.value;
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => onChange(d.value)}
              className={`flex-shrink-0 snap-start flex flex-col items-center justify-center w-[72px] h-[84px] rounded-2xl border-2 transition-all ${
                active
                  ? "border-indigo-600 bg-indigo-600 shadow-md "
                  : "border-slate-100 bg-white hover:border-indigo-200 hover:bg-indigo-50 "
              }`}
            >
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  active ? "text-indigo-200 " : "text-slate-400 "
                }`}
              >
                {d.month}
              </span>
              <span
                className={`text-xl font-black mt-0.5 mb-1 ${
                  active ? "text-white" : "text-slate-700 "
                }`}
              >
                {d.dayNum}
              </span>
              <span
                className={`text-[11px] font-medium ${
                  active ? "text-white" : "text-slate-500 "
                }`}
              >
                {d.label}
              </span>
            </button>
          );
        })}
      </ScrollableRow>
    </div>
  );
}
