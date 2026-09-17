import { useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { CancelModal } from "@/components/CancelModal";
import { PaymentBadge } from "@/components/PaymentBadge";
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
  const busy = accept.isPending || reject.isPending || complete.isPending;

  const clientName = booking.client_name ?? `Öğrenci #${booking.client_id}`;
  const price = parseMoney(booking.price);

  const run = (action: ReturnType<typeof useBookingAction>, okMsg: string) =>
    action.mutate(booking.id, {
      onSuccess: () => toast.success(okMsg),
      onError: (err) => toast.error(getErrorMessage(err, "İşlem başarısız.")),
    });

  const isPending = booking.status === BookingStatus.PENDING;
  const isAccepted = booking.status === BookingStatus.ACCEPTED;
  const yuzYuze = booking.mode === "IN_PERSON";

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between">
      <Link
        to={ROUTES.uyeProfili(booking.client_id)}
        className="flex min-w-0 items-start gap-3 transition hover:opacity-80"
      >
        <Avatar name={clientName} avatar_url={booking.client_avatar_url} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{clientName}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatRange(booking.start_at, booking.end_at)}
            {" · "}
            {yuzYuze ? "Yüz yüze" : "Online"}
            {price !== null && ` · ${formatTRY(booking.price)}`}
          </p>
          {booking.notes && (
            <p className="mt-1.5 line-clamp-2 text-xs italic text-slate-400">
              "{booking.notes}"
            </p>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link
          to={ROUTES.lesson(booking.id)}
          className="text-xs font-semibold text-marka-metin transition hover:text-marka-metin-hover"
        >
          Detay →
        </Link>
        {isPending ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(accept, "Ders talebi kabul edildi.")}
              className="rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {accept.isPending ? "…" : "Kabul et"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(reject, "Ders talebi reddedildi.")}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {reject.isPending ? "…" : "Reddet"}
            </button>
          </>
        ) : isAccepted ? (
          <>
            {booking.meeting_room && isLessonJoinable(booking.start_at, booking.end_at) && (
              <button
                type="button"
                onClick={() => onJoinMeeting(booking)}
                className="rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95"
              >
                Derse katıl
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => run(complete, "Ders tamamlandı olarak işaretlendi.")}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {complete.isPending ? "…" : "Tamamla"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowCancel(true)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              İptal
            </button>
          </>
        ) : (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${BOOKING_STATUS_STYLE[booking.status]}`}
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
        />
      )}
    </div>
  );
}
