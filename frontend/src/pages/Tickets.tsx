import { useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV } from "@/lib/nav";
import {
  useCancelRegistration,
  useMyRegistrations,
  usePayRegistration,
} from "@/hooks/useLibraryExams";
import {
  useCancelStudy,
  useMyStudyReservations,
  usePayStudy,
} from "@/hooks/useStudy";
import { formatTRY } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import { ROUTES } from "@/lib/routes";
import type {
  RegistrationOut,
  RegistrationStatus,
  StudyReservationOut,
} from "@/types";

const STATUS_META: Record<RegistrationStatus, { label: string; cls: string }> = {
  PENDING_PAYMENT: {
    label: "Ödeme bekliyor",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  PAID: {
    label: "Bilet hazır",
    cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  ATTENDED: {
    label: "Katıldın ✓",
    cls: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  },
  CANCELLED: {
    label: "İptal",
    cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  },
  REFUNDED: {
    label: "İade edildi",
    cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  },
};

export default function Tickets() {
  const { data, isLoading } = useMyRegistrations();
  const { data: studyRes, isLoading: studyLoading } = useMyStudyReservations();
  const hasExam = data && data.length > 0;
  const hasStudy = studyRes && studyRes.length > 0;

  return (
    <DashboardShell title="Biletlerim" navItems={STUDENT_NAV}>
      <div className="mx-auto max-w-[760px] space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Biletlerim & Rezervasyonlarım
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Deneme oturumları ve çalışma alanı girişlerinde QR kodunu okutarak doğrula.
          </p>
        </div>

        {isLoading || studyLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : !hasExam && !hasStudy ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
            <div className="text-4xl">🎟️</div>
            <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              Henüz bilet veya rezervasyon yok
            </p>
            <Link
              to={ROUTES.libraries}
              className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Kütüphaneleri keşfet
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {hasStudy && (
              <section className="space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
                  Çalışma Alanı Rezervasyonları
                </h2>
                {studyRes!.map((r) => (
                  <StudyReservationCard key={r.id} res={r} />
                ))}
              </section>
            )}
            {hasExam && (
              <section className="space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
                  Deneme Biletleri
                </h2>
                {data!.map((r) => (
                  <TicketCard key={r.id} reg={r} />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function TicketCard({ reg }: { reg: RegistrationOut }) {
  const [showQr, setShowQr] = useState(false);
  const pay = usePayRegistration();
  const cancel = useCancelRegistration();
  const meta = STATUS_META[reg.status];
  const session = reg.session;

  const doPay = async () => {
    try {
      const result = await pay.mutateAsync(reg.id);
      if (result.redirect_url) {
        window.location.href = result.redirect_url;
        return;
      }
      toast.success("Ödeme alındı! Biletin hazır.");
    } catch (e) {
      toast.error(getErrorMessage(e, "Ödeme başarısız."));
    }
  };

  const doCancel = () => {
    if (!window.confirm("Bu kaydı iptal etmek istiyor musun?")) return;
    cancel.mutate(reg.id, {
      onSuccess: () => toast.success("Kayıt iptal edildi."),
      onError: (e) => toast.error(getErrorMessage(e, "İptal başarısız.")),
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {session && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                {session.exam_type}
              </span>
            )}
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
              {meta.label}
            </span>
          </div>
          <h3 className="mt-2 text-base font-bold text-slate-900 dark:text-white">
            {session?.title ?? "Deneme oturumu"}
          </h3>
          {session && (
            <>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                🗓️ {formatDateTime(session.starts_at)} · ⏱️ {session.duration_minutes} dk
              </p>
              {session.library_name && (
                <Link
                  to={ROUTES.library(session.library_slug ?? session.library_id)}
                  className="mt-0.5 inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                >
                  📍 {session.library_name}
                </Link>
              )}
            </>
          )}
          <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
            {formatTRY(reg.amount)}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {reg.status === "PENDING_PAYMENT" && (
              <>
                <button
                  onClick={doPay}
                  disabled={pay.isPending}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                >
                  {pay.isPending ? "…" : "Ödemeyi tamamla"}
                </button>
                <button
                  onClick={doCancel}
                  disabled={cancel.isPending}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300"
                >
                  İptal
                </button>
              </>
            )}
            {reg.status === "PAID" && reg.qr_token && (
              <button
                onClick={() => setShowQr((v) => !v)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                {showQr ? "QR'ı gizle" : "QR kodunu göster"}
              </button>
            )}
          </div>
        </div>

        {/* QR — ödenmiş biletlerde */}
        {reg.status === "PAID" && reg.qr_token && showQr && (
          <div className="flex flex-col items-center rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:ring-slate-600">
            <QRCodeSVG value={`${reg.id}:${reg.qr_token}`} size={148} level="M" />
            <p className="mt-2 text-center text-[11px] text-slate-400">
              Kütüphanede okutun
            </p>
          </div>
        )}
        {reg.status === "ATTENDED" && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            ✓ Katılım doğrulandı
          </div>
        )}
      </div>
    </div>
  );
}

function StudyReservationCard({ res }: { res: StudyReservationOut }) {
  const [showQr, setShowQr] = useState(false);
  const pay = usePayStudy();
  const cancel = useCancelStudy();
  const meta = STATUS_META[res.status];

  const doPay = async () => {
    try {
      const result = await pay.mutateAsync(res.id);
      if (result.redirect_url) {
        window.location.href = result.redirect_url;
        return;
      }
      toast.success("Ödeme alındı! QR'ın hazır.");
    } catch (e) {
      toast.error(getErrorMessage(e, "Ödeme başarısız."));
    }
  };

  const doCancel = () => {
    if (!window.confirm("Bu rezervasyonu iptal etmek istiyor musun?")) return;
    cancel.mutate(res.id, {
      onSuccess: () => toast.success("Rezervasyon iptal edildi."),
      onError: (e) => toast.error(getErrorMessage(e, "İptal başarısız.")),
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              Çalışma Alanı
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
              {meta.label}
            </span>
          </div>
          <p className="mt-2 text-base font-bold text-slate-900 dark:text-white">
            {formatDateTime(res.starts_at)} – {formatDateTime(res.ends_at)}
          </p>
          {res.library_name && (
            <Link
              to={ROUTES.library(res.library_slug ?? res.library_id)}
              className="mt-0.5 inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300"
            >
              📍 {res.library_name}
            </Link>
          )}
          <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
            {formatTRY(res.amount)}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {res.status === "PENDING_PAYMENT" && (
              <>
                <button onClick={doPay} disabled={pay.isPending} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
                  {pay.isPending ? "…" : "Ödemeyi tamamla"}
                </button>
                <button onClick={doCancel} disabled={cancel.isPending} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300">
                  İptal
                </button>
              </>
            )}
            {res.status === "PAID" && res.qr_token && (
              <button onClick={() => setShowQr((v) => !v)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                {showQr ? "QR'ı gizle" : "Giriş QR'ını göster"}
              </button>
            )}
          </div>
        </div>

        {res.status === "PAID" && res.qr_token && showQr && (
          <div className="flex flex-col items-center rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:ring-slate-600">
            <QRCodeSVG value={`${res.id}:${res.qr_token}`} size={148} level="M" />
            <p className="mt-2 text-center text-[11px] text-slate-400">Girişte okutun</p>
          </div>
        )}
        {res.status === "ATTENDED" && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            ✓ Giriş doğrulandı
          </div>
        )}
      </div>
    </div>
  );
}
