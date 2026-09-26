/**
 * Masaüstü kontrol çubuğunda Mikrofon/Kamera düğmesinin yanındaki ok ve
 * açılan cihaz menüsü — Meet `AudioDevicesControl` / `VideoDeviceControl`
 * (La Suite Meet, MIT — DINUM/Etalab). Mikrofon menüsü: mikrofon seçici +
 * seviye, hoparlör seçici + test; kamera menüsü: kamera seçici. İkisinde de
 * "Ayarlar" kısayolu. Telefonda gösterilmez.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI, ODA_DUGMESI } from "../stiller";
import { surucu } from "../video/etkin";
import { gorunenCihazId, odaSeviyeOrani } from "./durum/indirgeyiciler";
import { useCihazlar, useSeciliCihazlar, useSesSeviyesi } from "./durum/odaDeposu";
import { cihazDegistir } from "./durum/useMedyaKontrolleri";
import { Acilir } from "./Acilir";
import { CihazSecici, HoparlorTesti } from "./CihazSecici";
import { SesSeviyesi } from "./SesSeviyesi";

export function CihazMenusu({
  tur,
  acik: cihazAcik,
  onAyarlar,
}: {
  tur: "mik" | "kamera";
  /** Cihaz açık mı (ok düğmesinin rengi toggle ile aynı). */
  acik: boolean;
  onAyarlar: (sekme: "ses" | "goruntu") => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const ok = useRef<HTMLButtonElement>(null);
  const cihazlar = useCihazlar();
  const secili = useSeciliCihazlar();
  const seviye = useSesSeviyesi();
  const etiket = t(tur === "mik" ? "selectDevice.settings.audio" : "selectDevice.settings.video");

  return (
    <div className="relative">
      <PlainButton
        ref={ok}
        onClick={() => setMenu((a) => !a)}
        aria-label={etiket}
        title={etiket}
        aria-haspopup="dialog"
        aria-expanded={menu}
        className={`${DUGME_TABANI} h-[46px] w-7 rounded rounded-l-none ${
          cihazAcik ? ODA_DUGMESI.acik : ODA_DUGMESI.kapali
        }`}
      >
        <Icon name="chevronUp" className="h-4 w-4" />
      </PlainButton>
      <Acilir acik={menu} onKapat={() => setMenu(false)} tetikleyici={ok} etiket={etiket}>
        <div className="flex w-[min(34rem,calc(100vw-2rem))] flex-col gap-2 sm:flex-row">
          {tur === "mik" ? (
            <>
              <div className="min-w-0 flex-1">
                <CihazSecici
                  tur="mikrofon"
                  cihazlar={cihazlar.mikrofon}
                  secili={gorunenCihazId(secili.mikrofon, cihazlar.mikrofon)}
                  onSec={(id) => void cihazDegistir("mikrofon", id)}
                />
                <SesSeviyesi oran={cihazAcik ? odaSeviyeOrani(seviye) : null} />
              </div>
              {surucu().destekler.hoparlorSecimi() && (
                <div className="min-w-0 flex-1">
                  <CihazSecici
                    tur="hoparlor"
                    cihazlar={cihazlar.hoparlor}
                    secili={gorunenCihazId(secili.hoparlor, cihazlar.hoparlor)}
                    onSec={(id) => void cihazDegistir("hoparlor", id)}
                  />
                  <HoparlorTesti hoparlorId={secili.hoparlor} />
                </div>
              )}
            </>
          ) : (
            <div className="min-w-0 flex-1">
              <CihazSecici
                tur="kamera"
                cihazlar={cihazlar.kamera}
                secili={gorunenCihazId(secili.kamera, cihazlar.kamera)}
                onSec={(id) => void cihazDegistir("kamera", id)}
              />
            </div>
          )}
          <PlainButton
            onClick={() => {
              setMenu(false);
              onAyarlar(tur === "mik" ? "ses" : "goruntu");
            }}
            aria-label={t("options.items.settings")}
            title={t("options.items.settings")}
            className={`${DUGME_TABANI} h-11 w-11 self-start rounded-ders ${ODA_DUGMESI.metin}`}
          >
            <Icon name="settings" className="h-5 w-5" />
          </PlainButton>
        </div>
      </Acilir>
    </div>
  );
}
