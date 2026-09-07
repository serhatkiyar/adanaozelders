import { gorunurCinsiyet } from "@/lib/demographics";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PublicShell } from "@/components/PublicShell";
import { Avatar } from "@/components/Avatar";
import { StarRating } from "@/components/StarRating";
import { FullScreenSpinner } from "@/components/Spinner";
import { ReviewListModal } from "@/components/ReviewListModal";
import { ReviewsSection, type ReviewItem } from "@/components/ReviewsSection";
import { useEffect, useState } from "react";
import { useReviewsByTutor, useTutorRatingDistribution } from "@/hooks/useReviews";
import { useTutorDetail } from "@/hooks/useTutorSearch";
import { recordViewedTutor } from "@/lib/recentlyViewed";
import { WEEKDAYS_SHORT, weeklySchedule } from "@/lib/availability";
import { formatRate, parseMoney } from "@/lib/money";
import { ShareButton } from "@/components/ShareButton";
import { BookmarkButton } from "@/components/BookmarkButton";
import { useNavSearch } from "@/hooks/useNavSearch";
import {
  DocumentedBadge,
  TutorOzetTablosu,
  hasVerifiedEducation,
} from "@/components/TutorTrust";
import { Seo } from "@/components/Seo";
import { JsonLd } from "@/components/JsonLd";
import { absoluteUrl } from "@/lib/seo";
import { ROUTES, parseTutorId, tutorSlug } from "@/lib/routes";
import { useCanonicalTutorSlug } from "@/hooks/useCanonicalTutorSlug";
import { videoEmbedUrl } from "@/lib/video";
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
  const { center, bottom, open: searchOpen, setOpen: setSearchOpen } =
    useNavSearch("egitmenler");
  const { data: tutor, isLoading, isError } = useTutorDetail(tutorId);
  useCanonicalTutorSlug(tutor);
  // "Son görüntülenen ilanlar" için bu eğitmeni kaydet.
  useEffect(() => {
    if (tutor) recordViewedTutor(tutor);
  }, [tutor]);
  const [showReviews, setShowReviews] = useState(false);
  const { data: reviews } = useReviewsByTutor(tutorId);
  const { data: ratingDist } = useTutorRatingDistribution(tutorId);

  if (isLoading) return <FullScreenSpinner />;

  if (isError || !tutor) {
    return (
      <PublicShell>
        <Seo title="Eğitmen bulunamadı" noindex />
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => navigate(-1)}
            className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover "
          >
            ← Geri dön
          </button>
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center ">
            <p className="text-sm text-slate-500 ">
              Eğitmen bulunamadı.
            </p>
          </div>
        </div>
      </PublicShell>
    );
  }

  const rate = parseMoney(tutor.hourly_rate);
  const embedUrl = videoEmbedUrl(tutor.intro_video_url);
  const hasRatings = tutor.rating_count > 0;
  const modeLabel = tutor.teaching_mode ? MODE_LABEL[tutor.teaching_mode] : null;

  // ── SEO: kanonik slug + Person/AggregateRating/Offer yapısal verisi ──
  const canonicalPath = ROUTES.tutor(tutorSlug(tutor));
  const seoDesc =
    tutor.bio ||
    tutor.headline ||
    (tutor.subjects?.length
      ? `${tutor.full_name}, ${tutor.subjects.join(", ")} özel ders eğitmeni.`
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
    <PublicShell center={center} bottom={bottom}>
      <Seo
        title={tutor.full_name}
        description={seoDesc}
        canonicalPath={canonicalPath}
        type="profile"
        image={tutor.avatar_url ?? undefined}
      >
        <JsonLd data={personLd} />
      </Seo>
      {/* Geniş arama açıkken sayfayı hafifçe karart; tıklayınca kapat. */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/10 animate-in fade-in duration-200"
          onClick={() => setSearchOpen(false)}
        />
      )}
      <div className="mx-auto max-w-[76rem] pb-12">
        {/* "← Geri dön" KALDIRILDI (kullanıcı kararı, 7 Eyl 2026): tarayıcının
            kendi geri düğmesi zaten var ve bağlantı, kartı bir satır aşağı
            itiyordu. Hata ekranındaki kopyası KALIR — orada sayfanın tek
            çıkışı odur. */}
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
          {/* ── Sağ: eğitmen bilgi + rezervasyon kartı (dikey, sticky) ── */}
          {/* Kart ekrandan TAŞMASIN (kullanıcı kararı, 7 Eyl 2026): sticky kart
              viewport'tan uzunsa alt kısmı görünmüyordu ve kullanıcı kartın
              tamamını görmek için SAYFAYI en aşağı kaydırmak zorunda kalıyordu.
              Artık yüksekliği ekranla sınırlı ve gerekirse KENDİ İÇİNDE kayar;
              kısa kaldığında hiçbir şey değişmez. */}
          <aside className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain">
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 ">
              {/* Üst aksiyon: favori + paylaş (kartın yukarısında) */}
              <div className="mb-2 flex items-center justify-end gap-2">
                <ShareButton size="md" />
                <BookmarkButton tutorId={tutor.id} size="md" onSolid />
              </div>
              <div className="flex flex-col items-center text-center">
                <Avatar name={tutor.full_name} avatar_url={tutor.avatar_url} size="lg" shape="square" />
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <h1 className="text-xl font-bold text-slate-900 ">
                    {tutor.full_name}
                  </h1>
                  {/* Diploma artık YAYIN KAPISI değil, ayrıcalık (5 Eyl 2026):
                      belgesiz eğitmen de yayında olur, belgesi admin tarafından
                      e-Devlet üzerinden doğrulanmış olan bu rozeti alır. Rozet
                      bugüne kadar tanımlıydı ama hiçbir ekrana bağlanmamıştı. */}
                  {hasVerifiedEducation(tutor.educations) && <DocumentedBadge />}
                </div>

                <button
                  type="button"
                  onClick={() => setShowReviews(true)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition hover:bg-slate-50 "
                >
                  <StarRating value={tutor.rating_average} single={true} />
                  <span className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover ">
                    {hasRatings
                      ? `${tutor.rating_average?.toFixed(1)} (${tutor.rating_count})`
                      : "Değerlendirme yok"}
                  </span>
                </button>

                {modeLabel && (
                  <span className="mt-3 rounded-full bg-marka-soft px-2.5 py-0.5 text-xs font-medium text-marka-metin-hover ">
                    {modeLabel}
                  </span>
                )}

                {/* Cinsiyet: API bunu ta baştan taşıyordu ama hiçbir ekran
                    basmıyordu. Öğrenci "Kadın" filtreliyor, sonuçlar geliyor,
                    ama neye göre geldiğini göremiyordu. Rozet DEĞİL sade meta
                    satırı — demografik bir öznitelik, ticari bir sinyal değil.
                    Belirtilmemişse kalem tümüyle atlanır. */}
                {gorunurCinsiyet(tutor.gender) && (
                  <p className="mt-2 text-xs text-slate-500">
                    {gorunurCinsiyet(tutor.gender)}
                  </p>
                )}
              </div>

              {/* Ücret + güven sinyalleri TEK TABLODA (Superprof deseni).
                  Girişli sürümle (TutorProfile) AYNI bileşen: rotanın iki
                  kabuğu ayrışmasın. */}
              <TutorOzetTablosu
                tutor={tutor}
                ucret={rate !== null ? formatRate(tutor.hourly_rate) : null}
              />
              <Link
                to="?modal=login"
                className="mt-4 block w-full rounded-full bg-marka px-5 py-2.5 text-center text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95"
              >
                Ders Talep Et
              </Link>
              {tutor.first_lesson_free !== false && (
                <p className="mt-2 text-center text-sm font-semibold text-emerald-600 ">
                  İlk ders ücretsiz
                </p>
              )}
            </section>
          </aside>

          {/* ── Sol: akan içerik (kartsız, alt alta) ── */}
          <div className="space-y-8 lg:col-start-1 lg:row-start-1">
            {/* Verdiği Dersler — ilan başlığının üstünde */}
            {tutor.subjects && tutor.subjects.length > 0 && (
              <section>
                <div className="flex flex-wrap gap-2">
                  {tutor.subjects.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-marka-soft px-3 py-1 text-sm font-medium text-marka-metin-hover "
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Headline / İlan Başlığı */}
            {tutor.headline && (
              <h2 className="text-3xl font-extrabold leading-tight text-slate-900 ">
                {tutor.headline}
              </h2>
            )}

            {/* Bio */}
            {tutor.bio && (
              <section className="border-t border-slate-100 pt-6 ">
                <h2 className="mb-2 text-xl font-bold text-slate-900 ">
                  {tutor.full_name.split(" ")[0]} ile ilgili bilgiler
                </h2>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-600 ">
                  {tutor.bio}
                </p>
              </section>
            )}

            {/* Ders Hakkında — metodoloji */}
            {tutor.lesson_info && (
              <section className="border-t border-slate-100 pt-6 ">
                <h2 className="mb-2 text-xl font-bold text-slate-900 ">
                  Ders Hakkında
                </h2>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-600 ">
                  {tutor.lesson_info}
                </p>
              </section>
            )}

            {/* Müsait Saatler — Wyzant tarzı haftalık çizelge (7 günün tamamı) */}
            {tutor.availability && tutor.availability.length > 0 && (
              <section className="border-t border-slate-100 pt-6 ">
                <h2 className="mb-3 text-xl font-bold text-slate-900 ">
                  Müsait Saatler
                </h2>
                <div className="max-w-md overflow-hidden rounded-xl ring-1 ring-slate-100 ">
                  {weeklySchedule(tutor.availability).map(({ weekday, ranges }, i) => (
                    <div
                      key={weekday}
                      className={`flex items-baseline gap-4 px-4 py-2.5 text-sm ${
                        i % 2 ? "bg-slate-50/60 " : ""
                      }`}
                    >
                      <span className="w-10 shrink-0 font-semibold text-slate-700 ">
                        {WEEKDAYS_SHORT[weekday]}
                      </span>
                      <span
                        className={
                          ranges
                            ? "text-slate-600 "
                            : "text-slate-400 "
                        }
                      >
                        {ranges ?? "Müsait değil"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Tanıtım videosu — değerlendirmelerin hemen üstünde, küçük */}
            {embedUrl && (
              <section className="border-t border-slate-100 pt-6 ">
                <h2 className="mb-3 text-xl font-bold text-slate-900 ">
                  Tanıtım videosu
                </h2>
                <div className="aspect-video w-full max-w-md overflow-hidden rounded-xl bg-black">
                  <iframe
                    src={embedUrl}
                    title={`${tutor.full_name} tanıtım videosu`}
                    className="h-full w-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </section>
            )}

            {/* Değerlendirmeler (Airbnb-tarzı: özet + dağılım + yorum ızgarası) */}
            <hr className="my-8 border-slate-200 " />
            <section>
              <ReviewsSection
                average={tutor.rating_average}
                count={tutor.rating_count}
                distribution={ratingDist}
                reviews={(reviews ?? []).map(
                  (r): ReviewItem => ({
                    id: r.id,
                    name: r.client_name ?? "Anonim",
                    avatarUrl: r.client_avatar_url,
                    rating: r.rating,
                    text: r.comment_text,
                    createdAt: r.created_at,
                    reply: r.tutor_reply,
                  })
                )}
                onShowAll={() => setShowReviews(true)}
              />
            </section>
          </div>
        </div>
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

