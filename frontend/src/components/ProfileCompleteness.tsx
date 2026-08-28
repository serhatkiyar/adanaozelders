import { Link } from "react-router-dom";
import { parseMoney } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import type { TutorOut } from "@/types";

export function ProfileCompleteness({
  tutor,
  showLink = true,
}: {
  tutor: TutorOut;
  showLink?: boolean;
}) {
  const items = [
    { label: "Başlık", done: !!tutor.headline?.trim() },
    { label: "Biyografi", done: !!tutor.bio?.trim() },
    { label: "Ders Hakkında", done: !!tutor.lesson_info?.trim() },
    { label: "Saatlik ücret", done: parseMoney(tutor.hourly_rate) !== null },
    { label: "Eğitim şekli", done: !!tutor.teaching_mode },
    { label: "Verdiğin dersler", done: (tutor.subjects?.length ?? 0) > 0 },
    { label: "Müsaitlik", done: (tutor.availability?.length ?? 0) > 0 },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);
  if (pct === 100) return null;

  const missing = items.filter((i) => !i.done).map((i) => i.label);
  const noSubjects = (tutor.subjects?.length ?? 0) === 0;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-indigo-100 ">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900 ">
          Profilini tamamla
        </h3>
        <span className="text-sm font-bold text-indigo-600 ">
          %{pct}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 ">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-3 text-xs text-slate-500 ">
        Eksik: {missing.join(", ")}.
        {noSubjects && (
          <span className="font-medium text-amber-600 ">
            {" "}
            Branş seçmeden aramada görünmezsin.
          </span>
        )}
      </p>
      {showLink && (
        <Link
          to={ROUTES.tutorListing}
          className="mt-3 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-95"
        >
          İlan Ayarları'na git →
        </Link>
      )}
    </div>
  );
}
