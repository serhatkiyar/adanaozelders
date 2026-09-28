import { BookingStatus, type BookingOut } from "@/types";

const OLAY_SINIFI: Partial<Record<BookingStatus, string>> = {
  [BookingStatus.PENDING]: "takvim-bekliyor",
  [BookingStatus.ACCEPTED]: "takvim-onayli",
  [BookingStatus.COMPLETED]: "takvim-tamamlandi",
};

type DersOlayiGirdisi = Pick<BookingOut, "status" | "is_free_lesson" | "series_id" | "client_name">;

/**
 * Öğretmen takvimindeki ders olayının rengi ve başlığı. İptal/reddedilen ders
 * takvimde yer tutmaz (`null`).
 *
 * İki kusurun düzeltmesi (28 Eyl 2026):
 * - Ücretsiz ilk ders rengi (`takvim-deneme`) yalnız KABUL EDİLMİŞ derse
 *   verilir. Eskiden bekleyen ücretsiz talep de aynı renkteydi ve onaylı bir
 *   dersten ayırt edilemiyordu — öğretmen yanıt bekleyen isteği kaçırıyordu.
 * - Bekleyen ders başlığında durum METİNLE, adın ARKASINDA yazılır; durum yalnız renkle
 *   taşınıyordu (WCAG 1.4.1).
 */
export function dersOlayi(
  b: DersOlayiGirdisi,
  adsizAd: string
): { sinif: string; baslik: string } | null {
  let sinif = OLAY_SINIFI[b.status];
  if (!sinif) return null;
  if (b.is_free_lesson && b.status === BookingStatus.ACCEPTED) sinif = "takvim-deneme";
  // Kabul edilmiş haftalık seri dersi ayrı renkte (Preply: haftalık ders pembe).
  else if (b.series_id && b.status === BookingStatus.ACCEPTED) sinif = "takvim-haftalik";
  const ad = b.client_name || adsizAd;
  // Ad ÖNCE: kısa olayda kutu kırpıyor; önek adı gizliyordu.
  return { sinif, baslik: b.status === BookingStatus.PENDING ? `${ad} · onay bekliyor` : ad };
}
