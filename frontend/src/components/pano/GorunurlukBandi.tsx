import { Link } from "react-router-dom";
import { ACIKLAMA, DUGME_SATIR_BIRINCIL, DUGME_SATIR_IKINCIL, ETIKET } from "@/components/pano/stil";
import { gorunurlukEylemi } from "@/lib/pano";
import type { VisibilityIssue } from "@/types";

/**
 * "Neden görünmüyorsun / neden ders alamıyorsun" bandı. Nedenleri sunucu
 * hesaplar (`visibility_issues`); ilanı aramadan gizleyenler (hidden) marka
 * zemininde, yalnız uyaranlar (warning) nötr zeminde durur. Her nedenin tek
 * eylemi vardır.
 */
export function GorunurlukBandi({ issues }: { issues: VisibilityIssue[] }) {
  const satirlar = issues
    .map((issue) => ({ issue, eylem: gorunurlukEylemi(issue.code) }))
    .filter((x) => x.eylem !== null);
  if (satirlar.length === 0) return null;

  return (
    <section aria-label="İlan durumu" className="space-y-3">
      {satirlar.map(({ issue, eylem }) => {
        const gizli = issue.severity === "hidden";
        return (
          <div
            key={issue.code}
            className={`flex flex-col gap-4 rounded-lg px-6 py-5 sm:flex-row sm:items-center sm:justify-between ${
              gizli ? "bg-marka-soft" : "border border-slate-200 bg-white"
            }`}
          >
            <div className="min-w-0">
              <p className={ETIKET}>{eylem!.baslik}</p>
              <p className={`mt-1 ${ACIKLAMA}`}>{eylem!.aciklama}</p>
            </div>
            {eylem!.dugme && eylem!.to && (
              <Link
                to={eylem!.to}
                className={`shrink-0 ${gizli ? DUGME_SATIR_BIRINCIL : DUGME_SATIR_IKINCIL}`}
              >
                {eylem!.dugme}
              </Link>
            )}
          </div>
        );
      })}
    </section>
  );
}
