/**
 * Ekran paylaşımı düğmesi — Meet `ScreenShareToggle` (La Suite Meet, MIT —
 * DINUM/Etalab): kare 46px, paylaşırken seçili görünüm. YALNIZ masaüstü
 * çubuğunda ve tarayıcı destekliyorsa (`paylasimDestekli`) çizilir; telefonda
 * paylaşım yok.
 *
 * Karşı taraf paylaşırken host olmayanın düğmesi kapalıdır (SDK `HostGrab`).
 * Seçiciden vazgeçmek sessizdir; izin/sistem reddi `PaylasimHatasi`
 * penceresini, diğer hatalar kısa bildirimi açar (`paylasimHatasiTuru`).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import { toast } from "@/store/toastStore";

import { DUGME_TABANI, ODA_DUGMESI } from "../stiller";
import { paylasimHatasiTuru } from "../zoom/indirgeyiciler";
import {
  paylasimDestekli,
  paylasimDevralabilir,
  paylasimiBaslat,
  paylasimiDurdur,
} from "../zoom/istemci";
import { useAktifPaylasim, useBenPaylasiyorum } from "../zoom/odaDeposu";
import { PaylasimHatasi } from "./paylasim/PaylasimHatasi";

export function PaylasimDugmesi() {
  const { t } = useTranslation();
  const destekli = useMemo(paylasimDestekli, []);
  const paylasiyor = useBenPaylasiyorum();
  const aktifPaylasim = useAktifPaylasim();
  const [mesgul, setMesgul] = useState(false);
  const [hataAcik, setHataAcik] = useState(false);

  if (!destekli) return null;

  // Karşı taraf paylaşırken yalnız host devralabilir (SDK `HostGrab`).
  const engelli = !paylasiyor && aktifPaylasim !== null && !paylasimDevralabilir();

  const degistir = async () => {
    setMesgul(true);
    try {
      if (paylasiyor) {
        await paylasimiDurdur();
      } else {
        await paylasimiBaslat();
      }
    } catch (hata) {
      const tur = paylasimHatasiTuru(hata);
      if (tur !== "iptal") console.warn("Zoom ekran paylaşımı", hata);
      if (tur === "izin") setHataAcik(true);
      else if (tur === "mesgul") toast.error(t("error.screenShare.busy"));
      else if (tur === "diger") toast.error(t("error.screenShare.generic"));
    } finally {
      setMesgul(false);
    }
  };

  const etiket = t(`controls.screenShare.${paylasiyor ? "stop" : "start"}`);
  const ipucu = engelli ? t("error.screenShare.busy") : etiket;
  return (
    <>
      <PlainButton
        onClick={() => void degistir()}
        disabled={mesgul || engelli}
        aria-label={etiket}
        aria-pressed={paylasiyor}
        title={ipucu}
        className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${
          paylasiyor ? ODA_DUGMESI.secili : ODA_DUGMESI.acik
        }`}
      >
        <Icon name={paylasiyor ? "shareScreenStop" : "shareScreenStart"} className="h-6 w-6" />
      </PlainButton>
      <PaylasimHatasi acik={hataAcik} onKapat={() => setHataAcik(false)} />
    </>
  );
}
