import { PaymentBranchNotice } from "@/components/PaymentBranchNotice";
import { usePaymentAvailability } from "@/hooks/useFeatureFlags";
import { isBranchOpen } from "@/lib/paymentAvailability";
import { Link, useNavigate } from "react-router-dom";
import { usePublicSessions, useMyRegistrations, useRegisterForSession, usePayRegistration } from "@/hooks/useLibraryExams";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/authStore";
import { formatTRY } from "@/lib/money";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROUTES } from "@/lib/routes";
import { PaymentConsentNote } from "@/components/LegalConsent";
import { ROLE_IDS, type ExamSessionOut, type RegistrationOut } from "@/types";

export function ExamSessionsSection({ libraryId }: { libraryId: number }) {
  const { data: availability } = usePaymentAvailability();
  const payOpen = isBranchOpen(availability, "library_marketplace");
  const token = useAuthStore((s) => s.token);
  const { data: user } = useCurrentUser();
  const isClient = user?.role_id === ROLE_IDS.CLIENT;
  const { data: sessions, isLoading } = usePublicSessions(libraryId);
  const { data: myRegs } = useMyRegistrations();

  // session_id -> benim kaydım (giriş yapmış öğrenci için).
  const bySession = new Map<number, RegistrationOut>();
  (myRegs ?? []).forEach((r) => bySession.set(r.session_id, r));

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />;
  }

  const empty = !sessions || sessions.length === 0;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      <h2 className="mb-1 text-base font-bold text-slate-900 dark:text-white">
        Yaklaşan Deneme Sınavları
      </h2>
      {empty ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 py-10 text-center dark:border-slate-700">
          <div className="text-2xl">🗓️</div>
          <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">
            Yaklaşan deneme sınavı yok
          </p>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            Yeni oturumlar açıldığında burada görünecek.
          </p>
        </div>
      ) : (
        <>
          {payOpen ? (
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Kaydol, online öde; oturum günü kütüphanede QR kodunu okutarak katıl.
            </p>
          ) : (
            // Kol kapalıyken kayıt da alınmaz (backend register ucu da kapılı) —
            // takvim görünür kalır ama satış vaadi verilmez.
            <PaymentBranchNotice branch="library_marketplace" className="mb-4" />
          )}
          <div className="space-y-3">
            {sessions!.map((s) => (
              <ExamSessionRow
                key={s.id}
                session={s}
                registration={bySession.get(s.id)}
                isClient={isClient}
                isLoggedIn={!!token}
              />
            ))}
          </div>
          <PaymentConsentNote className="mt-3" />
        </>
      )}
    </div>
  );
}

function ExamSessionRow({
  session,
  registration,
  isClient,
  isLoggedIn,
}: {
  session: ExamSessionOut;
  registration?: RegistrationOut;
  isClient: boolean;
  isLoggedIn: boolean;
}) {
  const navigate = useNavigate();
  const register = useRegisterForSession();
  const pay = usePayRegistration();
  const busy = register.isPending || pay.isPending;

  const full = session.available <= 0;
  const status = registration?.status;

  const doRegisterAndPay = async () => {
    try {
      const reg = await register.mutateAsync(session.id);
      const result = await pay.mutateAsync(reg.id);
      if (result.redirect_url) {
        window.location.href = result.redirect_url;
        return;
      }
      toast.success("Kaydın ve ödemen alındı! Biletin Biletlerim'de.");
    } catch (e) {
      toast.error(getErrorMessage(e, "Kayıt/ödeme başarısız."));
    }
  };

  const doPay = async () => {
    if (!registration) return;
    try {
      const result = await pay.mutateAsync(registration.id);
      if (result.redirect_url) {
        window.location.href = result.redirect_url;
        return;
      }
      toast.success("Ödeme alındı! Biletin Biletlerim'de.");
    } catch (e) {
      toast.error(getErrorMessage(e, "Ödeme başarısız."));
    }
  };

  const start = new Date(session.starts_at);
  const day = start.getDate();
  const month = start
    .toLocaleDateString("tr-TR", { month: "short" })
    .replace(".", "")
    .toUpperCase();
  const time = start.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const dm = session.duration_minutes;
  const durLabel =
    dm % 60 === 0 ? `${dm / 60} saat` : dm < 60 ? `${dm} dk` : `${(dm / 60).toFixed(1)} saat`;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 p-4 dark:border-slate-700">
      {/* Tarih kutusu */}
      <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-500/15">
        <span className="text-xl font-extrabold leading-none text-indigo-700 dark:text-indigo-300">
          {day}
        </span>
        <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">
          {month}
        </span>
      </div>

      {/* Orta: tip + başlık + saat/süre/kontenjan */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
            {session.exam_type}
          </span>
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            {session.title}
          </span>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
          🕐 {time} · {durLabel} ·{" "}
          {full ? (
            <span className="font-semibold text-rose-500">kontenjan doldu</span>
          ) : (
            <span>{session.available} koltuk kaldı</span>
          )}
        </p>
      </div>

      {/* Sağ: fiyat + aksiyon */}
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-lg font-bold text-slate-900 dark:text-white">
          {formatTRY(session.price)}
        </span>
        {status === "PAID" || status === "ATTENDED" ? (
          <Link
            to={ROUTES.bookings}
            className="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-700/40"
          >
            {status === "ATTENDED" ? "✓ Katıldın" : "✓ Biletin hazır"}
          </Link>
        ) : status === "PENDING_PAYMENT" ? (
          <button
            onClick={doPay}
            disabled={busy}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
          >
            {busy ? "…" : "Ödemeyi tamamla"}
          </button>
        ) : status === "REFUNDING" || status === "REFUNDED" ? (
          <span className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {status === "REFUNDING" ? "İade ediliyor" : "İade edildi"}
          </span>
        ) : !isLoggedIn ? (
          <Link
            to={ROUTES.login}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Giriş yap & kaydol
          </Link>
        ) : isClient ? (
          <button
            onClick={doRegisterAndPay}
            disabled={busy || full}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "İşleniyor…" : full ? "Doldu" : "Kaydol & Öde"}
          </button>
        ) : (
          <button
            onClick={() => navigate(ROUTES.tutors)}
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-400 dark:bg-slate-700"
            disabled
            title="Yalnız öğrenciler kaydolabilir"
          >
            Kaydol
          </button>
        )}
      </div>
    </div>
  );
}
