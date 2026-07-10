import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  favoritesCount,
  isFavorite,
  removeFavorite,
  toggleFavorite,
  type FavoriteItem,
} from "@/lib/favorites";
import { addFavorite as apiAdd, removeFavorite as apiRemove } from "@/api/store";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS } from "@/types";
import type { ProductSearchOut } from "@/types";

export type { FavoriteItem } from "@/lib/favorites";

/**
 * Mağaza favorileri (wishlist) — UI kaynağı localStorage persist (anonim de
 * çalışır); oturumlu CLIENT'ta her değişiklik best-effort sunucuya da yazılır
 * (`product_bookmarks`), girişte StoreFavoritesSync sunucuyla birleştirir.
 * Saf mutasyon mantığı `lib/favorites.ts`'tedir (Vitest'li).
 */
interface FavoritesState {
  items: FavoriteItem[];
  toggle: (product: ProductSearchOut) => void;
  has: (productId: number) => boolean;
  remove: (productId: number) => void;
  /** Girişte sunucu birleşimini tek seferde yazar (StoreFavoritesSync). */
  setAll: (items: FavoriteItem[]) => void;
  clear: () => void;
  count: () => number;
}

/** Oturumlu öğrenciyse sunucuya da yansıt (fail-soft — offline'da yerel kalır). */
function pushToServer(productId: number, added: boolean): void {
  const auth = useAuthStore.getState();
  if (!auth.token || auth.user?.role_id !== ROLE_IDS.CLIENT) return;
  void (added ? apiAdd(productId) : apiRemove(productId)).catch(() => {});
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      items: [],
      toggle: (product) => {
        const next = toggleFavorite(get().items, product);
        const added = next.length > get().items.length;
        set({ items: next });
        pushToServer(product.id, added);
      },
      has: (productId) => isFavorite(get().items, productId),
      remove: (productId) => {
        set((s) => ({ items: removeFavorite(s.items, productId) }));
        pushToServer(productId, false);
      },
      setAll: (items) => set({ items }),
      clear: () => set({ items: [] }),
      count: () => favoritesCount(get().items),
    }),
    { name: "ceyhan-favorites" }
  )
);
