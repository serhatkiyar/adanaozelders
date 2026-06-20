import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Avatar } from "@/components/Avatar";
import { ReviewModal } from "@/components/ReviewModal";
import { QuestionModal } from "@/components/QuestionModal";
import { CancelModal } from "@/components/CancelModal";
import { RescheduleModal } from "@/components/RescheduleModal";

import { useMeetingStore } from "@/store/meetingStore";
import { useBookings } from "@/hooks/useBookings";
import { usePayBooking } from "@/hooks/usePayments";
import { PaymentBadge } from "@/components/PaymentBadge";
import { PaymentConsentNote } from "@/components/LegalConsent";
import { BookingStatus, PaymentStatus, type BookingOut } from "@/types";
import { formatRange } from "@/lib/datetime";
import { formatTRY, parseMoney } from "@/lib/money";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLE } from "@/lib/bookingStatus";
import { qaEligibility } from "@/lib/qaWindow";
import { isLessonJoinable } from "@/lib/lesson";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

interface AskTarget {
  bookingId: number;
  tutorName: string;
}

/* ─── ortak buton sınıfları (sakin / nötr palet) ────────── */

const PRIMARY_BTN =
  "rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200";
const GHOST_BTN =
  "rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-95 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700";

/* ─── ikonlar ────────────────────────────────────────── */

function ChevronRight({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
    </svg>
  );
}

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

function CalendarIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
      />
    </svg>
  );
}

/* ─── filtreler ──────────────────────────────────────── */

type Filter = "ACTIVE" | "ALL" | BookingStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "ACTIVE",                    label: "Aktif"      },
  { value: "ALL",                       label: "Tümü"       },
  { value: BookingStatus.PENDING,       label: "Bekliyor"   },
  { value: BookingStatus.ACCEPTED,      label: "Onaylı"     },
  { value: BookingStatus.COMPLETED,     label: "Tamamlandı" },
  { value: BookingStatus.REJECTED,      label: "Reddedildi" },
  { value: BookingStatus.CANCELLED,     label: "İptal"      },
];

/* ─── ders satırı (kart değil; saç-teli çizgiyle ayrılır) ── */

function BookingRow({
  booking,
  reviewed,
  onReview,
  onAsk,
  onJoinMeeting,
}: {
  booking: BookingOut;
  reviewed: boolean;
  onReview: (id: number) => void;
  onAsk: (target: AskTarget) => void;
  onJoinMeeting: (booking: BookingOut) => void;
}) {
  const canReview = booking.status === BookingStatus.COMPLETED && !reviewed;
  const reviewedDone = booking.status === BookingStatus.COMPLETED && reviewed;
  const tutorName = booking.tutor_name ?? `Eğitmen #${booking.tutor_id}`;
  const price = parseMoney(booking.price);
  const qa = qaEligibility(booking);
  const [showCancel, setShowCancel] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const canCancel =
    booking.status === BookingStatus.PENDING ||
    booking.status === BookingStatus.ACCEPTED;

  const payMutation = usePayBooking();
  // Onaylanmış ama ödenmemiş ders → öğrenci ödeyebilir (escrow).
  const needsPayment =
    booking.status === BookingStatus.ACCEPTED &&
    booking.payment?.status === PaymentStatus.PENDING;
  const canJoin =
    booking.status === BookingStatus.ACCEPTED && !!booking.meeting_room;
  const joinable = canJoin && isLessonJoinable(booking.start_at, booking.end_at);

  const handlePay = () => {
    payMutation.mutate(booking.id, {
      onSuccess: (p) => {
        if (!p.redirect_url) toast.success("Ödeme alındı, ders kesinleşti.");
      },
      onError: (err) => toast.error(getErrorMessage(err, "Ödeme yapılamadı.")),
    });
  };

  const hasActions =
    needsPayment || canJoin || canReview || reviewedDone || canCancel;

  return (
    <div className="px-5 py-5 sm:px-6">
      {/* Üst satır: eğitmen + durum */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Link
          to={ROUTES.tutor(booking.tutor_id)}
          className="group flex min-w-0 items-center gap-3"
        >
          <Avatar name={tutorName} avatar_url={booking.tutor_avatar_url} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 transition group-hover:text-slate-600 dark:text-white dark:group-hover:text-slate-300">
              {tutorName}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {formatRange(booking.start_at, booking.end_at)}
              {booking.is_free_lesson ? (
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {" · Ücretsiz ilk ders"}
                </span>
              ) : (
                price !== null && ` · ${formatTRY(booking.price)}`
              )}
            </p>
          </div>
        </Link>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${BOOKING_STATUS_STYLE[booking.status]}`}
          >
            {BOOKING_STATUS_LABEL[booking.status]}
          </span>
          {booking.payment && <PaymentBadge payment={booking.payment} />}
          <Link
            to={ROUTES.lesson(booking.id)}
            className="ml-0.5 inline-flex items-center gap-0.5 text-xs font-semibold text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            Detay
            <ChevronRight />
          </Link>
        </div>
      </div>

      {/* Notlar / iptal nedeni */}
      {booking.notes && (
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-2.5 text-xs italic text-slate-500 dark:bg-slate-700/40 dark:text-slate-400">
          “{booking.notes}”
        </p>
      )}
      {booking.status === BookingStatus.CANCELLED && booking.cancel_reason && (
        <p className="mt-3 rounded-xl bg-rose-50 px-4 py-2.5 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          İptal nedeni: {booking.cancel_reason}
        </p>
      )}

      {/* Aksiyonlar */}
      {hasActions && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {needsPayment && (
            <button onClick={handlePay} disabled={payMutation.isPending} className={PRIMARY_BTN}>
              {payMutation.isPending
                ? "İşleniyor…"
                : `Öde · ${formatTRY(booking.payment?.amount)}`}
            </button>
          )}

          {canJoin &&
            (joinable ? (
              <button
                onClick={() => onJoinMeeting(booking)}
                className={`inline-flex items-center gap-1.5 ${PRIMARY_BTN}`}
              >
                <VideoIcon />
                Derse Katıl
              </button>
            ) : (
              <span
                title="Canlı ders, başlangıçtan 15 dk önce açılır."
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400 dark:bg-slate-700 dark:text-slate-500"
              >
                <VideoIcon />
                Ders saatinde açılır
              </span>
            ))}

          {canReview && (
            <button onClick={() => onReview(booking.id)} className={PRIMARY_BTN}>
              Değerlendir
            </button>
          )}

          {reviewedDone && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zm3.16 4.87L6.67 9.36 4.42 7.1 3.29 8.23l3.38 3.38L12.29 6z" />
              </svg>
              Değerlendirildi
            </span>
          )}

          {canCancel && (
            <button onClick={() => setShowReschedule(true)} className={GHOST_BTN}>
              Ertele
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => setShowCancel(true)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-rose-50 hover:text-rose-600 active:scale-95 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-rose-900/20 dark:hover:text-rose-300"
            >
              İptal et
            </button>
          )}
        </div>
      )}

      {/* Soru sorma penceresi */}
      {qa && qa.ended && (
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 dark:border-slate-700/60 sm:flex-row sm:items-center sm:justify-between">
          <p
            className={`text-xs font-medium ${
              qa.expired
                ? "text-slate-400 dark:text-slate-500"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            {qa.expired
              ? "Soru sorma süresi doldu"
              : `Soru sorma hakkının bitmesine ${qa.daysLeft} gün kaldı`}
          </p>
          <button
            type="button"
            disabled={!qa.canAsk}
            onClick={() => onAsk({ bookingId: booking.id, tutorName })}
            className={`shrink-0 ${PRIMARY_BTN}`}
          >
            Soru Sor
          </button>
        </div>
      )}

      {showCancel && (
        <CancelModal
          bookingId={booking.id}
          counterpartName={tutorName}
          onClose={() => setShowCancel(false)}
        />
      )}
      {showReschedule && (
        <RescheduleModal
          bookingId={booking.id}
          onClose={() => setShowReschedule(false)}
        />
      )}
    </div>
  );
}

/* ─── içerik (Rezervasyonlar sayfasının "Dersler" sekmesi) ── */

export function StudentBookingsContent() {
  const { data, isLoading, isError, error } = useBookings({ limit: 100 });
  const { joinMeeting } = useMeetingStore();
  const [activeReview, setActiveReview] = useState<number | null>(null);
  const [activeAsk, setActiveAsk]       = useState<AskTarget | null>(null);
  const [reviewed, setReviewed]         = useState<Set<number>>(new Set());
  const [filter, setFilter]             = useState<Filter>("ACTIVE");

  const markReviewed = (id: number) =>
    setReviewed((prev) => new Set(prev).add(id));

  const counts = useMemo(() => {
    const c: Record<BookingStatus, number> = {
      [BookingStatus.PENDING]:   0,
      [BookingStatus.ACCEPTED]:  0,
      [BookingStatus.COMPLETED]: 0,
      [BookingStatus.REJECTED]:  0,
      [BookingStatus.CANCELLED]: 0,
    };
    for (const b of data ?? []) c[b.status]++;
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "ALL") return data;
    if (filter === "ACTIVE")
      return data.filter(
        (b) =>
          b.status === BookingStatus.PENDING ||
          b.status === BookingStatus.ACCEPTED
      );
    return data.filter((b) => b.status === filter);
  }, [data, filter]);

  return (
    <div className="max-w-3xl space-y-5">
      {/* Filtre çipleri (sakin: aktif = slate-900) */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count =
            f.value === "ALL"
              ? (data ?? []).length
              : f.value === "ACTIVE"
                ? (counts[BookingStatus.PENDING] ?? 0) +
                  (counts[BookingStatus.ACCEPTED] ?? 0)
                : counts[f.value as BookingStatus] ?? 0;
          const active = filter === f.value;

          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition ${
                active
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {f.label}
              {!isLoading && count > 0 && (
                <span
                  className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                    active
                      ? "bg-white/20 text-current dark:bg-slate-900/15"
                      : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Liste */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl bg-rose-50 px-5 py-4 text-sm text-rose-700 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20">
          {getErrorMessage(error, "Ders talepleri yüklenemedi.")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 py-20 text-center dark:border-slate-700">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
            <CalendarIcon />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
            {(data ?? []).length === 0
              ? "Henüz rezervasyonun yok"
              : "Bu filtreye uyan rezervasyon yok"}
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {(data ?? []).length === 0
              ? "Bir eğitmen seç ve ders planla."
              : "Farklı bir filtre dene."}
          </p>
          {(data ?? []).length === 0 ? (
            <Link
              to={ROUTES.tutors}
              className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Eğitmenleri keşfet
            </Link>
          ) : (
            filter !== "ALL" && (
              <button
                onClick={() => setFilter("ALL")}
                className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Tümünü göster
              </button>
            )
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {filtered.length} rezervasyon listeleniyor
          </p>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 dark:divide-slate-700/60 dark:bg-slate-800 dark:ring-slate-700">
            {filtered.map((b) => (
              <BookingRow
                key={b.id}
                booking={b}
                reviewed={b.reviewed || reviewed.has(b.id)}
                onReview={setActiveReview}
                onAsk={setActiveAsk}
                onJoinMeeting={(bk) =>
                  joinMeeting(
                    bk.id,
                    bk.meeting_room!,
                    bk.tutor_name || "Eğitmen",
                    bk.client_name || "Öğrenci"
                  )
                }
              />
            ))}
          </div>
          {/* Ödenecek ders varsa mesafeli satış/iade bilgilendirmesi göster */}
          {filtered.some(
            (b) =>
              b.status === BookingStatus.ACCEPTED &&
              b.payment?.status === PaymentStatus.PENDING
          ) && <PaymentConsentNote className="pt-1" />}
        </>
      )}

      {activeReview !== null && (
        <ReviewModal
          bookingId={activeReview}
          onClose={() => setActiveReview(null)}
          onReviewed={markReviewed}
        />
      )}

      {activeAsk && (
        <QuestionModal
          bookingId={activeAsk.bookingId}
          tutorName={activeAsk.tutorName}
          onClose={() => setActiveAsk(null)}
        />
      )}
    </div>
  );
}
