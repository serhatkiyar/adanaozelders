/**
 * Canlı ders odasının durumu (zustand) ve seçici hook'lar.
 *
 * Akış tek yönlü: sürücü olayı (`video/tipler.ts` `VideoOlayi`) →
 * `olayBagla.ts` → saf indirgeyici → bu depo → bileşen (seçiciyle).
 * Bileşenler SDK'yı doğrudan çağırmaz; eylemler `medya.ts` ve `surucu()`den
 * geçer. Depoya yazan tek yer bu nötr katmandır.
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
import type { KatilimciId } from "../../video/tipler";

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
export const useSesEngellendi = () => useOdaDeposu((d) => d.sesEngellendi);
export const useOdaHatasi = () => useOdaDeposu((d) => d.hata);
export const useKonusuyor = (id: KatilimciId | undefined) =>
  useOdaDeposu((d) => id !== undefined && d.konusanlar.includes(id));
export const useCihazlar = () => useOdaDeposu((d) => d.cihazlar);
export const useSeciliCihazlar = () => useOdaDeposu((d) => d.secili);
export const useSesSeviyesi = () => useOdaDeposu((d) => d.sesSeviyesi);
export const useIzinler = () => useOdaDeposu((d) => d.izinler);
export const useIzinPenceresi = () => useOdaDeposu((d) => d.izinPenceresi);

/** Kartın ağ seviyesi (0–5) ya da ölçüm yoksa `null` (bkz. `agKalitesi`). */
export const useAgSeviyesi = (id: KatilimciId | undefined) =>
  useOdaDeposu((d) => agSeviyesi(d, id));

/* Ekran paylaşımı (Paket 4) */
export const usePaylasimVar = () => useOdaDeposu(paylasimVar);
export const useAktifPaylasim = () => useOdaDeposu((d) => d.aktifPaylasim);
export const useBenPaylasiyorum = () => useOdaDeposu((d) => d.benPaylasiyorum);
export const useBenTumEkran = () => useOdaDeposu((d) => d.benTumEkran);

/* Tepkiler ve el kaldırma (Paket 6) */
export const useTepkiKanali = () => useOdaDeposu((d) => d.tepkiKanali);
export const useElimKalkik = () => useOdaDeposu((d) => d.elimKalkik);
export const useEliKalkik = (id: KatilimciId | undefined) =>
  useOdaDeposu((d) =>
    id === undefined ? false : id === d.benId ? d.elimKalkik : d.kalkikEller.includes(id),
  );
export const useTepkiler = () => useOdaDeposu((d) => d.tepkiler);

export function izinPenceresiniAc(acik: boolean): void {
  useOdaDeposu.setState({ izinPenceresi: acik });
}
