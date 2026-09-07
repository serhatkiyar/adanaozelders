import { useState } from "react";
import { ShareModal } from "./ShareModal";

interface ShareButtonProps {
  size?: "sm" | "md";
  title?: string;
  /** Paylaşılacak mutlak URL (verilmezse mevcut sayfa adresi). Kartlarda gerekli. */
  url?: string;
  /** Paylaş penceresi başlığı (varsayılan "İlanı Paylaş"). */
  heading?: string;
  /** Metinli (genişletilmiş) varyant — detay sayfası için. */
  withLabel?: boolean;
  /** Görsel üzerinde duran buzlu (frosted) stil — kart kapağı overlay'i için. */
  overlay?: boolean;
  className?: string;
}

export function ShareButton({
  size = "sm",
  title,
  url,
  heading,
  withLabel = false,
  overlay = false,
  className = "",
}: ShareButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const dim = size === "md" ? "h-9 w-9" : "h-8 w-8";
  const iconSize = size === "md" ? "h-5 w-5" : "h-4 w-4";
  // Zeminsiz overlay'de ikon tek başına durur → yanındaki kalp glifiyle aynı boy.
  const overlayGlyph = size === "md" ? "h-7 w-7" : "h-6 w-6";

  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(true);
  };

  /** iOS tarzı paylaş sembolü: kutudan yukarı çıkan ok. */
  const glyphPath = (
    <>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 7.5H6.75A2.25 2.25 0 0 0 4.5 9.75v9a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-1.5"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m7.5 7.5 4.5-4.5 4.5 4.5" />
    </>
  );

  const icon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={iconSize}
    >
      {glyphPath}
    </svg>
  );

  return (
    <>
      {withLabel ? (
        <button
          type="button"
          aria-label="Paylaş"
          title="Paylaş"
          onClick={open}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 ${className}`}
        >
          {icon}
          Paylaş
        </button>
      ) : overlay ? (
        /* Görsel üzerinde: zeminsiz — yanındaki kalp gibi beyaz çizgi + gölge ile
           okunur (arkasında beyaz daire YOK). */
        <button
          type="button"
          aria-label="Paylaş"
          title="Paylaş"
          onClick={open}
          className={`shrink-0 transition hover:scale-110 active:scale-90 ${className}`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`${overlayGlyph} text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]`}
          >
            {glyphPath}
          </svg>
        </button>
      ) : (
        <button
          type="button"
          aria-label="Paylaş"
          title="Paylaş"
          onClick={open}
          // 8 Eyl 2026: daire ZEMİN kalktı — yanındaki kalple aynı karar.
          // İkincil iki eylem için gri dolu daireler fazla ağırlıktı.
          className={`relative flex ${dim} shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 active:scale-90 ${className}`}
        >
          {icon}
        </button>
      )}

      {isOpen && (
        <ShareModal
          url={url || window.location.href}
          titleText={title || document.title}
          heading={heading}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
