// Kargo (eşikli ücretsiz kargo) — GÖSTERİM sabitleri. Nihai kargo/tutar ödeme adımında
// SUNUCUDA hesaplanır (Faz B: backend config SHIPPING_FREE_THRESHOLD/SHIPPING_FLAT_FEE ile
// hizalanacak). Burası yalnız sepet eşik çubuğu ve ürün detay bilgisi içindir.
export const SHIPPING_FREE_THRESHOLD = 500; // TL
export const SHIPPING_FLAT_FEE = 49.9; // TL (eşik altı fiziksel sipariş)

/** Ara toplama göre gösterimlik kargo ücreti (eşik üstü ücretsiz). */
export function shippingFor(subtotal: number): number {
  return subtotal >= SHIPPING_FREE_THRESHOLD ? 0 : SHIPPING_FLAT_FEE;
}

/** Ücretsiz kargoya kalan tutar (0 ise eşik geçilmiş). */
export function remainingForFreeShipping(subtotal: number): number {
  return Math.max(0, SHIPPING_FREE_THRESHOLD - subtotal);
}
