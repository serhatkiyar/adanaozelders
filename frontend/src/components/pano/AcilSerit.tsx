import { Link } from "react-router-dom";

const SERIT =
  "flex min-h-14 w-full items-center gap-4 rounded-lg border border-slate-200 bg-white px-6 py-3 text-left transition hover:border-slate-900";

/**
 * Tam genişlik tek satır; yalnız sayı > 0 iken çizilir. Sayı rozet değil,
 * cümlenin parçası olarak bir tık büyük yazılır (kullanıcı kararı, 23 Eyl
 * 2026). `ikon`: satırın başındaki görsel (ör. `/icons/el-kaldiran.svg`).
 *
 * `to` verilirse bağlantı, `onClick` verilirse düğme olur (ör. öğretmen
 * panosunda ders istekleri penceresini açar).
 */
export function AcilSerit({
  count,
  metin,
  to,
  onClick,
  ikon,
}: {
  count: number;
  metin: string;
  to?: string;
  onClick?: () => void;
  ikon?: string;
}) {
  if (count <= 0) return null;
  const icerik = (
    <>
      {ikon && <img src={ikon} alt="" aria-hidden className="h-8 w-8 shrink-0" />}
      <span className="min-w-0 flex-1 text-base font-semibold leading-6 text-slate-900">
        <span className="text-lg tabular-nums">{count > 99 ? "99+" : count}</span> {metin}
      </span>
      <span aria-hidden className="text-lg text-slate-500">
        →
      </span>
    </>
  );
  return to ? (
    <Link to={to} className={SERIT}>
      {icerik}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={SERIT}>
      {icerik}
    </button>
  );
}
