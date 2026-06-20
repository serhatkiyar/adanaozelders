import SpeedTest from "@cloudflare/speedtest";
import { apiClient } from "@/api/axios";
import { clampMbps } from "@/lib/speedtest";
import type {
  LibrarySpeedTestStats,
  LibrarySpeedTestOut,
  SpeedTestResult,
} from "@/types";

// Ölçüm Cloudflare'in global edge'ine yapılır (fast.com/Ookla mantığı): kullanıcının
// GERÇEK internet hızı (kütüphane wifi'si), bizim sunucumuza değil. Ücretsiz, anahtarsız,
// tamamen tarayıcıda. Sonuç yine kütüphaneye kaydedilir (aşağıdaki record).

export type SpeedTestPhase = "ping" | "download" | "upload";

export interface SpeedTestPartial {
  download_mbps: number | null;
  upload_mbps: number | null;
  ping_ms: number | null;
}

const bpsToMbps = (bps: number | undefined): number | null =>
  bps == null ? null : clampMbps(bps / 1_000_000);

// Latency + indirme/yükleme rampası; paket kaybı/TURN (WebRTC) ve erişilebilirlik
// adımları dışarıda — daha hızlı ve her ağda güvenilir.
const MEASUREMENTS = [
  { type: "latency" as const, numPackets: 20 },
  { type: "download" as const, bytes: 1e5, count: 1, bypassMinDuration: true },
  { type: "download" as const, bytes: 1e6, count: 8 },
  { type: "download" as const, bytes: 1e7, count: 6 },
  { type: "upload" as const, bytes: 1e5, count: 4, bypassMinDuration: true },
  { type: "upload" as const, bytes: 1e6, count: 6 },
  { type: "upload" as const, bytes: 1e7, count: 4 },
];

/** Cloudflare hız testini çalıştırır. onPhase aşama, onProgress canlı kısmi sonuç verir. */
export function runSpeedTest(
  onPhase?: (phase: SpeedTestPhase) => void,
  onProgress?: (partial: SpeedTestPartial) => void
): Promise<SpeedTestResult> {
  return new Promise((resolve, reject) => {
    const engine = new SpeedTest({ autoStart: false, measurements: MEASUREMENTS });

    engine.onPhaseChange = ({ measurement }) => {
      const t = measurement.type;
      if (t === "latency") onPhase?.("ping");
      else if (t === "download") onPhase?.("download");
      else if (t === "upload") onPhase?.("upload");
    };

    engine.onResultsChange = () => {
      const s = engine.results.getSummary();
      onProgress?.({
        download_mbps: bpsToMbps(s.download),
        upload_mbps: bpsToMbps(s.upload),
        ping_ms: s.latency != null ? Math.round(s.latency) : null,
      });
    };

    engine.onFinish = (results) => {
      const s = results.getSummary();
      resolve({
        download_mbps: bpsToMbps(s.download) ?? 0,
        upload_mbps: bpsToMbps(s.upload) ?? 0,
        ping_ms: s.latency != null ? Math.round(s.latency) : 0,
      });
    };

    engine.onError = (message) =>
      reject(new Error(message || "Hız testi başarısız oldu."));

    engine.play();
  });
}

export async function recordSpeedTest(
  libraryId: number,
  payload: SpeedTestResult
): Promise<LibrarySpeedTestOut> {
  const { data } = await apiClient.post<LibrarySpeedTestOut>(
    `/library-speedtests/${libraryId}`,
    payload
  );
  return data;
}

export async function fetchSpeedTestStats(
  libraryId: number
): Promise<LibrarySpeedTestStats> {
  const { data } = await apiClient.get<LibrarySpeedTestStats>(
    `/library-speedtests/${libraryId}`
  );
  return data;
}
