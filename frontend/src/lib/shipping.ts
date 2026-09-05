// Kargo (eşikli ücretsiz kargo) — GÖSTERİM yardımcıları.
//
// Nihai kargo/tutar ödeme adımında SUNUCUDA hesaplanır
// (`order_service.compute_shipping`). Buradaki değerler yalnız "ücretsiz
// kargoya ne kadar kaldı" gibi bilgilendirme içindir.
//
// ── EŞİK NEDEN ARTIK SUNUCUDAN OKUNUYOR ──
//
// Sabitler burada FALLBACK olarak duruyor ama tek doğruluk kaynağı
// `GET /store/config`tir. Eşik `.env`'den (`SHIPPING_FREE_THRESHOLD`)
// değiştirildiğinde vitrin eski değeriyle "ücretsiz kargoya 20 TL kaldı" der,
// ödemede başka bir tutar çıkardı — sepetteki en pahalı sürpriz budur.

/** Sunucu erişilemezse kullanılan son çare değerler (backend varsayılanları). */
export const SHIPPING_FREE_THRESHOLD = 500; // TL
export const SHIPPING_FLAT_FEE = 49.9; // TL (eşik altı fiziksel sipariş)

export interface ShippingConfig {
  freeThreshold: number;
  flatFee: number;
}

/** Sunucudan gelen mağaza ayarını sayısal kargo yapılandırmasına çevirir.
 *  Alan yoksa ya da sayıya çevrilemiyorsa yerel sabite düşülür. */
export function shippingConfig(config?: {
  shipping_free_threshold?: string | null;
  shipping_flat_fee?: string | null;
}): ShippingConfig {
  const sayi = (deger: string | null | undefined, yedek: number) => {
    const n = Number(deger);
    return Number.isFinite(n) && n >= 0 ? n : yedek;
  };
  return {
    freeThreshold: sayi(config?.shipping_free_threshold, SHIPPING_FREE_THRESHOLD),
    flatFee: sayi(config?.shipping_flat_fee, SHIPPING_FLAT_FEE),
  };
}

/** Ara toplama göre gösterimlik kargo ücreti (eşik üstü ücretsiz). */
export function shippingFor(
  subtotal: number,
  config: ShippingConfig = {
    freeThreshold: SHIPPING_FREE_THRESHOLD,
    flatFee: SHIPPING_FLAT_FEE,
  }
): number {
  return subtotal >= config.freeThreshold ? 0 : config.flatFee;
}

/** Ücretsiz kargoya kalan tutar (0 ise eşik geçilmiş). */
export function remainingForFreeShipping(
  subtotal: number,
  config: ShippingConfig = {
    freeThreshold: SHIPPING_FREE_THRESHOLD,
    flatFee: SHIPPING_FLAT_FEE,
  }
): number {
  return Math.max(0, config.freeThreshold - subtotal);
}
