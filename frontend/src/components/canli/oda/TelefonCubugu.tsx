/**
 * Telefon kontrol çubuğu — Meet `MobileControlBar` (La Suite Meet, MIT —
 * DINUM/Etalab) sadeleştirilmiş: etiketli tek satır
 * Mikrofon · Kamera · Daha fazla (Kamerayı çevir, Tam ekran, Ayarlar,
 * Katılımcılar, Sohbet) · Çık. Telefonda cihaz okları yok; cihaz seçimi
 * Ayarlar'da. Okunmamış mesaj varsa "Daha fazla" üstünde nokta, çekmecedeki
 * Sohbet'te sayı görünür; yan panel telefonda tam ekran açılır.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { ODA_DUGMESI, TELEFON_DUGMESI } from "../stiller";
import { useMedyaKontrolleri } from "../zoom/useMedyaKontrolleri";
import { AltCekmece } from "./AltCekmece";
import type { AyarSekmesi } from "./AyarlarPenceresi";
import type { PanelDenetimi } from "./KontrolCubugu";
import { MedyaDugmesi } from "./MedyaDugmeleri";
import { useTamEkran } from "./useTamEkran";

const CEKMECE_OGESI =
  "flex flex-col items-center gap-2 rounded-ders p-3 text-sm text-white hover:bg-ders-dugme disabled:opacity-40";

export function TelefonCubugu({
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
  const tamEkran = useTamEkran();
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
          <span className={`relative ${TELEFON_DUGMESI.ikon} ${ODA_DUGMESI.acik}`}>
            <Icon name="moreHorizontal" className="h-6 w-6" />
            {panel.sohbetVar && panel.okunmamis > 0 && (
              <span
                aria-hidden
                className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-ders-zemin bg-marka"
              />
            )}
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
          className={CEKMECE_OGESI}
        >
          <Icon name="cameraSwitch" className="h-6 w-6" />
          {t("options.items.switchCamera")}
        </PlainButton>
        {tamEkran.destekli && (
          <PlainButton
            onClick={() => {
              menuyuKapat();
              void tamEkran.degistir();
            }}
            className={CEKMECE_OGESI}
          >
            <Icon
              name={tamEkran.acik ? "fullScreenMinimize" : "fullScreenMaximize"}
              className="h-6 w-6"
            />
            {t(`options.items.fullscreen.${tamEkran.acik ? "exit" : "enter"}`)}
          </PlainButton>
        )}
        <PlainButton
          onClick={() => {
            menuyuKapat();
            onAyarlar("ses");
          }}
          className={CEKMECE_OGESI}
        >
          <Icon name="settings" className="h-6 w-6" />
          {t("options.items.settings")}
        </PlainButton>
        <PlainButton
          onClick={() => {
            menuyuKapat();
            panel.onPanel("katilimcilar");
          }}
          className={CEKMECE_OGESI}
        >
          <Icon name="people" className="h-6 w-6" />
          {t("options.items.participants")}
        </PlainButton>
        {panel.sohbetVar && (
          <PlainButton
            onClick={() => {
              menuyuKapat();
              panel.onPanel("sohbet");
            }}
            aria-label={
              panel.okunmamis > 0
                ? `${t("options.items.chat")}, ${t("controls.chat.unread", { count: panel.okunmamis })}`
                : undefined
            }
            className={CEKMECE_OGESI}
          >
            <span className="relative">
              <Icon name="messages" className="h-6 w-6" />
              {panel.okunmamis > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-2 -top-2 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-marka px-1 text-[10px] font-bold text-marka-fg"
                >
                  {panel.okunmamis > 9 ? "9+" : panel.okunmamis}
                </span>
              )}
            </span>
            {t("options.items.chat")}
          </PlainButton>
        )}
      </AltCekmece>
    </>
  );
}
