import { useCallback } from "react";

import { ADSIZ_UYE } from "@/lib/roles";
import { ROUTES } from "@/lib/routes";
import { tamSayfaGit } from "@/lib/tamSayfaGezinme";
import { useMeetingStore } from "@/store/meetingStore";
import type { BookingOut } from "@/types";

/**
 * "Derse katıl" — dört çağrı yerinin (ders ayrıntısı, iki pano, Derslerim)
 * TEK kapısı. Altyapıyı sunucu söyler (`canli_ders_saglayici`):
 *
 *  - `zoom`  → Zoom sayfası, TAM SAYFA yüklemesiyle (gerekçe:
 *    `lib/tamSayfaGezinme.ts`). Açık kalmış bir Jitsi odası (kalıcı
 *    `meetingStore`) önce kapatılır; aksi halde dönüşte yeniden açılırdı.
 *  - diğerleri (jitsi/livekit/null) → bugünkü Jitsi akışı, değişmeden.
 */
export function useDerseKatil() {
  const joinMeeting = useMeetingStore((s) => s.joinMeeting);
  const leaveMeeting = useMeetingStore((s) => s.leaveMeeting);

  return useCallback(
    (bk: BookingOut) => {
      if (bk.canli_ders_saglayici === "zoom") {
        leaveMeeting();
        tamSayfaGit(ROUTES.canliDers(bk.id));
        return;
      }
      joinMeeting(
        bk.id,
        bk.meeting_room!,
        bk.tutor_name || "Öğretmen",
        bk.client_name || ADSIZ_UYE,
      );
    },
    [joinMeeting, leaveMeeting],
  );
}
