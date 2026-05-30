import { BookingStatus, type BookingOut } from "@/types";

const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export interface QaEligibility {
  /** Soru sorulabilir mi? */
  canAsk: boolean;
  /** Ders bitti mi (end_at geçti mi)? */
  ended: boolean;
  /** Pencere kapandı mı? */
  expired: boolean;
  /** Hakkın bitmesine kalan tam gün (0–7). */
  daysLeft: number;
}

// Soru sorma hakkı: tamamlanmış ve bitiş tarihi son 7 gün içinde olan ders.
export function qaEligibility(booking: BookingOut): QaEligibility | null {
  if (booking.status !== BookingStatus.COMPLETED) return null;

  const end = new Date(booking.end_at).getTime();
  const now = Date.now();
  const ended = end <= now;
  if (!ended) {
    return { canAsk: false, ended: false, expired: false, daysLeft: WINDOW_DAYS };
  }

  const msLeft = end + WINDOW_DAYS * DAY_MS - now;
  const expired = msLeft <= 0;
  return {
    canAsk: !expired,
    ended: true,
    expired,
    daysLeft: expired ? 0 : Math.ceil(msLeft / DAY_MS),
  };
}
