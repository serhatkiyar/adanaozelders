/**
 * Canlı ders odasının durumu (zustand) ve seçici hook'lar.
 *
 * Akış tek yönlü: Zoom olayı → `istemci.ts` → saf indirgeyici → bu depo →
 * bileşen (seçiciyle). Bileşenler SDK'yı doğrudan çağırmaz; eylemler
 * `istemci.ts`in servis fonksiyonlarından geçer.
 */
import { create } from "zustand";

import {
  BASLANGIC,
  benKimim,
  karsiTaraf,
  karsiTarafDurumu,
  type OdaDurumu,
} from "./indirgeyiciler";

export const useOdaDeposu = create<OdaDurumu>(() => ({ ...BASLANGIC }));

/** Saf indirgeyiciyi depoya uygular. */
export function depoyaUygula(indirgeyici: (d: OdaDurumu) => OdaDurumu): void {
  useOdaDeposu.setState((d) => indirgeyici(d), true);
}

export function depoyuSifirla(): void {
  useOdaDeposu.setState({ ...BASLANGIC }, true);
}

export const useAsama = () => useOdaDeposu((d) => d.asama);
export const useBaglanti = () => useOdaDeposu((d) => d.baglanti);
export const useBen = () => useOdaDeposu(benKimim);
export const useKarsiTaraf = () => useOdaDeposu(karsiTaraf);
export const useKarsiTarafDurumu = () => useOdaDeposu(karsiTarafDurumu);
export const useCokluVideo = () => useOdaDeposu((d) => d.cokluVideo);
export const useSesEngellendi = () => useOdaDeposu((d) => d.sesEngellendi);
export const useOdaHatasi = () => useOdaDeposu((d) => d.hata);
export const useKonusuyor = (userId: number | undefined) =>
  useOdaDeposu((d) => userId !== undefined && d.konusanlar.includes(userId));
