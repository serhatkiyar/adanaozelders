/**
 * Ekran paylaşımı düğmesi — Meet `ScreenShareToggle` (La Suite Meet, MIT —
 * DINUM/Etalab): kare 46px, paylaşırken seçili görünüm. YALNIZ masaüstü
 * çubuğunda ve tarayıcı destekliyorsa (`destekler.ekranPaylasimi`) çizilir; telefonda
 * paylaşım yok.
 *
 * İpucu: tüm ekran yerine pencere/sekme paylaşmak yazıları büyütür (karşı
 * tarafta paylaşım ölçeklenerek küçülür).
 *
 * Karşı taraf paylaşırken devralamayanın düğmesi kapalıdır (Zoom `HostGrab`).
 * Seçiciden vazgeçmek sessizdir; izin/sistem reddi `PaylasimHatasi`
 * penceresini, diğer hatalar kısa bildirimi açar (`paylasimHatasiTuru`).
 */
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";
import { toast } from "@/store/toastStore";

import { DUGME_TABANI, ODA_DUGMESI } from "../stiller";
import { surucu } from "../video/etkin";
import { paylasimHatasiTuru } from "./durum/indirgeyiciler";
import { paylasimiBaslat, paylasimiDurdur } from "./durum/medya";
import { useAktifPaylasim, useBenPaylasiyorum } from "./durum/odaDeposu";
import { PaylasimHatasi } from "./paylasim/PaylasimHatasi";

export function PaylasimDugmesi() {
  const { t } = useTranslation();
  const destekli = useMemo(() => surucu().destekler.ekranPaylasimi(), []);
  const paylasiyor = useBenPaylasiyorum();
  const aktifPaylasim = useAktifPaylasim();
  const [mesgul, setMesgul] = useState(false);
  const [hataAcik, setHataAcik] = useState(false);
  const ipucuId = useId();

  if (!destekli) return null;

  // Karşı taraf paylaşırken yalnız devralabilen (Zoom'da host) başlatabilir.
  const engelli = !paylasiyor && aktifPaylasim !== null && !surucu().paylasimDevralabilir();

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
      if (tur !== "iptal") console.warn("Ekran paylaşımı", hata);
      if (tur === "izin") setHataAcik(true);
      else if (tur === "mesgul") toast.error(t("error.screenShare.busy"));
      else if (tur === "diger") toast.error(t("error.screenShare.generic"));
    } finally {
      setMesgul(false);
    }
  };

  const etiket = t(`controls.screenShare.${paylasiyor ? "stop" : "start"}`);
  // Başlatmadan önce: pencere/sekme paylaşımı daha okunaklı.
  const paylasimIpucu = !paylasiyor && !engelli;
  const ipucu = engelli
    ? t("error.screenShare.busy")
    : paylasimIpucu
      ? `${etiket}\n${t("controls.screenShare.hint")}`
      : etiket;
  return (
    <>
      <PlainButton
        onClick={() => void degistir()}
        disabled={mesgul || engelli}
        aria-label={etiket}
        aria-pressed={paylasiyor}
        aria-describedby={paylasimIpucu ? ipucuId : undefined}
        title={ipucu}
        className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${
          paylasiyor ? ODA_DUGMESI.secili : ODA_DUGMESI.acik
        }`}
      >
        <Icon name={paylasiyor ? "shareScreenStop" : "shareScreenStart"} className="h-6 w-6" />
      </PlainButton>
      {paylasimIpucu && (
        <span id={ipucuId} className="sr-only">
          {t("controls.screenShare.hint")}
        </span>
      )}
      <PaylasimHatasi acik={hataAcik} onKapat={() => setHataAcik(false)} />
    </>
  );
}
