/**
 * Katılımcı avatarı ve kamera kapalıyken kart zemini — Meet `Avatar` +
 * `ParticipantPlaceholder` + `getParticipantBackgroundGradient`
 * (La Suite Meet, MIT — DINUM/Etalab).
 */
import { memo, useMemo } from "react";

import { basHarfler, katilimciRengi } from "@/lib/canliDers";

/** Ortası açık, kenarları koyu radyal gradyan (oklch karışımı: renk grileşmez). */
function zeminGradyani(renk: string): string {
  return `radial-gradient(circle at 50% 50%,
    color-mix(in oklch, ${renk} 82%, white) 0%,
    color-mix(in oklch, ${renk} 90%, white) 8%,
    ${renk} 35%,
    color-mix(in oklch, ${renk} 85%, black) 65%,
    color-mix(in oklch, ${renk} 65%, black) 100%)`;
}

export const Avatar = memo(function Avatar({ ad, renk }: { ad: string; renk: string }) {
  const harfler = useMemo(() => basHarfler(ad), [ad]);
  return (
    <div
      className="flex h-full w-full select-none overflow-hidden rounded-full text-white"
      style={{ backgroundColor: renk }}
    >
      <svg viewBox="0 0 100 100" aria-hidden className="block h-full w-full">
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="44"
          fontWeight="500"
          fill="currentColor"
        >
          {harfler}
        </text>
      </svg>
    </div>
  );
});

/** Kamera kapalıyken kartı dolduran zemin + ortada avatar. */
export const KatilimciZemini = memo(function KatilimciZemini({
  ad,
  konusuyor = false,
}: {
  ad: string;
  konusuyor?: boolean;
}) {
  const renk = useMemo(() => katilimciRengi(ad), [ad]);
  return (
    <div
      className="flex h-full w-full items-center justify-center [container-type:size]"
      style={{ backgroundColor: renk, backgroundImage: zeminGradyani(renk) }}
    >
      <div
        className={`aspect-square w-[min(90cqmin,160px)] rounded-full ${
          konusuyor ? "animate-ders-nabiz" : ""
        }`}
      >
        <Avatar ad={ad} renk={renk} />
      </div>
    </div>
  );
});
