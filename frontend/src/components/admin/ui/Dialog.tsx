import { useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useModalA11y } from "@/hooks/useModalA11y";

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement>;
  /**
   * Panel genişliği (İP-A7d1 · Görev 3'te eklendi).
   *
   * Ortak pencere bugüne dek TEK genişlikteydi (`max-w-lg`) ve panelde ondan
   * geniş yaşayan yüzeyler ortak yüzeye GEÇEMİYORDU: kütüphane editörü
   * (iki sütunlu adres ızgarası + harita + yedi günlük saat tablosu) ve
   * oturum yönetimi kendi `fixed inset-0` katmanlarını kuruyordu — yani
   * etiketsiz overlay borcunun bir kısmı doğrudan bu eksikten geliyordu.
   *
   * Serbest bir `className` değil, İKİ ADIM: yüzeylerin rastgele
   * genişliklerde büyümesi bir tasarım kararıdır ve ekran başına verilmemeli.
   */
  genislik?: "dar" | "genis";
}

const GENISLIK: Record<"dar" | "genis", string> = {
  dar: "max-w-lg",
  genis: "max-w-2xl",
};

export function Dialog({ open, title, description, children, onClose, initialFocusRef, genislik = "dar" }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useModalA11y({ open, onClose, panelRef, initialFocusRef });

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" aria-label="Pencereyi kapat" className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} className={`relative max-h-[92vh] w-full ${GENISLIK[genislik]} overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 sm:rounded-3xl`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-slate-950 dark:text-white">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800">
            <span className="sr-only">Kapat</span>
            <span aria-hidden="true" className="text-xl leading-none">×</span>
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
