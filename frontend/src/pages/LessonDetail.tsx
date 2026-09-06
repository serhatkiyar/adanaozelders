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
import { LessonTasksCard } from "@/components/LessonTasksCard";
import {
  useBooking,
  useBookingAction,
  useSetBookingLocation,
  useAddBookingComment,
  useDeleteBookingComment,
} from "@/hooks/useBookings";
import { MapPicker } from "@/components/MapPicker";
import { BookingResourcesPanel } from "@/components/booking/BookingResourcesPanel";
import { BookingPrivateNotesPanel } from "@/components/booking/BookingPrivateNotesPanel";
import { useReviewByBooking } from "@/hooks/useReviews";
import { useQaRights } from "@/hooks/useQa";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatRange } from "@/lib/datetime";
import { formatTRY, parseMoney } from "@/lib/money";
import { isLessonJoinable } from "@/lib/lesson";
import { useMeetingStore } from "@/store/meetingStore";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLE } from "@/lib/bookingStatus";
import { BookingStatus, ROLE_IDS } from "@/types";
import { rolEtiketi } from "@/lib/roles";
import { ADSIZ_UYE } from "@/lib/roles";

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

  const joinMeeting = useMeetingStore((s) => s.joinMeeting);

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
  const [locLatDraft, setLocLatDraft] = useState<number | null>(null);
  const [locLngDraft, setLocLngDraft] = useState<number | null>(null);
  const setLoc = useSetBookingLocation();

  const [commentBody, setCommentBody] = useState("");
  const addComment = useAddBookingComment();
  const delComment = useDeleteBookingComment();

  if (isLoading) return <FullScreenSpinner />;

  if (isError || !booking) {
    return (
      <DashboardShell title="Ders" navItems={navItems ?? undefined}>
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => navigate(-1)}
            className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover "
          >
            ← Geri dön
          </button>
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center ">
            <p className="text-sm text-slate-500 ">
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
    : booking.client_name ?? ADSIZ_UYE;
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
      { id: bookingId, location: locDraft.trim(), lat: locLatDraft, lng: locLngDraft },
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

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;
    addComment.mutate(
      { id: bookingId, body: commentBody.trim() },
      {
        onSuccess: () => {
          setCommentBody("");
        },
        onError: (err) => toast.error(getErrorMessage(err, "Not gönderilemedi.")),
      }
    );
  };

  return (
    <DashboardShell title="Ders Detayı" navItems={navItems ?? undefined}>
      <div className="mx-auto max-w-6xl pb-12">
        <button
          onClick={() => navigate(-1)}
          className="mb-5 inline-block text-sm font-medium text-marka-metin hover:text-marka-metin-hover "
        >
          ← Geri dön
        </button>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3 lg:grid-flow-row-dense">

        {/* ── Header ── */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <Link
              to={counterpartLink}
              className="flex min-w-0 items-center gap-3 transition hover:opacity-80"
            >
              <Avatar name={counterpartName} avatar_url={isClient ? booking.tutor_avatar_url : booking.client_avatar_url} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-lg font-bold text-slate-900 ">
                  {counterpartName}
                </p>
                <p className="text-xs text-slate-400 ">
                  {rolEtiketi(isClient ? ROLE_IDS.TUTOR : ROLE_IDS.CLIENT)} · profili gör →
                </p>
              </div>
            </Link>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${BOOKING_STATUS_STYLE[booking.status]}`}
            >
              {BOOKING_STATUS_LABEL[booking.status]}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-600 ">
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 ">
              {formatRange(booking.start_at, booking.end_at)}
            </span>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 ">
              {durationLabel(booking.start_at, booking.end_at)}
            </span>
            {modeLabel && (
              <span
                className={`rounded-lg px-2.5 py-1 font-medium ${
                  isRemote
                    ? "bg-blue-50 text-blue-600 "
                    : "bg-emerald-50 text-emerald-600 "
                }`}
              >
                {isRemote ? "" : ""} {modeLabel}
              </span>
            )}
            {price !== null && (
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-semibold ">
                {formatTRY(booking.price)}
              </span>
            )}
          </div>

          {/* Canlı katılım — yalnızca uzaktan + onaylı + oda. Gömülü pencerede açılır
              (GlobalMeeting); ders saatinden 15 dk önce aktifleşir. */}
          {isAccepted && isRemote && booking.meeting_room && (
            isLessonJoinable(booking.start_at, booking.end_at) ? (
              <button
                onClick={() =>
                  joinMeeting(
                    bookingId,
                    booking.meeting_room!,
                    booking.tutor_name || "Eğitmen",
                    booking.client_name || ADSIZ_UYE
                  )
                }
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
              >
                🎥 Canlı Derse Katıl
              </button>
            ) : (
              <span
                title="Canlı ders, başlangıçtan 15 dk önce açılır."
                className="mt-4 inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-400 "
              >
                🎥 Ders saatinde açılır
              </span>
            )
          )}
          {/* Yüzyüze ders — buluşma yeri */}
          {booking.mode === "IN_PERSON" && (
            <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 ">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-emerald-700 ">
                  🏠︎ Buluşma Yeri
                </p>
                {!editingLoc && (
                  <button
                    onClick={() => {
                      setLocDraft(booking.location ?? "");
                      setLocLatDraft(booking.location_lat ?? null);
                      setLocLngDraft(booking.location_lng ?? null);
                      setEditingLoc(true);
                    }}
                    className="text-xs font-semibold text-emerald-700 hover:underline "
                  >
                    {booking.location ? "Düzenle" : "Ekle"}
                  </button>
                )}
              </div>
              {editingLoc ? (
                <div className="mt-4 flex flex-col gap-3">
                  <MapPicker 
                    initialLat={locLatDraft} 
                    initialLng={locLngDraft} 
                    onLocationSelect={(lat, lng) => {
                      setLocLatDraft(lat);
                      setLocLngDraft(lng);
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={locDraft}
                      onChange={(e) => setLocDraft(e.target.value)}
                      maxLength={300}
                      placeholder="Adres / bina numarası / tarif..."
                      className="min-w-[12rem] flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-200 "
                    />
                    <button
                      onClick={saveLoc}
                      disabled={setLoc.isPending}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Kaydet
                    </button>
                    <button
                      onClick={() => setEditingLoc(false)}
                      className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-emerald-100 "
                    >
                      Vazgeç
                    </button>
                  </div>
                </div>
              ) : booking.location ? (
                <div className="mt-3 flex flex-col gap-2">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${
                      booking.location_lat && booking.location_lng 
                      ? `${booking.location_lat},${booking.location_lng}`
                      : encodeURIComponent(booking.location)
                    }`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-900 "
                  >
                    {booking.location}
                  </a>
                  {booking.location_lat && booking.location_lng && (
                    <div className="mt-2 h-32 w-full max-w-sm overflow-hidden rounded-xl">
                      <MapPicker initialLat={booking.location_lat} initialLng={booking.location_lng} readonly={true} />
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500 ">
                  Henüz buluşma yeri belirlenmedi.
                </p>
              )}
            </div>
          )}

          {booking.notes && (
            <p className="mt-3 rounded-xl bg-slate-50 px-4 py-2.5 text-sm italic text-slate-500 ">
              "{booking.notes}"
            </p>
          )}
          {booking.status === BookingStatus.CANCELLED && booking.cancel_reason && (
            <p className="mt-3 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ">
              İptal nedeni: {booking.cancel_reason}
            </p>
          )}

          {/* ── Actions ── */}
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4 ">
            {/* {canMessage && (
              <button
                onClick={() =>
                  navigate(
                    `/messages?to=${counterpartId}&name=${encodeURIComponent(counterpartName)}`
                  )
                }
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 "
              >
                Mesaj Gönder
              </button>
            )} */}

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
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 active:scale-95 disabled:opacity-60 "
                >
                  Reddet
                </button>
              </>
            )}
            {role === "TUTOR" && isAccepted && (
              <button
                disabled={busy}
                onClick={() => run(complete, "Ders tamamlandı olarak işaretlendi.")}
                className="rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover active:scale-95 disabled:opacity-60"
              >
                Tamamla
              </button>
            )}

            {isClient && canMessage && (
              <button
                onClick={() => setShowReschedule(true)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95 "
              >
                Ertele
              </button>
            )}
            {canMessage && (
              <button
                onClick={() => setShowCancel(true)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-red-50 hover:text-red-600 active:scale-95 "
              >
                İptal Et
              </button>
            )}
            {isClient && isCompleted && !alreadyReviewed && (
              <button
                onClick={() => setShowReview(true)}
                className="rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover active:scale-95"
              >
                Değerlendir
              </button>
            )}
          </div>
        </section>

        {/* ── Review ── */}
        {review && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 lg:col-span-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
              Değerlendirme
            </h2>
            <div className="mt-3">
              <StarRating value={review.rating} />
            </div>
            {review.comment_text && (
              <p className="mt-2 text-sm leading-relaxed text-slate-600 ">
                {review.comment_text}
              </p>
            )}
            {review.tutor_reply && (
              <div className="mt-3 rounded-xl border-l-2 border-marka-mid bg-marka-soft/60 px-4 py-3 ">
                <p className="text-xs font-semibold text-marka-metin-hover ">
                  Eğitmen yanıtı
                </p>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600 ">
                  {review.tutor_reply}
                </p>
              </div>
            )}
          </section>
        )}

        {/* ── Q&A (öğrenci) ── */}
        {isClient && qaGroup && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                Bu Ders İçin Sorularım
              </h2>
              {qaGroup.expired ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 ">
                  Süre doldu
                </span>
              ) : (
                <span className="rounded-full bg-marka-soft px-2.5 py-1 text-xs font-semibold text-marka-metin-hover ">
                  {qaGroup.remaining}/{qaGroup.quota} hak · {qaGroup.days_left} gün
                </span>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {qaGroup.threads.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400 ">
                  Bu derste henüz soru sormadın.
                </p>
              ) : (
                qaGroup.threads.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-xl bg-slate-50 p-3.5 "
                  >
                    {t.subject && (
                      <p className="mb-2 text-sm font-semibold text-slate-800 ">
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
                  className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 active:scale-[0.98] "
                >
                  Yeni Soru Başlığı Aç ({qaGroup.remaining} hak)
                </button>
              )}
            </div>
          </section>
        )}

        {/* ── Ders Kaynakları ── */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 lg:col-span-1">
          <BookingResourcesPanel
            bookingId={bookingId}
            resources={booking.resources}
            role={role}
            userId={user?.id}
            canEdit={canMessage}
          />
        </section>

        {/* ── Ders Notları (Yorumlar) ── */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 lg:col-span-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
            Ders Mesajları
          </h2>
          <div className="mt-4 space-y-4">
            {booking.comments && booking.comments.length > 0 ? (
              <div className="space-y-3">
                {booking.comments.map((comment) => {
                  const isMine = comment.sender_id === user?.id && comment.sender_role === role;
                  return (
                    <div
                      key={comment.id}
                      className={`flex w-full flex-col ${isMine ? "items-end" : "items-start"}`}
                    >
                      <div className="flex max-w-[85%] flex-col gap-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-semibold text-slate-700 ">
                            {isMine ? "Sen" : rolEtiketi(comment.sender_role === "TUTOR" ? ROLE_IDS.TUTOR : ROLE_IDS.CLIENT)}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div
                          className={`relative rounded-2xl px-4 py-2 text-sm ${
                            isMine
                              ? "bg-marka text-marka-fg"
                              : "bg-slate-100 text-slate-800 "
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{comment.body}</p>
                        </div>
                        {isMine && (
                          <button
                            onClick={() => delComment.mutate({ id: bookingId, commentId: comment.id })}
                            disabled={delComment.isPending}
                            className="self-end px-1 text-[10px] font-semibold text-slate-400 hover:text-red-500 disabled:opacity-50"
                          >
                            Sil
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500 ">
                Bu ders için henüz bir mesaj yok.
              </p>
            )}

            {/* Yeni Yorum Formu */}
            {canMessage && (
              <form onSubmit={handleAddComment} className="mt-2 flex gap-2 pt-2">
                <textarea
                  rows={2}
                  placeholder="Mesajınız"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-marka-mid focus:ring-1 focus:ring-marka-focus "
                />
                <button
                  type="submit"
                  disabled={addComment.isPending || !commentBody.trim()}
                  className="rounded-xl bg-marka px-5 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Gönder
                </button>
              </form>
            )}
          </div>
        </section>

        {/* ── Kişisel Notlarım (Gizli) ── */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 lg:col-span-1">
          <BookingPrivateNotesPanel
            bookingId={bookingId}
            notes={booking.private_notes}
          />
        </section>

        {/* ── Bu derse ait görevler (To-Do) ── */}
        <LessonTasksCard bookingId={bookingId} />
        </div>

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
