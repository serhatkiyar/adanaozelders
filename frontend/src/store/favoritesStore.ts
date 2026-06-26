import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  favoritesCount,
  isFavorite,
  removeFavorite,
  toggleFavorite,
  type FavoriteItem,
} from "@/lib/favorites";
import type { ProductSearchOut } from "@/types";

export type { FavoriteItem } from "@/lib/favorites";

/**
 * Mağaza favorileri (wishlist) — istemci tarafında (localStorage persist), sepet
 * (cartStore) deseninin ikizi. Backend gerektirmez; saf mutasyon mantığı
 * `lib/favorites.ts`'tedir (Vitest'li).
 */
interface FavoritesState {
  items: FavoriteItem[];
  toggle: (product: ProductSearchOut) => void;
  has: (productId: number) => boolean;
  remove: (productId: number) => void;
  clear: () => void;
  count: () => number;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      items: [],
      toggle: (product) =>
        set((s) => ({ items: toggleFavorite(s.items, product) })),
      has: (productId) => isFavorite(get().items, productId),
      remove: (productId) =>
        set((s) => ({ items: removeFavorite(s.items, productId) })),
      clear: () => set({ items: [] }),
      count: () => favoritesCount(get().items),
    }),
    { name: "ceyhan-favorites" }
  )
);
