import { useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { ExamSessionsManager } from "@/components/ExamSessionsManager";
import { QrScanner } from "@/components/QrScanner";
import { useOperatorMe, useVerifyAttendance } from "@/hooks/useLibraryExams";
import {
  useAttendStudyReservation,
  useManageStudyReservations,
} from "@/hooks/useStudy";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { AttendanceResult } from "@/types";

export default function OperatorHome() {
  const { data: op, isLoading } = useOperatorMe();
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
    <DashboardShell title="Kütüphane Paneli">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {isLoading ? "Yükleniyor…" : op?.library_name ?? "Kütüphane Paneli"}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Deneme oturumlarını yönet ve katılımcıların QR kodlarını okutarak doğrula.
          </p>
        </div>

        {/* ── QR doğrulama ── */}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
          <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">
            Katılım Doğrula (QR)
          </h2>

          {scanning ? (
            <QrScanner onScan={runVerify} onClose={() => setScanning(false)} />
          ) : (
            <button
              onClick={() => {
                setResult(null);
                setScanning(true);
              }}
              className="mb-3 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              📷 Kamera ile QR tara
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
                autoFocus
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
              <span className="text-2xl">{result.already ? "ℹ️" : "✅"}</span>
              <div>
                <p className="text-sm font-bold">{result.client_name}</p>
                <p className="text-xs">
                  {result.exam_title} · {result.message}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Oturum yönetimi ── */}
        {op && (
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
            <ExamSessionsManager libraryId={op.library_id} />
          </div>
        )}

        {/* ── Çalışma alanı rezervasyonları ── */}
        {op && <StudyReservationsList libraryId={op.library_id} />}
      </div>
    </DashboardShell>
  );
}

function StudyReservationsList({ libraryId }: { libraryId: number }) {
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
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
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
