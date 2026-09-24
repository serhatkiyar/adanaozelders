/**
 * Oda içi mikrofon/kamera durumu ve eylemleri — masaüstü ve telefon
 * çubuğunun ortak kaynağı. Durum SDK'dan (kendi katılımcı kaydımız) okunur;
 * eylem servis fonksiyonundan geçer, sonuç yine olayla depoya döner.
 */
import { useState } from "react";

import { kamerayiCevir, kamerayiDegistir, mikrofonuDegistir } from "./istemci";
import { useBen, useOdaDeposu } from "./odaDeposu";

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
      useOdaDeposu.setState({ hata: "media.deviceError" });
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
