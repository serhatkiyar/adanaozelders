/**
 * Boşta kalma ve sayfa kapanışı — iki sağlayıcı için aynı:
 *
 * - Odada, bağlıyken karşı taraf `bostaKalmaDk` boyunca yoksa `onDoldu`
 *   (oda: kendini çıkarır ve "bağlantın kesildi" penceresini açar — Zoom'un
 *   tek kişi kalınca oturumu kapatmasıyla aynı sonuç).
 * - `pagehide`: oturumdaysak yalnız kendimiz ayrılırız.
 *
 * Süre ders kaydından gelir (`lib/canliDers.ts` `bostaKalmaSuresiDk`).
 */
import { surucu } from "../../video/etkin";
import { karsiTaraf, type OdaDurumu } from "./indirgeyiciler";
import { ayril } from "./medya";
import { useOdaDeposu } from "./odaDeposu";

/** Boşta mı: odada, bağlı, ayrılmıyoruz ve karşı taraf yok. SAF. */
export function bostaMi(d: OdaDurumu): boolean {
  return d.asama === "odada" && d.baglanti === "bagli" && !d.ayriliyor && karsiTaraf(d) === null;
}

export function bostaKalmayiIzle(bostaKalmaDk: number, onDoldu: () => void): () => void {
  let zamanlayici: number | undefined;
  const bak = (d: OdaDurumu) => {
    if (bostaMi(d)) {
      zamanlayici ??= window.setTimeout(() => {
        zamanlayici = undefined;
        onDoldu();
      }, bostaKalmaDk * 60_000);
    } else if (zamanlayici !== undefined) {
      window.clearTimeout(zamanlayici);
      zamanlayici = undefined;
    }
  };
  bak(useOdaDeposu.getState());
  const coz = useOdaDeposu.subscribe(bak);
  const sayfaKapaniyor = () => {
    if (surucu().oturumdaMi()) void ayril();
  };
  window.addEventListener("pagehide", sayfaKapaniyor);
  return () => {
    coz();
    window.clearTimeout(zamanlayici);
    window.removeEventListener("pagehide", sayfaKapaniyor);
  };
}
