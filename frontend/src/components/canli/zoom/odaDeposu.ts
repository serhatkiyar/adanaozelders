/**
 * Canlı ders odasının durumu (zustand) ve seçici hook'lar.
 *
 * Akış tek yönlü: Zoom olayı → `istemci.ts` → saf indirgeyici → bu depo →
 * bileşen (seçiciyle). Bileşenler SDK'yı doğrudan çağırmaz; eylemler
 * `istemci.ts`in servis fonksiyonlarından geçer.
 */
import { create } from "zustand";

import {
  agSeviyesi,
  BASLANGIC,
  benKimim,
  karsiTaraf,
  karsiTarafDurumu,
  paylasimVar,
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
export const useCihazlar = () => useOdaDeposu((d) => d.cihazlar);
export const useSeciliCihazlar = () => useOdaDeposu((d) => d.secili);
export const useSesSeviyesi = () => useOdaDeposu((d) => d.sesSeviyesi);
export const useIzinler = () => useOdaDeposu((d) => d.izinler);
export const useIzinPenceresi = () => useOdaDeposu((d) => d.izinPenceresi);

/** Kartın ağ seviyesi (0–5) ya da ölçüm yoksa `null` (bkz. `agKalitesi`). */
export const useAgSeviyesi = (userId: number | undefined) =>
  useOdaDeposu((d) => agSeviyesi(d, userId));

/* Ekran paylaşımı (Paket 4) */
export const usePaylasimVar = () => useOdaDeposu(paylasimVar);
export const useAktifPaylasim = () => useOdaDeposu((d) => d.aktifPaylasim);
export const useBenPaylasiyorum = () => useOdaDeposu((d) => d.benPaylasiyorum);
export const useBenTumEkran = () => useOdaDeposu((d) => d.benTumEkran);

export function izinPenceresiniAc(acik: boolean): void {
  useOdaDeposu.setState({ izinPenceresi: acik });
}
