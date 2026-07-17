import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_CITY,
  DEFAULT_LGS_DATE,
  DEFAULT_YKS_DATE,
  type City,
  type NavbarWidget,
} from "@/lib/navbarWidget";

// Üst bardaki (navbar) logo alanında ne gösterileceğinin kullanıcı tercihi.
// Kişiselleştir penceresinden ayarlanır; localStorage'da kalıcıdır.
interface NavbarWidgetState {
  widget: NavbarWidget;
  yksDate: string;
  lgsDate: string;
  city: City;
  setWidget: (w: NavbarWidget) => void;
  setYksDate: (d: string) => void;
  setLgsDate: (d: string) => void;
  setCity: (c: City) => void;
}

export const useNavbarWidgetStore = create<NavbarWidgetState>()(
  persist(
    (set) => ({
      widget: "logo",
      yksDate: DEFAULT_YKS_DATE,
      lgsDate: DEFAULT_LGS_DATE,
      city: DEFAULT_CITY,
      setWidget: (w) => set({ widget: w }),
      setYksDate: (d) => set({ yksDate: d }),
      setLgsDate: (d) => set({ lgsDate: d }),
      setCity: (c) => set({ city: c }),
    }),
    { name: "adana-navbar-widget" }
  )
);
