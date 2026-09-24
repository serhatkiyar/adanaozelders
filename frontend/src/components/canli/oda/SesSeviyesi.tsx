/**
 * Mikrofon seviye çubuğu — Meet `AudioLevelGauge` (La Suite Meet, MIT —
 * DINUM/Etalab). `oran` 0–1; `null` → mikrofon kapalı, çubuk yerine
 * "Test etmek için mikrofonunu aç" ipucu.
 *
 * Seviyenin kaynağı çağırandadır: önizlemede `getCurrentVolume()` yoklaması
 * (`useOnizlemeSeviyesi`), odada `current-audio-level-change` (depo).
 */
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";

import type { SeciciGorunumu } from "./CihazSecici";

export function SesSeviyesi({
  oran,
  gorunum = "koyu",
  kapaliMetni,
}: {
  oran: number | null;
  gorunum?: SeciciGorunumu;
  /** Mikrofon kapalıyken görünen metin (varsayılan: Meet `muteTest`). */
  kapaliMetni?: string;
}) {
  const { t } = useTranslation();
  const koyu = gorunum === "koyu";
  return (
    <div
      className={`flex min-h-[2.5rem] items-center gap-3 px-1 py-2 text-xs font-medium ${
        koyu ? "text-white/70" : "text-slate-600"
      }`}
    >
      {oran === null ? (
        <>
          <Icon name="micOff" className="h-[18px] w-[18px] shrink-0" />
          <span>{kapaliMetni ?? t("selectDevice.audioinput.muteTest")}</span>
        </>
      ) : (
        <>
          <Icon name="mic" className="h-[18px] w-[18px] shrink-0" />
          <div
            role="meter"
            aria-label={t("selectDevice.audioinput.level")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(oran * 100)}
            className={`h-1.5 flex-1 overflow-hidden rounded-full ${
              koyu ? "bg-white/25" : "bg-slate-200"
            }`}
          >
            <div
              className="h-full w-full origin-left rounded-full bg-marka transition-transform duration-75 ease-linear"
              style={{ transform: `scaleX(${oran})` }}
            />
          </div>
        </>
      )}
    </div>
  );
}
