import { Link } from "react-router-dom";
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
    <section aria-label="İlan durumu" className="space-y-2">
      {satirlar.map(({ issue, eylem }) => {
        const gizli = issue.severity === "hidden";
        return (
          <div
            key={issue.code}
            className={`flex flex-col gap-3 rounded-2xl px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
              gizli
                ? "bg-marka-soft ring-1 ring-marka/20"
                : "bg-white ring-1 ring-slate-200"
            }`}
          >
            <div className="min-w-0">
              <p
                className={`text-sm font-semibold ${
                  gizli ? "text-marka-soft-fg" : "text-slate-900"
                }`}
              >
                {eylem!.baslik}
              </p>
              <p
                className={`mt-0.5 text-xs leading-relaxed ${
                  gizli ? "text-marka-metin-hover" : "text-slate-500"
                }`}
              >
                {eylem!.aciklama}
              </p>
            </div>
            {eylem!.dugme && eylem!.to && (
              <Link
                to={eylem!.to}
                className={`shrink-0 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${
                  gizli
                    ? "bg-marka text-marka-fg hover:bg-marka-hover"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
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
