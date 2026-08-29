// Cıncık Teslimat söz rozeti — sunucu gerçeğinden ("/store/delivery-info")
// beslenir; istemci yalnız geri sayımı saniye saniye eritir. Kutu/kart değil:
// ürün sayfasındaki saç-teli ayraçlı satır ritmine uyar.
import { useEffect, useState } from "react";

import { useDeliveryInfo } from "@/hooks/useDelivery";
import {
  formatCountdown,
  isCutoffClosing,
  promiseDayLabel,
} from "@/lib/deliveryPromise";

function useRemainingSeconds(
  serverSeconds: number | null | undefined,
  fetchedAt: number,
): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (serverSeconds == null) return null;
  const remaining = serverSeconds - Math.floor((now - fetchedAt) / 1000);
  return remaining > 0 ? remaining : null;
}

/**
 * variant="row": ikon + başlık + alt satır (ürün detay "Teslimat & satıcı" bloğu).
 * variant="inline": tek kısa satır (sepet kalemi / checkout künyesi).
 */
export function DeliveryPromiseBadge({
  variant = "row",
}: {
  variant?: "row" | "inline";
}) {
  const { data: info, dataUpdatedAt } = useDeliveryInfo();
  const remaining = useRemainingSeconds(info?.countdown_seconds, dataUpdatedAt);
  if (!info) return null;

  const day = promiseDayLabel(info.promised_date_now);
  // E1: son 15 dk — söz hâlâ geçerli ama kapanmak üzere; dürüst aciliyet tonu.
  const closing = isCutoffClosing(remaining);
  const title = `Cıncık Teslimat · ${day} kapında`;
  const sub =
    remaining != null
      ? closing
        ? `${day} garantisi kapanmak üzere, son ${formatCountdown(remaining)}.`
        : `${formatCountdown(remaining)} içinde sipariş ver, Adana Merkez'e kendi kuryemizle.`
      : "Adana Merkez'e kendi kuryemizle; 16:00 sonrası siparişler ertesi gün.";

  if (variant === "inline") {
    return (
      <span className="text-emerald-700 ">
        Cıncık Teslimat · {day} kapında
        {remaining != null && (
          <span
            className={
              closing
                ? "font-medium text-amber-600 "
                : "text-slate-400 "
            }
          >
            {" "}
            · son {formatCountdown(remaining)}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="flex items-start gap-2.5 text-slate-600 ">
      <svg
        className="mt-0.5 shrink-0 text-emerald-600 "
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
      <span>
        <span className="font-medium text-slate-900 ">{title}</span>
        <span
          className={`block ${
            closing
              ? "font-medium text-amber-600 "
              : "text-slate-500 "
          }`}
        >
          {sub}
        </span>
      </span>
    </div>
  );
}
