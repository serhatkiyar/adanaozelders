import { BookingStatus } from "@/types";

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  [BookingStatus.PENDING]: "Bekliyor",
  [BookingStatus.ACCEPTED]: "Onaylandı",
  [BookingStatus.REJECTED]: "Reddedildi",
  [BookingStatus.CANCELLED]: "İptal",
  [BookingStatus.COMPLETED]: "Tamamlandı",
};

export const BOOKING_STATUS_STYLE: Record<BookingStatus, string> = {
  [BookingStatus.PENDING]: "bg-amber-50 text-amber-700",
  [BookingStatus.ACCEPTED]: "bg-indigo-50 text-indigo-700",
  [BookingStatus.REJECTED]: "bg-red-50 text-red-700",
  [BookingStatus.CANCELLED]: "bg-slate-100 text-slate-600",
  [BookingStatus.COMPLETED]: "bg-emerald-50 text-emerald-700",
};
