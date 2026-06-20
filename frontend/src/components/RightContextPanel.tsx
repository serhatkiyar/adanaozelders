import { useBooking } from "@/hooks/useBookings";
import { formatRange } from "@/lib/datetime";
import { formatTRY } from "@/lib/money";
import { Avatar } from "./Avatar";
import { BookingStatus, ROLE_IDS } from "@/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const STATUS_CONFIG: Record<
  BookingStatus,
  { label: string; color: string; icon: string }
> = {
  [BookingStatus.PENDING]: {
    label: "Onay Bekliyor",
    color: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
    icon: "⏳",
  },
  [BookingStatus.ACCEPTED]: {
    label: "Onaylandı",
    color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
    icon: "✅",
  },
  [BookingStatus.REJECTED]: {
    label: "Reddedildi",
    color: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
    icon: "❌",
  },
  [BookingStatus.CANCELLED]: {
    label: "İptal Edildi",
    color: "bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-300",
    icon: "🚫",
  },
  [BookingStatus.COMPLETED]: {
    label: "Tamamlandı",
    color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300",
    icon: "🎓",
  },
};

export function RightContextPanel({ bookingId }: { bookingId: number }) {
  const { data: booking, isLoading } = useBooking(bookingId);
  const { data: user } = useCurrentUser();
  const isTutor = user?.role_id === ROLE_IDS.TUTOR;

  if (isLoading) {
    return (
      <aside className="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-slate-50 px-5 py-6 dark:border-slate-800 dark:bg-slate-900/50 xl:flex">
        <div className="flex animate-pulse space-x-4">
          <div className="flex-1 space-y-6 py-1">
            <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700"></div>
            <div className="space-y-3">
              <div className="h-4 rounded bg-slate-200 dark:bg-slate-700"></div>
              <div className="h-4 w-5/6 rounded bg-slate-200 dark:bg-slate-700"></div>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  if (!booking) return null;

  const statusConf = STATUS_CONFIG[booking.status] ?? STATUS_CONFIG[BookingStatus.PENDING];
  const counterpartyName = isTutor ? booking.client_name : booking.tutor_name;
  const counterpartyAvatar = isTutor ? booking.client_avatar_url : booking.tutor_avatar_url;

  return (
    <aside className="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-slate-50 px-5 py-6 dark:border-slate-800 dark:bg-slate-900/50 xl:flex">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
        Ders Detayları
      </h3>

      {/* Profil Özeti */}
      <div className="mt-5 flex items-center gap-3">
        <Avatar name={counterpartyName ?? "?"} avatar_url={counterpartyAvatar} size="lg" />
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {counterpartyName}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isTutor ? "Öğrenci" : "Eğitmen"}
          </p>
        </div>
      </div>

      <div className="my-6 border-b border-slate-200 dark:border-slate-800" />

      {/* Durum & Zaman */}
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Durum
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusConf.color}`}
            >
              <span>{statusConf.icon}</span>
              {statusConf.label}
            </span>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Zaman
          </p>
          <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
            {formatRange(booking.start_at, booking.end_at)}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Biçim
          </p>
          <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
            {booking.mode === "ONLINE" ? "💻 Online Ders" : "📍 Yüz Yüze Ders"}
          </p>
          {booking.location && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {booking.location}
            </p>
          )}
        </div>
      </div>

      <div className="my-6 border-b border-slate-200 dark:border-slate-800" />

      {/* Ücret Özeti */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Ödeme Detayı
        </p>
        <div className="mt-3 space-y-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600 dark:text-slate-300">Ders Ücreti</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {booking.price ? formatTRY(booking.price) : "Belirtilmedi"}
            </span>
          </div>
          {booking.price && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm font-semibold dark:border-slate-700">
              <span className="text-slate-900 dark:text-white">Toplam</span>
              <span className="text-indigo-600 dark:text-indigo-400">
                {formatTRY(booking.price)}
              </span>
            </div>
          )}
        </div>
      </div>

      {booking.notes && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Öğrenci Notu
          </p>
          <div className="mt-2 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-200">
            <p className="italic">&ldquo;{booking.notes}&rdquo;</p>
          </div>
        </div>
      )}
    </aside>
  );
}
