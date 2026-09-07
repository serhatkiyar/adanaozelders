import { Badge } from "@/components/admin/ui";

/**
 * Stok rozeti — SAYI + durum rengi.
 *
 * Neden hem rozet hem sayı: rozet **taranan** bir listede işe yarar ("hangileri
 * bitmiş" göz taramasıyla bulunur), sayı ise **karşılaştırılan** bir listede
 * ("hangisini önce sipariş edeyim"). Yönetim listesi ikisini de yapıyor.
 * Yalnız `in_stock` boolean'ı basmak "kaç adet var" sorusunu cevapsız bırakır.
 *
 * Renk tek başına anlam TAŞIMAZ: her rozet metnini de gösterir (erişilebilirlik
 * ve renk körlüğü). Yeni bir rozet bileşeni yazılmadı, mevcut `Badge` kullanıldı.
 */
export function StockBadge({
  stock,
  threshold,
}: {
  stock: number | null | undefined;
  /**
   * Eşik SUNUCUDAN gelir (`/store/config`); burada sabit yoktur.
   *
   * `undefined` olabilir (config ucu henüz yüklenmedi ya da düştü). O
   * durumda "azalan" AYRIMI yapılamaz ve rozet nötr basılır — yanlış eşikle
   * amber göstermektense renksiz göstermek dürüsttür. Ama "Tükendi" eşikten
   * BAĞIMSIZDIR: stok 0 ise ürün satılamıyordur ve bunu söylemek için
   * hiçbir sabite ihtiyaç yok.
   */
  threshold?: number;
}) {
  // Dijital ürünün stoğu yoktur ve tükenmez — 0 gibi gösterip "Tükendi"
  // demek karşılığı olmayan bir vaat üretirdi.
  if (stock === null || stock === undefined) {
    return <span className="text-xs text-slate-400 ">-</span>;
  }
  if (stock <= 0) {
    return <Badge tone="danger">Tükendi</Badge>;
  }
  if (threshold !== undefined && stock <= threshold) {
    return <Badge tone="warning">{stock} adet</Badge>;
  }
  return <Badge tone="neutral">{stock} adet</Badge>;
}
