import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  addToCart,
  cartCount,
  removeItem,
  removeSelected,
  setItemQuantity,
  toggleItemSelected,
  type CartItem,
} from "@/lib/cart";
import type { ProductSearchOut } from "@/types";

export type { CartItem } from "@/lib/cart";

/**
 * Mağaza sepeti — istemci tarafında (localStorage persist). Fiyatlar yalnız
 * GÖSTERİM içindir; checkout'ta sunucu fiyatı/stoğu yeniden doğrular (mock'a
 * güvenme kuralı). Saf mutasyon mantığı `lib/cart.ts`'tedir (Vitest'li).
 */
interface CartState {
  items: CartItem[];
  /** Sepete uygulanmış kupon kodu (sunucu doğrular; checkout'a taşınır). */
  couponCode: string | null;
  add: (product: ProductSearchOut, quantity?: number) => void;
  setQuantity: (productId: number, quantity: number) => void;
  remove: (productId: number) => void;
  /** Sepet sayfasındaki seçim kutusunu ters çevirir. */
  toggleSelected: (productId: number) => void;
  /** Seçili (satın alınan) satırları çıkarır; sepet boşalırsa kuponu da sıfırlar. */
  removeSelected: () => void;
  setCoupon: (code: string | null) => void;
  clear: () => void;
  totalCount: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      couponCode: null,
      add: (product, quantity = 1) =>
        set((s) => ({ items: addToCart(s.items, product, quantity) })),
      setQuantity: (productId, quantity) =>
        set((s) => ({ items: setItemQuantity(s.items, productId, quantity) })),
      remove: (productId) =>
        set((s) => ({ items: removeItem(s.items, productId) })),
      toggleSelected: (productId) =>
        set((s) => ({ items: toggleItemSelected(s.items, productId) })),
      removeSelected: () =>
        set((s) => {
          const items = removeSelected(s.items);
          return { items, couponCode: items.length === 0 ? null : s.couponCode };
        }),
      setCoupon: (code) => set({ couponCode: code }),
      clear: () => set({ items: [], couponCode: null }),
      totalCount: () => cartCount(get().items),
    }),
    { name: "ceyhan-cart" }
  )
);
