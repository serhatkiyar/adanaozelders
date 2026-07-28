/**
 * Sipariş ödeme durumu etiketleri (backend `OrderPaymentStatus`).
 *
 * Tek kaynak: durum gösterimi birden çok ekranda ternary zinciriyle
 * tekrarlanıyordu ve zincire girmeyen her yeni durum kullanıcıya ham İngilizce
 * sabit olarak sızıyordu (ör. iki fazlı iadeyle gelen "REFUNDING").
 */

export const ORDER_PAYMENT_LABELS: Record<string, string> = {
  PENDING: "Bekliyor",
  PAID: "Ödendi",
  FAILED: "Başarısız",
  // İki fazlı iadenin ara durumu: iade başlatıldı, sağlayıcıda henüz
  // kesinleşmedi (bkz. backend services/escrow.py).
  REFUNDING: "İade işleniyor",
  REFUNDED: "İade edildi",
};

/** Bilinmeyen durumda ham değeri döndürür (sessiz kaybolmaktansa görünür olsun). */
export function orderPaymentLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return ORDER_PAYMENT_LABELS[status] ?? status;
}

/** Para iadesi sürecinde mi (başlatıldı ya da tamamlandı)? */
export function isRefundInProgress(status: string | null | undefined): boolean {
  return status === "REFUNDING";
}
