// Kapasite şeridi: önümüzdeki günlerin söz doluluğu + söz borcu (retry_debt).
// Renk yalnız istisna için: ≥%90 amber, dolu rose. Güne tıklamak Bugün
// sayfasını o tarihe götürür (şerit artık salt görsel değil, navigasyon).
import { useCapacityOverview } from "@/hooks/useDelivery";

const WEEKDAY_FMT = new Intl.DateTimeFormat("tr-TR", { weekday: "short" });

export function CapacityStrip({
  selectedDate,
  onSelectDate,
}: {
  selectedDate?: string;
  onSelectDate?: (day: string) => void;
}) {
  const { data: days } = useCapacityOverview();
  // Dizi değilse (beklenmedik gövde) şerit sessizce gizlenir — kokpit çökmez.
  if (!Array.isArray(days) || days.length === 0) return null;

  return (
    <div
      className="flex items-stretch gap-1.5 overflow-x-auto border-b border-slate-100 px-6 py-3 "
      aria-label="Önümüzdeki günlerin teslimat kapasitesi"
    >
      {days.map((d) => {
        const date = new Date(`${d.day}T00:00:00`);
        const ratio = d.capacity > 0 ? d.booked / d.capacity : null;
        const full = ratio != null && ratio >= 1;
        const tight = ratio != null && ratio >= 0.9 && !full;
        const isSelected = d.day === selectedDate;
        const label = !d.is_working_day
          ? "kapalı gün"
          : d.capacity > 0
            ? `${d.booked} söz / ${d.capacity} kapasite`
            : `${d.booked} söz (kapasite kontrolü kapalı)`;
        const inner = (
          <>
            <p className="text-[10px] uppercase tracking-wide text-slate-400 ">
              {WEEKDAY_FMT.format(date)} {date.getDate()}
            </p>
            <p
              className={`mt-0.5 text-xs font-semibold tabular-nums ${
                full
                  ? "text-rose-600 "
                  : tight
                    ? "text-amber-600 "
                    : "text-slate-700 "
              }`}
            >
              {!d.is_working_day ? "-" : d.capacity > 0 ? `${d.booked}/${d.capacity}` : d.booked}
            </p>
            {d.retry_debt > 0 && (
              <p className="text-[10px] font-medium text-amber-600 ">
                ↻ {d.retry_debt}
              </p>
            )}
          </>
        );
        const cls = `min-w-[3.6rem] shrink-0 rounded-lg px-2 py-1.5 text-center ring-1 transition ${
          isSelected
            ? "ring-2 ring-panel-accent"
            : "ring-slate-100 "
        } ${!d.is_working_day ? "opacity-40" : ""}`;
        return onSelectDate ? (
          <button
            key={d.day}
            type="button"
            title={`${label}${d.retry_debt > 0 ? ` · ${d.retry_debt} öncelikli yeniden deneme` : ""}: bu güne git`}
            onClick={() => onSelectDate(d.day)}
            className={`${cls} cursor-pointer hover:ring-slate-300 `}
          >
            {inner}
          </button>
        ) : (
          <div key={d.day} title={label} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
