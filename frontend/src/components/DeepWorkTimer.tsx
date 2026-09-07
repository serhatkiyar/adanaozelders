import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { useTimerStore, remainingMsOf } from "@/store/timerStore";
import { formatClock, MODE_LABEL, type TimerMode } from "@/lib/deepwork";
import { playChime, notify } from "@/lib/timerSound";

const ACCENT: Record<TimerMode, { dot: string; text: string }> = {
  focus: { dot: "bg-marka-mid", text: "text-marka-metin " },
  short: { dot: "bg-emerald-500", text: "text-emerald-600 " },
  long: { dot: "bg-amber-500", text: "text-amber-600 " },
};

function completionMessage(completedMode: TimerMode): { title: string; body: string } {
  if (completedMode === "focus") {
    return { title: "Odak tamamlandı 🎉", body: "Mola zamanı." };
  }
  return { title: "Mola bitti", body: "Yeniden odaklanma zamanı." };
}

/**
 * Site-geneli zamanlayıcı sürücüsü + yüzen mini kart.
 * - App seviyesinde (BrowserRouter içinde) HER ZAMAN mount edilir → faz tamamlanma
 *   (ses/bildirim/istatistik) hangi sayfada olursan ol çalışır. Tek sahip olduğu
 *   için çift tetik olmaz.
 * - Yüzen UI yalnız aktif (idle değil) seans varken ve zamanlayıcı sayfasında
 *   DEĞİLken görünür (sayfada tam kontrol zaten var).
 */
export function DeepWorkTimer() {
  const location = useLocation();
  const [, setTick] = useState(0);

  const status = useTimerStore((s) => s.status);
  const mode = useTimerStore((s) => s.mode);
  const endsAt = useTimerStore((s) => s.endsAt);
  const remainingMs = useTimerStore((s) => s.remainingMs);
  const taskLabel = useTimerStore((s) => s.taskLabel);
  const start = useTimerStore((s) => s.start);
  const pause = useTimerStore((s) => s.pause);

  // Tek sürücü: 250 ms'de bir render tetikler + bitmiş running fazı tamamlar.
  useEffect(() => {
    const drive = () => {
      const s = useTimerStore.getState();
      if (s.status === "running" && s.endsAt != null && Date.now() >= s.endsAt) {
        if (s.settings.soundOn) playChime();
        const { title, body } = completionMessage(s.mode);
        notify(title, body);
        s.completePhase();
      }
    };
    drive(); // mount'ta: yenileme sonrası geçmiş endsAt'i hemen yakala
    const id = setInterval(() => {
      setTick((t) => (t + 1) % 1_000_000);
      drive();
    }, 250);
    return () => clearInterval(id);
  }, []);

  const onTimerPage = location.pathname === ROUTES.deepwork;
  if (status === "idle" || onTimerPage) return null;

  const remaining = remainingMsOf({ status, endsAt, remainingMs });
  const accent = ACCENT[mode];
  const running = status === "running";

  return (
    <div className="fixed bottom-4 left-4 z-[9998] w-64 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur ">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${accent.dot} ${running ? "animate-pulse" : ""}`} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${accent.text}`}>
          {MODE_LABEL[mode]}
        </span>
        <Link
          to={ROUTES.deepwork}
          className="ml-auto text-slate-400 transition hover:text-slate-600 "
          title="Zamanlayıcıyı aç"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2m8-16h2a2 2 0 012 2v2m-4 12h2a2 2 0 002-2v-2" />
          </svg>
        </Link>
      </div>

      <div className="mt-1 flex items-end justify-between">
        <span className="font-mono text-3xl font-bold tabular-nums text-slate-900 ">
          {formatClock(remaining)}
        </span>
        <button
          onClick={running ? pause : start}
          className={`flex h-10 w-10 items-center justify-center rounded-full text-white shadow transition active:scale-95 ${
            running ? "bg-slate-700 hover:bg-slate-600" : "bg-marka hover:bg-marka-hover"
          }`}
          title={running ? "Duraklat" : "Başlat"}
        >
          {running ? (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg className="h-5 w-5 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>

      {taskLabel.trim() && (
        <p className="mt-1 truncate text-xs text-slate-500 " title={taskLabel}>
          {taskLabel}
        </p>
      )}
    </div>
  );
}
