import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useModalA11y } from "@/hooks/useModalA11y";

/**
 * Tüketici tarafı modal kabuğu.
 *
 * NEDEN VAR: her modal kendi `fixed inset-0` sarmalayıcısını yazıyordu; sonuç
 * olarak hiçbirinde odak tuzağı, çoğunda portal ve `aria-modal` yoktu. Portal
 * ayrıca bu projede zorunludur: navbar `backdrop-blur` kullanır ve blur'lu bir
 * ata, içindeki `position: fixed` öğeyi kendi kutusuna hapseder — modal
 * ekranın ortasına değil navbar'ın içine çizilirdi.
 *
 * Görsel dil bilinçli olarak sade: karartılmış arka plan + tek panel. Başlık
 * satırı `title` verildiğinde çizilir; verilmezse (harita/tam ekran gibi kendi
 * başlığını çizen içerikler) yalnız panel döner ama erişilebilir ad yine
 * `ariaLabel` üzerinden verilir.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  description?: string;
  /** Başlık çizilmiyorsa ekran okuyucu için zorunlu ad. */
  ariaLabel?: string;
  /** Panel genişliği (Tailwind max-w sınıfı). */
  maxWidth?: string;
  /** Panel için ek sınıflar (tam ekran harita gibi istisnalar). */
  panelClassName?: string;
  /** Kapatma düğmesini gizle (içerik kendi kapatma düğmesini çiziyorsa). */
  hideCloseButton?: boolean;
}

export function Modal({
  open,
  onClose,
  children,
  title,
  description,
  ariaLabel,
  maxWidth = "max-w-md",
  panelClassName = "",
  hideCloseButton = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useModalA11y({ open, onClose, panelRef });

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      {/* Arka plan: tıklayınca kapanır. <button> olduğu için klavyeyle de
          erişilebilir; div + onClick sessizce klavyeye kapalı kalırdı. */}
      <button
        type="button"
        aria-label="Pencereyi kapat"
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        aria-describedby={description ? descriptionId : undefined}
        // `relative` HER ZAMAN eklenir: arka plan `absolute` konumlandığından,
        // panel statik kalırsa yığınlama sırasında altta kalır ve içindeki
        // düğmeler tıklanamaz olur (görünür ama tepkisiz bir modal).
        className={`relative ${
          panelClassName ||
          `max-h-[92vh] w-full ${maxWidth} overflow-y-auto rounded-t-3xl ` +
            "bg-white p-6 shadow-2xl sm:rounded-3xl"
        }`}
      >
        {(title || !hideCloseButton) && (
          <div className="flex items-start justify-between gap-4">
            <div>
              {title && (
                <h2
                  id={titleId}
                  className="text-lg font-semibold text-slate-900 "
                >
                  {title}
                </h2>
              )}
              {description && (
                <p
                  id={descriptionId}
                  className="mt-1 text-sm text-slate-500 "
                >
                  {description}
                </p>
              )}
            </div>
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus "
              >
                <span className="sr-only">Kapat</span>
                <span aria-hidden="true" className="text-xl leading-none">
                  ×
                </span>
              </button>
            )}
          </div>
        )}
        <div className={title ? "mt-5" : ""}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
