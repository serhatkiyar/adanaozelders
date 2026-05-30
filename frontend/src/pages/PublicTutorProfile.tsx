import { Link, useNavigate, useParams } from "react-router-dom";
import { PublicShell } from "@/components/PublicShell";
import { Avatar } from "@/components/Avatar";
import { StarRating } from "@/components/StarRating";
import { EducationSection } from "@/components/EducationSection";
import { FullScreenSpinner } from "@/components/Spinner";
import { useTutorDetail } from "@/hooks/useTutorSearch";
import { formatLastSeen } from "@/lib/datetime";
import { WEEKDAYS_SHORT, summarize } from "@/lib/availability";
import { ageFromBirthDate, GENDER_LABEL } from "@/lib/demographics";
import { formatRate, parseMoney } from "@/lib/money";
import { TeachingMode } from "@/types";

const MODE_LABEL: Partial<Record<TeachingMode, string>> = {
  [TeachingMode.ONLINE]: "Uzaktan",
  [TeachingMode.IN_PERSON]: "Yüzyüze",
  [TeachingMode.BOTH]: "Uzaktan & Yüzyüze",
};

export default function PublicTutorProfile() {
  const { id } = useParams();
  const tutorId = Number(id);
  const navigate = useNavigate();
  const { data: tutor, isLoading, isError } = useTutorDetail(tutorId);

  if (isLoading) return <FullScreenSpinner />;

  if (isError || !tutor) {
    return (
      <PublicShell title="Eğitmen">
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => navigate(-1)}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            ← Geri dön
          </button>
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Eğitmen bulunamadı.
            </p>
          </div>
        </div>
      </PublicShell>
    );
  }

  const rate = parseMoney(tutor.hourly_rate);
  const hasRatings = tutor.rating_count > 0;
  const modeLabel = tutor.teaching_mode ? MODE_LABEL[tutor.teaching_mode] : null;
  const age = ageFromBirthDate(tutor.birth_date);
  const genderLabel =
    tutor.gender && tutor.gender !== "UNSPECIFIED"
      ? GENDER_LABEL[tutor.gender]
      : null;
  const isOnline =
    !!tutor.last_seen_at &&
    Date.now() - new Date(tutor.last_seen_at).getTime() < 120_000;

  return (
    <PublicShell title={tutor.full_name}>
      <div className="mx-auto max-w-4xl space-y-5 pb-12">
        <button
          onClick={() => navigate(-1)}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
        >
          ← Geri dön
        </button>

        {/* Header */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <Avatar name={tutor.full_name} avatar_url={tutor.avatar_url} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                {tutor.full_name}
              </h1>
              {tutor.headline && (
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  {tutor.headline}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <StarRating value={tutor.rating_average} />
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {hasRatings
                      ? `${tutor.rating_average?.toFixed(1)} (${tutor.rating_count} değerlendirme)`
                      : "Henüz değerlendirme yok"}
                  </span>
                </div>
                {modeLabel && (
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                    {modeLabel}
                  </span>
                )}
                {age !== null && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {age} yaş
                  </span>
                )}
                {genderLabel && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {genderLabel}
                  </span>
                )}
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    isOnline ? "bg-emerald-400" : "bg-slate-300 dark:bg-slate-600"
                  }`}
                />
                {isOnline ? "Çevrimiçi" : formatLastSeen(tutor.last_seen_at)}
              </p>
            </div>
            {rate !== null && (
              <div className="shrink-0 text-right">
                <span className="text-2xl font-bold text-slate-900 dark:text-white">
                  {formatRate(tutor.hourly_rate)}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Bio */}
        {tutor.bio && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Hakkında
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {tutor.bio}
            </p>
          </section>
        )}

        {/* Subjects */}
        {tutor.subjects && tutor.subjects.length > 0 && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Verdiği Dersler
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {tutor.subjects.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                >
                  {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Availability */}
        {tutor.availability && tutor.availability.length > 0 && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Müsait Saatler
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {summarize(tutor.availability).map((s) => (
                <span
                  key={s.weekday}
                  className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                >
                  {WEEKDAYS_SHORT[s.weekday]} {s.ranges}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Education */}
        <EducationSection educations={tutor.educations} />

        {/* Login CTA (booking gated) */}
        <section className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-center text-white shadow-sm">
          <h2 className="text-lg font-bold">Bu eğitmenle ders al</h2>
          <p className="mt-1 text-sm text-indigo-100">
            Rezervasyon yapmak ve mesajlaşmak için ücretsiz bir hesap aç.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link
              to="/register"
              className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 active:scale-95"
            >
              Kayıt Ol
            </Link>
            <Link
              to="/login"
              className="rounded-xl bg-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/25 active:scale-95"
            >
              Giriş Yap
            </Link>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}

