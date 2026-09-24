/**
 * Bağlantı kalitesi göstergesi — Meet `ParticipantMetadata` içindeki
 * `ConnectionQualityIndicator` karşılığı (La Suite Meet, MIT — DINUM/Etalab).
 *
 * Kaynak Zoom `network-quality-change` (0–5); kendi kartımda ölçüm yoksa
 * ses istatistiği (`audio-statistic-data-change`). Gerçek ölçüm yoksa
 * gösterge HİÇ çizilmez ("bilinmiyor" yazılmaz). Soluk tam çubukların
 * üstüne seviyenin çubukları renkli çizilir.
 */
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "@/components/AppIcon";
import { agKalitesi, type AgKalitesi } from "@/lib/canliDers";

const IKON: Record<AgKalitesi, IconName | null> = {
  iyi: "cellular",
  orta: "cellularOrta",
  zayif: "cellularZayif",
  bilinmiyor: null,
};

const RENK: Record<AgKalitesi, string> = {
  iyi: "text-white",
  orta: "text-ders-uyari",
  zayif: "text-ders-tehlike-hover",
  bilinmiyor: "text-white",
};

/** Kalite etiketi ve (gerekirse) ipucu: kart ipucu ve üzerine gelme kutusu için. */
export function useBaglantiMetni(seviye: number | null): {
  kalite: AgKalitesi;
  etiket: string;
  ipucu: string | null;
} {
  const { t } = useTranslation();
  const kalite = agKalitesi(seviye);
  const etiket = t("connection.quality.label", { durum: t(`connection.quality.${kalite}`) });
  const ipucu = kalite === "zayif" ? t("connection.quality.weakHint") : null;
  return { kalite, etiket, ipucu };
}

export function BaglantiCubugu({
  seviye,
  kucuk = false,
}: {
  seviye: number | null;
  kucuk?: boolean;
}) {
  const { kalite, etiket, ipucu } = useBaglantiMetni(seviye);
  const boyut = kucuk ? "h-3.5 w-3.5" : "h-4 w-4";
  const ikon = IKON[kalite];
  if (!ikon) return null;
  return (
    <span
      className="relative inline-flex shrink-0"
      title={ipucu ? `${etiket}. ${ipucu}` : etiket}
      data-kalite={kalite}
    >
      <Icon name="cellular" className={`${boyut} text-white/30`} />
      <span className={`absolute inset-0 ${RENK[kalite]}`}>
        <Icon name={ikon} className={boyut} />
      </span>
      <span className="sr-only">{etiket}</span>
    </span>
  );
}
