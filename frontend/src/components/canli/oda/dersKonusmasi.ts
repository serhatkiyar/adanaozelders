/**
 * Ders içi sohbetin konuşması — sitenin kendi mesajlaşması (Meet sohbeti
 * taşınmadı; plan §5 P5). Konuşma, `Messages.tsx`in `?to=&role=` çözümüyle
 * AYNI kuralla bulunur: karşı tarafın kimliği ve türü eşleşen gelen kutusu
 * konuşması. Gelen kutusunda yoksa arşivde de aranır (arşiv kişiye özeldir ve
 * yeni mesaj konuşmayı arşivden çıkarmaz); yoksa geçmiş, gelen mesajlar ve
 * okunmamış rozeti derste görünmezdi. Hiç yazışılmamışsa ilk gönderim
 * konuşmayı sunucuda oluşturur; yanıttaki kimlik burada tutulur.
 */
import { useCallback, useState } from "react";

import { useConversations } from "@/hooks/useMessages";
import type { ConversationOut, MessageOut } from "@/types";

export interface DersSohbetBilgisi {
  karsiTarafId: number;
  karsiTarafRol: "CLIENT" | "TUTOR";
  karsiTarafAd: string;
  /** Karşı tarafın profil fotoğrafı (dersten); yoksa baş harf. */
  karsiTarafAvatar?: string | null;
  benimRolum: "CLIENT" | "TUTOR";
}

export interface DersKonusmasi {
  konusmaId: number | null;
  /** Karşı taraftan gelen, okunmamış mesaj sayısı. */
  okunmamis: number;
  /** Karşı tarafın konuşmayı en son okuduğu an ("… tarafından görüldü"). */
  karsiOkuma: string | null;
  /** Konuşmanın son mesajı ve zamanı (önizleme balonu). */
  sonMesaj: string | null;
  sonMesajZamani: string | null;
  /** Konuşma listesi (gerekirse arşiv de) yüklendi: okunmamış sayısı gerçek. */
  yuklendi: boolean;
  gonderildi: (mesaj: MessageOut) => void;
}

export function useDersKonusmasi(sohbet: DersSohbetBilgisi | undefined): DersKonusmasi {
  const gelen = useConversations(false, Boolean(sohbet));
  const eslesir = (c: ConversationOut) =>
    Boolean(sohbet) &&
    c.counterparty_id === sohbet?.karsiTarafId &&
    c.counterparty_role === sohbet?.karsiTarafRol;
  const gelendeki = gelen.data?.find(eslesir);
  // Arşiv listesi yalnız gelen kutusu yüklenip eşleşme çıkmadığında istenir.
  const arsiv = useConversations(true, Boolean(sohbet) && gelen.isSuccess && !gelendeki);
  const [olusanId, setOlusanId] = useState<number | null>(null);
  const konusma = gelendeki ?? (sohbet ? arsiv.data?.find(eslesir) : undefined);
  const gonderildi = useCallback((mesaj: MessageOut) => setOlusanId(mesaj.conversation_id), []);
  return {
    konusmaId: konusma?.id ?? olusanId,
    okunmamis: konusma?.unread ?? 0,
    karsiOkuma: konusma?.counterparty_last_read_at ?? null,
    sonMesaj: konusma?.last_message ?? null,
    sonMesajZamani: konusma?.last_message_at ?? null,
    yuklendi: gelen.isSuccess && (Boolean(gelendeki) || arsiv.isSuccess || arsiv.isError),
    gonderildi,
  };
}
