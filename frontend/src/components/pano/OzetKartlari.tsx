import { Link } from "react-router-dom";
import { formatTRY } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import type { EarningsSummary } from "@/types";

function Kart({
  etiket,
  deger,
  alt,
  to,
}: {
  etiket: string;
  deger: string;
  alt?: string;
  to?: string;
}) {
  const icerik = (
    <>
      <p className="text-xs font-medium text-slate-500">{etiket}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">{deger}</p>
      {alt && <p className="mt-0.5 text-[11px] text-slate-400">{alt}</p>}
    </>
  );
  const cls = "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5";
  return to ? (
    <Link to={to} className={`${cls} transition hover:bg-slate-50`}>
      {icerik}
    </Link>
  ) : (
    <div className={cls}>{icerik}</div>
  );
}

/**
 * Kısa özet. Kazanç rakamları `GET /payments/earnings`, ders sayısı pano
 * ucundan gelir; tarayıcıda sayım yapılmaz. Kazanç kartları Kazançlar
 * sayfasına açılır.
 */
export function OzetKartlari({
  earnings,
  completedThisMonth,
  escrowWording,
}: {
  earnings: EarningsSummary | undefined;
  completedThisMonth: number;
  escrowWording: boolean;
}) {
  return (
    <section aria-label="Özet" className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <Kart
        etiket="Bu ay kazancın"
        deger={formatTRY(earnings?.this_month ?? "0")}
        to={ROUTES.tutorEarnings}
      />
      <Kart
        etiket="Hesabına geçecek"
        deger={formatTRY(earnings?.pending ?? "0")}
        alt={escrowWording ? "Ders bitince hesabına geçer" : "Onay bekleyen ödemeler"}
        to={ROUTES.tutorEarnings}
      />
      <Kart etiket="Bu ay tamamlanan" deger={String(completedThisMonth)} alt="ders" />
    </section>
  );
}
