import { useRef } from "react";
import { useRtcStore } from "@/store/rtcStore";
import { rtcManager } from "@/lib/rtcTransfer";

function formatSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function P2PTransferPanel() {
  const active = useRtcStore((s) => s.active);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) rtcManager.sendFile(file);
  };

  const pct =
    active && active.fileSize > 0
      ? Math.min(100, Math.round((active.transferred / active.fileSize) * 100))
      : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-indigo-50 px-4 py-3 text-xs leading-relaxed text-indigo-700 ">
        <span className="font-semibold">Uçtan uca aktarım.</span> Dosya doğrudan
        karşı tarafa gönderilir, sunucuda saklanmaz ve boyut sınırı yoktur. Her iki
        taraf da derste açık olmalıdır.
      </div>

      {/* Boşta — dosya seç + gönder */}
      {!active && (
        <div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-600 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 "
          >
            <span aria-hidden className="text-lg">⇪</span>
            Dosya seç ve gönder
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handlePick}
          />
        </div>
      )}

      {/* Aktif aktarım kartı */}
      {active && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 ">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="text-lg">
              {active.direction === "send" ? "⬆" : "⬇"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800 ">
                {active.fileName}
              </p>
              <p className="text-xs text-slate-400 ">
                {formatSize(active.fileSize)} ·{" "}
                {active.direction === "send" ? "Gönderiliyor" : "Alınıyor"}
              </p>
            </div>
          </div>

          {/* Gelen dosya onayı */}
          {active.status === "pending-accept" && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => rtcManager.acceptIncoming()}
                className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                Kabul Et
              </button>
              <button
                onClick={() => rtcManager.rejectIncoming()}
                className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 "
              >
                Reddet
              </button>
            </div>
          )}

          {/* İlerleme */}
          {(active.status === "connecting" ||
            active.status === "transferring") && (
            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 ">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all"
                  style={{ width: `${active.status === "connecting" ? 4 : pct}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400 ">
                <span>
                  {active.status === "connecting"
                    ? "Bağlanılıyor…"
                    : `${formatSize(active.transferred)} / ${formatSize(active.fileSize)}`}
                </span>
                {active.status === "transferring" && <span>%{pct}</span>}
              </div>
              <button
                onClick={() => rtcManager.cancel()}
                className="mt-3 w-full rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-500 transition hover:bg-red-50 hover:text-red-600 "
              >
                İptal
              </button>
            </div>
          )}

          {/* Tamamlandı */}
          {active.status === "done" && (
            <div className="mt-3 space-y-2">
              {active.direction === "receive" && active.downloadUrl ? (
                <a
                  href={active.downloadUrl}
                  download={active.fileName}
                  className="block w-full rounded-xl bg-emerald-600 py-2 text-center text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  İndir
                </a>
              ) : (
                <p className="rounded-xl bg-emerald-50 py-2 text-center text-sm font-semibold text-emerald-700 ">
                  ✓ Gönderildi
                </p>
              )}
              <button
                onClick={() => rtcManager.reset()}
                className="w-full rounded-xl py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 "
              >
                Temizle
              </button>
            </div>
          )}

          {/* Reddedildi / İptal / Hata */}
          {(active.status === "rejected" ||
            active.status === "cancelled" ||
            active.status === "error") && (
            <div className="mt-3 space-y-2">
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-center text-sm font-medium text-rose-700 ">
                {active.status === "rejected"
                  ? "Karşı taraf aktarımı reddetti."
                  : active.status === "cancelled"
                    ? "Aktarım iptal edildi."
                    : active.error || "Aktarım başarısız."}
              </p>
              <button
                onClick={() => rtcManager.reset()}
                className="w-full rounded-xl py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 "
              >
                Kapat
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
