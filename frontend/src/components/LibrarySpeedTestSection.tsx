import { useState } from "react";
import {
  runSpeedTest,
  type SpeedTestPartial,
  type SpeedTestPhase,
} from "@/api/speedtest";
import {
  useRecordSpeedTest,
  useSpeedTestStats,
} from "@/hooks/useLibrarySpeedTests";
import { formatMbps, formatPing } from "@/lib/speedtest";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { SpeedTestResult } from "@/types";

const cardCls =
  "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ";

const PHASE_LABEL: Record<SpeedTestPhase, string> = {
  ping: "Gecikme ölçülüyor…",
  download: "İndirme ölçülüyor…",
  upload: "Yükleme ölçülüyor…",
};

export function LibrarySpeedTestSection({
  libraryId,
  canRecord,
}: {
  libraryId: number;
  canRecord: boolean;
}) {
  const { data: stats } = useSpeedTestStats(libraryId);
  const record = useRecordSpeedTest(libraryId);

  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<SpeedTestPhase | null>(null);
  const [live, setLive] = useState<SpeedTestPartial | null>(null);
  const [result, setResult] = useState<SpeedTestResult | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    setLive(null);
    try {
      const r = await runSpeedTest(setPhase, setLive);
      setResult(r);
      if (canRecord) {
        await record.mutateAsync(r);
        toast.success("Hız testi kaydedildi. Teşekkürler!");
      } else {
        toast.info("Sonucu kaydetmek için öğrenci hesabıyla giriş yap.");
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Hız testi yapılamadı. Tekrar dene."));
    } finally {
      setRunning(false);
      setPhase(null);
    }
  };

  const hasStats = (stats?.count ?? 0) > 0;

  return (
    <div className={cardCls}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 ">
          İnternet Hızı
        </h2>
        {hasStats && (
          <span className="text-xs text-slate-400 ">
            {stats!.count} ölçüm
          </span>
        )}
      </div>

      {/* Ortalama (kayıtlı testlerden) */}
      {hasStats ? (
        <div className="grid grid-cols-3 gap-2">
          <Metric label="İndirme" value={formatMbps(stats!.avg_download_mbps)} />
          <Metric label="Yükleme" value={formatMbps(stats!.avg_upload_mbps)} />
          <Metric label="Gecikme" value={formatPing(stats!.avg_ping_ms)} />
        </div>
      ) : (
        <p className="text-sm text-slate-500 ">
          Henüz hız testi yapılmamış. İlk ölçümü sen yap!
        </p>
      )}

      <p className="mt-1.5 text-[11px] text-slate-400 ">
        Cloudflare ile ölçülür, genel internet hızı (kullanıcı ölçümlerinin ortalaması).
      </p>

      {/* Canlı (test sürerken kısmi sonuç) */}
      {running && live && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Metric label="İndirme" value={formatMbps(live.download_mbps)} accent />
          <Metric label="Yükleme" value={formatMbps(live.upload_mbps)} accent />
          <Metric label="Gecikme" value={formatPing(live.ping_ms)} accent />
        </div>
      )}

      {/* Senin ölçümün */}
      {!running && result && (
        <div className="mt-4 rounded-xl bg-indigo-50 px-4 py-3 ">
          <p className="text-xs font-semibold text-indigo-700 ">
            Senin ölçümün
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Metric label="İndirme" value={formatMbps(result.download_mbps)} accent />
            <Metric label="Yükleme" value={formatMbps(result.upload_mbps)} accent />
            <Metric label="Gecikme" value={formatPing(result.ping_ms)} accent />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={run}
        disabled={running}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 "
      >
        {running ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
            </svg>
            {phase ? PHASE_LABEL[phase] : "Ölçülüyor…"}
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" />
            </svg>
            Hız testini çalıştır
          </>
        )}
      </button>
      {!canRecord && (
        <p className="mt-2 text-center text-[11px] text-slate-400 ">
          Testi herkes çalıştırabilir; sonucu kaydetmek için öğrenci girişi gerekir.
        </p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="text-center">
      <p
        className={`text-sm font-bold ${
          accent
            ? "text-indigo-700 "
            : "text-slate-900 "
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400 ">{label}</p>
    </div>
  );
}
