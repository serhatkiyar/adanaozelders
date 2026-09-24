/**
 * Oda içi mikrofon/kamera durumu ve eylemleri — masaüstü ve telefon
 * çubuğunun ortak kaynağı. Durum SDK'dan (kendi katılımcı kaydımız) okunur;
 * eylem servis fonksiyonundan geçer, sonuç yine olayla depoya döner.
 */
import { useState } from "react";

import { kameraHataAnahtari, mikIzniReddedildiMi, type CihazTuru } from "./indirgeyiciler";
import {
  hoparlorSec,
  kameraSec,
  kamerayiCevir,
  kamerayiDegistir,
  mikrofonSec,
  mikrofonuDegistir,
} from "./istemci";
import { izinPenceresiniAc, useBen, useOdaDeposu } from "./odaDeposu";

/** İzin reddi → yönlendirme penceresi; diğer hatalar → şerit. */
function hatayiGoster(tur: "mik" | "kamera", hata: unknown): void {
  const izinYok =
    tur === "kamera"
      ? kameraHataAnahtari(hata) === "join.cameraNotGranted"
      : mikIzniReddedildiMi(hata);
  if (izinYok) izinPenceresiniAc(true);
  useOdaDeposu.setState({ hata: izinYok ? null : "media.deviceError" });
}

/** Ders içinde cihaz değişimi (menü ve Ayarlar ortak). */
export async function cihazDegistir(tur: CihazTuru, id: string): Promise<void> {
  try {
    if (tur === "mikrofon") await mikrofonSec(id);
    else if (tur === "hoparlor") await hoparlorSec(id);
    else await kameraSec(id);
  } catch (hata) {
    console.warn("Zoom cihaz değişimi", hata);
    useOdaDeposu.setState({ hata: "media.deviceError" });
  }
}

export function useMedyaKontrolleri() {
  const ben = useBen();
  const [mesgul, setMesgul] = useState<null | "mik" | "kamera">(null);

  const calistir = async (tur: "mik" | "kamera", is: () => Promise<void>) => {
    setMesgul(tur);
    try {
      await is();
      useOdaDeposu.setState({ hata: null });
    } catch (hata) {
      console.warn("Zoom medya", hata);
      hatayiGoster(tur, hata);
    } finally {
      setMesgul(null);
    }
  };

  return {
    mikAcik: Boolean(ben && !ben.mikKapali),
    kameraAcik: Boolean(ben?.videoAcik),
    mesgul,
    mikDegistir: (ac: boolean) => calistir("mik", () => mikrofonuDegistir(ac)),
    kameraDegistir: (ac: boolean) => calistir("kamera", () => kamerayiDegistir(ac)),
    kameraCevir: () => calistir("kamera", kamerayiCevir),
  };
}
