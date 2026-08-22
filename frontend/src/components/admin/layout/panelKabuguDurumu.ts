import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Panel kabuğunun kalıcı durumu (İP-B1 · Görev 4).
 *
 * Bugün tek bir anahtar taşıyor: gezinme çubuğu katlı mı. Yine de kendi
 * store'unda yaşıyor, çünkü kabuk tercihleri (yoğunluk, sabitlenen alanlar)
 * B serisinde büyüyecek ve `uiPrefsStore` genel arayüz tercihlerinin yeri —
 * panel kabuğuna özel anahtarları oraya karıştırmak iki kavramı birleştirirdi.
 *
 * **Neden kalıcı:** katlama bir tercihtir, bir kip değil. Her açılışta
 * varsayılana dönen bir katlama düğmesi, katlamayı işe yaramaz kılar: dar
 * ekranda çalışan kullanıcı her sekmede yeniden katlamak zorunda kalırdı.
 *
 * Anahtar adı testlerde de kullanıldığı için dışa verilir; testin string'i
 * kendi yazması, adı değiştiren bir düzenlemede nöbetçiyi sessizce yalancı
 * yeşile çevirirdi.
 */
export const KABUK_DEPO_ANAHTARI = "adana-panel-kabuk";

interface PanelKabuguDurumu {
  /** Gezinme çubuğu katlı mı (yalnız ikon). */
  katli: boolean;
  katlamaDegistir: () => void;
}

export const usePanelKabugu = create<PanelKabuguDurumu>()(
  persist(
    (set, get) => ({
      katli: false,
      katlamaDegistir: () => set({ katli: !get().katli }),
    }),
    { name: KABUK_DEPO_ANAHTARI }
  )
);
