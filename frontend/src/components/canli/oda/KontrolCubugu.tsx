/**
 * Masaüstü kontrol çubuğu — Meet `DesktopControlBar` + `ControlBarRegion`
 * (La Suite Meet, MIT — DINUM/Etalab): 80px yükseklik, üç sütun, ortada
 * Mikrofon▴ · Kamera▴ · ⋯ · kırmızı Ayrıl. Oklar cihaz menüsünü, ⋯ Tam ekran
 * ve Ayarlar'ı açar. Ayrıl, sayfanın ONAYLI çıkış penceresini açar; ders
 * karşı taraf için sürer.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI, ODA_DUGMESI } from "../stiller";
import { useMedyaKontrolleri } from "../zoom/useMedyaKontrolleri";
import { Acilir } from "./Acilir";
import type { AyarSekmesi } from "./AyarlarPenceresi";
import { CihazMenusu } from "./CihazMenusu";
import { MedyaDugmesi } from "./MedyaDugmeleri";
import { useTamEkran } from "./useTamEkran";

export function KontrolCubugu({
  onAyril,
  onAyarlar,
}: {
  onAyril?: () => void;
  onAyarlar: (sekme: AyarSekmesi) => void;
}) {
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
        <div className="flex gap-px">
          <MedyaDugmesi
            tur="mik"
            gorunum="oda"
            grup
            acik={m.mikAcik}
            mesgul={m.mesgul === "mik"}
            onDegistir={(ac) => void m.mikDegistir(ac)}
          />
          <CihazMenusu tur="mik" acik={m.mikAcik} onAyarlar={onAyarlar} />
        </div>
        <div className="flex gap-px">
          <MedyaDugmesi
            tur="kamera"
            gorunum="oda"
            grup
            acik={m.kameraAcik}
            mesgul={m.mesgul === "kamera"}
            onDegistir={(ac) => void m.kameraDegistir(ac)}
          />
          <CihazMenusu tur="kamera" acik={m.kameraAcik} onAyarlar={onAyarlar} />
        </div>
        <SecenekMenusu onAyarlar={() => onAyarlar("ses")} />
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

/** Meet `OptionsButton` → yalnız Tam ekran ve Ayarlar. */
function SecenekMenusu({ onAyarlar }: { onAyarlar: () => void }) {
  const { t } = useTranslation();
  const [acik, setAcik] = useState(false);
  const dugme = useRef<HTMLButtonElement>(null);
  const tamEkran = useTamEkran();
  const kapat = () => setAcik(false);
  const oge = `${DUGME_TABANI} h-11 w-full justify-start rounded-ders px-3 text-sm ${ODA_DUGMESI.metin}`;

  return (
    <div className="relative">
      <PlainButton
        ref={dugme}
        onClick={() => setAcik((a) => !a)}
        aria-label={t("options.buttonLabel")}
        title={t("options.buttonLabel")}
        aria-haspopup="dialog"
        aria-expanded={acik}
        className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${ODA_DUGMESI.acik}`}
      >
        <Icon name="moreHorizontal" className="h-6 w-6" />
      </PlainButton>
      <Acilir acik={acik} onKapat={kapat} tetikleyici={dugme} etiket={t("options.buttonLabel")}>
        <div className="flex w-56 flex-col">
          {tamEkran.destekli && (
            <PlainButton
              onClick={() => {
                kapat();
                void tamEkran.degistir();
              }}
              className={oge}
            >
              <Icon
                name={tamEkran.acik ? "fullScreenMinimize" : "fullScreenMaximize"}
                className="h-5 w-5"
              />
              {t(`options.items.fullscreen.${tamEkran.acik ? "exit" : "enter"}`)}
            </PlainButton>
          )}
          <PlainButton
            onClick={() => {
              kapat();
              onAyarlar();
            }}
            className={oge}
          >
            <Icon name="settings" className="h-5 w-5" />
            {t("options.items.settings")}
          </PlainButton>
        </div>
      </Acilir>
    </div>
  );
}
