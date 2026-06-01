import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_SETTINGS,
  computeNextPhase,
  phaseDurationMs,
  todayKey,
  type TimerMode,
  type TimerSettings,
} from "@/lib/deepwork";

export type TimerStatus = "idle" | "running" | "paused";

interface DailyStats {
  date: string; // YYYY-MM-DD
  focusSeconds: number;
  sessions: number;
}

interface TimerState {
  settings: TimerSettings;
  mode: TimerMode;
  status: TimerStatus;
  endsAt: number | null; // running iken epoch ms
  remainingMs: number; // running DEĞİLken kalan süre (idle/paused)
  focusDone: number; // tamamlanan odak seansı (döngü pozisyonu, monotonik)
  taskLabel: string;
  stats: DailyStats;

  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  setMode: (mode: TimerMode) => void;
  setTask: (s: string) => void;
  updateSettings: (patch: Partial<TimerSettings>) => void;
  completePhase: () => void; // sürücü çağırır (yan etkiler — ses/bildirim — bileşende)
  dismiss: () => void; // yüzen widget'ı gizle (idle'a al)
}

function freshStats(): DailyStats {
  return { date: todayKey(), focusSeconds: 0, sessions: 0 };
}

// Çalışan/durmuş duruma göre o anki kalan süre (ms).
export function remainingMsOf(s: {
  status: TimerStatus;
  endsAt: number | null;
  remainingMs: number;
}): number {
  if (s.status === "running" && s.endsAt != null) {
    return Math.max(0, s.endsAt - Date.now());
  }
  return s.remainingMs;
}

// Derin çalışma (Pomodoro) zamanlayıcısı. persist: sayfa gezinmesi/yenilemesinde
// kaldığı yerden sürer (timestamp tabanlı). Yan etkiler (ses/bildirim) burada
// DEĞİL, sürücü bileşeninde (DeepWorkTimer).
export const useTimerStore = create<TimerState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      mode: "focus",
      status: "idle",
      endsAt: null,
      remainingMs: phaseDurationMs("focus", DEFAULT_SETTINGS),
      focusDone: 0,
      taskLabel: "",
      stats: freshStats(),

      start: () => {
        const s = get();
        const rem =
          s.status === "running" && s.endsAt != null
            ? Math.max(0, s.endsAt - Date.now())
            : s.remainingMs;
        const ms = rem > 0 ? rem : phaseDurationMs(s.mode, s.settings);
        set({ status: "running", endsAt: Date.now() + ms });
      },

      pause: () => {
        const s = get();
        if (s.status !== "running" || s.endsAt == null) return;
        set({
          status: "paused",
          remainingMs: Math.max(0, s.endsAt - Date.now()),
          endsAt: null,
        });
      },

      reset: () => {
        const s = get();
        set({
          status: "idle",
          endsAt: null,
          remainingMs: phaseDurationMs(s.mode, s.settings),
        });
      },

      skip: () => {
        // Saymadan sonraki faza geç: odak → kısa mola, mola → odak.
        const s = get();
        const nextMode: TimerMode = s.mode === "focus" ? "short" : "focus";
        set({
          mode: nextMode,
          status: "idle",
          endsAt: null,
          remainingMs: phaseDurationMs(nextMode, s.settings),
        });
      },

      setMode: (mode) => {
        const s = get();
        set({
          mode,
          status: "idle",
          endsAt: null,
          remainingMs: phaseDurationMs(mode, s.settings),
        });
      },

      setTask: (taskLabel) => set({ taskLabel }),

      updateSettings: (patch) => {
        const s = get();
        const settings = { ...s.settings, ...patch };
        // Süre değişiklikleri yalnız çalışmıyorken (idle) anlık kalan süreye yansır;
        // çalışan/duraklı seans bozulmaz, yeni süreler sonraki fazda geçerli olur.
        const remainingMs =
          s.status === "idle" ? phaseDurationMs(s.mode, settings) : s.remainingMs;
        set({ settings, remainingMs });
      },

      completePhase: () => {
        const s = get();
        let stats = s.stats;
        if (stats.date !== todayKey()) stats = freshStats();
        if (s.mode === "focus") {
          const focusSec = Math.round(phaseDurationMs("focus", s.settings) / 1000);
          stats = {
            ...stats,
            focusSeconds: stats.focusSeconds + focusSec,
            sessions: stats.sessions + 1,
          };
        }
        const next = computeNextPhase(s.mode, s.focusDone, s.settings);
        const ms = phaseDurationMs(next.mode, s.settings);
        if (s.settings.autoStartNext) {
          set({
            mode: next.mode,
            focusDone: next.focusDone,
            stats,
            status: "running",
            endsAt: Date.now() + ms,
            remainingMs: ms,
          });
        } else {
          // Otomatik başlatma kapalı: sonraki faz "paused" (hazır) kalır ki yüzen
          // widget görünür ve tek tıkla başlatılabilsin.
          set({
            mode: next.mode,
            focusDone: next.focusDone,
            stats,
            status: "paused",
            endsAt: null,
            remainingMs: ms,
          });
        }
      },

      dismiss: () => {
        const s = get();
        set({
          status: "idle",
          endsAt: null,
          remainingMs: phaseDurationMs(s.mode, s.settings),
        });
      },
    }),
    { name: "ceyhan-deepwork" }
  )
);
