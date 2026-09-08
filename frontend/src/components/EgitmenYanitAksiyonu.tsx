import { useState } from "react";
import { useReplyToReview } from "@/hooks/useReviews";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

/**
 * Eğitmenin bir değerlendirmeye yanıt yazması — `ReviewsSection`'ın kart-altı
 * slotuna (`renderItemAction`) takılır.
 *
 * İKİ yüzey kullanıyor: eğitmenin kendi ilan sayfası (`TutorProfile`) ve
 * panel şeridindeki Değerlendirmeler ekranı (`TutorReviews`). Bileşen
 * eskiden `TutorProfile` içinde yerel bir fonksiyondu; ikinci yüzey açılınca
 * kopyalanmak yerine buraya çıkarıldı.
 */
export function EgitmenYanitAksiyonu({
  reviewId,
  replyMutation,
}: {
  reviewId: number;
  replyMutation: ReturnType<typeof useReplyToReview>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  const submitReply = () => {
    if (!text.trim()) {
      toast.error("Lütfen bir yanıt yaz.");
      return;
    }
    replyMutation.mutate(
      { reviewId, reply: text.trim() },
      {
        onSuccess: () => {
          toast.success("Yanıtın eklendi.");
          setEditing(false);
          setText("");
        },
        onError: (err) =>
          toast.error(getErrorMessage(err, "Yanıt eklenemedi.")),
      }
    );
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-3 text-sm font-medium text-marka-metin transition hover:text-marka-metin-hover "
      >
        Yanıtla
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <textarea
        rows={3}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        placeholder="Değerlendirmeye yanıtını yaz…"
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setText("");
          }}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 "
        >
          Vazgeç
        </button>
        <button
          type="button"
          onClick={submitReply}
          disabled={replyMutation.isPending}
          className="rounded-lg bg-marka px-4 py-1.5 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover active:scale-95 disabled:opacity-60"
        >
          {replyMutation.isPending ? "Gönderiliyor…" : "Yanıtla"}
        </button>
      </div>
    </div>
  );
}
