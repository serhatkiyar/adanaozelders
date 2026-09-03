import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { ReservationRow } from "@/components/reservation/ReservationRow";
import { toReservationItem } from "@/lib/reservationModel";

import { useMeetingStore } from "@/store/meetingStore";
import { useBookings } from "@/hooks/useBookings";
import { usePayBooking } from "@/hooks/usePayments";
import { PaymentConsentNote } from "@/components/LegalConsent";
import { BookingStatus, PaymentStatus, type BookingOut } from "@/types";
import { formatTRY } from "@/lib/money";
import { isLessonJoinable } from "@/lib/lesson";
import { PaymentBranchNotice } from "@/components/PaymentBranchNotice";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { isBranchOpen } from "@/lib/paymentAvailability";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

/* ─── ortak buton sınıfları (sakin / nötr palet) ────────── */

const PRIMARY_BTN =
  "rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ";

/* ─── ikonlar ────────────────────────────────────────── */

const PAY_CLOSED_NOTICE_ID = "tutor-payment-closed-notice";

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
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
          {needsPayment &&
            (payOpen ? (
              <button onClick={handlePay} disabled={payMutation.isPending} className={PRIMARY_BTN}>
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
                className="text-sm font-medium text-slate-500 "
              >
                Ödeme yolu şu an kapalı
              </span>
            ))}

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
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400 "
              >
                <VideoIcon />
                Ders saatinde açılır
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

/* ─── içerik (Rezervasyonlar sayfasının "Dersler" sekmesi) ── */

export function StudentBookingsContent() {
  const { data, isLoading, isError, error } = useBookings({ limit: 100 });
  const { joinMeeting } = useMeetingStore();
  const [filter, setFilter]             = useState<Filter>("ACTIVE");

  const { data: availability } = usePaymentAvailability();
  const payOpen = isBranchOpen(availability, "tutor_marketplace");

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

  // Şerit yalnız gerçekten ödenmeyi bekleyen ders varsa gösterilir; aksi halde
  // ilgisiz bir uyarı olurdu.
  const anyNeedsPayment = useMemo(
    () =>
      filtered.some(
        (b) =>
          b.status === BookingStatus.ACCEPTED &&
          b.payment?.status === PaymentStatus.PENDING,
      ),
    [filtered],
  );

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
                  ? "bg-slate-900 text-white "
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 "
              }`}
            >
              {f.label}
              {!isLoading && count > 0 && (
                <span
                  className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                    active
                      ? "bg-white/20 text-current "
                      : "bg-slate-200 text-slate-600 "
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
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 " />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl bg-rose-50 px-5 py-4 text-sm text-rose-700 ring-1 ring-rose-100 ">
          {getErrorMessage(error, "Ders talepleri yüklenemedi.")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 py-20 text-center ">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ">
            <CalendarIcon />
          </div>
          <p className="mt-4 text-sm font-medium text-slate-700 ">
            {(data ?? []).length === 0
              ? "Henüz rezervasyonun yok"
              : "Bu filtreye uyan rezervasyon yok"}
          </p>
          <p className="mt-1 text-xs text-slate-400 ">
            {(data ?? []).length === 0
              ? "Bir eğitmen seç ve ders planla."
              : "Farklı bir filtre dene."}
          </p>
          {(data ?? []).length === 0 ? (
            <Link
              to={ROUTES.tutors}
              className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 "
            >
              Eğitmenleri keşfet
            </Link>
          ) : (
            filter !== "ALL" && (
              <button
                onClick={() => setFilter("ALL")}
                className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 "
              >
                Tümünü göster
              </button>
            )
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400 ">
            {filtered.length} rezervasyon listeleniyor
          </p>
          {/* Sebep bir kez, liste başında: satırlarda yalnız nötr bir durum
              metni var (renk = istisna disiplini). */}
          {!payOpen && anyNeedsPayment && (
            <PaymentBranchNotice
              branch="tutor_marketplace"
              id={PAY_CLOSED_NOTICE_ID}
            />
          )}
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 ">
            {filtered.map((b) => (
              <BookingRow
                key={b.id}
                booking={b}
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

    </div>
  );
}
