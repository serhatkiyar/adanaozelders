// Favori (wishlist) saf mantığı (store'dan ayrı → Vitest'li; localStorage'a bağımlı değil).
// Sepet deseninin (lib/cart.ts) ikizi. Favori öğesi tam ProductSearchOut'tur; favoriler
// sayfası bunu doğrudan ProductCard'a basar (ek istek yok). Fiyat yalnız gösterim içindir.
import type { ProductSearchOut } from "@/types";

export type FavoriteItem = ProductSearchOut;

export function isFavorite(items: FavoriteItem[], productId: number): boolean {
  return items.some((i) => i.id === productId);
}

export function toggleFavorite(
  items: FavoriteItem[],
  product: ProductSearchOut
): FavoriteItem[] {
  return isFavorite(items, product.id)
    ? items.filter((i) => i.id !== product.id)
    : [product, ...items];
}

export function removeFavorite(
  items: FavoriteItem[],
  productId: number
): FavoriteItem[] {
  return items.filter((i) => i.id !== productId);
}

export function favoritesCount(items: FavoriteItem[]): number {
  return items.length;
}
