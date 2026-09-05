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
    // ANAHTAR BUMP'I (5 Eyl 2026): "Görünüm ve tercihler" sekmesi donduruldu.
    // Eski anahtar bırakılsaydı, daha önce ayar yapmış bir kullanıcının
    // tercihleri UYGULANMAYA DEVAM EDER ama değiştirilebileceği yüzey
    // kalmazdı — kullanıcı kendi seçtiği bir düzene kilitlenirdi. Anahtarı
    // ilerletmek herkesi varsayılana döndürür.
    { name: "adana-ui-prefs-v2" }
  )
);
