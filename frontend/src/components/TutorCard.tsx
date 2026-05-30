import { Link } from "react-router-dom";
import type { TutorSearchOut } from "@/types";
import { TeachingMode } from "@/types";
import { StarRating } from "@/components/StarRating";
import { Avatar } from "@/components/Avatar";
import { BookmarkButton } from "@/components/BookmarkButton";
import { formatRate, parseMoney } from "@/lib/money";
import { formatLastSeen } from "@/lib/datetime";
import { ageFromBirthDate, GENDER_LABEL } from "@/lib/demographics";

const MODE_META: Record<TeachingMode, { label: string; cls: string }> = {
  [TeachingMode.ONLINE]: {
    label: "Uzaktan",
    cls: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
  },
  [TeachingMode.IN_PERSON]: {
    label: "Yüzyüze",
    cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  },
  [TeachingMode.BOTH]: {
    label: "Uzaktan & Yüzyüze",
    cls: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
  },
};

interface TutorCardProps {
  tutor: TutorSearchOut;
  hrefBase?: string;
  showBookmark?: boolean;
}

export function TutorCard({
  tutor,
  hrefBase = "/student/tutors",
  showBookmark = true,
}: TutorCardProps) {
  const hasRatings = tutor.rating_count > 0;
  const rate = parseMoney(tutor.hourly_rate);
  const mode = tutor.teaching_mode ? MODE_META[tutor.teaching_mode] : null;
  const age = ageFromBirthDate(tutor.birth_date);
  const genderLabel =
    tutor.gender && tutor.gender !== "UNSPECIFIED"
      ? GENDER_LABEL[tutor.gender]
      : null;
  const isOnline =
    !!tutor.last_seen_at &&
    Date.now() - new Date(tutor.last_seen_at).getTime() < 120_000;

  return (
    <Link
      to={`${hrefBase}/${tutor.id}`}
      className="group flex h-full flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 transition duration-200 hover:-translate-y-1 hover:shadow-lg hover:ring-indigo-200 dark:bg-slate-800 dark:ring-slate-700 dark:hover:ring-indigo-500/40"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <Avatar name={tutor.full_name} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-slate-900 transition group-hover:text-indigo-700 dark:text-white dark:group-hover:text-indigo-300">
            {tutor.full_name}
          </h3>
          {tutor.headline && (
            <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
              {tutor.headline}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            title="Bayesian sıralama puanı"
            className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
          >
            ★ {tutor.bayesian_score.toFixed(1)}
          </span>
          {showBookmark && <BookmarkButton tutorId={tutor.id} />}
        </div>
      </div>

      {/* Bio preview */}
      {tutor.bio && (
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {tutor.bio}
        </p>
      )}

      {/* Rating */}
      <div className="mt-4 flex items-center gap-2">
        <StarRating value={tutor.rating_average} />
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {hasRatings
            ? `${tutor.rating_average?.toFixed(1)} (${tutor.rating_count})`
            : "Henüz değerlendirme yok"}
        </span>
      </div>

      {/* Presence */}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            isOnline ? "bg-emerald-400" : "bg-slate-300 dark:bg-slate-600"
          }`}
        />
        {isOnline ? "Çevrimiçi" : formatLastSeen(tutor.last_seen_at)}
      </p>

      {/* Subjects */}
      {tutor.subjects && tutor.subjects.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tutor.subjects.slice(0, 3).map((s) => (
            <span
              key={s}
              className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300"
            >
              {s}
            </span>
          ))}
          {tutor.subjects.length > 3 && (
            <span className="px-1 text-[11px] text-slate-400 dark:text-slate-500">
              +{tutor.subjects.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
        <div className="flex flex-wrap gap-1.5">
          {mode && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${mode.cls}`}>
              {mode.label}
            </span>
          )}
          {age !== null && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {age} yaş
            </span>
          )}
          {genderLabel && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {genderLabel}
            </span>
          )}
        </div>
        {rate !== null ? (
          <span className="shrink-0 text-base font-bold text-slate-900 dark:text-white">
            {formatRate(tutor.hourly_rate)}
          </span>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            Ücret belirtilmemiş
          </span>
        )}
      </div>
    </Link>
  );
}
