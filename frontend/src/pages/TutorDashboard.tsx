import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { TUTOR_NAV } from "@/lib/nav";
import { Avatar } from "@/components/Avatar";
import { CancelModal } from "@/components/CancelModal";

import { useMeetingStore } from "@/store/meetingStore";
import { useBookingAction, useBookings } from "@/hooks/useBookings";
import { useEarnings } from "@/hooks/usePayments";
import { PaymentBadge } from "@/components/PaymentBadge";
import { BookingStatus, type BookingOut } from "@/types";
import { ROUTES } from "@/lib/routes";
import { formatRange } from "@/lib/datetime";
import { formatTRY, parseMoney } from "@/lib/money";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLE } from "@/lib/bookingStatus";
import { isLessonJoinable } from "@/lib/lesson";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

/* ─── stat box ───────────────────────────────────────── */

type Tone = "amber" | "indigo" | "emerald" | "slate";

const TONE: Record<Tone, { num: string; bg: string; ring: string }> = {
  amber:   { num: "text-amber-600",   bg: "bg-amber-50",   ring: "ring-amber-100"   },
  indigo:  { num: "text-indigo-600",  bg: "bg-indigo-50",  ring: "ring-indigo-100"  },
  emerald: { num: "text-emerald-600", bg: "bg-emerald-50", ring: "ring-emerald-100" },
  slate:   { num: "text-slate-700",   bg: "bg-slate-50",   ring: "ring-slate-100"   },
};

function StatBox({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: Tone;
  icon: string;
}) {
  const cls = TONE[tone];
  return (
    <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 dark:bg-slate-800 dark:ring-slate-700 ${cls.ring}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {label}
          </p>
          <p className={`mt-2 text-3xl font-bold ${cls.num}`}>{value}</p>
        </div>
        <span className={`rounded-xl p-2.5 text-lg ${cls.bg}`}>{icon}</span>
      </div>
    </div>
  );
}

/* ─── booking card ───────────────────────────────────── */

function BookingCard({ booking, onJoinMeeting }: { booking: BookingOut; onJoinMeeting: (booking: BookingOut) => void }) {
  const accept   = useBookingAction("accept");
  const reject   = useBookingAction("reject");
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

  const isPending  = booking.status === BookingStatus.PENDING;
  const isAccepted = booking.status === BookingStatus.ACCEPTED;

  return (
    <div
      className={`flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 sm:flex-row sm:items-center sm:justify-between dark:bg-slate-800 ${
        isPending
          ? "ring-amber-200 dark:ring-amber-700/40"
          : isAccepted
          ? "ring-indigo-100 dark:ring-indigo-700/30"
          : "ring-slate-100 dark:ring-slate-700"
      }`}
    >
      <Link
        to={ROUTES.studentProfile(booking.client_id)}
        className="flex min-w-0 items-start gap-3 transition hover:opacity-80"
      >
        <Avatar name={clientName} avatar_url={booking.client_avatar_url} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400">
            {clientName}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {formatRange(booking.start_at, booking.end_at)}
            {price !== null && ` · ${formatTRY(booking.price)}`}
          </p>
          {booking.notes && (
            <p className="mt-1.5 line-clamp-2 text-xs italic text-slate-400 dark:text-slate-500">
              "{booking.notes}"
            </p>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-2">
        <Link
          to={ROUTES.lesson(booking.id)}
          className="text-xs font-semibold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400"
        >
          Detay →
        </Link>
        {isPending ? (
          <>
            <button
              disabled={busy}
              onClick={() => run(accept, "Ders talebi kabul edildi.")}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {accept.isPending ? "…" : "Kabul Et"}
            </button>
            <button
              disabled={busy}
              onClick={() => run(reject, "Ders talebi reddedildi.")}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-red-900/20"
            >
              {reject.isPending ? "…" : "Reddet"}
            </button>
          </>
        ) : isAccepted ? (
          <>
            {booking.meeting_room && (
              isLessonJoinable(booking.start_at, booking.end_at) ? (
                <button
                  onClick={() => onJoinMeeting(booking)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
                >
                  🎥 Derse Katıl
                </button>
              ) : (
                <span
                  title="Canlı ders, başlangıçtan 15 dk önce açılır."
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400 dark:bg-slate-700 dark:text-slate-500"
                >
                  🎥 Ders saatinde açılır
                </span>
              )
            )}
            <button
              disabled={busy}
              onClick={() => run(complete, "Ders tamamlandı olarak işaretlendi.")}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {complete.isPending ? "…" : "Tamamla"}
            </button>
            <button
              disabled={busy}
              onClick={() => setShowCancel(true)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700"
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

/* ─── section ────────────────────────────────────────── */

function BookingSection({
  title,
  hint,
  bookings,
  alert,
  onJoinMeeting,
}: {
  title: string;
  hint?: string;
  bookings: BookingOut[];
  alert?: boolean;
  onJoinMeeting: (booking: BookingOut) => void;
}) {
  if (bookings.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {title}
        </h2>
        <span
          className={`flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-bold text-white ${
            alert ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600"
          }`}
        >
          {bookings.length}
        </span>
        {alert && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
            Aksiyon bekleniyor
          </span>
        )}
      </div>
      {hint && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      )}
      <div className="mt-3 space-y-3">
        {bookings.map((b) => (
          <BookingCard key={b.id} booking={b} onJoinMeeting={onJoinMeeting} />
        ))}
      </div>
    </section>
  );
}

/* ─── page ───────────────────────────────────────────── */

export default function TutorDashboard() {
  const { data, isLoading, isError, error } = useBookings({ limit: 100 });
  const { data: earnings } = useEarnings();
  const { joinMeeting } = useMeetingStore();

  const groups = useMemo(() => {
    const pending: BookingOut[] = [];
    const accepted: BookingOut[] = [];
    const history: BookingOut[] = [];
    for (const b of data ?? []) {
      if (b.status === BookingStatus.PENDING) pending.push(b);
      else if (b.status === BookingStatus.ACCEPTED) accepted.push(b);
      else history.push(b);
    }
    return { pending, accepted, history };
  }, [data]);

  const completedCount = useMemo(
    () => groups.history.filter((b) => b.status === BookingStatus.COMPLETED).length,
    [groups.history]
  );

  return (
    <DashboardShell title="Eğitmen Paneli" navItems={TUTOR_NAV}>
      <div className="mx-auto max-w-3xl space-y-6 pb-12">
        {isLoading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-800/30">
            <span>⚠</span>
            {getErrorMessage(error, "Ders talepleri yüklenemedi.")}
          </div>
        ) : (data ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center dark:border-slate-700">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">
              📭
            </div>
            <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
              Henüz rezervasyon talebin yok
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              İlanın yayında olduğunda öğrenciler seni bulacak.
            </p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <StatBox label="Bekleyen" value={groups.pending.length} tone="amber" icon="⏳" />
              <StatBox label="Onaylı" value={groups.accepted.length} tone="indigo" icon="✅" />
              <StatBox label="Tamamlanan" value={completedCount} tone="emerald" icon="🎓" />
            </div>

            {/* Kazanç özeti (escrow) */}
            {earnings && (
              <div className="flex items-center justify-between rounded-2xl bg-gradient-to-br from-emerald-50 to-white px-5 py-4 ring-1 ring-emerald-100 dark:from-emerald-900/10 dark:to-slate-800 dark:ring-emerald-800/30">
                <div>
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    Toplam kazancın (net)
                  </p>
                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                    {formatTRY(earnings.released)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Emanette bekleyen
                  </p>
                  <p className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                    {formatTRY(earnings.pending)}
                  </p>
                </div>
              </div>
            )}

            {/* Alert banner for pending */}
            {groups.pending.length > 0 && (
              <div className="flex items-center gap-3 rounded-2xl bg-amber-50 px-5 py-3.5 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-700/30">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  <span className="font-semibold">{groups.pending.length} yeni talep</span> yanıtını bekliyor.
                </p>
              </div>
            )}

            <BookingSection
              title="Bekleyen Aksiyonlar"
              hint="Yanıtını bekleyen yeni talepler."
              bookings={groups.pending}
              alert
              onJoinMeeting={(bk) => joinMeeting(bk.meeting_room!, bk.tutor_name || "Eğitmen", bk.client_name || "Öğrenci")}
            />
            <BookingSection
              title="Onaylı Dersler"
              hint="Yaklaşan dersler — bittiğinde tamamlandı olarak işaretle."
              bookings={groups.accepted}
              onJoinMeeting={(bk) => joinMeeting(bk.meeting_room!, bk.tutor_name || "Eğitmen", bk.client_name || "Öğrenci")}
            />
            <BookingSection title="Geçmiş" bookings={groups.history} onJoinMeeting={(bk) => joinMeeting(bk.meeting_room!, bk.tutor_name || "Eğitmen", bk.client_name || "Öğrenci")} />
          </>
        )}
      </div>
    </DashboardShell>
  );
}
