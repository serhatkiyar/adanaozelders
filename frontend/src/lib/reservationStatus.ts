// Rezervasyon durum rozetinin TEK kaynağı.
//
// Bu dosyadan önce ÜÇ ayrı harita vardı ve renkleri birbiriyle çelişiyordu:
// `lib/bookingStatus.ts` (liste), `pages/Tickets.tsx` `STATUS_PILL` (koyu bilet
// zemini) ve `components/BookingActionCard.tsx` `STATUS_CONFIG` — sonuncusunda
// ACCEPTED emerald, COMPLETED indigo, yani ilkinin TAM TERSİ. Aynı sipariş
// sohbette bir renk, listede başka renk görünüyordu.
//
// Doğruluk kaynağı `bookingStatus.ts`'in paleti seçildi: rezervasyonun ana
// yüzeyi liste ekranıdır ve kullanıcı en çok orayı görür. `bookingStatus.ts`
// artık buradan re-export eden bir shim'dir.
//
// Etiket kuralları (Polaris): tek kelime tercih edilir, cümle düzeni (sentence
// case), tamamlanmış durum GEÇMİŞ ZAMAN, süren işlem `-iyor`.
import type { ReservationStatusKey } from "./reservationModel";

export const RESERVATION_STATUS_LABEL: Record<ReservationStatusKey, string> = {
  BEKLIYOR: "Bekliyor",
  ONAYLANDI: "Onaylandı",
  GIRIS_YAPILDI: "Giriş yapıldı",
  TAMAMLANDI: "Tamamlandı",
  REDDEDILDI: "Reddedildi",
  IPTAL: "İptal edildi",
  IADE_EDILIYOR: "İade ediliyor",
  IADE_EDILDI: "İade edildi",
  SURESI_DOLDU: "Süresi doldu",
};

export const RESERVATION_STATUS_STYLE: Record<ReservationStatusKey, string> = {
  BEKLIYOR: "bg-amber-50 text-amber-700",
  ONAYLANDI: "bg-marka-soft text-marka-metin-hover",
  // Giriş yapıldı ve tamamlandı aynı ailede: ikisi de "başarıyla bitti".
  GIRIS_YAPILDI: "bg-emerald-50 text-emerald-700",
  TAMAMLANDI: "bg-emerald-50 text-emerald-700",
  REDDEDILDI: "bg-red-50 text-red-700",
  IPTAL: "bg-slate-100 text-slate-600",
  IADE_EDILIYOR: "bg-amber-50 text-amber-700",
  IADE_EDILDI: "bg-slate-100 text-slate-600",
  SURESI_DOLDU: "bg-slate-100 text-slate-600",
};

//: Ekranın "bu randevu artık yaşamıyor" diye soluklaştırdığı durumlar.
export const SOLUK_DURUMLAR: ReadonlySet<ReservationStatusKey> = new Set([
  "IPTAL",
  "IADE_EDILDI",
  "SURESI_DOLDU",
  "REDDEDILDI",
]);
