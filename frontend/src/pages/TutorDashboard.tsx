import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { canPromiseEscrow } from "@/lib/paymentAvailability";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { TUTOR_NAV } from "@/lib/nav";
import { Avatar } from "@/components/Avatar";
import { CancelModal } from "@/components/CancelModal";
import { ProfileCompleteness } from "@/components/ProfileCompleteness";

import { useMeetingStore } from "@/store/meetingStore";
import { useBookingAction, useBookings } from "@/hooks/useBookings";
import { useEarnings } from "@/hooks/usePayments";
import { useMyTutorProfile } from "@/hooks/useTutorProfile";
import { useMyPayout } from "@/hooks/usePayout";
import { PaymentBadge } from "@/components/PaymentBadge";
import { BookingStatus, TutorStatus, type BookingOut } from "@/types";
import { ROUTES } from "@/lib/routes";
import { formatRange } from "@/lib/datetime";
import { formatTRY, parseMoney } from "@/lib/money";
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_STYLE } from "@/lib/bookingStatus";
import { isLessonJoinable } from "@/lib/lesson";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ADSIZ_UYE } from "@/lib/roles";

/* ─── stat box ───────────────────────────────────────── */

/**
 * Sayı kutusu — nötr. Eskiden dört tonlu bir renk sözlüğü ve emoji ikonu
 * (⏳ ✅ 🎓) taşıyordu; panoda aynı anda beş renk ailesi ve üç ayrı ikon dili
 * dönüyordu. Renk aksiyona ayrıldı, sayı kutusu okunacak bir sayıdır.
 */
function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
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
      className={`flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 sm:flex-row sm:items-center sm:justify-between ${
        isPending
          ? "ring-amber-200 "
          : isAccepted
          ? "ring-marka/20 "
          : "ring-slate-100 "
      }`}
    >
      <Link
        to={ROUTES.uyeProfili(booking.client_id)}
        className="flex min-w-0 items-start gap-3 transition hover:opacity-80"
      >
        <Avatar name={clientName} avatar_url={booking.client_avatar_url} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 hover:text-marka-metin ">
            {clientName}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 ">
            {formatRange(booking.start_at, booking.end_at)}
            {price !== null && ` · ${formatTRY(booking.price)}`}
          </p>
          {booking.notes && (
            <p className="mt-1.5 line-clamp-2 text-xs italic text-slate-400 ">
              "{booking.notes}"
            </p>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-2">
        <Link
          to={ROUTES.lesson(booking.id)}
          className="text-xs font-semibold text-marka-metin transition hover:text-marka-metin-hover "
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
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 "
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
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400 "
                >
                  🎥 Ders saatinde açılır
                </span>
              )
            )}
            <button
              disabled={busy}
              onClick={() => run(complete, "Ders tamamlandı olarak işaretlendi.")}
              className="rounded-xl bg-marka px-4 py-2 text-sm font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {complete.isPending ? "…" : "Tamamla"}
            </button>
            <button
              disabled={busy}
              onClick={() => setShowCancel(true)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 "
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
        <h2 className="text-base font-semibold text-slate-900 ">
          {title}
        </h2>
        <span
          className={`flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-bold text-white ${
            alert ? "bg-amber-500" : "bg-slate-300 "
          }`}
        >
          {bookings.length}
        </span>
        {alert && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 ">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
            Aksiyon bekleniyor
          </span>
        )}
      </div>
      {hint && (
        <p className="mt-1 text-xs text-slate-500 ">{hint}</p>
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
  const { data: paymentAvailability } = usePaymentAvailability();
  const escrowWording = canPromiseEscrow(paymentAvailability, "tutor_marketplace");
  const { data, isLoading, isError, error } = useBookings({ limit: 100 });
  const { data: earnings } = useEarnings();
  const { data: payout } = useMyPayout();
  const { data: ilan } = useMyTutorProfile();
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

  // Üç bölüm de aynı çağrıyı yapıyordu; satır birebir üç kez kopyalanmıştı.
  const derseKatil = (bk: BookingOut) =>
    joinMeeting(
      bk.id,
      bk.meeting_room!,
      bk.tutor_name || "Eğitmen",
      bk.client_name || ADSIZ_UYE
    );

  const completedCount = useMemo(
    () => groups.history.filter((b) => b.status === BookingStatus.COMPLETED).length,
    [groups.history]
  );

  return (
    <DashboardShell title="Pano" navItems={TUTOR_NAV} genislik="orta">
      <div className="space-y-6 pb-12">
        {/*
          Taslak ilan panelin en üstünde durur. Eğitmen kayıt olup akışı yarıda
          bıraktığında, geri döndüğünde kaldığı yeri bulabileceği tek yer
          burasıydı — eskiden hiçbir yerden görünmüyordu.
        */}
        {ilan?.status === TutorStatus.DRAFT && (
          <Link
            to={ROUTES.tutorOnboarding}
            className="flex items-center justify-between gap-4 rounded-2xl bg-marka-soft px-5 py-4 ring-1 ring-marka/20 transition hover:bg-marka-line/70"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-marka-soft-fg">
                İlanın henüz yayında değil
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-marka-metin-hover">
                Kaldığın yerden devam et; tamamlayınca öğrenciler seni aramada
                bulmaya başlar.
              </p>
            </div>
            <span className="shrink-0 rounded-xl bg-marka px-4 py-2.5 text-sm font-semibold text-marka-fg">
              Devam et
            </span>
          </Link>
        )}

        {/* Müsaitlik ve belge ilan sihirbazından çıkarıldı (5 Eyl 2026); ikisi
            de ilan yayına girdikten SONRA burada tamamlanıyor. Gösterge
            olmadan eğitmenin bunları göreceği hiçbir yer kalmıyordu. */}
        {ilan && <ProfileCompleteness tutor={ilan} />}

        {isLoading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 " />
              ))}
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 " />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-3 rounded-2xl bg-red-50 px-5 py-4 text-sm text-red-700 ring-1 ring-red-100 ">
            <span>⚠</span>
            {getErrorMessage(error, "Ders talepleri yüklenemedi.")}
          </div>
        ) : (data ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-20 text-center ">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl ">
              📭
            </div>
            <p className="mt-4 text-sm font-medium text-slate-700 ">
              Henüz rezervasyon talebin yok
            </p>
            <p className="mt-1 text-xs text-slate-400 ">
              İlanın yayında olduğunda öğrenciler seni bulacak.
            </p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <StatBox label="Bekleyen" value={groups.pending.length} />
              <StatBox label="Onaylı" value={groups.accepted.length} />
              <StatBox label="Tamamlanan" value={completedCount} />
            </div>

            {/* Kazanç özeti (escrow) — tıklayınca Bakiyem (işlem dökümü) açılır.
                Eskiden emerald gradient bir kartti ve panodaki tek gradient
                öğeydi; çevresindeki hiçbir şeye benzemiyordu. Zemin nötre
                indi, rakam koyu; yeşil yalnız küçük bir vurgu. */}
            {earnings && (
              <Link
                to={ROUTES.balance}
                className="flex items-center justify-between gap-4 rounded-2xl bg-white px-5 py-4 ring-1 ring-slate-200 transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">
                    Toplam kazancın (net)
                  </p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {formatTRY(earnings.released)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Bakiyem &amp; işlem dökümü →
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-slate-500">
                    {/* "Emanet" ifadesi ancak kol açıkken (yani alt üye işyeri
                        modeli çalışırken) doğrudur; kapalıyken nötr etiket. */}
                    {escrowWording ? "Emanette bekleyen" : "Bekleyen"}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-700">
                    {formatTRY(earnings.pending)}
                  </p>
                </div>
              </Link>
            )}

            {/* Payout durumu: kurulmamışsa kurmaya yönlendir, kuruluysa IBAN'ı göster */}
            {payout && payout.payout_status === "ACTIVE" ? (
              <p className="px-1 text-xs text-slate-500 ">
                Ödemeler şu hesaba yatar:{" "}
                <span className="font-mono text-slate-700 ">
                  {payout.iban_masked}
                </span>
              </p>
            ) : payout ? (
              <Link
                // Ödeme bilgileri Ayarlar'ın bir sekmesi; eskiden "Profil"e
                // yolluyordu ve kullanıcı doğru sekmeyi kendi arıyordu.
                to={`${ROUTES.settings}?bolum=odeme`}
                className="flex items-center justify-between gap-3 rounded-2xl bg-marka-soft px-5 py-3.5 ring-1 ring-marka/20 transition hover:bg-marka-line "
              >
                <p className="text-sm font-medium text-marka-soft-fg ">
                  💳 Ödemeleri alabilmek için <strong>ödeme bilgilerini</strong> ekle (IBAN + kimlik).
                </p>
                <span className="shrink-0 text-sm font-bold text-marka-metin ">
                  Ekle →
                </span>
              </Link>
            ) : null}

            {/* Bekleyen talep uyarı şeridi KALDIRILDI: aynı sayı üç ayrı
                yerde duruyordu — "Bekleyen" kutusu, bu şerit ve "Bekleyen
                Aksiyonlar" bölümünün rozeti. Bölümün kendi nabzı (alert)
                uyarıyı zaten taşıyor. */}
            <BookingSection
              title="Bekleyen Aksiyonlar"
              hint="Yanıtını bekleyen yeni talepler."
              bookings={groups.pending}
              alert
              onJoinMeeting={derseKatil}
            />
            <BookingSection
              title="Onaylı Dersler"
              hint="Yaklaşan dersler, bittiğinde tamamlandı olarak işaretle."
              bookings={groups.accepted}
              onJoinMeeting={derseKatil}
            />
            <BookingSection title="Geçmiş" bookings={groups.history} onJoinMeeting={derseKatil} />
          </>
        )}
      </div>
    </DashboardShell>
  );
}
