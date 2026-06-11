import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStudyQuote, useReserveStudy, usePayStudy } from "@/hooks/useStudy";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/authStore";
import { formatTRY } from "@/lib/money";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROUTES } from "@/lib/routes";
import { PaymentConsentNote } from "@/components/LegalConsent";
import { ROLE_IDS, type LibraryDetailOut } from "@/types";

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 24 saatlik dilim, 30 dk adımlarla (00:00 … 23:30) — tarayıcı yereline bağlı
// AM/PM görünümünden bağımsız, her zaman 24 saat.
const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 ? "30" : "00";
  return `${String(h).padStart(2, "0")}:${m}`;
});

/** "YYYY-MM-DD" + "HH:MM" (yerel) → ISO string. Geçersizse null. */
function toIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function StudySpaceSection({ library }: { library: LibraryDetailOut }) {
  const token = useAuthStore((s) => s.token);
  const { data: user } = useCurrentUser();
  const isClient = user?.role_id === ROLE_IDS.CLIENT;

  const [date, setDate] = useState(todayStr());
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");

  const startsAt = useMemo(() => toIso(date, start), [date, start]);
  const endsAt = useMemo(() => toIso(date, end), [date, end]);

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
      toast.success("Rezervasyonun alındı! QR'ın Biletlerim'de.");
    } catch (e) {
      toast.error(getErrorMessage(e, "Rezervasyon/ödeme başarısız."));
    }
  };

  const canReserve = quote?.available && isClient && !busy;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">
          Çalışma Alanı Rezervasyonu
        </h2>
        <span className="text-sm font-bold text-indigo-600 dark:text-indigo-300">
          {formatTRY(library.study_hourly_price)}/saat
        </span>
      </div>
      <p className="mb-4 mt-1 text-xs text-slate-500 dark:text-slate-400">
        Saat aralığı seç, online öde; kütüphanede QR kodunu okutarak giriş yap.
        {library.capacity ? ` ${library.capacity} kişilik kapasite.` : ""}
      </p>

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Tarih</span>
          <input type="date" value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} className="input" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Başlangıç</span>
          <select
            value={start}
            onChange={(e) => {
              const v = e.target.value;
              setStart(v);
              // Bitiş başlangıçtan sonra kalsın.
              if (end <= v) {
                const next = TIME_OPTIONS.find((t) => t > v);
                if (next) setEnd(next);
              }
            }}
            className="input"
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Bitiş</span>
          <select value={end} onChange={(e) => setEnd(e.target.value)} className="input">
            {TIME_OPTIONS.filter((t) => t > start).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Fiyat / uygunluk */}
      <div className="mt-4 flex flex-col gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {isError ? (
            <span className="text-rose-500">{getErrorMessage(error, "Fiyat alınamadı")}</span>
          ) : quote ? (
            quote.available ? (
              <>
                <span className="font-semibold text-slate-900 dark:text-white">
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
      <PaymentConsentNote className="mt-2" />
      {token && !isClient && (
        <p className="mt-2 text-xs text-slate-400">Yalnız öğrenci hesapları rezervasyon yapabilir.</p>
      )}
    </div>
  );
}
