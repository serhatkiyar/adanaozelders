/**
 * Telefon kontrol çubuğu — Meet `MobileControlBar` (La Suite Meet, MIT —
 * DINUM/Etalab) sadeleştirilmiş: etiketli tek satır
 * Mikrofon · Kamera · Daha fazla (Kamerayı çevir) · Çık.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { ODA_DUGMESI, TELEFON_DUGMESI } from "../stiller";
import { useMedyaKontrolleri } from "../zoom/useMedyaKontrolleri";
import { AltCekmece } from "./AltCekmece";
import { MedyaDugmesi } from "./MedyaDugmeleri";

export function TelefonCubugu({ onAyril }: { onAyril?: () => void }) {
  const { t } = useTranslation();
  const m = useMedyaKontrolleri();
  const [menuAcik, setMenuAcik] = useState(false);
  const menuyuKapat = useCallback(() => setMenuAcik(false), []);

  return (
    <>
      <div
        role="region"
        aria-label={t("controls.region")}
        className="flex w-full shrink-0 items-stretch gap-1 bg-ders-zemin px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
      >
        <MedyaDugmesi
          tur="mik"
          gorunum="telefon"
          acik={m.mikAcik}
          mesgul={m.mesgul === "mik"}
          onDegistir={(ac) => void m.mikDegistir(ac)}
        />
        <MedyaDugmesi
          tur="kamera"
          gorunum="telefon"
          acik={m.kameraAcik}
          mesgul={m.mesgul === "kamera"}
          onDegistir={(ac) => void m.kameraDegistir(ac)}
        />
        <PlainButton
          onClick={() => setMenuAcik(true)}
          aria-label={t("options.buttonLabel")}
          aria-haspopup="dialog"
          aria-expanded={menuAcik}
          className={TELEFON_DUGMESI.kutu}
        >
          <span className={`${TELEFON_DUGMESI.ikon} ${ODA_DUGMESI.acik}`}>
            <Icon name="moreHorizontal" className="h-6 w-6" />
          </span>
          <span aria-hidden className="truncate">
            {t("controls.moreOptions")}
          </span>
        </PlainButton>
        {onAyril && (
          <PlainButton
            onClick={onAyril}
            aria-label={t("controls.leave")}
            className={TELEFON_DUGMESI.kutu}
          >
            <span className={`${TELEFON_DUGMESI.ikon} ${ODA_DUGMESI.tehlike}`}>
              <Icon name="callEnd" className="h-6 w-6" />
            </span>
            <span aria-hidden className="truncate">
              {t("controls.leaveShort")}
            </span>
          </PlainButton>
        )}
      </div>

      <AltCekmece acik={menuAcik} onKapat={menuyuKapat} baslik={t("options.buttonLabel")}>
        <PlainButton
          onClick={() => {
            menuyuKapat();
            void m.kameraCevir();
          }}
          disabled={!m.kameraAcik || m.mesgul !== null}
          className="flex flex-col items-center gap-2 rounded-ders p-3 text-sm text-white hover:bg-ders-dugme disabled:opacity-40"
        >
          <Icon name="cameraSwitch" className="h-6 w-6" />
          {t("options.items.switchCamera")}
        </PlainButton>
      </AltCekmece>
    </>
  );
}
