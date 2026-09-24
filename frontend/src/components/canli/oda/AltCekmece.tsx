/**
 * Telefonda alttan açılan menü — Meet `ResponsiveMenu` (La Suite Meet, MIT —
 * DINUM/Etalab). Esc ve dış tıklama kapatır; kapanınca odak açan düğmeye
 * döner (Meet `useEscapeToClose` / `useRestoreFocus` deseni).
 */
import { useEffect, useRef, type ReactNode } from "react";

import { PlainButton } from "@/components/ui/PlainButton";

export function AltCekmece({
  acik,
  onKapat,
  baslik,
  children,
}: {
  acik: boolean;
  onKapat: () => void;
  baslik: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const oncekiOdak = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!acik) return;
    oncekiOdak.current = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const tus = (e: KeyboardEvent) => {
      if (e.key === "Escape") onKapat();
    };
    document.addEventListener("keydown", tus);
    return () => {
      document.removeEventListener("keydown", tus);
      oncekiOdak.current?.focus?.();
    };
  }, [acik, onKapat]);

  if (!acik) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <PlainButton
        aria-label="Kapat"
        tabIndex={-1}
        onClick={onKapat}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={baslik}
        className="relative w-full rounded-t-2xl bg-ders-yuzey px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-white"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ders-cizgi" aria-hidden />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-4">{children}</div>
      </div>
    </div>
  );
}
