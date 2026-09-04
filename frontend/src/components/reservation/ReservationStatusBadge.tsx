// Rezervasyon durum rozeti — üç ürünün ortak dili.
//
// Renk ve etiket `lib/reservationStatus.ts`ten gelir; bu bileşen karar VERMEZ,
// yalnız çizer. Üç ayrı rozet sisteminin (ders listesi · bilet koçanı · sohbet
// kartı) tek yere inmesi bu dosyayla mümkün oluyor.
import {
  RESERVATION_STATUS_LABEL,
  RESERVATION_STATUS_STYLE,
} from "@/lib/reservationStatus";
import type { ReservationStatusKey } from "@/lib/reservationModel";

export function ReservationStatusBadge({
  durum,
  className = "",
}: {
  durum: ReservationStatusKey;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${RESERVATION_STATUS_STYLE[durum]} ${className}`}
    >
      {RESERVATION_STATUS_LABEL[durum]}
    </span>
  );
}
