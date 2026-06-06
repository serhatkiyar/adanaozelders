import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";
/** Kullanıcı tercihi: açık, koyu veya işletim sistemini izle. */
export type ThemePreference = Theme | "system";

const MEDIA = "(prefers-color-scheme: dark)";

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia(MEDIA).matches
    ? "dark"
    : "light";
}

/** Tercihi şu anki gerçek temaya çözer ("system" → OS değeri). */
function resolveTheme(pref: ThemePreference): Theme {
  return pref === "system" ? systemTheme() : pref;
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

interface ThemeState {
  /** Kullanıcının seçtiği tercih (kaydedilen değer). */
  preference: ThemePreference;
  /** Şu an uygulanan gerçek tema (system çözümlenmiş hali). */
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
  setPreference: (p: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      preference: "light",
      theme: "light",
      toggle: () => {
        const next: Theme = get().theme === "dark" ? "light" : "dark";
        applyTheme(next);
        set({ preference: next, theme: next });
      },
      setTheme: (t) => {
        applyTheme(t);
        set({ preference: t, theme: t });
      },
      setPreference: (p) => {
        const resolved = resolveTheme(p);
        applyTheme(resolved);
        set({ preference: p, theme: resolved });
      },
    }),
    {
      name: "ceyhan-theme",
      // Yalnız tercihi kaydet; gerçek tema her açılışta tercihten çözülür.
      partialize: (s) => ({ preference: s.preference }),
      onRehydrateStorage: () => (state) => {
        // Geriye dönük uyum: eski kayıtlarda yalnız `theme` vardı.
        const legacy = (state as { theme?: Theme } | undefined)?.theme;
        const pref = state?.preference ?? legacy ?? "light";
        const resolved = resolveTheme(pref);
        applyTheme(resolved);
        useThemeStore.setState({ preference: pref, theme: resolved });
      },
    }
  )
);

// "system" tercihi seçiliyken OS teması değişirse anında yansıt.
if (typeof window !== "undefined") {
  window.matchMedia(MEDIA).addEventListener("change", () => {
    if (useThemeStore.getState().preference === "system") {
      const resolved = systemTheme();
      applyTheme(resolved);
      useThemeStore.setState({ theme: resolved });
    }
  });
}
