import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { Avatar } from "@/components/Avatar";
import { StarRating } from "@/components/StarRating";
import { FullScreenSpinner } from "@/components/Spinner";
import { CancelModal } from "@/components/CancelModal";
import { RescheduleModal } from "@/components/RescheduleModal";
import { ReviewModal } from "@/components/ReviewModal";
import { QuestionModal } from "@/components/QuestionModal";
import { QaThreadChat } from "@/components/QaThreadChat";
import { LessonTasksCard } from "@/components/LessonTasksCard";
import { DersOnayKarti } from "@/components/booking/DersOnayKarti";
import { Modal } from "@/components/ui/Modal";
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  DUGME_SATIR_TEHLIKE,
  ETIKET,
  KART,
  KUCUK_ACIKLAMA,
  METIN_BAGLANTI,
} from "@/components/pano/stil";
import { useSeri, useSeriBitir, useTeklifiGeriCek } from "@/hooks/useDersTeklifi";
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
import { degerlendirmeTarihi } from "@/lib/reviewStats";
import { formatTRY, parseMoney } from "@/lib/money";
import { isLessonJoinable } from "@/lib/lesson";
import { useMeetingStore } from "@/store/meetingStore";
import { getErrorDetail, getErrorMessage } from "@/lib/errors";
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
  const navItems = role === "TUTOR" ? TUTOR_NAV : UYE_NAV;

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
  const [editReview, setEditReview] = useState(false);
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

  // Haftalık seri (varsa): durum rozet ve "Seriyi bitir" düğmesi için.
  const seri = useSeri(booking?.series_id);
  const seriBitir = useSeriBitir();
  const geriCek = useTeklifiGeriCek();
  const [seriBitirAcik, setSeriBitirAcik] = useState(false);

  if (isLoading) return <FullScreenSpinner />;

  if (isError || !booking) {
    return (
      <DashboardShell title="Ders" navItems={navItems ?? undefined} genislik="dar">
        <div>
          <button onClick={() => navigate(-1)} className={METIN_BAGLANTI}>
            ← Geri dön
          </button>
          <div className="mt-6 flex flex-col items-center rounded-lg border border-dashed border-slate-300 py-16 text-center">
            <p className={ACIKLAMA}>Ders bulunamadı.</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const isClient = role === "CLIENT";
  const counterpartName = isClient
    ? booking.tutor_name ?? "Öğretmen"
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

  const teklifiGeriCek = () =>
    geriCek.mutate(bookingId, {
      onSuccess: () => toast.success("Teklifini geri çektin."),
      onError: (err) => toast.error(getErrorDetail(err, "Teklif geri çekilemedi.")),
    });

  const seriyiBitir = () => {
    if (!booking.series_id) return;
    seriBitir.mutate(booking.series_id, {
      onSuccess: () => {
        toast.success("Haftalık seri sona erdi.");
        setSeriBitirAcik(false);
      },
      onError: (err) => toast.error(getErrorDetail(err, "Seri bitirilemedi.")),
    });
  };
  const canWithdraw =
    role === "TUTOR" && isPending && !!booking.offered_by_tutor && !booking.payment;
  const seriAktif = !!booking.series_id && seri.data?.status === "ACTIVE";

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
    <DashboardShell title="Ders Detayı" navItems={navItems ?? undefined} genislik="orta">
      <div className="pb-12">
        <button onClick={() => navigate(-1)} className={`${METIN_BAGLANTI} mb-6 inline-block`}>
          ← Geri dön
        </button>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3 lg:grid-flow-row-dense">

        {/* ── Header ── */}
        <section className={`${KART} lg:col-span-2`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <Link
              to={counterpartLink}
              className="flex min-w-0 items-center gap-3 transition hover:opacity-80"
            >
              <Avatar name={counterpartName} avatar_url={isClient ? booking.tutor_avatar_url : booking.client_avatar_url} size="lg" />
              <div className="min-w-0">
                <p className={`${BOLUM_BASLIGI} truncate`}>
                  {counterpartName}
                </p>
                <p className={KUCUK_ACIKLAMA}>
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

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <span className="rounded-lg bg-slate-100 px-2.5 py-1">
              {formatRange(booking.start_at, booking.end_at)}
            </span>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1">
              {durationLabel(booking.start_at, booking.end_at)}
            </span>
            {modeLabel && (
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium">
                {modeLabel}
              </span>
            )}
            {price !== null && (
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-semibold">
                {formatTRY(booking.price)}
              </span>
            )}
            {booking.series_id && (
              <span className="rounded-lg bg-marka-soft px-2.5 py-1 font-medium text-marka-soft-fg">
                Haftalık seri
                {seri.data?.status === "ENDED" ? " · sona erdi" : ""}
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
                    booking.tutor_name || "Öğretmen",
                    booking.client_name || ADSIZ_UYE
                  )
                }
                className={`${DUGME_SATIR_BIRINCIL} mt-4`}
              >
                Canlı Derse Katıl
              </button>
            ) : (
              <span
                title="Canlı ders, başlangıçtan 15 dk önce açılır."
                className="mt-4 inline-flex h-10 cursor-not-allowed items-center rounded-lg bg-slate-100 px-4 text-base font-semibold text-slate-500"
              >
                Ders saatinde açılır
              </span>
            )
          )}
          {/* Yüzyüze ders — buluşma yeri */}
          {booking.mode === "IN_PERSON" && (
            <div className="mt-4 rounded-lg border border-slate-200 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className={ETIKET}>Buluşma Yeri</p>
                {!editingLoc && (
                  <button
                    onClick={() => {
                      setLocDraft(booking.location ?? "");
                      setLocLatDraft(booking.location_lat ?? null);
                      setLocLngDraft(booking.location_lng ?? null);
                      setEditingLoc(true);
                    }}
                    className={METIN_BAGLANTI}
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
                      className="h-10 min-w-[12rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka-focus"
                    />
                    <button
                      onClick={saveLoc}
                      disabled={setLoc.isPending}
                      className={DUGME_SATIR_BIRINCIL}
                    >
                      Kaydet
                    </button>
                    <button
                      onClick={() => setEditingLoc(false)}
                      className={DUGME_SATIR_IKINCIL}
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
                    className={`${METIN_BAGLANTI} break-words`}
                  >
                    {booking.location}
                  </a>
                  {booking.location_lat && booking.location_lng && (
                    <div className="mt-2 h-32 w-full max-w-sm overflow-hidden rounded-lg">
                      <MapPicker initialLat={booking.location_lat} initialLng={booking.location_lng} readonly={true} />
                    </div>
                  )}
                </div>
              ) : (
                <p className={`${KUCUK_ACIKLAMA} mt-1`}>
                  Henüz buluşma yeri belirlenmedi.
                </p>
              )}
            </div>
          )}

          {booking.notes && (
            <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-base italic leading-6 text-slate-600">
              "{booking.notes}"
            </p>
          )}
          {booking.status === BookingStatus.CANCELLED && booking.cancel_reason && (
            <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-base leading-6 text-red-700">
              İptal nedeni: {booking.cancel_reason}
            </p>
          )}
          {/* Reddedilen derste açıklama: geri çekilen teklif ya da biten seri. */}
          {booking.status === BookingStatus.REJECTED && booking.cancel_reason && (
            <p className={`${ACIKLAMA} mt-4 rounded-lg bg-slate-50 px-4 py-3`}>
              {booking.cancel_reason}
            </p>
          )}

          {/* Öğrenci onayı / sorun bildirimi (Modül 2) */}
          {isClient && (
            <div className="mt-4">
              <DersOnayKarti booking={booking} />
            </div>
          )}
          {role === "TUTOR" && booking.status === BookingStatus.COMPLETED && booking.payment?.status === "HELD" && (
            <p className={`${ACIKLAMA} mt-4 rounded-lg bg-slate-50 px-4 py-3`}>
              {booking.is_disputed
                ? "Öğrenci bu ders için sorun bildirdi; ekibimiz inceliyor. Karar verilene kadar ücret aktarılmaz."
                : "Öğrenci onayladığında ya da ders bitişinden 72 saat sonra ücret kazancına eklenir."}
            </p>
          )}

          {/* ── Actions ── */}
          <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-200 pt-6">
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

            {/* Bekleyen dersin yanıtını KİM verir: öğrencinin talebinde öğretmen,
                öğretmenin teklifinde öğrenci (Modül 8). Sunucu da aynı kuralı
                uygular; buradaki tek iş doğru düğmeyi doğru tarafa göstermek. */}
            {role === "CLIENT" && isPending && booking.offered_by_tutor && (
              <>
                <button
                  disabled={busy}
                  onClick={() => run(accept, "Ders teklifini kabul ettin; ödeme adımına geçebilirsin.")}
                  className={DUGME_SATIR_BIRINCIL}
                >
                  Teklifi Kabul Et
                </button>
                <button
                  disabled={busy}
                  onClick={() => run(reject, "Ders teklifini reddettin.")}
                  className={DUGME_SATIR_TEHLIKE}
                >
                  Reddet
                </button>
              </>
            )}

            {role === "TUTOR" && isPending && !booking.offered_by_tutor && (
              <>
                <button
                  disabled={busy}
                  onClick={() => run(accept, "Rezervasyon kabul edildi.")}
                  className={DUGME_SATIR_BIRINCIL}
                >
                  Kabul Et
                </button>
                <button
                  disabled={busy}
                  onClick={() => run(reject, "Rezervasyon reddedildi.")}
                  className={DUGME_SATIR_TEHLIKE}
                >
                  Reddet
                </button>
              </>
            )}
            {/* Öğretmen, yanıt bekleyen kendi teklifini geri çeker: ders iptal
                sayılmaz (sunucu REJECTED yazar); ödemesi olan derste sunucu 409 verir. */}
            {canWithdraw && (
              <button
                disabled={geriCek.isPending}
                onClick={teklifiGeriCek}
                className={DUGME_SATIR_IKINCIL}
              >
                {geriCek.isPending ? "Geri çekiliyor…" : "Teklifi geri çek"}
              </button>
            )}
            {seriAktif && role !== null && (
              <button
                onClick={() => setSeriBitirAcik(true)}
                className={DUGME_SATIR_TEHLIKE}
              >
                Seriyi bitir
              </button>
            )}
            {role === "TUTOR" && isAccepted && (
              <button
                disabled={busy}
                onClick={() => run(complete, "Ders tamamlandı olarak işaretlendi.")}
                className={DUGME_SATIR_BIRINCIL}
              >
                Tamamla
              </button>
            )}

            {isClient && canMessage && !booking.late_for_changes && (
              <button
                onClick={() => setShowReschedule(true)}
                className={DUGME_SATIR_IKINCIL}
              >
                Ertele
              </button>
            )}
            {/* Ödemesiz bekleyen kendi teklifinde öğretmene "İptal" yerine yalnız
                "Teklifi geri çek" gösterilir: iptal, iptal oranı metriğine yazılır. */}
            {canMessage && !canWithdraw && (
              <button
                onClick={() => setShowCancel(true)}
                className={DUGME_SATIR_TEHLIKE}
              >
                İptal Et
              </button>
            )}
            {/* Düğme sunucunun `can_review` kararına bağlı (16 Eyl 2026):
                tamamlanmış + kartla ödenmiş + bu öğretmene ilk yorum. Yerel
                `alreadyReviewed`, pencere kapanır kapanmaz düğmeyi gizler. */}
            {isClient && booking.can_review && !alreadyReviewed && (
              <button
                onClick={() => setShowReview(true)}
                className={DUGME_SATIR_BIRINCIL}
              >
                Değerlendir
              </button>
            )}
          </div>
        </section>

        {/* ── Review ── */}
        {review && (
          <section className={`${KART} lg:col-span-1`}>
            <h2 className={BOLUM_BASLIGI}>Değerlendirme</h2>
            <div className="mt-3">
              <StarRating value={review.rating} />
            </div>
            {/* Alt kriterler yalnız burada (sahibine / öğretmene) listelenir;
                public kartlarda tekrarlanmaz. */}
            {(() => {
              const kriterler = [
                ["Netlik", review.clarity_rating],
                ["Motivasyon", review.motivation_rating],
                ["Hazırlık", review.preparation_rating],
              ].filter(([, v]) => v != null);
              return kriterler.length > 0 ? (
                <p className={`${ACIKLAMA} mt-2`}>
                  {kriterler.map(([ad, v]) => `${ad} ${v}`).join(" · ")}
                </p>
              ) : null;
            })()}
            {review.comment_text && (
              <p className={`${ACIKLAMA} mt-2 whitespace-pre-line`}>
                {review.comment_text}
              </p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              {degerlendirmeTarihi(review.created_at, review.edited_at)}
              {isClient && review.is_anonymous && " · Anonim paylaşıldı"}
            </p>
            {/* Değerlendirme dersin değil öğretmenin: o öğretmenle yapılan her
                dersin detayında aynı kayıt görünür ve buradan düzenlenir. */}
            {isClient && (
              <button
                onClick={() => setEditReview(true)}
                className={`${DUGME_SATIR_IKINCIL} mt-4`}
              >
                Düzenle
              </button>
            )}
          </section>
        )}

        {/* ── Q&A (öğrenci) ── */}
        {isClient && qaGroup && (
          <section className={`${KART} lg:col-span-2`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className={BOLUM_BASLIGI}>Bu Ders İçin Sorularım</h2>
              {qaGroup.expired ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  Süre doldu
                </span>
              ) : (
                <span className="rounded-full bg-marka-soft px-2.5 py-1 text-xs font-semibold text-marka-metin-hover">
                  {qaGroup.remaining}/{qaGroup.quota} hak · {qaGroup.days_left} gün
                </span>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {qaGroup.threads.length === 0 ? (
                <p className={`${ACIKLAMA} rounded-lg border border-dashed border-slate-300 py-6 text-center`}>
                  Bu derste henüz soru sormadın.
                </p>
              ) : (
                qaGroup.threads.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-lg bg-slate-50 p-4"
                  >
                    {t.subject && (
                      <p className={`${ETIKET} mb-2`}>
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
                  className={`${DUGME_SATIR_BIRINCIL} w-full`}
                >
                  Yeni Soru Başlığı Aç ({qaGroup.remaining} hak)
                </button>
              )}
            </div>
          </section>
        )}

        {/* ── Ders Kaynakları ── */}
        <section className={`${KART} lg:col-span-1`}>
          <h2 className={BOLUM_BASLIGI}>Ders Kaynakları</h2>
          <div className="mt-4">
            <BookingResourcesPanel
              bookingId={bookingId}
              resources={booking.resources}
              role={role}
              userId={user?.id}
              canEdit={canMessage}
              showHeading={false}
            />
          </div>
        </section>

        {/* ── Ders Notları (Yorumlar) ── */}
        <section className={`${KART} lg:col-span-2`}>
          <h2 className={BOLUM_BASLIGI}>Ders Mesajları</h2>
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
                          <span className="text-sm font-semibold text-slate-900">
                            {isMine ? "Sen" : rolEtiketi(comment.sender_role === "TUTOR" ? ROLE_IDS.TUTOR : ROLE_IDS.CLIENT)}
                          </span>
                          <span className="text-xs text-slate-500">
                            {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div
                          className={`relative rounded-lg px-4 py-2 text-base leading-6 ${
                            isMine
                              ? "bg-marka text-marka-fg"
                              : "bg-slate-100 text-slate-900"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{comment.body}</p>
                        </div>
                        {isMine && (
                          <button
                            onClick={() => delComment.mutate({ id: bookingId, commentId: comment.id })}
                            disabled={delComment.isPending}
                            className="self-end px-1 text-xs font-semibold text-slate-500 hover:text-red-700 disabled:opacity-50"
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
              <p className={ACIKLAMA}>
                Bu ders için henüz bir mesaj yok.
              </p>
            )}

            {/* Yeni Yorum Formu */}
            {canMessage && (
              <form onSubmit={handleAddComment} className="mt-2 flex items-end gap-3 pt-2">
                <textarea
                  rows={2}
                  placeholder="Mesajınız"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  className="min-w-0 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka-focus"
                />
                <button
                  type="submit"
                  disabled={addComment.isPending || !commentBody.trim()}
                  className={DUGME_SATIR_BIRINCIL}
                >
                  Gönder
                </button>
              </form>
            )}
          </div>
        </section>

        {/* ── Kişisel Notlarım (Gizli) ── */}
        <section className={`${KART} lg:col-span-1`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={BOLUM_BASLIGI}>Notlar</h2>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
              Sadece siz görebilirsiniz
            </span>
          </div>
          <div className="mt-4">
            <BookingPrivateNotesPanel
              bookingId={bookingId}
              notes={booking.private_notes}
              showHeading={false}
            />
          </div>
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
          booking={booking}
          rol={isClient ? "CLIENT" : "TUTOR"}
          onReschedule={isClient ? () => setShowReschedule(true) : undefined}
        />
      )}
      <Modal
        open={seriBitirAcik}
        onClose={() => setSeriBitirAcik(false)}
        title="Haftalık seriyi bitir"
      >
        <p className={ACIKLAMA}>
          Seriden yeni teklif gelmeyecek; bekleyen teklifler geri çekilir, kabul edilmiş dersler
          takviminde kalır.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" className={DUGME_SATIR_IKINCIL} onClick={() => setSeriBitirAcik(false)}>
            Vazgeç
          </button>
          <button
            type="button"
            className={DUGME_SATIR_TEHLIKE}
            onClick={seriyiBitir}
            disabled={seriBitir.isPending}
          >
            {seriBitir.isPending ? "Bitiriliyor…" : "Seriyi bitir"}
          </button>
        </div>
      </Modal>
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
      {editReview && review && (
        <ReviewModal
          bookingId={bookingId}
          existing={review}
          onClose={() => setEditReview(false)}
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
