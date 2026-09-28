import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import type { UserOut } from "@/types";

const REMEMBER_KEY = "adana-remember";

// "Beni hatırla" kapalıysa access token sessionStorage'da tutulur (sekme/tarayıcı
// kapanınca silinir); açıksa (varsayılan) localStorage'da kalıcı olur. Bayrak
// token yazılmadan ÖNCE setRemember ile belirlenir.
//
// Refresh token BURADA TUTULMAZ — `httpOnly` çerezde yaşar ve JavaScript onu
// hiç görmez (backend `core/cookies.py`). Burada yalnız kısa ömürlü access
// token durur: çalınsa bile dakikalar içinde ölür, oysa refresh token 30 gün
// boyunca hesabın kendisi kadar değerlidir.
function rememberEnabled(): boolean {
  return localStorage.getItem(REMEMBER_KEY) !== "0";
}

const switchingStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name) ?? sessionStorage.getItem(name),
  setItem: (name, value) => {
    if (rememberEnabled()) {
      sessionStorage.removeItem(name);
      localStorage.setItem(name, value);
    } else {
      localStorage.removeItem(name);
      sessionStorage.setItem(name, value);
    }
  },
  removeItem: (name) => {
    localStorage.removeItem(name);
    sessionStorage.removeItem(name);
  },
};

interface AuthState {
  token: string | null;
  user: UserOut | null;
  isAuthenticated: boolean;
  /**
   * Çıkış başladı ama sunucu isteği henüz bitmedi. Kalıcı değildir.
   * `PublicRoute` bu sırada kullanıcıyı eski token'la panosuna geri
   * yollamasın diye var (bkz. `useLogout`).
   */
  cikisYapiliyor: boolean;
  cikisBasladi: () => void;
  setRemember: (remember: boolean) => void;
  /** Login ve sessiz yenileme (rotasyon) sonrası access token'ı yazar. */
  setToken: (token: string) => void;
  setUser: (user: UserOut | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      cikisYapiliyor: false,
      cikisBasladi: () => set({ cikisYapiliyor: true }),
      setRemember: (remember) =>
        localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0"),
      setToken: (token) =>
        set({ token, isAuthenticated: true, cikisYapiliyor: false }),
      setUser: (user) => set({ user }),
      logout: () =>
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          cikisYapiliyor: false,
        }),
    }),
    {
      name: "adana-auth",
      storage: createJSONStorage(() => switchingStorage),
      partialize: (state) => ({ token: state.token }),
      onRehydrateStorage: () => (state) => {
        if (state?.token) state.isAuthenticated = true;
      },
    }
  )
);
