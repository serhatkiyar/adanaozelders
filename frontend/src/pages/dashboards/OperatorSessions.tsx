import { useState } from "react";
import { Link } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { OPERATOR_NAV } from "@/lib/nav";
import { ExamSessionsManager } from "@/components/ExamSessionsManager";
import { QrScanner } from "@/components/QrScanner";
import { useOperatorMe, useVerifyAttendance } from "@/hooks/useLibraryExams";
import { useLibraryAdminDetail } from "@/hooks/useLibraries";
import {
  useAttendStudyReservation,
  useManageStudyReservations,
} from "@/hooks/useStudy";
import { formatDateTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/routes";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { AttendanceResult } from "@/types";

const cardCls =
  "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700";

export default function OperatorSessions() {
  const { data: op, isLoading } = useOperatorMe();
  const { data: lib } = useLibraryAdminDetail(op?.library_id);
  const isActive = lib?.status === "ACTIVE";

  return (
    <DashboardShell title="Oturumlar & QR" navItems={OPERATOR_NAV}>
      <div className="mx-auto max-w-3xl space-y-5">
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
        ) : !isActive ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Deneme oturumları, QR doğrulama ve çalışma rezervasyonları kütüphanen{" "}
            <strong>onaylandıktan</strong> sonra açılır. Bu sırada{" "}
            <Link to={ROUTES.operatorLibrary} className="font-semibold underline">
              profilini tamamla
            </Link>
            .
          </div>
        ) : (
          op && (
            <>
              <QrVerifyCard />
              <div className={cardCls}>
                <ExamSessionsManager libraryId={op.library_id} />
              </div>
              <StudyReservationsCard libraryId={op.library_id} />
            </>
          )
        )}
      </div>
    </DashboardShell>
  );
}

/* ── QR doğrulama (kamera + elle/USB) ── */
function QrVerifyCard() {
  const verify = useVerifyAttendance();
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<AttendanceResult | null>(null);

  const runVerify = (payload: string) => {
    if (!payload.trim()) return;
    verify.mutate(payload.trim(), {
      onSuccess: (res) => {
        setResult(res);
        setScanning(false);
        setCode("");
        if (res.already) toast.success("Zaten doğrulanmıştı.");
        else toast.success(`${res.client_name} doğrulandı ✓`);
      },
      onError: (e) => {
        setResult(null);
        toast.error(getErrorMessage(e, "Doğrulama başarısız."));
      },
    });
  };

  return (
    <div className={cardCls}>
      <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">Katılım Doğrula (QR)</h2>

      {scanning ? (
        <QrScanner onScan={runVerify} onClose={() => setScanning(false)} />
      ) : (
        <button
          onClick={() => {
            setResult(null);
            setScanning(true);
          }}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-[0.98]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
          </svg>
          Kamera ile QR tara
        </button>
      )}

      <div className="mt-3">
        <p className="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
          veya kodu elle gir / USB okuyucu ile okut
        </p>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runVerify(code);
            }}
            placeholder="Bilet kodu…"
            className="input flex-1"
          />
          <button
            onClick={() => runVerify(code)}
            disabled={verify.isPending}
            className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-700"
          >
            {verify.isPending ? "…" : "Doğrula"}
          </button>
        </div>
      </div>

      {result && (
        <div
          className={`mt-4 flex items-center gap-3 rounded-xl px-4 py-3 ${
            result.already
              ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
          }`}
        >
          <svg className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            {result.already ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            )}
          </svg>
          <div>
            <p className="text-sm font-bold">{result.client_name}</p>
            <p className="text-xs">
              {result.exam_title} · {result.message}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Çalışma alanı rezervasyonları (yaklaşan) ── */
function StudyReservationsCard({ libraryId }: { libraryId: number }) {
  const { data, isLoading } = useManageStudyReservations(libraryId);
  const attend = useAttendStudyReservation();

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />;
  }
  if (!data || data.length === 0) return null;

  const doAttend = (id: number, name: string) => {
    attend.mutate(id, {
      onSuccess: (res) =>
        toast.success(res.already ? `${name} zaten giriş yapmıştı.` : `${name} giriş yaptı ✓`),
      onError: (e) => toast.error(getErrorMessage(e, "Doğrulama başarısız.")),
    });
  };

  return (
    <div className={cardCls}>
      <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">
        Çalışma Alanı Rezervasyonları (yaklaşan)
      </h2>
      <ul className="divide-y divide-slate-100 dark:divide-slate-700">
        {data.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                {r.client_name ?? "Öğrenci"}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {formatDateTime(r.starts_at)} – {formatDateTime(r.ends_at)}
              </p>
            </div>
            {r.status === "ATTENDED" ? (
              <span className="shrink-0 text-xs font-semibold text-emerald-600">Giriş yaptı ✓</span>
            ) : (
              <button
                onClick={() => doAttend(r.id, r.client_name ?? "Öğrenci")}
                disabled={attend.isPending}
                className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {attend.isPending ? "…" : "Giriş ver"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
