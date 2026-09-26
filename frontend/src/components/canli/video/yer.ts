import type { CSSProperties } from "react";

import type { Kutu } from "@/lib/sinifDuzeni";

/**
 * Kutuyu sahne koordinatında mutlak yerleştirir (animasyon YOK — Preply §6).
 * Boş kutu gizlenir; `goreli` verilirse ona göre konumlanır.
 */
export function yer(k: Kutu | null, goreli?: Kutu): CSSProperties {
  if (!k || k.w <= 0 || k.h <= 0) {
    return { visibility: "hidden", left: 0, top: 0, width: 0, height: 0 };
  }
  return {
    left: k.x - (goreli?.x ?? 0),
    top: k.y - (goreli?.y ?? 0),
    width: k.w,
    height: k.h,
  };
}
