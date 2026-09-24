/**
 * Arka plan seçimi — Meet `EffectsConfiguration` (La Suite Meet, MIT —
 * DINUM/Etalab) sadeleştirilmiş: Yok · Bulanıklaştır · düz renkler. Görsel
 * yok (bkz. `zoom/arkaPlan.ts`). Önizlemede koyu, Ayarlar'da açık görünüm.
 *
 * Desteklenmeyen cihazda (telefon tarayıcıları, eski tarayıcı) seçenekler
 * gösterilmez; yalnız kısa not.
 */
import { useTranslation } from "react-i18next";

import { PlainButton } from "@/components/ui/PlainButton";

import {
  ARKA_PLAN_RENKLERI,
  ARKA_PLANLAR,
  arkaPlanRengi,
  type ArkaPlan,
} from "../zoom/arkaPlan";

export function ArkaPlanSecici({
  secili,
  onSec,
  destekli,
  gorunum = "koyu",
  mesgul = false,
}: {
  secili: ArkaPlan;
  onSec: (ap: ArkaPlan) => void;
  destekli: boolean;
  gorunum?: "koyu" | "acik";
  mesgul?: boolean;
}) {
  const { t } = useTranslation();
  const koyu = gorunum === "koyu";

  if (!destekli) {
    return (
      <p className={`text-sm ${koyu ? "text-white/70" : "text-slate-600"}`}>
        {t("settings.video.background.unsupported")}
      </p>
    );
  }

  const halka = koyu
    ? "focus-visible:outline-white"
    : "focus-visible:outline-marka-focus";

  return (
    <div
      role="radiogroup"
      aria-label={t("settings.video.background.heading")}
      aria-busy={mesgul || undefined}
      className="flex flex-wrap items-center gap-2"
    >
      {ARKA_PLANLAR.map((ap) => {
        const renk = arkaPlanRengi(ap);
        const secik = ap === secili;
        const etiket = renk
          ? t(`settings.video.background.colors.${renk}`)
          : t(`settings.video.background.${ap === "bulanik" ? "blur" : "none"}`);
        const ortak = `inline-flex h-10 shrink-0 items-center justify-center rounded-ders border-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${halka}`;
        if (renk) {
          return (
            <PlainButton
              key={ap}
              role="radio"
              aria-checked={secik}
              aria-label={etiket}
              title={etiket}
              disabled={mesgul}
              onClick={() => onSec(ap)}
              className={`${ortak} w-10 ${
                secik ? "border-marka" : koyu ? "border-white/30" : "border-slate-300"
              }`}
              style={{ backgroundColor: ARKA_PLAN_RENKLERI[renk] }}
            />
          );
        }
        return (
          <PlainButton
            key={ap}
            role="radio"
            aria-checked={secik}
            disabled={mesgul}
            onClick={() => onSec(ap)}
            className={`${ortak} px-3 ${
              secik
                ? "border-marka bg-marka/15"
                : koyu
                  ? "border-white/30 text-white hover:bg-white/10"
                  : "border-slate-300 text-slate-900 hover:bg-slate-100"
            } ${secik ? (koyu ? "text-white" : "text-slate-900") : ""}`}
          >
            {etiket}
          </PlainButton>
        );
      })}
    </div>
  );
}
