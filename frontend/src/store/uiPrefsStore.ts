import { create } from "zustand";
import { persist } from "zustand/middleware";

// Genel arayüz/keşif tercihleri (Kişiselleştir penceresinden yönetilir).
// Tema ve navbar widget'ı kendi store'larında; burası onların dışındaki
// görünüm anahtarlarını tutar.
interface UiPrefsState {
  /** Ana sayfadaki "Son Görüntülenen İlanlar" bölümü gösterilsin mi? */
  showRecentlyViewed: boolean;
  setShowRecentlyViewed: (v: boolean) => void;
}

export const useUiPrefsStore = create<UiPrefsState>()(
  persist(
    (set) => ({
      showRecentlyViewed: true,
      setShowRecentlyViewed: (v) => set({ showRecentlyViewed: v }),
    }),
    { name: "adana-ui-prefs" }
  )
);
