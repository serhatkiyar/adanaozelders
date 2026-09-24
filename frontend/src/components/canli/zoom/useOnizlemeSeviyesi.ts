/**
 * Önizleme mikrofon seviyesi: `LocalAudioTrack.getCurrentVolume()` olay
 * yaymaz, kısa aralıkla yoklanır. `aktif` değilse `null` (çubuk yerine ipucu).
 */
import { useEffect, useState } from "react";

import { seviyeOrani } from "./indirgeyiciler";
import { onizlemeSeviyesi } from "./onizleme";

const ARALIK_MS = 80;

export function useOnizlemeSeviyesi(aktif: boolean): number | null {
  const [oran, setOran] = useState(0);
  useEffect(() => {
    if (!aktif) return;
    const t = window.setInterval(() => setOran(seviyeOrani(onizlemeSeviyesi())), ARALIK_MS);
    return () => {
      window.clearInterval(t);
      setOran(0);
    };
  }, [aktif]);
  return aktif ? oran : null;
}
