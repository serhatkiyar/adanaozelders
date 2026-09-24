/**
 * Ekran paylaşımı düğmesi — Meet `ScreenShareToggle` (La Suite Meet, MIT —
 * DINUM/Etalab): kare 46px, paylaşırken seçili görünüm. YALNIZ masaüstü
 * çubuğunda ve tarayıcı destekliyorsa (`paylasimDestekli`) çizilir; telefonda
 * paylaşım yok.
 *
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
import { paylasimDestekli, paylasimiBaslat, paylasimiDurdur } from "../zoom/istemci";
import { useBenPaylasiyorum } from "../zoom/odaDeposu";
import { PaylasimHatasi } from "./paylasim/PaylasimHatasi";

export function PaylasimDugmesi() {
  const { t } = useTranslation();
  const destekli = useMemo(paylasimDestekli, []);
  const paylasiyor = useBenPaylasiyorum();
  const [mesgul, setMesgul] = useState(false);
  const [hataAcik, setHataAcik] = useState(false);

  if (!destekli) return null;

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
      else if (tur === "diger") toast.error(t("error.screenShare.generic"));
    } finally {
      setMesgul(false);
    }
  };

  const etiket = t(`controls.screenShare.${paylasiyor ? "stop" : "start"}`);
  return (
    <>
      <PlainButton
        onClick={() => void degistir()}
        disabled={mesgul}
        aria-label={etiket}
        aria-pressed={paylasiyor}
        title={etiket}
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
