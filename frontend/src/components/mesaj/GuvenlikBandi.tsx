import { useState } from "react";

import { KUCUK_ACIKLAMA } from "@/components/pano/stil";
import type { MessagingStage } from "@/types";

/**
 * Sohbetin üstündeki güvenlik bandı (Modül 5).
 *
 * Ders öncesi (`INQUIRY`) sohbette her zaman görünür ve KAPATILAMAZ: en çok
 * dolandırıcılık girişimi ders ayırtılmadan önceki yazışmada olur. Ders
 * ilişkisi kurulduktan sonra (`LESSON`) kullanıcı bandı kapatabilir; tercih
 * yalnız bu tarayıcıda saklanır ve depolama erişilemezse bant görünür kalır.
 */
const ANAHTAR = "mesaj-guvenlik-bandi-kapali";

function kapaliMi(): boolean {
  try {
    return window.localStorage.getItem(ANAHTAR) === "1";
  } catch {
    return false;
  }
}

export function GuvenlikBandi({
  stage,
  rol,
}: {
  stage: MessagingStage;
  rol: "CLIENT" | "TUTOR";
}) {
  const [kapali, setKapali] = useState(kapaliMi);
  const kapatilabilir = stage === "LESSON";
  if (kapatilabilir && kapali) return null;

  const metin =
    stage === "INQUIRY" && rol === "TUTOR"
      ? "Bu öğrenci henüz ders ayırtmadı. Ödemeyi platform dışına taşıma teklifi kurallara aykırıdır; şüpheli mesajı bildir ya da öğrenciyi engelle."
      : "Ödemeyi ve yazışmayı platformda tut. Kart bilgisi, şifre ya da kimlik bilgisi paylaşma; platform dışı ödeme isteyen olursa mesajı bildir.";

  const kapat = () => {
    setKapali(true);
    try {
      window.localStorage.setItem(ANAHTAR, "1");
    } catch {
      // Depolama kapalıysa tercih yalnız bu oturumda geçerli olur.
    }
  };

  return (
    <div
      role="note"
      aria-label="Güvenlik uyarısı"
      className="border-b border-amber-200 bg-amber-50"
    >
      <div className="mx-auto flex w-full max-w-4xl items-start gap-3 px-4 py-3 sm:px-6">
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
          />
        </svg>
        <p className={`min-w-0 flex-1 ${KUCUK_ACIKLAMA} text-slate-800`}>{metin}</p>
        {kapatilabilir && (
          <button
            type="button"
            onClick={kapat}
            aria-label="Uyarıyı kapat"
            className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-amber-100 hover:text-slate-800"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
