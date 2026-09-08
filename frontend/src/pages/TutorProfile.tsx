import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { Avatar } from "@/components/Avatar";
import { StarRating } from "@/components/StarRating";
import { ReviewsSection, type ReviewItem } from "@/components/ReviewsSection";
import { EgitmenYanitAksiyonu } from "@/components/EgitmenYanitAksiyonu";
import { BookmarkButton } from "@/components/BookmarkButton";
import { ShareButton } from "@/components/ShareButton";
import { TutorOzetTablosu } from "@/components/TutorTrust";
import { ReportModal } from "@/components/ReportModal";
import { FullScreenSpinner } from "@/components/Spinner";
import { ReviewListModal } from "@/components/ReviewListModal";
import { useTutorDetail } from "@/hooks/useTutorSearch";
import {
  useReviewsByTutor,
  useReplyToReview,
  useTutorRatingDistribution,
} from "@/hooks/useReviews";
import { useBookings } from "@/hooks/useBookings";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatRate, parseMoney } from "@/lib/money";
import { BookingStatus, ROLE_IDS, TeachingMode } from "@/types";
import type { TutorSearchOut } from "@/types";
import { BookingModal } from "@/components/BookingModal";
import { ROUTES, parseTutorId } from "@/lib/routes";
import { useCanonicalTutorSlug } from "@/hooks/useCanonicalTutorSlug";
import { recordViewedTutor } from "@/lib/recentlyViewed";
import { videoEmbedUrl } from "@/lib/video";
import { useNavSearch } from "@/hooks/useNavSearch";

// Removed constants

/* ─── main page ─────────────────────────────────────────── */

export default function TutorProfile() {
  const { slug } = useParams();
  const tutorId = parseTutorId(slug);
  const navigate = useNavigate();
  const { center, bottom, open: searchOpen, setOpen: setSearchOpen } =
    useNavSearch("egitmenler");

  const { data: currentUser } = useCurrentUser();
  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : currentUser?.role_id === ROLE_IDS.CLIENT
        ? UYE_NAV
        : undefined;

  const { data: tutor, isLoading, isError } = useTutorDetail(tutorId);
  useCanonicalTutorSlug(tutor);
  // "Son görüntülenen ilanlar" için bu eğitmeni kaydet.
  useEffect(() => {
    if (tutor) recordViewedTutor(tutor);
  }, [tutor]);
  const { data: reviews } = useReviewsByTutor(tutorId);
  const { data: ratingDist } = useTutorRatingDistribution(tutorId);
  const { data: myBookings } = useBookings({ limit: 100 });
  const hasActiveBooking = (myBookings ?? []).some(
    (b) =>
      b.tutor_id === tutorId &&
      (b.status === BookingStatus.PENDING ||
        b.status === BookingStatus.ACCEPTED)
  );

  const [showBookingModal, setShowBookingModal] = useState(false);

  const replyMutation = useReplyToReview(tutorId);
  const isOwnerTutor =
    currentUser?.role_id === ROLE_IDS.TUTOR && currentUser.id === tutorId;
  const [showReport, setShowReport] = useState(false);
  const [showReviews, setShowReviews] = useState(false);

  if (isLoading) return <FullScreenSpinner />;

  if (isError || !tutor) {
    return (
      <DashboardShell title="Eğitmen" navItems={navItems} sekmeler={null}>
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => navigate(-1)}
            className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover"
          >
            ← Geri dön
          </button>
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center ">
            <p className="text-sm text-slate-500">Eğitmen bulunamadı.</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const rate = parseMoney(tutor.hourly_rate);
  // Ücretsiz ilk ders: eğitmen sunuyor + öğrencinin bu eğitmenle (iptal/red dışı) dersi yok.
  const hadLessonWithTutor = (myBookings ?? []).some(
    (b) =>
      b.tutor_id === tutorId &&
      b.status !== BookingStatus.CANCELLED &&
      b.status !== BookingStatus.REJECTED
  );
  const canRequestFreeLesson =
    tutor.first_lesson_free !== false && !isOwnerTutor && !hadLessonWithTutor;
  const embedUrl = videoEmbedUrl(tutor.intro_video_url);
  const modeLabel = tutor.teaching_mode === TeachingMode.ONLINE
    ? "Uzaktan" 
    : tutor.teaching_mode === TeachingMode.IN_PERSON 
    ? "Yüzyüze" 
    : tutor.teaching_mode === TeachingMode.BOTH 
    ? "Uzaktan & Yüzyüze"
    : null;

  return (
    <DashboardShell
      title="Eğitmen Detayı"
      navItems={navItems}
      sekmeler={null}
      center={center}
      bottom={bottom}
    >
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
            itiyordu. Hata dalındaki kopyası KALIR — orada sayfanın tek
            çıkışı odur. */}
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
          {/* ── Sağ: eğitmen bilgi + rezervasyon kartı (dikey, sticky) ── */}
          {/* Kart ekrandan TAŞMASIN (kullanıcı kararı, 7 Eyl 2026): sticky kart
              viewport'tan uzunsa alt kısmı (fiyat + birincil düğme) görünmüyor
              ve sabitlendiği için sayfa kaydırılsa bile gelmiyordu. Artık
              yüksekliği ekranla sınırlı ve gerekirse KENDİ İÇİNDE kayar. */}
          <aside className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-[calc(var(--yapiskan-ust,6rem)+1.5rem)]">
            <section className="rounded-2xl bg-white p-5 shadow-lg shadow-slate-300/40 ring-1 ring-slate-200/60 lg:max-h-[calc(100vh-var(--yapiskan-ust,6rem)-3rem)] lg:overflow-y-auto lg:overscroll-contain">
              {/* Üst aksiyonlar: favori + paylaş (kartın yukarısında) */}
              <div className="mb-2 flex items-center justify-end gap-2">
                {!isOwnerTutor && hasActiveBooking && (
                  <button
                    type="button"
                    title="Mesaj Gönder"
                    aria-label="Mesaj Gönder"
                    onClick={() =>
                      navigate(ROUTES.messageWith(tutor.id, tutor.display_name))
                    }
                    className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:scale-90 hover:bg-slate-200 hover:text-slate-700 "
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                    </svg>
                  </button>
                )}
                <ShareButton size="md" />
                {!isOwnerTutor && (
                  <BookmarkButton tutorId={tutor.id} size="md" onSolid />
                )}
              </div>

              <div className="flex flex-col items-center text-center">
                <Avatar
                  name={tutor.display_name}
                  avatar_url={tutor.avatar_url}
                  size="lg"
                  shape="square"
                />
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <h1 className="text-xl font-bold text-slate-900 ">
                    {tutor.display_name}
                  </h1>
                </div>

                <button
                  type="button"
                  onClick={() => setShowReviews(true)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition hover:bg-slate-50 "
                >
                  <StarRating value={tutor.rating_average} single={true} />
                  <span className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover ">
                    {tutor.rating_count > 0
                      ? `${tutor.rating_average?.toFixed(1)} (${tutor.rating_count})`
                      : "Değerlendirme yok"}
                  </span>
                </button>

                {/* Ders mekânı buradan KALKTI, sol sütundaki "Ders Mekânı"
                    başlığına taşındı. Anonim kabukla (PublicTutorProfile) aynı
                    değişiklik: rotanın iki kabuğu ayrışmasın — bu ayrışma daha
                    önce ölçülmüş bir kusurdu (bkz. __guards__/ilanKartiTasmaz). */}
              </div>

              {/* Ücret + güven sinyalleri TEK TABLODA (Superprof deseni).
                  Eskiden ikisi ayrı bloktu ve kart 632 piksele çıkıyordu;
                  1366x768'de bile taşıyordu. Ayrıntı: `TutorOzetTablosu`. */}
              <TutorOzetTablosu
                tutor={tutor}
                ucret={rate !== null ? formatRate(tutor.hourly_rate) : null}
              />
              {!isOwnerTutor && (
                <button
                  onClick={() => setShowBookingModal(true)}
                  className="mt-4 block w-full rounded-full bg-marka px-5 py-2.5 text-center text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95"
                >
                  Ders Talep Et
                </button>
              )}
              {tutor.first_lesson_free !== false && (
                <p className="mt-2 text-center text-sm font-semibold text-emerald-600 ">
                  {canRequestFreeLesson ? "İlk dersin ücretsiz" : "İlk ders ücretsiz"}
                </p>
              )}
            </section>

            {/* Şikayet (kartın dışında, altında; ikincil) */}
            {currentUser && !isOwnerTutor && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setShowReport(true)}
                  className="text-xs font-medium text-slate-400 transition hover:text-rose-600 "
                >
                  ⚐ Şikayet et
                </button>
              </div>
            )}
            {showReport && (
              <ReportModal
                targetType="TUTOR"
                targetId={tutorId}
                targetLabel={tutor.display_name}
                onClose={() => setShowReport(false)}
              />
            )}
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
            {(tutor.headline || isOwnerTutor) && (
              <h2 className="text-3xl font-extrabold leading-tight text-slate-900 ">
                {tutor.headline || "Eğitmen"}
              </h2>
            )}

            {/* Bio */}
            {tutor.bio && (
              <section className="border-t border-slate-100 pt-6 ">
                <h2 className="mb-2 text-xl font-bold text-slate-900 ">
                  {tutor.display_name} ile ilgili bilgiler
                </h2>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-600 ">
                  {tutor.bio}
                </p>
              </section>
            )}

            {/* Ders Mekânı — kartta rozet olarak duruyordu, buraya taşındı */}
            {modeLabel && (
              <section className="border-t border-slate-100 pt-6 ">
                <h2 className="mb-2 text-xl font-bold text-slate-900 ">
                  Ders Mekânı
                </h2>
                <p className="text-[15px] leading-relaxed text-slate-600 ">
                  {modeLabel}
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

            {/* Tanıtım videosu — değerlendirmelerin hemen üstünde, küçük */}
            {embedUrl && (
              <section className="border-t border-slate-100 pt-6 ">
                <h2 className="mb-3 text-xl font-bold text-slate-900 ">
                  Tanıtım videosu
                </h2>
                <div className="aspect-video w-full max-w-md overflow-hidden rounded-xl bg-black">
                  <iframe
                    src={embedUrl}
                    title={`${tutor.display_name} tanıtım videosu`}
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
                renderItemAction={
                  isOwnerTutor
                    ? (item) =>
                        item.reply ? null : (
                          <EgitmenYanitAksiyonu
                            reviewId={item.id}
                            replyMutation={replyMutation}
                          />
                        )
                    : undefined
                }
              />
            </section>
          </div>
        </div>
      </div>

      {showBookingModal && tutor && (
        <BookingModal
          tutor={tutor as TutorSearchOut}
          onClose={() => setShowBookingModal(false)}
          canRequestFreeLesson={canRequestFreeLesson}
        />
      )}

      {showReviews && tutor && (
        <ReviewListModal
          tutorId={tutor.id}
          tutorName={tutor.display_name}
          onClose={() => setShowReviews(false)}
        />
      )}
    </DashboardShell>
  );
}

