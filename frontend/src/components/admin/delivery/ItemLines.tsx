import {
  MISSING_ITEMS_TEXT,
  formatItemLine,
  hasItemDetail,
  type OrderItemLike,
} from "@/lib/orderItems";

/**
 * Toplanacak kalemlerin listesi — hazırlama havuzu ve tur durağının ortak
 * gösterimi.
 *
 * Neden ayrı bileşen: aynı bilgi üç yüzeyde (havuz · durak · etiket) görünüyor
 * ve kuralları (adet gösterimi, eksik veri metni) tek yerde kalmak zorunda.
 * Etiket baskısı ayrı ele alınır — orada satırlar sarmalı, kırpılmamalı.
 *
 * Uzun başlıklar `line-clamp` ile SUNUMDA kısaltılır (veri kırpılmaz); tam
 * başlık `title` ile hover/uzun basışta görünür.
 */
export function ItemLines({
  items,
  className = "",
}: {
  items: readonly OrderItemLike[] | null | undefined;
  className?: string;
}) {
  if (!hasItemDetail(items)) {
    return (
      // Sessiz boşluk "toplanacak bir şey yok" diye okunur; eksik veri açıkça
      // söylenir (eski siparişlerde `order_items` satırı hiç olmayabilir).
      <p
        className={`text-xs font-medium text-amber-700 dark:text-amber-400 ${className}`}
      >
        {MISSING_ITEMS_TEXT}
      </p>
    );
  }

  return (
    <ul className={`space-y-0.5 ${className}`}>
      {(items ?? []).map((item, i) => (
        <li
          key={`${item.title}-${i}`}
          title={formatItemLine(item)}
          className="line-clamp-2 text-xs text-slate-600 dark:text-slate-300"
        >
          <span className="text-slate-400 dark:text-slate-500">•</span>{" "}
          {formatItemLine(item)}
        </li>
      ))}
    </ul>
  );
}
