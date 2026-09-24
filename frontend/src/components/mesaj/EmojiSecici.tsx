import { useState } from "react";

import { Icon } from "@/components/AppIcon";
import { SIK_EMOJILER } from "@/lib/emoji";

/**
 * Yazma alanının emoji seçicisi — composer'ın araç satırındaki simge.
 * Mesaj tepkileriyle (`Messages.tsx::REACTION_EMOJIS`) AYNI listeyi kullanır
 * (`lib/emoji.ts`); iki ayrı emoji kümesi icat edilmedi.
 *
 * Reaksiyon seçiciden farkı: seçilen emoji doğrudan bir isteğe DÖNÜŞMEZ,
 * yazma alanındaki imlecin bulunduğu yere basılır (çağıran taraf,
 * `Messages.tsx`, imleç konumunu bildiği için ekleme mantığı orada yaşar).
 */
export function EmojiSecici({
  onSec,
}: {
  /** Seçilen emoji — çağıran imleç konumuna basar. */
  onSec: (emoji: string) => void;
}) {
  const [acik, setAcik] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAcik((o) => !o)}
        title="Emoji ekle"
        aria-label="Emoji ekle"
        aria-expanded={acik}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-slate-100 "
      >
        {/* Fluent System "Emoji" (Regular) — uygulama ikon seti (AppIcon);
            kullanıcı kararı, 23 Eyl 2026 (önceki: Fluent UI Emoji statik
            dosyası). Şablonlar düğmesiyle aynı set ve renk. */}
        <Icon name="emoji" className="h-5 w-5 text-slate-800" />
      </button>

      {acik && (
        <div className="absolute bottom-full left-0 z-10 mb-2 flex gap-0.5 rounded-full bg-white p-1 shadow-lg ring-1 ring-slate-200 ">
          {SIK_EMOJILER.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onSec(e);
                setAcik(false);
              }}
              className="rounded-full px-1.5 py-1 text-lg transition hover:bg-slate-100 "
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
