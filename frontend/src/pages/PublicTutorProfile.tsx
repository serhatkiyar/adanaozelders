import { Link, useNavigate, useParams } from "react-router-dom";
import { PublicShell } from "@/components/PublicShell";
import { Avatar } from "@/components/Avatar";
import { StarRating } from "@/components/StarRating";
import { EducationSection } from "@/components/EducationSection";
import { FullScreenSpinner } from "@/components/Spinner";
import { ReviewListModal } from "@/components/ReviewListModal";
import { useEffect, useState } from "react";
import { useTutorDetail } from "@/hooks/useTutorSearch";
import { recordViewedTutor } from "@/lib/recentlyViewed";
import { formatLastSeen } from "@/lib/datetime";
import { WEEKDAYS_SHORT, summarize } from "@/lib/availability";
import { formatRate, parseMoney } from "@/lib/money";
import { ShareButton } from "@/components/ShareButton";
import {
  VerifiedTutorBadge,
  IdentityVerifiedBadge,
  DocumentedBadge,
  TutorTrustBar,
  hasVerifiedEducation,
} from "@/components/TutorTrust";
import { Seo } from "@/components/Seo";
import { JsonLd } from "@/components/JsonLd";
import { absoluteUrl } from "@/lib/seo";
import { ROUTES, parseTutorId, tutorSlug } from "@/lib/routes";
import { useCanonicalTutorSlug } from "@/hooks/useCanonicalTutorSlug";
import { TeachingMode } from "@/types";

const MODE_LABEL: Partial<Record<TeachingMode, string>> = {
  [TeachingMode.ONLINE]: "Uzaktan",
  [TeachingMode.IN_PERSON]: "Yüzyüze",
  [TeachingMode.BOTH]: "Uzaktan & Yüzyüze",
};

export default function PublicTutorProfile() {
  const { slug } = useParams();
  const tutorId = parseTutorId(slug);
  const navigate = useNavigate();
  const { data: tutor, isLoading, isError } = useTutorDetail(tutorId);
  useCanonicalTutorSlug(tutor);
  // "Son görüntülenen ilanlar" için bu eğitmeni kaydet.
  useEffect(() => {
    if (tutor) recordViewedTutor(tutor);
  }, [tutor]);
  const [showReviews, setShowReviews] = useState(false);

  if (isLoading) return <FullScreenSpinner />;

  if (isError || !tutor) {
    return (
      <PublicShell>
        <Seo title="Eğitmen bulunamadı" noindex />
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
  const isOnline =
    !!tutor.last_seen_at &&
    Date.now() - new Date(tutor.last_seen_at).getTime() < 120_000;

  // ── SEO: kanonik slug + Person/AggregateRating/Offer yapısal verisi ──
  const canonicalPath = ROUTES.tutor(tutorSlug(tutor));
  const seoDesc =
    tutor.bio ||
    tutor.headline ||
    (tutor.subjects?.length
      ? `${tutor.full_name} — ${tutor.subjects.join(", ")} özel ders eğitmeni.`
      : `${tutor.full_name} ile özel ders.`);
  const personLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: tutor.full_name,
    url: absoluteUrl(canonicalPath),
    jobTitle: "Özel Ders Eğitmeni",
    ...(tutor.avatar_url ? { image: tutor.avatar_url } : {}),
    ...(tutor.headline ? { description: tutor.headline } : {}),
    ...(tutor.subjects?.length ? { knowsAbout: tutor.subjects } : {}),
    ...(hasRatings && tutor.rating_average
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Number(tutor.rating_average.toFixed(2)),
            reviewCount: tutor.rating_count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(rate !== null
      ? {
          makesOffer: {
            "@type": "Offer",
            priceCurrency: "TRY",
            price: rate,
            availability: "https://schema.org/InStock",
            itemOffered: {
              "@type": "Service",
              name: "Özel ders",
              ...(tutor.subjects?.length
                ? { serviceType: tutor.subjects.join(", ") }
                : {}),
            },
          },
        }
      : {}),
  };

  return (
    <PublicShell>
      <Seo
        title={tutor.full_name}
        description={seoDesc}
        canonicalPath={canonicalPath}
        type="profile"
        image={tutor.avatar_url ?? undefined}
      >
        <JsonLd data={personLd} />
      </Seo>
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
            <Avatar name={tutor.full_name} avatar_url={tutor.avatar_url} size="xl" shape="square" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  {tutor.full_name}
                </h1>
                <VerifiedTutorBadge />
                {tutor.identity_verified && <IdentityVerifiedBadge />}
                {hasVerifiedEducation(tutor.educations) && <DocumentedBadge />}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowReviews(true)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 transition hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <StarRating value={tutor.rating_average} single={true} />
                  <span className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400">
                    {hasRatings
                      ? `${tutor.rating_average?.toFixed(1)} (${tutor.rating_count} değerlendirme)`
                      : "Henüz değerlendirme yok"}
                  </span>
                </button>
                {modeLabel && (
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                    {modeLabel}
                  </span>
                )}

              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                {isOnline ? (
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">Çevrimiçi</span>
                ) : (
                  formatLastSeen(tutor.last_seen_at)
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-3 text-right">
              <div className="flex items-center gap-2">
                <ShareButton size="md" />
              </div>
            </div>
          </div>

          {/* ── Güven sinyalleri: tamamlanan ders / değerlendirme / üyelik ── */}
          <TutorTrustBar tutor={tutor} />

          {/* ── Verdiği Dersler (transparan, profil kartının içinde) ── */}
          {tutor.subjects && tutor.subjects.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-700/60">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Verdiği Dersler
              </p>
              <div className="flex flex-wrap gap-2">
                {tutor.subjects.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Booking Section (Inside Card) ── */}
          <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-t border-slate-100 pt-5 dark:border-slate-700/60">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Saatlik ücret
              </p>
              <p className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                {rate !== null ? formatRate(tutor.hourly_rate) : "Belirtilmemiş"}
              </p>
            </div>
            <Link
              to="?modal=login"
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
            >
              Ders Talep Et
            </Link>
          </div>
        </section>

        {/* Headline / İlan Başlığı (Outside Card) */}
        {tutor.headline && (
          <h2 className="px-2 pt-2 text-3xl font-extrabold leading-tight text-slate-900 dark:text-white">
            {tutor.headline}
          </h2>
        )}

        {/* Bio */}
        {tutor.bio && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {tutor.full_name.split(" ")[0]} ile ilgili bilgiler
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {tutor.bio}
            </p>
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


      </div>

      {showReviews && (
        <ReviewListModal
          tutorId={tutor.id}
          tutorName={tutor.full_name}
          onClose={() => setShowReviews(false)}
        />
      )}
    </PublicShell>
  );
}

