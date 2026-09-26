/**
 * Zoom Video SDK web bileşenleri — `<video-player-container>` ve
 * `<video-player>` JSX'te yazılabilsin diye. SDK bu öğeleri `init` sırasında
 * kaydeder; `attachVideo(userId, kalite, oyuncu)` JSX'te kurulan oyuncuya
 * çizer (media.d.ts `attachVideo`). Oyuncu kabın ALT düğümü olmalı.
 *
 * Boyut `className` ile değil ebeveynden verilir (bkz. `video/zoom/MedyaKatmani`):
 * özel öğelerde `className` → `class` eşlemesine güvenilmez.
 */
import type { DetailedHTMLProps, HTMLAttributes } from "react";

type ZoomOgesi = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "video-player-container": ZoomOgesi;
      "video-player": ZoomOgesi;
    }
  }
}
