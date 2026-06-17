import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { StarRating } from "@/components/StarRating";
import { Avatar } from "@/components/Avatar";
import { EducationSection } from "@/components/EducationSection";
import { BookmarkButton } from "@/components/BookmarkButton";
import { ShareButton } from "@/components/ShareButton";
import {
  VerifiedTutorBadge,
  IdentityVerifiedBadge,
  DocumentedBadge,
  TutorTrustBar,
  hasVerifiedEducation,
} from "@/components/TutorTrust";
import { ReportModal } from "@/components/ReportModal";
import { FullScreenSpinner } from "@/components/Spinner";
import { ReviewListModal } from "@/components/ReviewListModal";
import { useTutorDetail } from "@/hooks/useTutorSearch";
import { useReviewsByTutor, useReplyToReview } from "@/hooks/useReviews";
import { useBookings } from "@/hooks/useBookings";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDateTime, formatLastSeen } from "@/lib/datetime";
import { formatRate, parseMoney } from "@/lib/money";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { BookingStatus, ROLE_IDS, TeachingMode } from "@/types";
import type { ReviewOut, TutorSearchOut } from "@/types";
import { BookingModal } from "@/components/BookingModal";
import { ROUTES, parseTutorId } from "@/lib/routes";
import { useCanonicalTutorSlug } from "@/hooks/useCanonicalTutorSlug";
import { recordViewedTutor } from "@/lib/recentlyViewed";

// Removed constants

/* ─── ReviewCard ─────────────────────────────────────────── */

function ReviewCard({
  review,
  canReply,
  replyMutation,
}: {
  review: ReviewOut;
  canReply: boolean;
  replyMutation: ReturnType<typeof useReplyToReview>;
}) {
  const name = review.client_name ?? "Anonim";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  const submitReply = () => {
    if (!text.trim()) {
      toast.error("Lütfen bir yanıt yaz.");
      return;
    }
    replyMutation.mutate(
      { reviewId: review.id, reply: text.trim() },
      {
        onSuccess: () => {
          toast.success("Yanıtın eklendi.");
          setEditing(false);
          setText("");
        },
        onError: (err) =>
          toast.error(getErrorMessage(err, "Yanıt eklenemedi.")),
      }
    );
  };

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start gap-3">
        <Avatar name={name} avatar_url={review.client_avatar_url} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {name}
            </span>
            <span className="shrink-0 text-xs text-slate-400">
              {formatDateTime(review.created_at)}
            </span>
          </div>
          <div className="mt-1">
            <StarRating value={review.rating} />
          </div>
          {review.comment_text && (
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {review.comment_text}
            </p>
          )}

          {review.tutor_reply && (
            <div className="mt-3 rounded-xl border-l-2 border-indigo-300 bg-indigo-50/60 px-4 py-3 dark:border-indigo-500/40 dark:bg-indigo-500/10">
              <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                Eğitmen yanıtı
              </p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {review.tutor_reply}
              </p>
            </div>
          )}

          {canReply && !review.tutor_reply && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-3 text-sm font-medium text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400"
            >
              Yanıtla
            </button>
          )}

          {canReply && editing && (
            <div className="mt-3 space-y-2">
              <textarea
                rows={3}
                maxLength={2000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
                placeholder="Değerlendirmeye yanıtını yaz…"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setText("");
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={submitReply}
                  disabled={replyMutation.isPending}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-95 disabled:opacity-60"
                >
                  {replyMutation.isPending ? "Gönderiliyor…" : "Yanıtla"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Removed pill

/* ─── main page ─────────────────────────────────────────── */

export default function TutorProfile() {
  const { slug } = useParams();
  const tutorId = parseTutorId(slug);
  const navigate = useNavigate();

  const { data: currentUser } = useCurrentUser();
  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : currentUser?.role_id === ROLE_IDS.CLIENT
        ? STUDENT_NAV
        : undefined;

  const { data: tutor, isLoading, isError } = useTutorDetail(tutorId);
  useCanonicalTutorSlug(tutor);
  // "Son görüntülenen ilanlar" için bu eğitmeni kaydet.
  useEffect(() => {
    if (tutor) recordViewedTutor(tutor);
  }, [tutor]);
  const { data: reviews, isLoading: reviewsLoading } = useReviewsByTutor(tutorId);
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
      <DashboardShell title="Eğitmen" navItems={navItems}>
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => navigate(-1)}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            ← Geri dön
          </button>
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500">Eğitmen bulunamadı.</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const rate = parseMoney(tutor.hourly_rate);
  const modeLabel = tutor.teaching_mode === TeachingMode.ONLINE 
    ? "Uzaktan" 
    : tutor.teaching_mode === TeachingMode.IN_PERSON 
    ? "Yüzyüze" 
    : tutor.teaching_mode === TeachingMode.BOTH 
    ? "Uzaktan & Yüzyüze" 
    : null;
  const isOnline =
    !!tutor.last_seen_at &&
    Date.now() - new Date(tutor.last_seen_at).getTime() < 120_000;

  return (
    <DashboardShell title="Eğitmen Detayı" navItems={navItems}>
      <div className="mx-auto max-w-4xl space-y-5 pb-12">
        <button
          onClick={() => navigate(-1)}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
        >
          ← Geri dön
        </button>

        {/* ── Header ── */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="flex items-center gap-4">
              <Avatar
                name={tutor.full_name}
                avatar_url={tutor.avatar_url}
                size="xl"
                shape="square"
              />
              <div className="flex flex-col justify-center gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold leading-none text-slate-900 dark:text-white">
                    {tutor.full_name}
                  </h1>
                  <VerifiedTutorBadge />
                  {tutor.identity_verified && <IdentityVerifiedBadge />}
                  {hasVerifiedEducation(tutor.educations) && <DocumentedBadge />}
                </div>

                {modeLabel && (
                  <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                    {modeLabel}
                  </div>
                )}
                
                <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {isOnline ? "Çevrimiçi" : <span className="text-slate-400 dark:text-slate-500 font-normal">{formatLastSeen(tutor.last_seen_at)}</span>}
                </div>
              </div>
            </div>
            
            <div className="flex flex-col items-start gap-3 sm:items-end">
              {currentUser && !isOwnerTutor && (
                <div className="flex items-center gap-2">
                  {hasActiveBooking && (
                    <button
                      type="button"
                      title="Mesaj Gönder"
                      aria-label="Mesaj Gönder"
                      onClick={() =>
                        navigate(ROUTES.messageWith(tutor.id, tutor.full_name))
                      }
                      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:scale-90 hover:bg-slate-200 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                    >
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                      </svg>
                    </button>
                  )}
                  <ShareButton size="md" />
                  <BookmarkButton tutorId={tutor.id} size="md" />
                  <button
                    type="button"
                    onClick={() => setShowReport(true)}
                    className="text-xs font-medium text-slate-400 transition hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400"
                  >
                    ⚐ Şikayet et
                  </button>
                </div>
              )}
              {showReport && (
                <ReportModal
                  targetType="TUTOR"
                  targetId={tutorId}
                  targetLabel={tutor.full_name}
                  onClose={() => setShowReport(false)}
                />
              )}
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
            <button
              onClick={() => setShowBookingModal(true)}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
            >
              Ders Talep Et
            </button>
          </div>
        </section>

        {/* ── Headline / İlan Başlığı (Outside Card) ── */}
        {(tutor.headline || isOwnerTutor) && (
          <h2 className="px-2 pt-2 text-3xl font-extrabold leading-tight text-slate-900 dark:text-white">
            {tutor.headline || "Eğitmen"}
          </h2>
        )}

        {/* ── Bio ── */}
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

        {/* ── Eğitim ── */}
        <EducationSection educations={tutor.educations} />

        {/* ── Reviews ── */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Değerlendirmeler
            </h2>
            <button
              onClick={() => setShowReviews(true)}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
            >
              Tümünü gör
            </button>
          </div>
          <div className="mt-4">
            {tutor.rating_average !== null && tutor.rating_average !== undefined ? (
              <div className="flex items-center gap-2">
                <StarRating value={tutor.rating_average} single={true} />
                <span className="font-bold text-slate-800 dark:text-slate-100">
                  {tutor.rating_average.toFixed(1)}
                </span>
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  ({tutor.rating_count} değerlendirme)
                </span>
              </div>
            ) : (
              <span className="text-slate-500 dark:text-slate-400 font-medium italic">
                Henüz değerlendirme yok
              </span>
            )}
          </div>
          <div className="mt-4 space-y-3">
            {reviewsLoading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700"
                />
              ))
            ) : !reviews || reviews.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 py-12 text-center dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Henüz değerlendirme yok.
                </p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Tamamlanan derslerden sonra öğrenciler yorum bırakabilir.
                </p>
              </div>
            ) : (
              reviews.map((r) => (
                <ReviewCard
                  key={r.id}
                  review={r}
                  canReply={isOwnerTutor}
                  replyMutation={replyMutation}
                />
              ))
            )}
          </div>
        </section>
      </div>

      {showBookingModal && tutor && (
        <BookingModal
          tutor={tutor as TutorSearchOut}
          onClose={() => setShowBookingModal(false)}
        />
      )}

      {showReviews && tutor && (
        <ReviewListModal
          tutorId={tutor.id}
          tutorName={tutor.full_name}
          onClose={() => setShowReviews(false)}
        />
      )}
    </DashboardShell>
  );
}

