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
      className="flex items-center gap-3 rounded-2xl bg-white px-5 py-3.5 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
    >
      <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-marka px-1.5 text-xs font-bold text-marka-fg">
        {count > 99 ? "99+" : count}
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">{metin}</span>
      <span aria-hidden className="text-slate-400">
        →
      </span>
    </Link>
  );
}
