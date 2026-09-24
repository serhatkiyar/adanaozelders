/**
 * Ders içi sohbetin konuşması — sitenin kendi mesajlaşması (Meet sohbeti
 * taşınmadı; plan §5 P5). Konuşma, `Messages.tsx`in `?to=&role=` çözümüyle
 * AYNI kuralla bulunur: karşı tarafın kimliği ve türü eşleşen gelen kutusu
 * konuşması. Bulunamazsa (hiç yazışılmamış ya da arşivde) ilk gönderim
 * konuşmayı sunucuda oluşturur; yanıttaki kimlik burada tutulur.
 */
import { useCallback, useState } from "react";

import { useConversations } from "@/hooks/useMessages";
import type { MessageOut } from "@/types";

export interface DersSohbetBilgisi {
  karsiTarafId: number;
  karsiTarafRol: "CLIENT" | "TUTOR";
  karsiTarafAd: string;
  benimRolum: "CLIENT" | "TUTOR";
}

export interface DersKonusmasi {
  konusmaId: number | null;
  /** Karşı taraftan gelen, okunmamış mesaj sayısı. */
  okunmamis: number;
  gonderildi: (mesaj: MessageOut) => void;
}

export function useDersKonusmasi(sohbet: DersSohbetBilgisi | undefined): DersKonusmasi {
  const { data } = useConversations(false, Boolean(sohbet));
  const [olusanId, setOlusanId] = useState<number | null>(null);
  const konusma = sohbet
    ? data?.find(
        (c) =>
          c.counterparty_id === sohbet.karsiTarafId &&
          c.counterparty_role === sohbet.karsiTarafRol,
      )
    : undefined;
  const gonderildi = useCallback((mesaj: MessageOut) => setOlusanId(mesaj.conversation_id), []);
  return {
    konusmaId: konusma?.id ?? olusanId,
    okunmamis: konusma?.unread ?? 0,
    gonderildi,
  };
}
