import { Link } from "react-router-dom";
import { ACIKLAMA, KUCUK_ACIKLAMA } from "@/components/pano/stil";
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
      <p className={ACIKLAMA}>{etiket}</p>
      <p className="mt-2 text-2xl font-bold leading-8 tabular-nums text-slate-900">{deger}</p>
      {alt && <p className={`mt-1 ${KUCUK_ACIKLAMA}`}>{alt}</p>}
    </>
  );
  const cls = "rounded-lg border border-slate-200 bg-white p-5 sm:p-6";
  return to ? (
    <Link to={to} className={`${cls} transition hover:border-slate-900`}>
      {icerik}
    </Link>
  ) : (
    <div className={cls}>{icerik}</div>
  );
}

/**
 * Kısa özet. Kazanç rakamları `GET /payments/earnings`, ders sayısı pano
 * ucundan gelir; tarayıcıda sayım yapılmaz. Kazanç kartları Kazançlar
 * sayfasına, tamamlanan ders sayısı takvime açılır.
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
    <section aria-label="Özet" className="grid grid-cols-2 gap-4 md:grid-cols-3">
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
      <Kart
        etiket="Bu ay tamamlanan"
        deger={String(completedThisMonth)}
        alt="ders"
        to={ROUTES.tutorCalendar}
      />
    </section>
  );
}
