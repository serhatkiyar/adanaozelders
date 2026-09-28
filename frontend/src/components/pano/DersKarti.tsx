import { useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { CancelModal } from "@/components/CancelModal";
import { PaymentBadge } from "@/components/PaymentBadge";
import {
  ACIKLAMA,
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  DUGME_SATIR_TEHLIKE,
  ETIKET,
  METIN_BAGLANTI,
} from "@/components/pano/stil";
import { useBookingAction } from "@/hooks/useBookings";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLE } from "@/lib/bookingStatus";
import { formatRange } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { isLessonJoinable } from "@/lib/lesson";
import { formatTRY, parseMoney } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import { BookingStatus, type BookingOut } from "@/types";

/**
 * Tek ders satırı: bekleyen istekte Kabul/Reddet, kabul edilmiş derste
 * Derse katıl / Tamamla / İptal, geçmişte durum etiketi. Eski panodaki
 * `BookingCard` davranışı birebir korunur.
 */
export function DersKarti({
  booking,
  onJoinMeeting,
}: {
  booking: BookingOut;
  onJoinMeeting: (booking: BookingOut) => void;
}) {
  const accept = useBookingAction("accept");
  const reject = useBookingAction("reject");
  const complete = useBookingAction("complete");
  const [showCancel, setShowCancel] = useState(false);
  // Reddetme geri alınamaz ve "Kabul et"in hemen yanında duruyor: telefonda
  // yanlış dokunuş öğrencinin talebini kaybettiriyordu. İki adımlı onay
  // `LessonDetail`deki `redOnayi` deseniyle aynı.
  const [redOnayi, setRedOnayi] = useState(false);
  const busy = accept.isPending || reject.isPending || complete.isPending;

  const clientName = booking.client_name ?? `Öğrenci #${booking.client_id}`;
  const price = parseMoney(booking.price);

  const run = (action: ReturnType<typeof useBookingAction>, okMsg: string) =>
    action.mutate(booking.id, {
      onSuccess: () => toast.success(okMsg),
      onError: (err) => toast.error(getErrorMessage(err, "İşlem başarısız.")),
    });

  // Bu kart eğitmen panosunda çizilir. Eğitmenin KENDİ teklifi de PENDING'dir
  // ama yanıtı öğrenci verir (Modül 8) — Kabul/Reddet çıkmaz, "bekliyor" kalır.
  const isPending =
    booking.status === BookingStatus.PENDING && !booking.offered_by_tutor;
  const isAccepted = booking.status === BookingStatus.ACCEPTED;
  const yuzYuze = booking.mode === "IN_PERSON";
  // Sunucu başlamamış dersi tamamlatmaz (409, `_assert_completable`); düğme
  // o zamana dek gösterilmez — yoksa her dokunuş yalnız bir hata toast'ıydı.
  const basladi = Date.parse(booking.start_at) <= Date.now();

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar name={clientName} avatar_url={booking.client_avatar_url} size="md" />
        <div className="min-w-0">
          <p className={`truncate ${ETIKET}`}>{clientName}</p>
          <p className={`mt-1 ${ACIKLAMA}`}>
            {formatRange(booking.start_at, booking.end_at)}
            {" · "}
            {yuzYuze ? "Yüz yüze" : "Online"}
            {price !== null && ` · ${formatTRY(booking.price)}`}
          </p>
          {booking.notes && (
            <p className="mt-2 line-clamp-2 text-sm italic leading-5 text-slate-500">
              "{booking.notes}"
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Link
          to={ROUTES.lesson(booking.id)}
          className={METIN_BAGLANTI}
        >
          Detay
        </Link>
        {isPending && redOnayi ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(reject, "Ders talebi reddedildi.")}
              className={DUGME_SATIR_TEHLIKE}
            >
              {reject.isPending ? "Reddediliyor…" : "Evet, reddet"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRedOnayi(false)}
              className={DUGME_SATIR_IKINCIL}
            >
              Vazgeç
            </button>
          </>
        ) : isPending ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(accept, "Ders talebi kabul edildi.")}
              className={DUGME_SATIR_BIRINCIL}
            >
              {accept.isPending ? "Kabul ediliyor…" : "Kabul et"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRedOnayi(true)}
              className={DUGME_SATIR_TEHLIKE}
            >
              Reddet
            </button>
          </>
        ) : isAccepted ? (
          <>
            {booking.meeting_room && isLessonJoinable(booking.start_at, booking.end_at) && (
              <button
                type="button"
                onClick={() => onJoinMeeting(booking)}
                className={DUGME_SATIR_BIRINCIL}
              >
                Derse katıl
              </button>
            )}
            {basladi && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(complete, "Ders tamamlandı olarak işaretlendi.")}
                className={DUGME_SATIR_IKINCIL}
              >
                {complete.isPending ? "Kaydediliyor…" : "Tamamla"}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowCancel(true)}
              className={DUGME_SATIR_IKINCIL}
            >
              İptal
            </button>
          </>
        ) : (
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${BOOKING_STATUS_STYLE[booking.status]}`}
          >
            {BOOKING_STATUS_LABEL[booking.status]}
          </span>
        )}
        {booking.payment && <PaymentBadge payment={booking.payment} />}
      </div>

      {showCancel && (
        <CancelModal
          bookingId={booking.id}
          counterpartName={clientName}
          onClose={() => setShowCancel(false)}
          booking={booking}
          rol="TUTOR"
        />
      )}
    </div>
  );
}
