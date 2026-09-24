/**
 * Masaüstü kontrol çubuğu — Meet `DesktopControlBar` + `ControlBarRegion`
 * (La Suite Meet, MIT — DINUM/Etalab): 80px yükseklik, üç sütun, ortada
 * Mikrofon · Kamera · kırmızı Ayrıl. Ayrıl, sayfanın ONAYLI çıkış penceresini
 * açar; ders karşı taraf için sürer.
 */
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI, ODA_DUGMESI } from "../stiller";
import { useMedyaKontrolleri } from "../zoom/useMedyaKontrolleri";
import { MedyaDugmesi } from "./MedyaDugmeleri";

export function KontrolCubugu({ onAyril }: { onAyril?: () => void }) {
  const { t } = useTranslation();
  const m = useMedyaKontrolleri();
  return (
    <div className="flex h-ders-cubuk w-full shrink-0 items-center bg-ders-zemin px-[1.125rem]">
      <div className="flex flex-1 basis-1/3" />
      <div
        role="region"
        aria-label={t("controls.region")}
        className="flex flex-1 basis-1/3 items-center justify-center gap-[0.65rem]"
      >
        <MedyaDugmesi
          tur="mik"
          gorunum="oda"
          acik={m.mikAcik}
          mesgul={m.mesgul === "mik"}
          onDegistir={(ac) => void m.mikDegistir(ac)}
        />
        <MedyaDugmesi
          tur="kamera"
          gorunum="oda"
          acik={m.kameraAcik}
          mesgul={m.mesgul === "kamera"}
          onDegistir={(ac) => void m.kameraDegistir(ac)}
        />
        {onAyril && (
          <PlainButton
            onClick={onAyril}
            aria-label={t("controls.leave")}
            title={t("controls.leave")}
            className={`${DUGME_TABANI} h-[46px] min-w-[46px] rounded px-4 ${ODA_DUGMESI.tehlike}`}
          >
            <Icon name="callEnd" className="h-6 w-6" />
          </PlainButton>
        )}
      </div>
      <div className="flex flex-1 basis-1/3" />
    </div>
  );
}
