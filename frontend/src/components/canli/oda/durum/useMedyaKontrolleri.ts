/**
 * Oda içi mikrofon/kamera durumu ve eylemleri — masaüstü ve telefon
 * çubuğunun ortak kaynağı. Durum depodan (kendi katılımcı kaydımız) okunur;
 * eylem nötr kapıdan (`medya.ts`) sürücüye geçer, sonuç olayla depoya döner.
 */
import { useEffect, useState } from "react";

import { surucu } from "../../video/etkin";
import { kameraHataAnahtari, mikIzniReddedildiMi, type CihazTuru } from "./indirgeyiciler";
import { cihazSec, kamerayiCevir, kamerayiDegistir, mikrofonuDegistir } from "./medya";
import { kameraTercihiniKaydet } from "./oturumKamerasi";
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
    await cihazSec(tur, id);
  } catch (hata) {
    console.warn("Cihaz değişimi", hata);
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
      console.warn("Medya", hata);
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
    kameraDegistir: (ac: boolean) =>
      calistir("kamera", async () => {
        await kamerayiDegistir(ac);
        kameraTercihiniKaydet(ac);
      }),
    kameraCevir: () => calistir("kamera", kamerayiCevir),
  };
}

/** Son okunan sanal arka plan desteği (önizleme / oda ayrı): ilk çizim beklemesin. */
const arkaPlanDestegiOnbellegi = new Map<boolean, boolean>();

/**
 * Bu cihazda sanal arka plan var mı? Sürücü sorusu sözle döner (Agora
 * eklentisi tembel yüklenir); son yanıt önbellekten hemen okunur.
 */
export function useArkaPlanDestegi(etkin = true): boolean {
  const oturumda = surucu().oturumdaMi();
  const [destek, setDestek] = useState(() => arkaPlanDestegiOnbellegi.get(oturumda) ?? false);
  useEffect(() => {
    if (!etkin) return;
    let gecerli = true;
    void surucu()
      .destekler.arkaPlan()
      .catch(() => false)
      .then((varMi) => {
        arkaPlanDestegiOnbellegi.set(oturumda, varMi);
        if (gecerli) setDestek(varMi);
      });
    return () => {
      gecerli = false;
    };
  }, [etkin, oturumda]);
  return etkin && destek;
}

/**
 * Oda çizilmeden önce (sayfanın tembel yükleyicisi) desteği önbelleğe alır:
 * önizlemedeki seçici ilk çizimde "desteklenmiyor" gösterip değişmesin.
 */
export async function arkaPlanDesteginiOnbellegeAl(): Promise<void> {
  const s = surucu();
  const varMi = await s.destekler.arkaPlan().catch(() => false);
  arkaPlanDestegiOnbellegi.set(s.oturumdaMi(), varMi);
}
