// Sipariş kalemlerinin gösterimi — saf mantık (üç yüzeyin ortak kaynağı).
//
// Kalem listesi üç yerde görünür ve **aynı** kuralları izlemek zorundadır:
// hazırlama havuzu (ne toplanacak), tur durağı (kuryede ne var), paket etiketi
// (kutunun üstünde ne yazıyor). Kuralları burada tutmak, üç yüzeyin zamanla
// birbirinden ayrışmasını engeller.
//
// Kurallar:
//  • Adet 1 ise gösterilmez ("Kitap"), 1'den büyükse gösterilir ("Kitap × 3").
//    Her satıra "× 1" yazmak gürültü üretir ve gerçek çoklu adetleri gizler.
//  • "N parça" özeti KALIR ama kalem listesinin yerine geçmez (kullanıcının
//    bildirdiği hata tam olarak buydu).
//  • Kalem listesi BOŞ ise bu "toplanacak bir şey yok" DEĞİLDİR — eski/bozuk
//    veride `order_items` satırı hiç olmayabilir. Yüzey bunu açıkça söylemek
//    zorunda; sessiz boşluk operatörü yanıltır.

export interface OrderItemLike {
  title: string;
  quantity: number;
}

/** Tek satırın gösterim metni. */
export function formatItemLine(item: OrderItemLike): string {
  const title = (item.title || "").trim() || "Başlıksız ürün";
  return item.quantity > 1 ? `${title} × ${item.quantity}` : title;
}

/** Toplam parça (adetlerin toplamı) — "N parça" özeti için. */
export function totalQuantity(items: readonly OrderItemLike[] | null | undefined): number {
  return (items ?? []).reduce((n, it) => n + (it.quantity || 0), 0);
}

/**
 * Kalem bilgisi gösterilebilir durumda mı?
 *
 * `false` ise yüzey **"kalem bilgisi yok"** demek zorundadır. Sunucu alanı hiç
 * göndermemiş olabilir (eski istemci/şema) ya da sipariş legacy olabilir; iki
 * durumda da operatörün körlemesine paket hazırlamaması gerekir.
 */
export function hasItemDetail(
  items: readonly OrderItemLike[] | null | undefined,
): boolean {
  return Array.isArray(items) && items.length > 0;
}

/** Yüzeylerin ortak kullandığı eksik-veri metni. */
export const MISSING_ITEMS_TEXT = "Kalem bilgisi yok: siparişi açıp kontrol edin";

/**
 * Tek satıra sığdırılmış özet (etiket ve dar alanlar için).
 * Örn. `"TYT Matematik × 2 · AYT Fizik"`.
 */
export function itemsSummaryLine(
  items: readonly OrderItemLike[] | null | undefined,
): string {
  if (!hasItemDetail(items)) return MISSING_ITEMS_TEXT;
  return (items ?? []).map(formatItemLine).join(" · ");
}
