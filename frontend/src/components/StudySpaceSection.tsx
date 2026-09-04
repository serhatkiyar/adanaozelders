import { PaymentBranchNotice } from "@/components/PaymentBranchNotice";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { isBranchOpen } from "@/lib/paymentAvailability";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStudyQuote, useReserveStudy, usePayStudy } from "@/hooks/useStudy";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/authStore";
import { formatTRY } from "@/lib/money";
import { istanbulInputToIso } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROUTES } from "@/lib/routes";
import { PaymentConsentNote } from "@/components/LegalConsent";
import { DateStrip, buildUpcomingDays } from "@/components/booking/DateStrip";
import { TimeStepper } from "@/components/booking/TimeStepper";
import { ROLE_IDS, type LibraryDetailOut } from "@/types";

const NOTICE_ID = "study-payment-closed-notice";

const NEXT_14_DAYS = buildUpcomingDays();

// Çalışma alanı için süre seçenekleri (dakika).
const DURATIONS = [
  { label: "1 saat", value: 60 },
  { label: "2 saat", value: 120 },
  { label: "3 saat", value: 180 },
  { label: "4 saat", value: 240 },
  { label: "6 saat", value: 360 },
  { label: "8 saat", value: 480 },
];

function hhmm(d: Date): string {
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

export function StudySpaceSection({ library }: { library: LibraryDetailOut }) {
  const { data: availability } = usePaymentAvailability();
  const payOpen = isBranchOpen(availability, "library_marketplace");
  const token = useAuthStore((s) => s.token);
  const { data: user } = useCurrentUser();
  const isClient = user?.role_id === ROLE_IDS.CLIENT;

  const [date, setDate] = useState(NEXT_14_DAYS[0].value);
  const [start, setStart] = useState("09:00");
  const [duration, setDuration] = useState(180);

  // Başlangıç Türkiye duvar-saati kabul edilir (+03:00, backend de UTC+3); süreden
  // bitiş hesaplanır (gece yarısını da doğru aşar). Tarayıcı tz'inden bağımsız.
  const startDate = useMemo(() => {
    if (!date || !start) return null;
    const d = new Date(istanbulInputToIso(`${date}T${start}`));
    return isNaN(d.getTime()) ? null : d;
  }, [date, start]);
  const endDate = useMemo(
    () => (startDate ? new Date(startDate.getTime() + duration * 60_000) : null),
    [startDate, duration]
  );

  const startsAt = startDate ? startDate.toISOString() : null;
  const endsAt = endDate ? endDate.toISOString() : null;

  const { data: quote, isFetching, isError, error } = useStudyQuote(
    library.id,
    startsAt,
    endsAt
  );
  const reserve = useReserveStudy();
  const pay = usePayStudy();
  const busy = reserve.isPending || pay.isPending;

  // Çalışma alanı sunulmuyorsa bölümü gösterme.
  if (library.study_hourly_price == null || !library.capacity) return null;

  const doReserveAndPay = async () => {
    if (!startsAt || !endsAt) return;
    try {
      const res = await reserve.mutateAsync({ libraryId: library.id, startsAt, endsAt });
      const result = await pay.mutateAsync(res.id);
      if (result.redirect_url) {
        window.location.href = result.redirect_url;
        return;
      }
      toast.success("Rezervasyonun alındı! Giriş kodun Rezervasyonlarım'da.");
    } catch (e) {
      toast.error(getErrorMessage(e, "Rezervasyon/ödeme başarısız."));
    }
  };

  const canReserve = quote?.available && isClient && !busy;

  return (
    <div className="space-y-5">
      {/* Fiyat + bilgilendirme */}
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-indigo-50 px-4 py-3 ">
        <p className="text-xs leading-relaxed text-indigo-700 ">
          Tarih ve saat aralığı seç, online öde; kütüphanede QR kodunu okutarak giriş yap.
          {library.capacity ? ` ${library.capacity} kişilik kapasite.` : ""}
        </p>
        <span className="shrink-0 text-sm font-bold text-indigo-700 ">
          {formatTRY(library.study_hourly_price)}
          <span className="font-medium text-indigo-500 ">/saat</span>
        </span>
      </div>

      {/* Tarih */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
          Tarih
        </p>
        <DateStrip value={date} onChange={setDate} days={NEXT_14_DAYS} />
      </div>

      {/* Başlangıç saati */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
          Başlangıç Saati
        </p>
        <TimeStepper value={start} onChange={setStart} />
      </div>

      {/* Süre */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
          Süre
        </p>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => setDuration(d.value)}
              className={`rounded-xl px-3.5 py-2 text-sm font-medium transition active:scale-95 ${
                duration === d.value
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 "
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        {startDate && endDate && (
          <p className="mt-2 text-xs text-slate-500 ">
            {hhmm(startDate)} – {hhmm(endDate)}
          </p>
        )}
      </div>

      {/* Fiyat / uygunluk özeti */}
      <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {isError ? (
            <span className="text-rose-500">{getErrorMessage(error, "Fiyat alınamadı")}</span>
          ) : quote ? (
            quote.available ? (
              <>
                <span className="font-semibold text-slate-900 ">
                  {quote.hours} saat · {formatTRY(quote.amount)}
                </span>
                <span className="ml-2 text-xs text-emerald-600">
                  ✓ {quote.remaining} yer müsait
                </span>
              </>
            ) : (
              <span className="text-rose-500">{quote.reason ?? "Seçilen saat uygun değil"}</span>
            )
          ) : (
            <span className="text-slate-400">{isFetching ? "Hesaplanıyor…" : "Saat seçin"}</span>
          )}
        </div>

        {!token ? (
          <Link
            to={ROUTES.login}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Giriş yap & rezerve et
          </Link>
        ) : !payOpen ? (
          // Giriş yapıp dönünce devre dışı buton bulmasın.
          <span
            aria-describedby={NOTICE_ID}
            className="rounded-xl bg-slate-100 px-4 py-2 text-center text-sm font-semibold text-slate-500 "
          >
            Ödeme kapalı
          </span>
        ) : (
          <button
            onClick={doReserveAndPay}
            disabled={!canReserve}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "İşleniyor…" : "Rezerve et & Öde"}
          </button>
        )}
      </div>
      {!payOpen && <PaymentBranchNotice branch="library_marketplace" id={NOTICE_ID} />}
      {payOpen && <PaymentConsentNote />}
      {token && !isClient && (
        <p className="text-xs text-slate-400">Yalnız öğrenci hesapları rezervasyon yapabilir.</p>
      )}
    </div>
  );
}
