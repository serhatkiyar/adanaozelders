/**
 * Kart bilgisi — sol altta ad ve kapalı mikrofon rozeti. Meet
 * `ParticipantMetadata` + `MutedMicIndicator` (La Suite Meet, MIT —
 * DINUM/Etalab) ve `.lk-participant-metadata` ölçüleri.
 *
 * Video oyuncusunun KARDEŞİ olarak mutlak konumlanır; oyuncunun üstüne
 * opak zemin koymaz.
 */
import { useTranslation } from "react-i18next";

import { Icon } from "@/components/AppIcon";

export function KaroBilgisi({
  ad,
  mikKapali,
  kucuk = false,
}: {
  ad: string;
  mikKapali: boolean;
  kucuk?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`pointer-events-none absolute flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded bg-black/50 text-white ${
        kucuk ? "bottom-1 left-1 p-0.5 text-xs" : "bottom-1 left-1 p-1 text-sm"
      }`}
    >
      {mikKapali && (
        <span className="inline-flex shrink-0 rounded bg-ders-tehlike p-0.5" title={t("participantTile.muted")}>
          <Icon name="micOff" className={kucuk ? "h-3 w-3" : "h-4 w-4"} />
          <span className="sr-only">{t("participantTile.muted")}</span>
        </span>
      )}
      <span className="truncate px-0.5 font-medium">{ad}</span>
    </div>
  );
}
