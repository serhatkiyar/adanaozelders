import { useEffect, useRef, useState } from "react";

// Kameradan QR okuyan hafif tarayıcı. Tarayıcı `BarcodeDetector` API'sini destekliyorsa
// (Chrome/Edge/Android) kullanır; desteklemiyorsa kullanıcıyı manuel girişe yönlendiren
// bir not gösterir. Dış servis/kütüphane yok — tamamen tarayıcı yerel API'si.
export function QrScanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
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

  if (!supported) {
    return (
      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        Bu tarayıcı kamera ile QR taramayı desteklemiyor. Öğrencinin kodunu aşağıdaki
        kutuya elle girebilir veya USB barkod okuyucu kullanabilirsiniz.
        <button
          onClick={onClose}
          className="mt-2 block rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"
        >
          Kapat
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-black">
      {error ? (
        <p className="p-4 text-sm text-rose-300">{error}</p>
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
