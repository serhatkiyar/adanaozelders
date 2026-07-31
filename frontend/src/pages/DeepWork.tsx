import { useEffect, useState } from "react";
import { Field } from "@/components/ui/Field";
import { DashboardShell } from "@/components/DashboardShell";
import { STUDENT_NAV, TUTOR_NAV } from "@/lib/nav";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ROLE_IDS } from "@/types";
import { useTimerStore, remainingMsOf } from "@/store/timerStore";
import {
  formatClock,
  formatDuration,
  phaseDurationMs,
  todayKey,
  MODE_LABEL,
  type TimerMode,
} from "@/lib/deepwork";
import { primeAudio } from "@/lib/timerSound";

const RING: Record<TimerMode, string> = {
  focus: "stroke-indigo-500",
  short: "stroke-emerald-500",
  long: "stroke-amber-500",
};
const TAB_ACTIVE: Record<TimerMode, string> = {
  focus: "bg-indigo-600 text-white",
  short: "bg-emerald-600 text-white",
  long: "bg-amber-500 text-white",
};

const RADIUS = 130;
const CIRC = 2 * Math.PI * RADIUS;

export default function DeepWork() {
  const { data: user } = useCurrentUser();
  const navItems = user?.role_id === ROLE_IDS.TUTOR ? TUTOR_NAV : STUDENT_NAV;

  const {
    settings,
    mode,
    status,
    endsAt,
    remainingMs,
    focusDone,
    taskLabel,
    stats,
    start,
    pause,
    reset,
    skip,
    setMode,
    setTask,
    updateSettings,
  } = useTimerStore();

  const [showSettings, setShowSettings] = useState(false);
  const [, setTick] = useState(0);

  // Sayfa görünümünü saniyede güncelle (faz tamamlama sürücüsü DeepWorkTimer'da).
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 250);
    return () => clearInterval(id);
  }, []);

  const total = phaseDurationMs(mode, settings);
  const remaining = remainingMsOf({ status, endsAt, remainingMs });
  const fraction = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const running = status === "running";

  const handleStart = () => {
    primeAudio(); // kullanıcı etkileşimi: ses/bildirim için hazırla
    start();
  };

  const tabs: TimerMode[] = ["focus", "short", "long"];
  const cyclePos = settings.longEvery > 0 ? focusDone % settings.longEvery : focusDone;
  // Gün değiştiyse (ilk seans tamamlanana dek) dünün sayılarını gösterme.
  const today = stats.date === todayKey() ? stats : { focusSeconds: 0, sessions: 0 };

  return (
    <DashboardShell title="Zamanlayıcı" navItems={navItems}>
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Derin Çalışma
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Pomodoro tekniğiyle odaklan: çalış, kısa molalar ver, her birkaç turda
          uzun mola yap.
        </p>

        {/* Faz sekmeleri */}
        <div className="mt-6 flex justify-center gap-2">
          {tabs.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                mode === m
                  ? TAB_ACTIVE[m]
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        {/* Zamanlayıcı halkası */}
        <div className="mt-6 flex flex-col items-center">
          <div className="relative h-[300px] w-[300px]">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 300 300">
              <circle
                cx="150"
                cy="150"
                r={RADIUS}
                className="fill-none stroke-slate-100 dark:stroke-slate-800"
                strokeWidth="14"
              />
              <circle
                cx="150"
                cy="150"
                r={RADIUS}
                className={`fill-none ${RING[mode]} transition-[stroke-dashoffset] duration-500 ease-linear`}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - fraction)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-6xl font-bold tabular-nums text-slate-900 dark:text-white">
                {formatClock(remaining)}
              </span>
              <span className="mt-1 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {MODE_LABEL[mode]}
              </span>
              {/* Döngü noktaları */}
              <div className="mt-3 flex gap-1.5">
                {Array.from({ length: Math.max(1, settings.longEvery) }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-2 w-2 rounded-full ${
                      i < cyclePos
                        ? "bg-indigo-500"
                        : "bg-slate-200 dark:bg-slate-700"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Kontroller */}
          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={reset}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 active:scale-95 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              title="Sıfırla"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5 19A9 9 0 0019 5" />
              </svg>
            </button>
            <button
              onClick={running ? pause : handleStart}
              className={`flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition active:scale-95 ${
                running
                  ? "bg-slate-700 hover:bg-slate-600"
                  : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/30"
              }`}
              title={running ? "Duraklat" : "Başlat"}
            >
              {running ? (
                <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg className="h-7 w-7 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button
              onClick={skip}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 active:scale-95 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              title="Atla"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 5l8 7-8 7zM16 5h2v14h-2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Görev etiketi */}
        <Field label="Ne üzerine çalışıyorsun?" labelClassName="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500" className="mt-8">
          {(id) => (
              <input
                    id={id}
                type="text"
                value={taskLabel}
                onChange={(e) => setTask(e.target.value)}
                maxLength={120}
                placeholder="Örn. Matematik — türev soruları"
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
          )}
        </Field>

        {/* Bugün + Ayarlar */}
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Bugün
            </h2>
            <div className="mt-3 flex items-center justify-around">
              <div className="text-center">
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {formatDuration(today.focusSeconds)}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">Odak süresi</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {today.sessions}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">Tamamlanan seans</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="flex w-full items-center justify-between"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Ayarlar
              </span>
              <svg
                className={`h-4 w-4 text-slate-400 transition ${showSettings ? "rotate-180" : ""}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showSettings && (
              <div className="mt-4 space-y-3">
                <SettingNumber
                  label="Odak (dk)"
                  value={settings.focusMin}
                  onChange={(v) => updateSettings({ focusMin: v })}
                />
                <SettingNumber
                  label="Kısa mola (dk)"
                  value={settings.shortMin}
                  onChange={(v) => updateSettings({ shortMin: v })}
                />
                <SettingNumber
                  label="Uzun mola (dk)"
                  value={settings.longMin}
                  onChange={(v) => updateSettings({ longMin: v })}
                />
                <SettingNumber
                  label="Uzun mola sıklığı (odak)"
                  value={settings.longEvery}
                  onChange={(v) => updateSettings({ longEvery: Math.round(v) })}
                />
                <Toggle
                  label="Sonrakini otomatik başlat"
                  checked={settings.autoStartNext}
                  onChange={(v) => updateSettings({ autoStartNext: v })}
                />
                <Toggle
                  label="Sesli uyarı"
                  checked={settings.soundOn}
                  onChange={(v) => updateSettings({ soundOn: v })}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

function SettingNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
      <input
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n) && n >= 0) onChange(n);
        }}
        className="w-20 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between"
    >
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
      <span
        className={`relative h-6 w-11 rounded-full transition ${
          checked ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
