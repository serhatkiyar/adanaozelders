/**
 * Emoji tepkileri ve el kaldırma — Meet `reactions` + `HandToggle` (La Suite
 * Meet, MIT — DINUM/Etalab). Taşıyıcı Zoom command channel (`istemci.ts`);
 * kanal kullanılamıyorsa (`komutKanali` false) düğmeler hiç çizilmez.
 *
 * Tepkiler görsel değil metin emojisidir. Ekranda sol altta belirip 3 sn'de
 * yükselerek söner (Meet `FloatingReaction`); hareket azaltıldığında
 * (`prefers-reduced-motion`) yerinde durur, süre dolunca kalkar.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

import { DUGME_TABANI, ODA_DUGMESI } from "../stiller";
import { TEPKI_EMOJILERI } from "../zoom/indirgeyiciler";
import { elimiDegistir, tepkiGonder } from "../zoom/istemci";
import { useElimKalkik, useKomutKanali, useTepkiler } from "../zoom/odaDeposu";
import { Acilir } from "./Acilir";

/** Kontrol çubuğu: Tepki gönder (açılır emoji satırı). */
export function TepkiDugmesi() {
  const { t } = useTranslation();
  const kanal = useKomutKanali();
  const [acik, setAcik] = useState(false);
  const dugme = useRef<HTMLButtonElement>(null);
  if (!kanal) return null;
  return (
    <div className="relative">
      <PlainButton
        ref={dugme}
        onClick={() => setAcik((a) => !a)}
        aria-label={t("controls.reactions.button")}
        title={t("controls.reactions.button")}
        aria-haspopup="dialog"
        aria-expanded={acik}
        className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${
          acik ? ODA_DUGMESI.secili : ODA_DUGMESI.acik
        }`}
      >
        <Icon name="emoji" className="h-6 w-6" />
      </PlainButton>
      <Acilir
        acik={acik}
        onKapat={() => setAcik(false)}
        tetikleyici={dugme}
        etiket={t("controls.reactions.button")}
      >
        <EmojiSatiri />
      </Acilir>
    </div>
  );
}

/** Emoji düğmeleri; seçim sonrası açık kalır (Meet araç çubuğu gibi). */
function EmojiSatiri({ onGonderildi }: { onGonderildi?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1">
      {TEPKI_EMOJILERI.map((emoji) => (
        <PlainButton
          key={emoji}
          onClick={() => {
            tepkiGonder(emoji);
            onGonderildi?.();
          }}
          aria-label={t("controls.reactions.send", { emoji })}
          title={t("controls.reactions.send", { emoji })}
          className={`${DUGME_TABANI} h-ders-tepki w-ders-tepki rounded text-2xl leading-none hover:bg-ders-dugme`}
        >
          <span aria-hidden>{emoji}</span>
        </PlainButton>
      ))}
    </div>
  );
}

/** Kontrol çubuğu: El kaldır / indir (Meet `HandToggle`). */
export function ElDugmesi() {
  const { t } = useTranslation();
  const kanal = useKomutKanali();
  const kalkik = useElimKalkik();
  if (!kanal) return null;
  const etiket = t(kalkik ? "controls.hand.lower" : "controls.hand.raise");
  return (
    <PlainButton
      onClick={() => elimiDegistir(!kalkik)}
      aria-label={etiket}
      title={etiket}
      aria-pressed={kalkik}
      className={`${DUGME_TABANI} ${ODA_DUGMESI.boyut} ${
        kalkik ? ODA_DUGMESI.secili : ODA_DUGMESI.acik
      }`}
    >
      <Icon name="handRight" className="h-6 w-6" />
    </PlainButton>
  );
}

/**
 * Telefon alt çekmecesi: çubuğa sığmayıp menüye taşınan Tepkiler (emoji
 * satırı, tam genişlik) ve El kaldır (Meet `MobileControlBar` `hideReactions`
 * / `hideHand`).
 */
export function TelefonTepkileri({
  onKapat,
  ogeSinifi,
  tepkiler,
  el,
}: {
  onKapat: () => void;
  ogeSinifi: string;
  tepkiler: boolean;
  el: boolean;
}) {
  const { t } = useTranslation();
  const kanal = useKomutKanali();
  const kalkik = useElimKalkik();
  if (!kanal) return null;
  return (
    <>
      {tepkiler && (
        <div className="col-span-full flex flex-col items-center gap-2">
          <span className="text-xs text-white/70">{t("controls.reactions.button")}</span>
          <EmojiSatiri onGonderildi={onKapat} />
        </div>
      )}
      {el && (
      <PlainButton
        onClick={() => {
          onKapat();
          elimiDegistir(!kalkik);
        }}
        aria-pressed={kalkik}
        className={ogeSinifi}
      >
        <span
          className={`-m-1 inline-flex rounded-full p-1 ${
            kalkik ? "bg-ders-secili text-ders-secili-fg" : ""
          }`}
        >
          <Icon name="handRight" className="h-6 w-6" />
        </span>
        {t(kalkik ? "controls.hand.lower" : "controls.hand.raise")}
      </PlainButton>
      )}
    </>
  );
}

/**
 * Ekranda yükselen tepkiler. Sahne kabının içinde, tıklamayı yutmaz.
 * Karşı tarafın tepkisi ekran okuyucuya da okunur.
 */
export function UcanTepkiler() {
  const { t } = useTranslation();
  const tepkiler = useTepkiler();
  const sonKarsi = [...tepkiler].reverse().find((x) => !x.ben);
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {tepkiler.map((x) => (
        <div
          key={x.id}
          aria-hidden
          className="absolute bottom-16 flex animate-ders-tepki flex-col items-center gap-1 motion-reduce:animate-none"
          style={{ left: `${x.sol * 100}%` }}
        >
          <span className="text-5xl leading-none drop-shadow">{x.emoji}</span>
          {x.ad && (
            <span
              className={`max-w-[12rem] truncate rounded-full px-2 py-0.5 text-xs font-medium shadow ${
                x.ben ? "bg-marka text-marka-fg" : "bg-ders-yuzey text-white"
              }`}
            >
              {x.ben ? t("participantTile.you") : x.ad}
            </span>
          )}
        </div>
      ))}
      <p className="sr-only" aria-live="polite">
        {sonKarsi ? t("controls.reactions.announce", { name: sonKarsi.ad, emoji: sonKarsi.emoji }) : ""}
      </p>
    </div>
  );
}
