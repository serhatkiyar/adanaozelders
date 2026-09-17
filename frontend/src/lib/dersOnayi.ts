import { BookingStatus, type BookingIssueReason, type BookingOut } from "@/types";

export type OnayDurumu =
  | "yok" // onay/sorun akışı bu derse uygulanmaz (başlamamış, iptal vb.)
  | "bekliyor" // öğrenci onaylayabilir ya da sorun bildirebilir
  | "onaylandi"
  | "sorun_bildirildi"
  | "sure_doldu"; // pencere kapandı, ders onaylanmış sayıldı

/**
 * Öğrencinin ders sonrası onay kartının durumu. Kural sunucudadır
 * (`booking_service.confirm_by_student` / `report_issue`); burada yalnız hangi
 * kartın çizileceğine karar verilir, sunucu yine son sözü söyler.
 */
export function onayDurumu(booking: BookingOut, now: number = Date.now()): OnayDurumu {
  if (booking.student_confirmed_at) return "onaylandi";
  if (booking.issue_reported_at) return "sorun_bildirildi";
  if (booking.status !== BookingStatus.ACCEPTED && booking.status !== BookingStatus.COMPLETED) {
    return "yok";
  }
  if (new Date(booking.start_at).getTime() > now) return "yok";
  if (booking.issue_report_deadline && new Date(booking.issue_report_deadline).getTime() < now) {
    return "sure_doldu";
  }
  // Tamamlanmış ve parası zaten eğitmene geçmiş (ör. eski kurallarla) ders.
  if (booking.payment?.status === "RELEASED") return "sure_doldu";
  return "bekliyor";
}

export const SORUN_NEDENLERI: { value: BookingIssueReason; label: string }[] = [
  { value: "TUTOR_ABSENT", label: "Eğitmen derse gelmedi" },
  { value: "LESSON_NOT_HELD", label: "Ders yapılmadı / yarım kaldı" },
  { value: "OTHER", label: "Başka bir sorun" },
];

export function sorunNedeniEtiketi(reason: string | null | undefined): string {
  return SORUN_NEDENLERI.find((n) => n.value === reason)?.label ?? "Sorun bildirildi";
}

export type IptalKurali =
  | "ucretsiz" // derse 12 saatten fazla var ya da ders henüz kabul edilmedi
  | "ogrenci_gec" // öğrenci iptal edebilir, ödenmiş ücret iade edilmez
  | "egitmen_gec"; // eğitmen iptal edemez

/** İptal penceresinde gösterilecek kural (sunucunun `late_for_changes` alanına dayanır). */
export function iptalKurali(booking: BookingOut, rol: "TUTOR" | "CLIENT"): IptalKurali {
  if (!booking.late_for_changes) return "ucretsiz";
  return rol === "TUTOR" ? "egitmen_gec" : "ogrenci_gec";
}
