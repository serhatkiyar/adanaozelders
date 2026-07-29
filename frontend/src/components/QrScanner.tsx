import { useEffect, useRef, useState } from "react";

// Kameradan QR okuyan hafif tarayıcı. Tarayıcı `BarcodeDetector` API'sini destekliyorsa
// (Chrome/Edge/Android) kullanır; desteklemiyorsa (iOS Safari!) MANUEL GİRİŞ kutusu
// gösterir — "kodu elle gir" diyen ama kutu sunmayan eski fallback, iOS'taki kuryeyi
// tamamen tıkıyordu. Dış servis/kütüphane yok — tamamen tarayıcı yerel API'si.
export function QrScanner({
  onScan,
  onClose,
  manualHint = "Kodu elle girebilir veya USB barkod okuyucu kullanabilirsiniz.",
  manualPlaceholder = "Kodu buraya girin",
}: {
  onScan: (value: string) => void;
  onClose: () => void;
  /** Fallback açıklaması — çağıran bağlama göre yazılır (paket etiketi / bilet). */
  manualHint?: string;
  manualPlaceholder?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    if (!supported) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    // @ts-expect-error — BarcodeDetector tüm TS lib'lerinde tanımlı değil.
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setError("Kameraya erişilemedi. Lütfen izin verin veya kodu elle girin.");
        return;
      }

      const tick = async () => {
        if (stopped || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && codes[0].rawValue) {
            onScan(codes[0].rawValue);
            return; // ilk okumada dur (parent kapatır)
          }
        } catch {
          /* kare atlandı — devam */
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [supported, onScan]);

  const submitManual = () => {
    const value = manual.trim();
    if (value) onScan(value);
  };

  const ManualEntry = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitManual();
      }}
      className="flex gap-2"
    >
      <input
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        placeholder={manualPlaceholder}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="QR kodunu elle gir"
        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:focus:ring-indigo-500/20"
      />
      <button
        type="submit"
        disabled={!manual.trim()}
        className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-slate-900"
      >
        Doğrula
      </button>
    </form>
  );

  if (!supported) {
    return (
      <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        <p>Bu tarayıcı kamera ile QR taramayı desteklemiyor. {manualHint}</p>
        {ManualEntry}
        <button
          onClick={onClose}
          className="block rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
        >
          Kapat
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-black">
      {error ? (
        <div className="space-y-3 p-4">
          <p className="text-sm text-rose-300">{error}</p>
          {ManualEntry}
        </div>
      ) : (
        <div className="relative">
          <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-40 rounded-2xl border-4 border-white/70" />
          </div>
        </div>
      )}
      <button
        onClick={onClose}
        className="w-full bg-slate-900 py-2 text-sm font-semibold text-white"
      >
        Kamerayı kapat
      </button>
    </div>
  );
}
