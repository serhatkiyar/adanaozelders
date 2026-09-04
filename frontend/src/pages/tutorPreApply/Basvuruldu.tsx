import { Link } from "react-router-dom";

import { ROUTES } from "@/lib/routes";

/** Numarayı okunur ama tam açık olmayan biçimde gösterir: +90 532 *** ** 67 */
function telefonuMaskele(e164: string): string {
  const s = e164.replace(/\D/g, "");
  if (s.length < 12) return e164;
  return `+90 ${s.slice(2, 5)} *** ** ${s.slice(10)}`;
}

/**
 * Gönderim sonrası ekran.
 *
 * Form yerine aynı kartın içinde görünür — yeni sayfaya atmıyoruz ki
 * "gönderildi mi?" tereddüdü olmasın. Numara maskeli gösterilir: kişi doğru
 * numarayı yazdığını görsün, ama ekran omuz üstünden okunduğunda tamamı
 * görünmesin.
 */
export function Basvuruldu({
  telefon,
  belgeSayisi,
}: {
  telefon: string;
  belgeSayisi: number;
}) {
  return (
    <div>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6 text-emerald-600">
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      </div>

      <h2 className="mt-4 text-xl font-semibold text-slate-900">
        Başvurun bize ulaştı
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        En geç 24 saat içinde{" "}
        <span className="font-medium text-slate-900">{telefonuMaskele(telefon)}</span>{" "}
        numarasından arayacağız. Yazdıklarını aramada birlikte gözden geçiririz.
      </p>
      {belgeSayisi > 0 && (
        <p className="mt-2 text-sm text-slate-500">
          {belgeSayisi} belge de başvurunla birlikte alındı.
        </p>
      )}

      <div className="mt-6 border-t border-slate-100 pt-5 text-center">
        <Link
          to={ROUTES.tutors}
          className="text-sm text-slate-500 underline underline-offset-2 transition hover:text-slate-800"
        >
          Eğitmen ilanlarına göz at
        </Link>
      </div>
    </div>
  );
}
