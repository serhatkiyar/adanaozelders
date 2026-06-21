import { Fragment } from "react";

/* ─────────────────────────────────────────────────────────────────────────
   Airbnb tarzı segment kontrolü (tek seçimli "pill" grup).
   Aktif segment beyaz/yükseltilmiş kutu, aralarında ince ayraç çizgisi.
   ──────────────────────────────────────────────────────────────────────── */

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: Props<T>) {
  return (
    <div className="flex items-stretch rounded-2xl border border-slate-200 p-1 dark:border-slate-700">
      {options.map((opt, i) => {
        const active = value === opt.value;
        const prevActive = i > 0 && value === options[i - 1].value;
        return (
          <Fragment key={opt.value}>
            {i > 0 && (
              <span
                aria-hidden
                className={`my-2 w-px self-stretch transition-colors ${
                  active || prevActive
                    ? "bg-transparent"
                    : "bg-slate-200 dark:bg-slate-700"
                }`}
              />
            )}
            <button
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900 dark:bg-slate-700 dark:text-white dark:ring-white/80"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
