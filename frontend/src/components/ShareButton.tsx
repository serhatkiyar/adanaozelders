import { useState } from "react";
import { ShareModal } from "./ShareModal";

interface ShareButtonProps {
  size?: "sm" | "md";
  title?: string;
}

export function ShareButton({ size = "sm", title }: ShareButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const dim = size === "md" ? "h-9 w-9" : "h-8 w-8";
  const icon = size === "md" ? "h-5 w-5" : "h-4 w-4";

  return (
    <>
      <button
        type="button"
        aria-label="İlanı Paylaş"
        title="İlanı Paylaş"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(true);
        }}
        className={`relative flex ${dim} shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition active:scale-90 hover:bg-slate-200 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={icon}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
        </svg>
      </button>

      {isOpen && (
        <ShareModal
          url={window.location.href}
          titleText={title || document.title}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
