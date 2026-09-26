/**
 * Olay köprüsü: sürücü olayı (`VideoOlayi`) → saf indirgeyici → depo.
 * Depoya yazan tek yer nötr katmandır; sürücü depo bilmez. Dönen fonksiyon
 * dinleyiciyi söker (StrictMode'un kur-sök-kur döngüsü için).
 */
import { surucu } from "../../video/etkin";
import type { NotrBilet } from "../../video/tipler";
import {
  agKalitesiDegisti,
  aktifKonusanlar,
  aktifPaylasimDegisti,
  baglantiDegisti,
  benimPaylasimim,
  katilimcilariEsitle,
  medyaHatasi,
  paylasimiEsitle,
  sesEngellendi,
  sesKalitesiDegisti,
  yenidenBaglandi,
} from "./indirgeyiciler";
import { cihazlariOku } from "./medya";
import { depoyaUygula, useOdaDeposu } from "./odaDeposu";
import { elimiYenidenBildir, elleriEsitle } from "./tepkiler";

export function olaylariBagla(
  secenekler: {
    kapaliykenKonusma?: () => void;
    /** Bilet bitmek üzere: yenisi alınıp sürücüye verilir. */
    biletTazele?: () => Promise<NotrBilet | undefined>;
  } = {},
): () => void {
  return surucu().olaylar((olay) => {
    switch (olay.t) {
      case "katilimcilar": {
        const once = useOdaDeposu.getState();
        const oncekiler = new Set(once.katilimcilar.map((k) => k.id));
        depoyaUygula((d) => katilimcilariEsitle(d, olay.liste));
        // Yeni bir karşı taraf (ya da kimliği değişen): kalkık eller eşitlenir.
        const yeniVar = olay.liste.some((k) => !k.ben && !oncekiler.has(k.id));
        if (yeniVar && once.asama === "odada") elleriEsitle();
        break;
      }
      case "baglanti": {
        const onceki = useOdaDeposu.getState().baglanti;
        depoyaUygula((d) => baglantiDegisti(d, olay.durum));
        // Kimliğim değişmiş olabilir: karşı taraf kalkık elimi yeniden öğrensin.
        if (yenidenBaglandi(onceki, olay.durum)) elimiYenidenBildir();
        break;
      }
      case "konusanlar":
        depoyaUygula((d) => aktifKonusanlar(d, olay.idler));
        break;
      case "sesSeviyem":
        useOdaDeposu.setState({ sesSeviyesi: olay.seviye });
        break;
      case "ag":
        depoyaUygula((d) => agKalitesiDegisti(d, olay));
        break;
      case "sesKalitesi":
        depoyaUygula((d) =>
          sesKalitesiDegisti(sesKalitesiDegisti(d, "encode", olay.encode), "decode", olay.decode),
        );
        break;
      case "sesEngellendi":
        depoyaUygula((d) => sesEngellendi(d, olay.engellendi));
        break;
      case "cihazlarDegisti":
        cihazlariOku();
        break;
      case "kapaliykenKonusma":
        secenekler.kapaliykenKonusma?.();
        break;
      case "medyaHatasi":
        depoyaUygula(medyaHatasi);
        break;
      case "paylasim":
        depoyaUygula((d) =>
          olay.esitle ? paylasimiEsitle(d, olay.id) : aktifPaylasimDegisti(d, olay.id),
        );
        break;
      case "paylasimBitti":
        depoyaUygula((d) => benimPaylasimim(d, false));
        break;
      case "paylasimYuzeyi":
        depoyaUygula((d) => (d.benPaylasiyorum ? benimPaylasimim(d, true, olay.tumEkran) : d));
        break;
      case "biletSonu": {
        const tazele = secenekler.biletTazele;
        if (!tazele) break;
        void tazele()
          .then((b) => (b ? surucu().bileTazele(b) : undefined))
          .catch((e: unknown) => console.warn("Bilet tazelenemedi", e));
        break;
      }
    }
  });
}
