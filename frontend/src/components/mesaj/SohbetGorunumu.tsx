import { FormEvent, useEffect, useRef } from "react";
import { Icon } from "@/components/AppIcon";
import { EmojiSecici } from "@/components/mesaj/EmojiSecici";
import { SablonPaneli } from "@/components/mesaj/SablonPaneli";
import { useMarkConversationRead, useMessages, useSendMessage } from "@/hooks/useMessages";
import { formatChatTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { MessageOut } from "@/types";

export type SohbetRolu = "CLIENT" | "TUTOR" | "LIBRARY";

/**
 * Tek bir konuşmanın mesaj akışı + yazma alanı — üst bardaki mesaj önizleme
 * panelinden (`MesajlarPaneli`) çıkarıldı (24 Eyl 2026) ki canlı dersin yan
 * panelindeki ders içi sohbet (`canli/oda/DersSohbeti`) AYNI sohbeti
 * kullansın; ikinci bir sohbet arayüzü yazılmadı.
 *
 * Başlık, liste ve kapanış çağıranın işidir. Taslak metin de çağırandadır
 * (kontrollü): panel kapanıp açılınca ya da görünüm değişince taslağın ne
 * olacağına çağıran karar verir.
 *
 * Bu dosya ana pakette yaşar (`DashboardHeader` → `MesajlarPaneli`): canlı
 * ders parçasına özgü hiçbir şey (i18next, `components/canli/**`) import
 * edilmez; metinler düz Türkçe.
 *
 * `konusmaId` `null` ise henüz konuşma yoktur: akış "Henüz mesaj yok" der,
 * ilk gönderim konuşmayı sunucuda oluşturur ve `onGonderildi` yanıttaki
 * `conversation_id`yi çağırana verir.
 */
export function SohbetGorunumu({
  konusmaId,
  karsiTarafId,
  karsiTarafRol,
  rol,
  metin,
  setMetin,
  onGonderildi,
  yaziyor = null,
  onYaziyor,
}: {
  konusmaId: number | null;
  /** Yoksa gönderim yapılmaz (önizleme panelindeki eski davranış). */
  karsiTarafId: number | null | undefined;
  karsiTarafRol?: string | null;
  /** Benim rolüm: balonların hangisinin "benim" olduğu buna göre. */
  rol: SohbetRolu | null;
  metin: string;
  setMetin: (metin: string) => void;
  onGonderildi?: (mesaj: MessageOut) => void;
  /** Karşı taraf yazıyorsa adı ("… yazıyor…"); değilse `null`. */
  yaziyor?: string | null;
  /** Boş olmayan her tuşta (kısma çağıranda / store'da). */
  onYaziyor?: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages, isLoading: messagesLoading } = useMessages(konusmaId);
  const send = useSendMessage();
  const markRead = useMarkConversationRead();

  useEffect(() => {
    if (konusmaId !== null) markRead.mutate(konusmaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [konusmaId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, konusmaId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = metin.trim();
    if (!body || !karsiTarafId) return;
    send.mutate(
      {
        counterpartyId: karsiTarafId,
        body,
        counterpartyRole: karsiTarafRol,
      },
      {
        onSuccess: (mesaj) => {
          setMetin("");
          onGonderildi?.(mesaj);
        },
        onError: (err) => toast.error(getErrorMessage(err, "Mesaj gönderilemedi.")),
      }
    );
  };

  // `Messages.tsx::emojiEkle` ile birebir aynı — imleç konumuna basar.
  const emojiEkle = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setMetin(metin + emoji);
      return;
    }
    const start = el.selectionStart ?? metin.length;
    const end = el.selectionEnd ?? metin.length;
    setMetin(metin.slice(0, start) + emoji + metin.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const konum = start + emoji.length;
      el.setSelectionRange(konum, konum);
    });
  };

  return (
    <>
      {/* ── Sohbet görünümü — arka plan `Messages.tsx`teki AYNI slate-50 ── */}
      <div className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50 px-5 py-4 ">
        {konusmaId !== null && messagesLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-2xl bg-slate-100 " />
            ))}
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            {/* Mesajlar sayfasıyla AYNI görsel (23 Eyl 2026). */}
            <img src="/icons/incoming-envelope.png" alt="" aria-hidden className="h-24 w-24" />
            <p className="mt-4 text-sm font-semibold text-slate-700 ">Henüz mesaj yok</p>
            <p className="mt-1 text-xs text-slate-500 ">İlk mesajı sen yaz.</p>
          </div>
        ) : (
          messages.map((m) => {
            // `Messages.tsx::MessageRow` ile AYNI balon renkleri —
            // "kendim" bariz turuncu, karşı taraf beyaz+ince halka.
            const mine = rol !== null && m.sender_role === rol;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                    mine
                      ? "bg-marka text-marka-fg "
                      : "bg-white text-slate-700 ring-1 ring-slate-100 "
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words leading-relaxed ">{m.body}</p>
                  <p className={`mt-0.5 text-[10px] ${mine ? "text-marka-fg/80 " : "text-slate-500 "}`}>
                    {formatChatTime(m.created_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        {/* "yazıyor…" — Centrifugo ipucu (`Messages.tsx` ile aynı); 3 sn
            sonra kendiliğinden söner. Kalıcı veri değil. */}
        {yaziyor && (
          <p className="px-1 text-xs text-slate-500" aria-live="polite">
            {yaziyor} yazıyor…
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Yazma alanı: `Messages.tsx`teki AYNI birleşik kutu —
          yazı alanı ve araç satırı (şablonlar + emoji) tek çerçevenin
          içinde (kullanıcı kararı, 22 Eyl 2026, panel için de
          geçerli: "bizim chatin elemanlarını koy"). ── */}
      <form onSubmit={submit} className="p-4 pt-3 ">
        <div className="rounded-2xl border border-slate-200 bg-white transition focus-within:border-marka-mid focus-within:ring-2 focus-within:ring-marka/20 ">
          <textarea
            ref={textareaRef}
            rows={1}
            value={metin}
            onChange={(e) => {
              setMetin(e.target.value);
              // Boş alanda haber verilmez: yazdığını silen biri karşı
              // tarafa "yazıyor…" göstermemeli.
              if (e.target.value.trim()) onYaziyor?.();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            placeholder="Mesajın"
            aria-label="Mesajın"
            className="max-h-24 min-h-[38px] w-full resize-none border-0 bg-transparent px-3.5 pt-2.5 text-sm text-slate-900 placeholder-slate-500 outline-none focus:ring-0 "
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
            <div className="flex items-center gap-0.5">
              {rol === "TUTOR" && <SablonPaneli onSec={(body) => setMetin(body)} />}
              <EmojiSecici onSec={emojiEkle} />
            </div>
            <button
              type="submit"
              disabled={send.isPending || !metin.trim()}
              aria-label="Gönder"
              title="Gönder"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-marka text-marka-fg transition hover:bg-marka-hover active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 "
            >
              {send.isPending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent " />
              ) : (
                <Icon name="send" className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
