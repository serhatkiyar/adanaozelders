/**
 * Sipariş durumu etiketleri ve rozet tonu (backend `OrderStatus`).
 *
 * Kardeşi `orderPayment.ts` (ödeme durumu) ile aynı gerekçe: durum gösterimi
 * ekranlarda ternary zinciriyle tekrarlanınca, zincire girmeyen her yeni durum
 * kullanıcıya ham İngilizce sabit olarak sızıyor. Yönetim sipariş listesi bu
 * pakete kadar `{o.status} · {o.payment_status}` basıyordu — yani yönetici
 * "PAID · SHIPPED" okuyordu.
 *
 * Renk tek başına anlam TAŞIMAZ: her rozet metnini de gösterir.
 */

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "Ödeme bekliyor",
  PAID: "Hazırlanacak",
  SHIPPED: "Kargoda",
  DELIVERED: "Teslim edildi",
  CANCELLED: "İptal edildi",
  REFUNDED: "İade edildi",
};

const ORDER_STATUS_TONES: Record<string, Tone> = {
  PENDING: "warning",
  // Ödenmiş sipariş bir İŞ'tir (hazırlanmayı bekliyor) — bu yüzden "info",
  // "success" değil. Yeşil, iş bittiğinde (DELIVERED) gelir.
  PAID: "info",
  SHIPPED: "info",
  DELIVERED: "success",
  CANCELLED: "neutral",
  REFUNDED: "danger",
};

/** Bilinmeyen durumda ham değeri döndürür (sessiz kaybolmaktansa görünür olsun). */
export function orderStatusLabel(status: string | null | undefined): string {
  if (!status) return "-";
  return ORDER_STATUS_LABELS[status] ?? status;
}

export function orderStatusTone(status: string | null | undefined): Tone {
  if (!status) return "neutral";
  return ORDER_STATUS_TONES[status] ?? "neutral";
}

/** Ödeme durumunun rozet tonu (etiketler `orderPayment.ts`'te). */
export function orderPaymentTone(status: string | null | undefined): Tone {
  switch (status) {
    case "PAID":
      return "success";
    case "PENDING":
      return "warning";
    case "FAILED":
      return "danger";
    case "REFUNDING":
      return "warning";
    case "REFUNDED":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Durum filtresinin seçenekleri — sunucudaki `OrderStatus` ile aynı küme. */
export const ORDER_STATUS_FILTERS = Object.keys(ORDER_STATUS_LABELS);
