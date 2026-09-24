/**
 * Mikrofon ve kamera aç/kapa düğmeleri — Meet `ToggleDevice` görünümü
 * (La Suite Meet, MIT — DINUM/Etalab). Üç görünüm: önizleme (yuvarlak,
 * beyaz çerçeve / kırmızı), oda (kare, koyu / kırmızımsı) ve telefon (ikon
 * üstte, etiket altta). Durum ve eylem dışarıdan gelir; SDK burada yok.
 */
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI, ODA_DUGMESI, ONIZLEME_DUGMESI, TELEFON_DUGMESI } from "../stiller";

export type MedyaGorunumu = "onizleme" | "oda" | "telefon";
export type MedyaTuru = "mik" | "kamera";

const IKON: Record<MedyaTuru, { acik: IconName; kapali: IconName }> = {
  mik: { acik: "mic", kapali: "micOff" },
  kamera: { acik: "video", kapali: "videoOff" },
};

const ANAHTAR: Record<MedyaTuru, string> = {
  mik: "selectDevice.audioinput",
  kamera: "selectDevice.videoinput",
};

export function MedyaDugmesi({
  tur,
  acik,
  gorunum,
  mesgul = false,
  grup = false,
  onDegistir,
}: {
  tur: MedyaTuru;
  acik: boolean;
  gorunum: MedyaGorunumu;
  mesgul?: boolean;
  /** Yanında cihaz oku var (Meet `groupPosition="left"`): sağ köşeler düz. */
  grup?: boolean;
  onDegistir: (ac: boolean) => void;
}) {
  const { t } = useTranslation();
  const etiket = t(`${ANAHTAR[tur]}.${acik ? "disable" : "enable"}`);
  const ikon = <Icon name={acik ? IKON[tur].acik : IKON[tur].kapali} className="h-6 w-6" />;

  if (gorunum === "telefon") {
    return (
      <PlainButton
        onClick={() => onDegistir(!acik)}
        disabled={mesgul}
        aria-label={etiket}
        aria-pressed={!acik}
        className={`${TELEFON_DUGMESI.kutu} disabled:opacity-60`}
      >
        <span
          className={`${TELEFON_DUGMESI.ikon} ${acik ? ODA_DUGMESI.acik : ODA_DUGMESI.kapali}`}
        >
          {ikon}
        </span>
        <span aria-hidden className="truncate">
          {t(tur === "mik" ? "controls.microphone" : "controls.camera")}
        </span>
      </PlainButton>
    );
  }

  const stil =
    gorunum === "onizleme"
      ? `${ONIZLEME_DUGMESI.boyut} ${acik ? ONIZLEME_DUGMESI.acik : ONIZLEME_DUGMESI.kapali}`
      : `${ODA_DUGMESI.boyut} ${grup ? "rounded-r-none" : ""} ${
          acik ? ODA_DUGMESI.acik : ODA_DUGMESI.kapali
        }`;

  return (
    <PlainButton
      onClick={() => onDegistir(!acik)}
      disabled={mesgul}
      aria-label={etiket}
      aria-pressed={!acik}
      title={etiket}
      className={`${DUGME_TABANI} ${stil}`}
    >
      {ikon}
    </PlainButton>
  );
}
