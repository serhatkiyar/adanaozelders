import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { Avatar } from "@/components/Avatar";
import { StarRating } from "@/components/StarRating";
import { FullScreenSpinner } from "@/components/Spinner";
import { CancelModal } from "@/components/CancelModal";
import { RescheduleModal } from "@/components/RescheduleModal";
import { ReviewModal } from "@/components/ReviewModal";
import { QuestionModal } from "@/components/QuestionModal";
import { QaThreadChat } from "@/components/QaThreadChat";
import {
  useBooking,
  useBookingAction,
  useSetBookingLocation,
} from "@/hooks/useBookings";
import { useReviewByBooking } from "@/hooks/useReviews";
import { useQaRights } from "@/hooks/useQa";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatRange } from "@/lib/datetime";
import { formatTRY, parseMoney } from "@/lib/money";
import { jitsiUrl, mapsUrl } from "@/lib/lesson";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLE } from "@/lib/bookingStatus";
import { BookingStatus, ROLE_IDS } from "@/types";

function durationLabel(startIso: string, endIso: string): string {
  const min = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000
  );
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} saat` : `${h} sa ${m} dk`;
}

export default function LessonDetail() {
  const { id } = useParams();
  const bookingId = Number(id);
  const navigate = useNavigate();

  const { data: user } = useCurrentUser();
  const role =
    user?.role_id === ROLE_IDS.TUTOR
      ? "TUTOR"
      : user?.role_id === ROLE_IDS.CLIENT
        ? "CLIENT"
        : null;
  const navItems = role === "TUTOR" ? TUTOR_NAV : STUDENT_NAV;

  const { data: booking, isLoading, isError } = useBooking(bookingId);
  const { data: review } = useReviewByBooking(bookingId);
  const { data: qaGroups } = useQaRights();

  const accept = useBookingAction("accept");
  const reject = useBookingAction("reject");
  const complete = useBookingAction("complete");
  const busy = accept.isPending || reject.isPending || complete.isPending;

  const [showCancel, setShowCancel] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showAsk, setShowAsk] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [editingLoc, setEditingLoc] = useState(false);
  const [locDraft, setLocDraft] = useState("");
  const setLoc = useSetBookingLocation();

  if (isLoading) return <FullScreenSpinner />;

  if (isError || !booking) {
    return (
      <DashboardShell title="Ders" navItems={navItems ?? undefined}>
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => navigate(-1)}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            ← Geri dön
          </button>
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ders bulunamadı.
            </p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const isClient = role === "CLIENT";
  const counterpartName = isClient
    ? booking.tutor_name ?? "Eğitmen"
    : booking.client_name ?? "Öğrenci";
  const counterpartId = isClient ? booking.tutor_id : booking.client_id;
  const counterpartLink = isClient
    ? `/student/tutors/${booking.tutor_id}`
    : `/tutor/students/${booking.client_id}`;
  const price = parseMoney(booking.price);
  const isRemote = booking.mode === "ONLINE";
  const modeLabel =
    booking.mode === "ONLINE"
      ? "Uzaktan"
      : booking.mode === "IN_PERSON"
        ? "Yüzyüze"
        : null;

  const isPending = booking.status === BookingStatus.PENDING;
  const isAccepted = booking.status === BookingStatus.ACCEPTED;
  const isCompleted = booking.status === BookingStatus.COMPLETED;
  const canMessage = isPending || isAccepted;
  const alreadyReviewed = !!review || reviewed;

  const qaGroup =
    isClient && qaGroups
      ? qaGroups.find((g) => g.booking_id === bookingId) ?? null
      : null;

  const saveLoc = () => {
    if (!locDraft.trim()) {
      toast.error("Bir adres / buluşma noktası gir.");
      return;
    }
    setLoc.mutate(
      { id: bookingId, location: locDraft.trim() },
      {
        onSuccess: () => {
          toast.success("Buluşma yeri kaydedildi.");
          setEditingLoc(false);
        },
        onError: (err) => toast.error(getErrorMessage(err, "Kaydedilemedi.")),
      }
    );
  };

  const run = (action: typeof accept, okMsg: string) =>
    action.mutate(bookingId, {
      onSuccess: () => toast.success(okMsg),
      onError: (err) => toast.error(getErrorMessage(err, "İşlem başarısız.")),
    });

  return (
    <DashboardShell title="Ders Detayı" navItems={navItems ?? undefined}>
      <div className="mx-auto max-w-3xl space-y-5 pb-12">
        <button
          onClick={() => navigate(-1)}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
        >
          ← Geri dön
        </button>

        {/* ── Header ── */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <Link
              to={counterpartLink}
              className="flex min-w-0 items-center gap-3 transition hover:opacity-80"
            >
              <Avatar name={counterpartName} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-lg font-bold text-slate-900 dark:text-white">
                  {counterpartName}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {isClient ? "Eğitmen" : "Öğrenci"} · profili gör →
                </p>
              </div>
            </Link>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${BOOKING_STATUS_STYLE[booking.status]}`}
            >
              {BOOKING_STATUS_LABEL[booking.status]}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 dark:bg-slate-700">
              📅 {formatRange(booking.start_at, booking.end_at)}
            </span>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 dark:bg-slate-700">
              ⏱ {durationLabel(booking.start_at, booking.end_at)}
            </span>
            {modeLabel && (
              <span
                className={`rounded-lg px-2.5 py-1 font-medium ${
                  isRemote
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400"
                    : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                }`}
              >
                {isRemote ? "🎥" : "📍"} {modeLabel}
              </span>
            )}
            {price !== null && (
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-semibold dark:bg-slate-700">
                {formatTRY(booking.price)}
              </span>
            )}
          </div>

          {/* Canlı katılım — yalnızca uzaktan + onaylı + oda */}
          {isAccepted && isRemote && booking.meeting_room && (
            <a
              href={jitsiUrl(booking.meeting_room)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
            >
              🎥 Canlı Derse Katıl
            </a>
          )}
          {/* Yüzyüze ders — buluşma yeri */}
          {booking.mode === "IN_PERSON" && (
            <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 dark:bg-emerald-500/10">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  📍 Buluşma Yeri
                </p>
                {!editingLoc && (
                  <button
                    onClick={() => {
                      setLocDraft(booking.location ?? "");
                      setEditingLoc(true);
                    }}
                    className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                  >
                    {booking.location ? "Düzenle" : "Ekle"}
                  </button>
                )}
              </div>
              {editingLoc ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={locDraft}
                    onChange={(e) => setLocDraft(e.target.value)}
                    maxLength={300}
                    placeholder="Adres / buluşma noktası (ör. X Kütüphanesi, Kadıköy)"
                    className="min-w-[12rem] flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-200 dark:border-emerald-500/30 dark:bg-slate-700 dark:text-white"
                  />
                  <button
                    onClick={saveLoc}
                    disabled={setLoc.isPending}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    Kaydet
                  </button>
                  <button
                    onClick={() => setEditingLoc(false)}
                    className="rounded-lg px-2 py-1.5 text-sm text-slate-500 dark:text-slate-400"
                  >
                    Vazgeç
                  </button>
                </div>
              ) : booking.location ? (
                <a
                  href={mapsUrl(booking.location)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-sm text-emerald-800 hover:underline dark:text-emerald-200"
                >
                  {booking.location} — Haritada gör →
                </a>
              ) : (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Henüz buluşma yeri belirlenmedi.
                </p>
              )}
            </div>
          )}

          {booking.notes && (
            <p className="mt-3 rounded-xl bg-slate-50 px-4 py-2.5 text-sm italic text-slate-500 dark:bg-slate-700/50 dark:text-slate-400">
              "{booking.notes}"
            </p>
          )}
          {booking.status === BookingStatus.CANCELLED && booking.cancel_reason && (
            <p className="mt-3 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              İptal nedeni: {booking.cancel_reason}
            </p>
          )}

          {/* ── Actions ── */}
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
            {canMessage && (
              <button
                onClick={() =>
                  navigate(
                    `/messages?to=${counterpartId}&name=${encodeURIComponent(counterpartName)}`
                  )
                }
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
              >
                Mesaj Gönder
              </button>
            )}

            {role === "TUTOR" && isPending && (
              <>
                <button
                  disabled={busy}
                  onClick={() => run(accept, "Rezervasyon kabul edildi.")}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-95 disabled:opacity-60"
                >
                  Kabul Et
                </button>
                <button
                  disabled={busy}
                  onClick={() => run(reject, "Rezervasyon reddedildi.")}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 active:scale-95 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-red-900/20"
                >
                  Reddet
                </button>
              </>
            )}
            {role === "TUTOR" && isAccepted && (
              <button
                disabled={busy}
                onClick={() => run(complete, "Ders tamamlandı olarak işaretlendi.")}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-95 disabled:opacity-60"
              >
                Tamamla
              </button>
            )}

            {isClient && canMessage && (
              <button
                onClick={() => setShowReschedule(true)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
              >
                Ertele
              </button>
            )}
            {canMessage && (
              <button
                onClick={() => setShowCancel(true)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-red-50 hover:text-red-600 active:scale-95 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-red-900/20"
              >
                İptal Et
              </button>
            )}
            {isClient && isCompleted && !alreadyReviewed && (
              <button
                onClick={() => setShowReview(true)}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-95"
              >
                Değerlendir
              </button>
            )}
          </div>
        </section>

        {/* ── Review ── */}
        {review && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Değerlendirme
            </h2>
            <div className="mt-3">
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
          </section>
        )}

        {/* ── Q&A (öğrenci) ── */}
        {isClient && qaGroup && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Bu Ders İçin Sorularım
              </h2>
              {qaGroup.expired ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                  Süre doldu
                </span>
              ) : (
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                  {qaGroup.remaining}/{qaGroup.quota} hak · {qaGroup.days_left} gün
                </span>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {qaGroup.threads.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
                  Bu derste henüz soru sormadın.
                </p>
              ) : (
                qaGroup.threads.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-700/40"
                  >
                    {t.subject && (
                      <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {t.subject}
                      </p>
                    )}
                    <QaThreadChat
                      thread={t}
                      role="CLIENT"
                      canReply={!qaGroup.expired}
                    />
                  </div>
                ))
              )}
              {qaGroup.can_ask && (
                <button
                  onClick={() => setShowAsk(true)}
                  className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 active:scale-[0.98] dark:bg-slate-700 dark:hover:bg-slate-600"
                >
                  Yeni Soru Başlığı Aç ({qaGroup.remaining} hak)
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      {showCancel && (
        <CancelModal
          bookingId={bookingId}
          counterpartName={counterpartName}
          onClose={() => setShowCancel(false)}
        />
      )}
      {showReschedule && (
        <RescheduleModal
          bookingId={bookingId}
          onClose={() => setShowReschedule(false)}
        />
      )}
      {showReview && (
        <ReviewModal
          bookingId={bookingId}
          onClose={() => setShowReview(false)}
          onReviewed={() => setReviewed(true)}
        />
      )}
      {showAsk && qaGroup && (
        <QuestionModal
          bookingId={bookingId}
          tutorName={counterpartName}
          remaining={qaGroup.remaining}
          onClose={() => setShowAsk(false)}
        />
      )}
    </DashboardShell>
  );
}
