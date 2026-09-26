/**
 * Önizleme mikrofon seviyesi: sürücünün önizleme seviyesi olay yaymaz, kısa
 * aralıkla yoklanır (gösterime hazır 0–1). `aktif` değilse `null` (çubuk yerine ipucu).
 */
import { useEffect, useState } from "react";

import { surucu } from "../../video/etkin";

const ARALIK_MS = 80;

export function useOnizlemeSeviyesi(aktif: boolean): number | null {
  const [oran, setOran] = useState(0);
  useEffect(() => {
    if (!aktif) return;
    const t = window.setInterval(() => setOran(surucu().onizleme.seviye()), ARALIK_MS);
    return () => {
      window.clearInterval(t);
      setOran(0);
    };
  }, [aktif]);
  return aktif ? oran : null;
}
