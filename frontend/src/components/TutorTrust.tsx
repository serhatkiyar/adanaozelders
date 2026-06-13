import type { ReactNode } from "react";
import type { TutorSearchOut } from "@/types";

// Eğitmen güven sinyalleri: hem public (PublicTutorProfile) hem panel
// (TutorProfile) görünümünde paylaşılır. Tüm veriler backend'den gerçek;
// public profilde yalnız APPROVED eğitmenler döndüğü için "Onaylı" her zaman geçerli.

/** İsmin yanına gelen "Onaylı Eğitmen" rozeti (yönetici onayından geçmiştir). */
export function VerifiedTutorBadge() {
  return (
    <span
      title="Bu eğitmen yönetici onayından geçti"
      className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/25"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
        <path
          fillRule="evenodd"
          d="M16.403 12.652a3 3 0 0 0 0-5.304 3 3 0 0 0-3.75-3.751 3 3 0 0 0-5.305 0 3 3 0 0 0-3.751 3.75 3 3 0 0 0 0 5.305 3 3 0 0 0 3.75 3.751 3 3 0 0 0 5.305 0 3 3 0 0 0 3.751-3.75Zm-2.546-4.46a.75.75 0 0 0-1.214-.883l-3.236 4.53-1.766-1.767a.75.75 0 0 0-1.06 1.06l2.4 2.4a.75.75 0 0 0 1.137-.089l3.739-5.234Z"
          clipRule="evenodd"
        />
      </svg>
      Onaylı
    </span>
  );
}

/** "Belgeli eğitim" rozeti — en az bir eğitimde diploma/belge yüklüyse. */
export function DocumentedBadge() {
  return (
    <span
      title="Eğitim belgesi (diploma) yüklenmiş"
      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
      Belgeli
    </span>
  );
}

function StatCell({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-900/40">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:text-indigo-300 dark:ring-slate-700">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold leading-tight text-slate-900 dark:text-white">{value}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </div>
  );
}

const MONTH_YEAR = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" });

/**
 * Eğitmen güven istatistikleri şeridi: tamamlanan ders, değerlendirme ve üyelik
 * başlangıcı. Yalnız anlamlı veri olan hücreler gösterilir; hiçbiri yoksa gizlenir.
 */
export function TutorTrustBar({ tutor }: { tutor: TutorSearchOut }) {
  const cells: { icon: React.ReactNode; value: string; label: string }[] = [];

  const completed = tutor.completed_lessons ?? 0;
  if (completed > 0) {
    cells.push({
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5zm0 0v6m0-6l6.16-3.42A12 12 0 0 1 12 21a12 12 0 0 1-6.16-10.42L12 14z" />
        </svg>
      ),
      value: String(completed),
      label: "tamamlanan ders",
    });
  }

  if (tutor.rating_count > 0 && tutor.rating_average != null) {
    cells.push({
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
          <path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L10 14.77l-5.2 2.73.99-5.79L1.58 7.62l5.82-.85L10 1.5z" />
        </svg>
      ),
      value: tutor.rating_average.toFixed(1),
      label: `${tutor.rating_count} değerlendirme`,
    });
  }

  if (tutor.created_at) {
    const d = new Date(tutor.created_at);
    if (!isNaN(d.getTime())) {
      cells.push({
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
          </svg>
        ),
        value: MONTH_YEAR.format(d),
        label: "üyelik başlangıcı",
      });
    }
  }

  if (cells.length === 0) return null;

  return (
    <div className="mt-5 grid grid-cols-1 gap-2.5 border-t border-slate-100 pt-5 dark:border-slate-700/60 sm:grid-cols-3">
      {cells.map((c) => (
        <StatCell key={c.label + c.value} icon={c.icon} value={c.value} label={c.label} />
      ))}
    </div>
  );
}

/** Eğitimlerde diploma/belge var mı? (DocumentedBadge'i göstermek için.) */
export function hasDocumentedEducation(
  educations: { document_url?: string | null }[] | undefined
): boolean {
  return !!educations?.some((e) => e.document_url);
}
