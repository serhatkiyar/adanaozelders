// Sepet saf mantığı (store'dan ayrı → Vitest'li; persist/localStorage'a bağımlı değil).
import type { ProductKind, ProductSearchOut } from "@/types";

export interface CartItem {
  product_id: number;
  slug: string;
  title: string;
  price: string;
  cover_url?: string | null;
  kind: ProductKind;
  quantity: number;
  /** Sepet sayfasındaki seçim kutusu. Alan yoksa (eski sepet) seçili kabul edilir. */
  selected?: boolean;
}

/** Dijital ürün tek adet (indirme); fiziksel 99'a kadar. */
function maxFor(kind: ProductKind): number {
  return kind === "DIGITAL" ? 1 : 99;
}

export function addToCart(
  items: CartItem[],
  product: ProductSearchOut,
  quantity = 1
): CartItem[] {
  const existing = items.find((i) => i.product_id === product.id);
  if (existing) {
    const max = maxFor(product.kind);
    return items.map((i) =>
      i.product_id === product.id
        ? { ...i, quantity: Math.min(max, i.quantity + quantity) }
        : i
    );
  }
  return [
    ...items,
    {
      product_id: product.id,
      slug: product.slug,
      title: product.title,
      price: product.price,
      cover_url: product.cover_url,
      kind: product.kind,
      quantity: product.kind === "DIGITAL" ? 1 : quantity,
      selected: true,
    },
  ];
}

/** Satır seçili mi (alan yoksa varsayılan seçili). */
export function isSelected(item: CartItem): boolean {
  return item.selected !== false;
}

/** Seçim kutusunu ters çevirir. */
export function toggleItemSelected(
  items: CartItem[],
  productId: number
): CartItem[] {
  return items.map((i) =>
    i.product_id === productId ? { ...i, selected: !isSelected(i) } : i
  );
}

/** Yalnız seçili satırların ara toplamı (fiyat × adet). */
export function selectedSubtotal(items: CartItem[]): number {
  return items
    .filter(isSelected)
    .reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
}

/** Seçili satırları çıkarır (sipariş sonrası: satın alınanları sepetten temizle). */
export function removeSelected(items: CartItem[]): CartItem[] {
  return items.filter((i) => !isSelected(i));
}

export function setItemQuantity(
  items: CartItem[],
  productId: number,
  quantity: number
): CartItem[] {
  return items
    .map((i) =>
      i.product_id === productId ? { ...i, quantity: Math.max(0, quantity) } : i
    )
    .filter((i) => i.quantity > 0);
}

export function removeItem(items: CartItem[], productId: number): CartItem[] {
  return items.filter((i) => i.product_id !== productId);
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}
