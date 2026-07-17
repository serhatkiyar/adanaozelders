import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Kullanıcının son gezdiği yüzey — /hesabim bağlama duyarlı navbar için.
 * "store" = mağaza (StoreLayout), "discover" = keşif/eğitmen tarafı.
 * Yüzey sayfaları mount'ta yazar; panel sayfaları (mesajlar/ayarlar vb.)
 * yüzeyi DEĞİŞTİRMEZ — "son gezilen dükkân" korunur. */
export type Surface = "discover" | "store";

interface SurfaceState {
  lastSurface: Surface;
  setSurface: (s: Surface) => void;
}

export const useSurfaceStore = create<SurfaceState>()(
  persist(
    (set) => ({
      lastSurface: "discover",
      setSurface: (s) => set({ lastSurface: s }),
    }),
    { name: "adana-last-surface" }
  )
);
