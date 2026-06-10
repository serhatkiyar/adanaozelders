import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
import { Avatar } from "@/components/Avatar";
import { ReviewModal } from "@/components/ReviewModal";
import { QuestionModal } from "@/components/QuestionModal";
import { CancelModal } from "@/components/CancelModal";
import { RescheduleModal } from "@/components/RescheduleModal";

import { useMeetingStore } from "@/store/meetingStore";
import { useBookings } from "@/hooks/useBookings";
import { usePayBooking } from "@/hooks/usePayments";
import { useCheckoutResultToast } from "@/hooks/useCheckoutResult";
import { PaymentBadge } from "@/components/PaymentBadge";
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

/* ─── filter tabs ────────────────────────────────────── */

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

const FILTER_BADGE_CLS: Partial<Record<Filter, string>> = {
  ACTIVE:                    "bg-blue-500",
  [BookingStatus.PENDING]:   "bg-amber-500",
  [BookingStatus.ACCEPTED]:  "bg-indigo-500",
  [BookingStatus.COMPLETED]: "bg-slate-400",
  [BookingStatus.REJECTED]:  "bg-red-500",
};

/* ─── booking row ────────────────────────────────────── */

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
  const handlePay = () => {
    payMutation.mutate(booking.id, {
      onSuccess: (p) => {
        if (!p.redirect_url) toast.success("Ödeme alındı, ders kesinleşti.");
      },
      onError: (err) => toast.error(getErrorMessage(err, "Ödeme yapılamadı.")),
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 transition hover:shadow-md dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          to={ROUTES.tutor(booking.tutor_id)}
          className="flex min-w-0 items-center gap-3 transition hover:opacity-80"
        >
          <Avatar name={tutorName} avatar_url={booking.tutor_avatar_url} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400">
              {tutorName}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {formatRange(booking.start_at, booking.end_at)}
              {price !== null && ` · ${formatTRY(booking.price)}`}
            </p>
          </div>
        </Link>

        <div className="flex shrink-0 items-center gap-2.5">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${BOOKING_STATUS_STYLE[booking.status]}`}
          >
            {BOOKING_STATUS_LABEL[booking.status]}
          </span>

          {booking.payment && <PaymentBadge payment={booking.payment} />}

          <Link
            to={ROUTES.lesson(booking.id)}
            className="text-xs font-semibold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400"
          >
            Detay →
          </Link>

          {needsPayment && (
            <button
              onClick={handlePay}
              disabled={payMutation.isPending}
              className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {payMutation.isPending
                ? "İşleniyor…"
                : `Öde · ${formatTRY(booking.payment?.amount)}`}
            </button>
          )}

          {canReview && (
            <button
              onClick={() => onReview(booking.id)}
              className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
            >
              Değerlendir
            </button>
          )}

          {booking.status === BookingStatus.COMPLETED && reviewed && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span>✓</span> Değerlendirildi
            </span>
          )}

          {booking.status === BookingStatus.ACCEPTED && booking.meeting_room && (
            isLessonJoinable(booking.start_at, booking.end_at) ? (
              <button
                onClick={() => onJoinMeeting(booking)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
              >
                🎥 Derse Katıl
              </button>
            ) : (
              <span
                title="Canlı ders, başlangıçtan 15 dk önce açılır."
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-1.5 text-sm font-semibold text-slate-400 dark:bg-slate-700 dark:text-slate-500"
              >
                🎥 Ders saatinde açılır
              </span>
            )
          )}

          {canCancel && (
            <button
              onClick={() => setShowReschedule(true)}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              Ertele
            </button>
          )}

          {canCancel && (
            <button
              onClick={() => setShowCancel(true)}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-red-50 hover:text-red-600 active:scale-95 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-red-900/20"
            >
              İptal Et
            </button>
          )}
        </div>
      </div>

      {booking.notes && (
        <p className="rounded-xl bg-slate-50 px-4 py-2.5 text-xs italic text-slate-500 dark:bg-slate-700/50 dark:text-slate-400">
          "{booking.notes}"
        </p>
      )}

      {booking.status === BookingStatus.CANCELLED && booking.cancel_reason && (
        <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          İptal nedeni: {booking.cancel_reason}
        </p>
      )}

      {qa && qa.ended && (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <p
            className={`flex items-center gap-1.5 text-xs font-medium ${
              qa.expired
                ? "text-slate-400 dark:text-slate-500"
                : "text-indigo-600 dark:text-indigo-400"
            }`}
          >
            <span>{qa.expired ? "⏳" : "💬"}</span>
            {qa.expired
              ? "Soru sorma süresi doldu"
              : `Soru sorma hakkının bitmesine ${qa.daysLeft} gün kaldı`}
          </p>
          <button
            type="button"
            disabled={!qa.canAsk}
            onClick={() => onAsk({ bookingId: booking.id, tutorName })}
            className="shrink-0 rounded-xl bg-slate-900 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-700 dark:hover:bg-slate-600"
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

/* ─── page ───────────────────────────────────────────── */

export default function StudentBookings() {
  useCheckoutResultToast(); // iyzico dönüşü: ?odeme=basarili|basarisiz
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

  const filtered = useMemo(
    () => {
      if (!data) return [];
      if (filter === "ALL") return data;
      if (filter === "ACTIVE") return data.filter((b) => b.status === BookingStatus.PENDING || b.status === BookingStatus.ACCEPTED);
      return data.filter((b) => b.status === filter);
    },
    [data, filter]
  );

  return (
    <DashboardShell title="Ders Taleplerim" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-4xl space-y-6 pb-12">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Ders Taleplerim
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Tüm ders taleplerini ve rezervasyonlarını buradan yönetebilirsin.
          </p>
        </div>

        {/* Stats 
        {!isLoading && !isError && (
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <StatBox label="Bekleyen"   value={counts[BookingStatus.PENDING]}   tone="amber"   emoji="⏳" />
            <StatBox label="Onaylı"     value={counts[BookingStatus.ACCEPTED]}  tone="indigo"  emoji="✅" />
            <StatBox label="Tamamlanan" value={counts[BookingStatus.COMPLETED]} tone="emerald" emoji="🎓" />
          </div>
        )}*/}

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-1.5 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
          {FILTERS.map((f) => {
            const count = f.value === "ALL"
              ? (data ?? []).length
              : f.value === "ACTIVE"
              ? (counts[BookingStatus.PENDING] ?? 0) + (counts[BookingStatus.ACCEPTED] ?? 0)
              : counts[f.value as BookingStatus] ?? 0;
            const active = filter === f.value;

            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                }`}
              >
                {f.label}
                {!isLoading && count > 0 && (
                  <span
                    className={`flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                      active
                        ? "bg-white/25 text-white"
                        : (FILTER_BADGE_CLS[f.value] ?? "bg-slate-400") + " text-white"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Booking list */}
        <div className="space-y-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            ))
          ) : isError ? (
            <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-800/30">
              <span>⚠</span>
              {getErrorMessage(error, "Ders talepleri yüklenemedi.")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center dark:border-slate-700">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">
                {(data ?? []).length === 0 ? "📅" : "🔍"}
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
                {(data ?? []).length === 0
                  ? "Henüz rezervasyonun yok"
                  : "Bu filtreye uyan rezervasyon yok"}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                {(data ?? []).length === 0
                  ? "Marketplace'ten bir eğitmen seç ve ders planla."
                  : "Farklı bir filtre dene."}
              </p>
              {filter !== "ALL" && (
                <button
                  onClick={() => setFilter("ALL")}
                  className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  Tümünü göster
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {filtered.length} rezervasyon listeleniyor
              </p>
              {filtered.map((b) => (
                <BookingRow
                  key={b.id}
                  booking={b}
                  reviewed={b.reviewed || reviewed.has(b.id)}
                  onReview={setActiveReview}
                  onAsk={setActiveAsk}
                  onJoinMeeting={(bk) => joinMeeting(bk.id, bk.meeting_room!, bk.tutor_name || "Eğitmen", bk.client_name || "Öğrenci")}
                />
              ))}
            </>
          )}
        </div>
      </div>

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
    </DashboardShell>
  );
}
