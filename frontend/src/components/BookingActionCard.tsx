import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking, useBookingAction, useCancelBooking } from "@/hooks/useBookings";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatRange } from "@/lib/datetime";
import { formatTRY } from "@/lib/money";
import { toast } from "@/store/toastStore";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { ReservationStatusBadge } from "@/components/reservation/ReservationStatusBadge";
import { DERS_ANAHTARI } from "@/lib/bookingStatus";
import { BookingStatus, ROLE_IDS, type BookingCardMetadata } from "@/types";

interface BookingActionCardProps {
  meta: BookingCardMetadata;
}

export function BookingActionCard({ meta }: BookingActionCardProps) {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const { data: liveBooking } = useBooking(meta.booking_id);
  const isTutor = user?.role_id === ROLE_IDS.TUTOR;
  
  const currentStatus = liveBooking?.status ?? meta.status;
  const isPending = currentStatus === BookingStatus.PENDING;
  
  const accept = useBookingAction("accept");
  const reject = useBookingAction("reject");
  const cancel = useCancelBooking();
  const [acted, setActed] = useState(false);

  const durum = DERS_ANAHTARI[currentStatus] ?? "BEKLIYOR";

  const handleAccept = () => {
    setActed(true);
    accept.mutate(meta.booking_id, {
      onError: (err) => {
        setActed(false);
        toast.error(getErrorMessage(err, "Onaylama işlemi başarısız."));
      }
    });
  };

  const handleReject = () => {
    setActed(true);
    reject.mutate(meta.booking_id, {
      onError: (err) => {
        setActed(false);
        toast.error(getErrorMessage(err, "Reddetme işlemi başarısız."));
      }
    });
  };

  const handleCancel = () => {
    setActed(true);
    cancel.mutate({ id: meta.booking_id }, {
      onError: (err) => {
        setActed(false);
        toast.error(getErrorMessage(err, "İptal işlemi başarısız."));
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-slate-100 ">
      {/* Üst bant: gradient */}
      <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

      <div className="p-4">
        {/* Başlık + Durum */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-base ">
              📚
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900 ">
                Ders Talebi
              </p>
              {meta.client_name && (
                <p className="text-xs text-slate-500 ">
                  {meta.client_name}
                </p>
              )}
            </div>
          </div>
          <ReservationStatusBadge durum={durum} />
        </div>

        {/* Detaylar */}
        <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 ">
          <div className="flex items-center gap-2 text-sm text-slate-600 ">
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4 shrink-0 text-slate-400"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Z"
                clipRule="evenodd"
              />
            </svg>
            <span>{formatRange(meta.start_at, meta.end_at)}</span>
          </div>

          {meta.price && (
            <div className="flex items-center gap-2 text-sm text-slate-600 ">
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4 shrink-0 text-slate-400"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M1 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4Zm12 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM4 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm13-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="font-semibold text-slate-900 ">
                {formatTRY(meta.price)}
              </span>
            </div>
          )}

          {meta.mode && (
            <div className="flex items-center gap-2 text-sm text-slate-600 ">
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4 shrink-0 text-slate-400"
                aria-hidden
              >
                <path d="M13 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM14 15a4 4 0 0 0-8 0v3h8v-3ZM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />
              </svg>
              <span>
                {meta.mode === "ONLINE" ? "Online Ders" : "Yüz Yüze Ders"}
              </span>
            </div>
          )}

          {meta.notes && (
            <div className="flex items-start gap-2 text-sm text-slate-500 ">
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v11.75A2.75 2.75 0 0 0 16.75 18h-12A2.75 2.75 0 0 1 2 15.25V3.5Zm3.75 7a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5Zm0-4a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5Z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="line-clamp-2 italic">&ldquo;{meta.notes}&rdquo;</span>
            </div>
          )}
        </div>

        {/* Sadece Eğitmen ve Bekliyor durumunda Aksiyonlar */}
        {isTutor && isPending && !acted && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleReject}
              disabled={reject.isPending || accept.isPending}
              className="flex-1 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 hover:text-slate-900 active:scale-95 disabled:pointer-events-none disabled:opacity-50 "
            >
              Reddet
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={accept.isPending || reject.isPending}
              className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              Onayla
            </button>
          </div>
        )}

        {/* Öğrenci ve Bekliyor durumunda İptal Butonu */}
        {!isTutor && isPending && !acted && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancel.isPending}
              className="flex-1 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-red-600 shadow-sm ring-1 ring-inset ring-red-200 transition hover:bg-red-50 active:scale-95 disabled:pointer-events-none disabled:opacity-50 "
            >
              Talebi İptal Et
            </button>
          </div>
        )}

        {/* Eylem yapıldı, bekliyor */}
        {isPending && acted && (
          <div className="mt-4 flex justify-center rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500 ">
            {accept.isPending || reject.isPending || cancel.isPending
              ? "İşleniyor…"
              : accept.isSuccess
                ? "Ders talebi onaylandı ✓"
                : reject.isSuccess
                  ? "Ders talebi reddedildi"
                  : cancel.isSuccess
                    ? "Ders talebi iptal edildi"
                    : "İşlem tamamlandı"}
          </div>
        )}

        {/* Detay linki */}
        <button
          type="button"
          onClick={() => navigate(ROUTES.lesson(meta.booking_id))}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl py-2 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 "
        >
          Detayları gör
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5 10a.75.75 0 0 1 .75-.75h6.638L10.23 7.29a.75.75 0 1 1 1.04-1.08l3.5 3.25a.75.75 0 0 1 0 1.08l-3.5 3.25a.75.75 0 1 1-1.04-1.08l2.158-1.96H5.75A.75.75 0 0 1 5 10Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
