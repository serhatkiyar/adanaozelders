import { ROUTES } from "@/lib/routes";
import { ReservationRow } from "@/components/reservation/ReservationRow";
import { toReservationItem } from "@/lib/reservationModel";

import { usePayBooking } from "@/hooks/usePayments";
import { BookingStatus, PaymentStatus, type BookingOut } from "@/types";
import { formatTRY } from "@/lib/money";
import { isLessonJoinable } from "@/lib/lesson";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { isBranchOpen } from "@/lib/paymentAvailability";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { DUGME_SATIR_BIRINCIL, KUCUK_ACIKLAMA } from "@/components/pano/stil";

/* ─── ikonlar ────────────────────────────────────────── */

export const PAY_CLOSED_NOTICE_ID = "tutor-payment-closed-notice";

function VideoIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  );
}

/* ─── ders satırı (kart değil; saç-teli çizgiyle ayrılır) ── */

/**
 * Ders liste satırı — ortak `ReservationRow` + zamana duyarlı aksiyonlar.
 *
 * ## Hangi aksiyon nerede
 *
 * Satırda YALNIZ iki aksiyon kalır ve ikisinin de gerekçesi var:
 *   • **Öde** — ödenmemiş kaydın tek işi tamamlanmaktır.
 *   • **Derse katıl** — ders 10 dakika sonra başlıyorsa öğrenciyi bir tık daha
 *     uzağa göndermek yanlış olur.
 *
 * Ertele · iptal · değerlendir · soru sor DETAYA taşındı (`LessonDetail`de
 * hepsi zaten var). Satırdaki aksiyon yığını tarama ritmini bozuyor ve
 * yanlışlıkla tıklanıyordu — Resy · Zocdoc · Preply da aynı ayrımı yapar.
 *
 * Nöbetçi: `dersSatiri.test.tsx`.
 */
export function BookingRow({
  booking,
  onJoinMeeting,
}: {
  booking: BookingOut;
  onJoinMeeting: (booking: BookingOut) => void;
}) {
  const payMutation = usePayBooking();
  // Onaylanmış ama ödenmemiş ders → öğrenci ödeyebilir (escrow).
  const needsPayment =
    booking.status === BookingStatus.ACCEPTED &&
    booking.payment?.status === PaymentStatus.PENDING;
  const canJoin =
    booking.status === BookingStatus.ACCEPTED && !!booking.meeting_room;
  const joinable = canJoin && isLessonJoinable(booking.start_at, booking.end_at);

  // React Query aynı anahtarı paylaşan satırları tek isteğe indirir; bu yüzden
  // availability prop olarak zincirlenmiyor.
  const { data: availability } = usePaymentAvailability();
  const payOpen = isBranchOpen(availability, "tutor_marketplace");

  const handlePay = () => {
    payMutation.mutate(booking.id, {
      onSuccess: (p) => {
        if (!p.redirect_url) toast.success("Ödeme alındı, ders kesinleşti.");
      },
      onError: (err) => toast.error(getErrorMessage(err, "Ödeme yapılamadı.")),
    });
  };

  const aksiyonVar = needsPayment || canJoin;

  return (
    <div>
      <ReservationRow item={toReservationItem(booking)} to={ROUTES.lesson(booking.id)} />
      {aksiyonVar && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
          {needsPayment &&
            (payOpen ? (
              <button onClick={handlePay} disabled={payMutation.isPending} className={DUGME_SATIR_BIRINCIL}>
                {payMutation.isPending
                  ? "İşleniyor…"
                  : `Öde · ${formatTRY(booking.payment?.amount)}`}
              </button>
            ) : (
              // Sebep LİSTE BAŞINDA bir kez söyleniyor; satırda nötr bir durum
              // yeterli. Her satıra tam genişlikte amber blok koymak rengi
              // "istisna" olmaktan çıkarıyordu.
              <span
                aria-describedby={PAY_CLOSED_NOTICE_ID}
                className={KUCUK_ACIKLAMA}
              >
                Ödeme yolu şu an kapalı
              </span>
            ))}

          {canJoin &&
            (joinable ? (
              <button
                onClick={() => onJoinMeeting(booking)}
                className={DUGME_SATIR_BIRINCIL}
              >
                <VideoIcon />
                Derse Katıl
              </button>
            ) : (
              <span
                title="Canlı ders, başlangıçtan 15 dk önce açılır."
                className="inline-flex h-10 cursor-not-allowed items-center gap-2 whitespace-nowrap rounded-lg bg-slate-100 px-4 text-base font-semibold text-slate-500"
              >
                Ders saatinde açılır
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
