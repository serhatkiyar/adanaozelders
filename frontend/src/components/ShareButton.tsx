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

  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(true);
  };

  const icon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={iconSize}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
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
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-600 ${className}`}
        >
          {icon}
          Paylaş
        </button>
      ) : (
        <button
          type="button"
          aria-label="Paylaş"
          title="Paylaş"
          onClick={open}
          className={`relative flex ${dim} shrink-0 items-center justify-center rounded-full transition active:scale-90 ${
            overlay
              ? "bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:bg-white hover:text-indigo-600 dark:bg-slate-800/90 dark:text-slate-300 dark:hover:bg-slate-800"
              : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
          } ${className}`}
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
