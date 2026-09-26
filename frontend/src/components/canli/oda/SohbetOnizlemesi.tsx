/**
 * Sohbet kapalıyken gelen mesajın önizleme balonu — telefonda ve ≤880px'te
 * (masaüstü geniş düzende sohbet düğmesindeki okunmamış nokta yeter).
 * Sahnenin altında ortada; dokununca sohbet açılır. ~5 sn sonra kaybolur,
 * üstüne gelince / odaktayken bekler. Kural: `lib/sohbetCekmecesi.ts`.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PlainButton } from "@/components/ui/PlainButton";

const GORUNME_MS = 5000;

export function SohbetOnizlemesi({
  ad,
  metin,
  onAc,
  onKapandi,
}: {
  ad: string;
  /** Kısaltılmış mesaj metni; boşsa "Yeni mesaj". */
  metin: string;
  onAc: () => void;
  onKapandi: () => void;
}) {
  const { t } = useTranslation();
  const [bekle, setBekle] = useState(false);
  const gosterilen = metin || t("chat.preview.fallback");

  useEffect(() => {
    if (bekle) return;
    const z = window.setTimeout(onKapandi, GORUNME_MS);
    return () => window.clearTimeout(z);
  }, [bekle, onKapandi, metin]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-sohbet-onizlemesi
      className="absolute inset-x-3 bottom-3 z-30 mx-auto max-w-sm"
    >
      <PlainButton
        onClick={onAc}
        onPointerEnter={() => setBekle(true)}
        onPointerLeave={() => setBekle(false)}
        onFocus={() => setBekle(true)}
        onBlur={() => setBekle(false)}
        aria-label={t("chat.preview.open", { name: ad, text: gosterilen })}
        className="flex w-full animate-ders-belir items-start gap-2 rounded-ders bg-white px-3 py-2 text-left text-[#121117] shadow-xl hover:bg-[#F4F4F8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-marka-focus"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{ad}</span>
          <span className="line-clamp-2 text-sm text-[#4D4C5C]">{gosterilen}</span>
        </span>
      </PlainButton>
    </div>
  );
}
