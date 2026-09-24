/**
 * Masaüstü kontrol çubuğu — Meet `DesktopControlBar` + `ControlBarRegion`
 * (La Suite Meet, MIT — DINUM/Etalab): 80px yükseklik, üç sütun, ortada
 * Mikrofon▴ · Kamera▴ · Tepki · Ekran paylaş · El kaldır · ⋯ · kırmızı Ayrıl
 * (Tepki ve El yalnız Zoom command channel varsa). Oklar cihaz menüsünü, ⋯
 * Ayarlar'ı açar. (Tam ekran kaldırıldı: canlı denemede çalışmadı, kök neden
 * tarayıcısız doğrulanamadı; oda zaten pencereyi dolduruyor.) Ayrıl, sayfanın ONAYLI çıkış penceresini açar; ders
 * karşı taraf için sürer. Sağ sütun Meet `MoreOptions`: Katılımcılar ve
 * Sohbet yan panel düğmeleri (`YanPanelDugmeleri`).
 */
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI, ODA_DUGMESI } from "../stiller";
import { useOdaDeposu } from "../zoom/odaDeposu";
import { useMedyaKontrolleri } from "../zoom/useMedyaKontrolleri";
import { Acilir } from "./Acilir";
import type { AyarSekmesi } from "./AyarlarPenceresi";
import { CihazMenusu } from "./CihazMenusu";
import { MedyaDugmesi } from "./MedyaDugmeleri";
import { PaylasimDugmesi } from "./PaylasimDugmesi";
import { ElDugmesi, TepkiDugmesi } from "./Tepkiler";
import type { PanelTuru } from "./YanPanel";

/** Yan panel düğmelerinin ortak girdisi (masaüstü ve telefon çubuğu). */
export interface PanelDenetimi {
  panel: PanelTuru | null;
  onPanel: (tur: PanelTuru) => void;
  /** Ders içi sohbet var mı (ders bilgisi yüklenmediyse yok). */
  sohbetVar: boolean;
  okunmamis: number;
}

export function KontrolCubugu({
  onAyril,
  onAyarlar,
  panel,
}: {
  onAyril?: () => void;
  onAyarlar: (sekme: AyarSekmesi) => void;
  panel: PanelDenetimi;
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
        <TepkiDugmesi />
        <PaylasimDugmesi />
        <ElDugmesi />
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
      <div className="flex flex-1 basis-1/3 items-center justify-end gap-2">
        <YanPanelDugmeleri {...panel} />
      </div>
    </div>
  );
}

/** Meet `ParticipantsToggle` + `ChatToggle` (`primaryTextDark`, seçiliyken açık). */
function YanPanelDugmeleri({ panel, onPanel, sohbetVar, okunmamis }: PanelDenetimi) {
  const { t } = useTranslation();
  const sayi = useOdaDeposu((d) => d.katilimcilar.length);
  const sayiId = useId();
  const okunmamisId = useId();
  const katilimciAcik = panel === "katilimcilar";
  const sohbetAcik = panel === "sohbet";
  const rozet =
    "pointer-events-none absolute -right-1 -top-1 z-10 flex h-5 min-w-[1.25rem] select-none items-center justify-center rounded-full px-1 text-xs";

  return (
    <>
      <div className="relative inline-block">
        <PlainButton
          onClick={() => onPanel("katilimcilar")}
          aria-label={t(`controls.participants.${katilimciAcik ? "open" : "closed"}`)}
          title={t(`controls.participants.${katilimciAcik ? "open" : "closed"}`)}
          aria-describedby={sayiId}
          aria-pressed={katilimciAcik}
          className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${
            katilimciAcik ? ODA_DUGMESI.secili : ODA_DUGMESI.metin
          }`}
        >
          <Icon name="people" className="h-6 w-6" />
        </PlainButton>
        <span id={sayiId} className="sr-only">
          {t("controls.participants.count", { count: sayi })}
        </span>
        {sayi > 0 && (
          <span aria-hidden className={`${rozet} bg-slate-500 text-white`}>
            {sayi}
          </span>
        )}
      </div>
      {sohbetVar && (
        <div className="relative inline-block">
          <PlainButton
            onClick={() => onPanel("sohbet")}
            aria-label={t(`controls.chat.${sohbetAcik ? "open" : "closed"}`)}
            title={t(`controls.chat.${sohbetAcik ? "open" : "closed"}`)}
            aria-describedby={okunmamis > 0 ? okunmamisId : undefined}
            aria-pressed={sohbetAcik}
            className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${
              sohbetAcik ? ODA_DUGMESI.secili : ODA_DUGMESI.metin
            }`}
          >
            <Icon name="messages" className="h-6 w-6" />
          </PlainButton>
          {okunmamis > 0 && (
            <>
              <span id={okunmamisId} className="sr-only">
                {t("controls.chat.unread", { count: okunmamis })}
              </span>
              <span aria-hidden className={`${rozet} bg-marka font-semibold text-marka-fg`}>
                {okunmamis > 9 ? "9+" : okunmamis}
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Meet `OptionsButton` → yalnız Ayarlar. */
function SecenekMenusu({ onAyarlar }: { onAyarlar: () => void }) {
  const { t } = useTranslation();
  const [acik, setAcik] = useState(false);
  const dugme = useRef<HTMLButtonElement>(null);
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
