/**
 * Yan paneldeki ders içi sohbet — sitenin mesajlaşması, üst bardaki mesaj
 * panelinin konuşma görünümüyle (`mesaj/SohbetGorunumu`) AYNI arayüz. Meet
 * `Chat` yerine bizim sohbetimiz (kullanıcı kararı, 24 Eyl 2026): derste
 * yazılan mesaj /mesajlar sayfasında da durur.
 *
 * - Yeni mesajlar sitenin `/ws` bağlantısıyla gelir (`App.tsx` `WsManager`
 *   → `NEW_MESSAGE` konuşmayı ve mesajları tazeler).
 * - "yazıyor…" için Centrifugo bağlantısı YALNIZ panel açıkken kurulur
 *   (`Messages.tsx` ile aynı gerekçe: ikinci soket sürekli açık kalmaz).
 * - Panel açıkken gelen mesaj hemen okundu sayılır: okunmamış rozeti yalnız
 *   panel kapalıyken birikir.
 *
 * Panel kapansa da içerik çizili kalabilir (kayma geçişi, sonraki açılış).
 * Kapalıyken görünen konuşma DONDURULUR: o sırada ilk kez oluşan bir konuşma
 * (karşı tarafın ilk mesajı) sessizce okundu sayılmasın, rozet çıksın.
 * Taslak odada tutulur (`ZoomOdasi`): paneller arasında geçince kaybolmaz.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { SohbetGorunumu } from "@/components/mesaj/SohbetGorunumu";
import { useMarkConversationRead } from "@/hooks/useMessages";
import { useCentrifugoStore } from "@/store/centrifugoStore";

import type { DersKonusmasi, DersSohbetBilgisi } from "./dersKonusmasi";

export function DersSohbeti({
  acik,
  sohbet,
  konusma,
  taslak,
  setTaslak,
}: {
  acik: boolean;
  sohbet: DersSohbetBilgisi;
  konusma: DersKonusmasi;
  taslak: string;
  setTaslak: (metin: string) => void;
}) {
  const { t } = useTranslation();
  const { konusmaId, okunmamis } = konusma;
  const [gorunenId, setGorunenId] = useState(konusmaId);
  if (acik && gorunenId !== konusmaId) setGorunenId(konusmaId);
  const markRead = useMarkConversationRead();

  const baglan = useCentrifugoStore((s) => s.connect);
  const kopar = useCentrifugoStore((s) => s.disconnect);
  const yaziyorBildir = useCentrifugoStore((s) => s.notifyTyping);
  const yaziyor = useCentrifugoStore((s) => konusmaId !== null && Boolean(s.typing[konusmaId]));

  useEffect(() => {
    if (!acik) return;
    void baglan();
    return () => kopar();
  }, [acik, baglan, kopar]);

  // Açıkken gelen (ya da açılınca bekleyen) mesaj okundu sayılır. `unread`
  // 0'a inince durur: `markRead` konuşma listesini tazeler, döngü olmaz.
  useEffect(() => {
    if (acik && konusmaId !== null && okunmamis > 0) markRead.mutate(konusmaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik, konusmaId, okunmamis]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-6 pb-2 text-xs text-slate-500">{t("chat.hint")}</p>
      <SohbetGorunumu
        konusmaId={gorunenId}
        karsiTarafId={sohbet.karsiTarafId}
        karsiTarafRol={sohbet.karsiTarafRol}
        rol={sohbet.benimRolum}
        metin={taslak}
        setMetin={setTaslak}
        onGonderildi={konusma.gonderildi}
        yaziyor={yaziyor ? sohbet.karsiTarafAd : null}
        onYaziyor={konusmaId !== null ? () => yaziyorBildir(konusmaId) : undefined}
      />
    </div>
  );
}
