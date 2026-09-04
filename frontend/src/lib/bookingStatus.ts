// Ders durum haritası — artık `reservationStatus.ts`'ten TÜRER.
//
// Bu dosya bir shim'dir ve bilinçli olarak duruyor: onlarca çağrı yeri
// `BOOKING_STATUS_LABEL`/`STYLE` isimleriyle bu modülü import ediyor. İsimleri
// korumak göçü risksiz kılar; değer artık tek kaynaktan gelir ve ders/kütüphane
// rozetleri ayrışamaz (`reservationStatus.test.ts` bunu kilitliyor).
import { BookingStatus } from "@/types";
import {
  RESERVATION_STATUS_LABEL,
  RESERVATION_STATUS_STYLE,
} from "./reservationStatus";
import type { ReservationStatusKey } from "./reservationModel";

/** Ders durumu → ortak rezervasyon anahtarı. Rozet çizen her yüzey bunu kullanır. */
export const DERS_ANAHTARI: Record<BookingStatus, ReservationStatusKey> = {
  [BookingStatus.PENDING]: "BEKLIYOR",
  [BookingStatus.ACCEPTED]: "ONAYLANDI",
  [BookingStatus.REJECTED]: "REDDEDILDI",
  [BookingStatus.CANCELLED]: "IPTAL",
  [BookingStatus.COMPLETED]: "TAMAMLANDI",
};

function esle<T>(kaynak: Record<ReservationStatusKey, T>): Record<BookingStatus, T> {
  return Object.fromEntries(
    Object.entries(DERS_ANAHTARI).map(([ders, anahtar]) => [
      ders,
      kaynak[anahtar as ReservationStatusKey],
    ]),
  ) as Record<BookingStatus, T>;
}

export const BOOKING_STATUS_LABEL = esle(RESERVATION_STATUS_LABEL);
export const BOOKING_STATUS_STYLE = esle(RESERVATION_STATUS_STYLE);
