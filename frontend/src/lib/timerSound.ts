// Zamanlayıcı uyarıları — ses (Web Audio, dosya/asset gerekmez) + tarayıcı bildirimi.

let audioCtx: AudioContext | null = null;

type WindowWithWebkit = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  return audioCtx;
}

// Kullanıcı etkileşiminde (örn. Başlat) çağrılır — autoplay politikası gereği
// AudioContext'i hazır/resume eder ve bildirim izni ister.
export function primeAudio(): void {
  const ctx = getCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  if (
    typeof Notification !== "undefined" &&
    Notification.permission === "default"
  ) {
    Notification.requestPermission().catch(() => {});
  }
}

// Kısa, yumuşak iki notalı "çın" sesi.
export function playChime(): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const notes = [
    { freq: 880, at: 0 },
    { freq: 1320, at: 0.18 },
  ];
  for (const { freq, at } of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + at;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.35);
  }
}

// İzin verilmişse tarayıcı bildirimi gösterir (sessizce başarısız olur).
export function notify(title: string, body: string): void {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    /* yoksay */
  }
}
