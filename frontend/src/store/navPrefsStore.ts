import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { NavSurface, RoleNavPrefs, SurfacePrefs } from "@/lib/navPrefs";

// Kısayolların kullanıcıya özel düzeni — iki yüzey (üst bar + yan menü), her biri
// göster/gizle + sıralama. Rol bazlı tutulur (öğrenci/eğitmen listeleri farklı).
// Kişiselleştir > Navigasyon bölümünden yönetilir; DashboardHeader okur.
interface NavPrefsState {
  byRole: Record<number, RoleNavPrefs>;
  setVisible: (
    roleId: number,
    surface: NavSurface,
    to: string,
    visible: boolean
  ) => void;
  setOrder: (roleId: number, surface: NavSurface, order: string[]) => void;
  reset: (roleId: number) => void;
}

const emptySurface = (): SurfacePrefs => ({ order: [], visible: {} });
const emptyRole = (): RoleNavPrefs => ({
  navbar: emptySurface(),
  sidebar: emptySurface(),
});

export const useNavPrefsStore = create<NavPrefsState>()(
  persist(
    (set) => ({
      byRole: {},
      setVisible: (roleId, surface, to, visible) =>
        set((s) => {
          const role = s.byRole[roleId] ?? emptyRole();
          const surf = role[surface] ?? emptySurface();
          return {
            byRole: {
              ...s.byRole,
              [roleId]: {
                ...role,
                [surface]: { ...surf, visible: { ...surf.visible, [to]: visible } },
              },
            },
          };
        }),
      setOrder: (roleId, surface, order) =>
        set((s) => {
          const role = s.byRole[roleId] ?? emptyRole();
          const surf = role[surface] ?? emptySurface();
          return {
            byRole: {
              ...s.byRole,
              [roleId]: { ...role, [surface]: { ...surf, order } },
            },
          };
        }),
      reset: (roleId) =>
        set((s) => {
          const next = { ...s.byRole };
          delete next[roleId];
          return { byRole: next };
        }),
    }),
    { name: "ceyhan-nav-prefs-v2" }
  )
);
