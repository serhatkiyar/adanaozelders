import { Link } from "react-router-dom";

/** Sayı rozetli, tam genişlik tek satır; yalnız sayı > 0 iken çizilir. */
export function AcilSerit({
  count,
  metin,
  to,
}: {
  count: number;
  metin: string;
  to: string;
}) {
  if (count <= 0) return null;
  return (
    <Link
      to={to}
      className="flex min-h-14 items-center gap-4 rounded-lg border border-slate-200 bg-white px-6 py-3 transition hover:border-slate-900"
    >
      <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-marka px-2 text-sm font-bold text-marka-fg">
        {count > 99 ? "99+" : count}
      </span>
      <span className="min-w-0 flex-1 text-base font-semibold leading-6 text-slate-900">{metin}</span>
      <span aria-hidden className="text-lg text-slate-500">
        →
      </span>
    </Link>
  );
}
