import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import type { UserOut } from "@/types";

const REMEMBER_KEY = "ceyhan-remember";

// "Beni hatırla" kapalıysa token sessionStorage'da tutulur (sekme/tarayıcı
// kapanınca silinir); açıksa (varsayılan, geriye dönük uyumlu) localStorage'da
// kalıcı olur. Bayrak token yazılmadan ÖNCE setRemember ile belirlenir.
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
  setRemember: (remember: boolean) => void;
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
      setRemember: (remember) =>
        localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0"),
      setToken: (token) => set({ token, isAuthenticated: true }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null, isAuthenticated: false }),
    }),
    {
      name: "ceyhan-auth",
      storage: createJSONStorage(() => switchingStorage),
      partialize: (state) => ({ token: state.token }),
      onRehydrateStorage: () => (state) => {
        if (state?.token) state.isAuthenticated = true;
      },
    }
  )
);
