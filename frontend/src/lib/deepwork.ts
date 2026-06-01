// DeepWork (Pomodoro) zamanlayıcısının saf mantığı — UI/state'ten bağımsız,
// test edilebilir yardımcılar.

export type TimerMode = "focus" | "short" | "long";

export interface TimerSettings {
  focusMin: number; // odak süresi (dk)
  shortMin: number; // kısa mola (dk)
  longMin: number; // uzun mola (dk)
  longEvery: number; // kaç odakta bir uzun mola
  autoStartNext: boolean; // faz bitince sonraki otomatik başlasın mı
  soundOn: boolean; // sesli uyarı
}

export const DEFAULT_SETTINGS: TimerSettings = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  autoStartNext: false,
  soundOn: true,
};

export const MODE_LABEL: Record<TimerMode, string> = {
  focus: "Odak",
  short: "Kısa Mola",
  long: "Uzun Mola",
};

// "MM:SS" — negatif değerler 00:00'a kırpılır, 60 dk üstü için saat eklenmez
// (Pomodoro fazları kısa olduğundan dk:sn yeterli).
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function phaseDurationMs(mode: TimerMode, s: TimerSettings): number {
  const min = mode === "focus" ? s.focusMin : mode === "short" ? s.shortMin : s.longMin;
  // En az 1 sn (0 dk girilse bile takılmasın); dakika kesirli olabilir (test için).
  return Math.max(1000, Math.round(min * 60 * 1000));
}

// Bir faz tamamlandığında sıradaki faz + güncellenmiş odak sayacı.
// - Odak biterse: focusDone +1; longEvery'nin katıysa "long", değilse "short".
// - Mola (short/long) biterse: "focus" (focusDone korunur; long'tan sonra döngü
//   yeni baştan sayılmaya devam eder — focusDone monotonik artar, kat kontrolü
//   modulo ile yapılır).
export function computeNextPhase(
  mode: TimerMode,
  focusDone: number,
  s: TimerSettings
): { mode: TimerMode; focusDone: number } {
  if (mode === "focus") {
    const nextDone = focusDone + 1;
    const isLong = s.longEvery > 0 && nextDone % s.longEvery === 0;
    return { mode: isLong ? "long" : "short", focusDone: nextDone };
  }
  return { mode: "focus", focusDone };
}

// İstatistik gün anahtarı (yerel saat) — "YYYY-MM-DD".
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// İnsan-okur süre: "1s 5dk", "45dk", "30sn".
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0dk";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}s ${m}dk` : `${h}s`;
  if (m > 0) return `${m}dk`;
  return `${seconds}sn`;
}
