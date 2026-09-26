/**
 * Etkin sürücü — sayfa sağlayıcıyı yükleyip (`yukle.ts`) odayı çizmeden
 * ÖNCE kurar (`pages/CanliDers.tsx`); oda ve nötr katman `surucu()` ile okur.
 */
import type { VideoSurucusu } from "./tipler";

let etkin: VideoSurucusu | null = null;

export function surucuyuKur(s: VideoSurucusu | null): void {
  etkin = s;
}

export function surucu(): VideoSurucusu {
  if (!etkin) throw new Error("Görüntülü ders sürücüsü kurulmadı");
  return etkin;
}
