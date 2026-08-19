/**
 * Ürün düzenleme penceresi — İP-A5'te `AdminStore.tsx`ten AYNEN taşındı.
 *
 * İP-A6 NOTU: bu overlay ortak `Dialog`u KULLANMIYOR; `role="dialog"` ve
 * `aria-modal` taşımadığı için nöbetçinin "etiketsiz overlay" sayısındaki beş
 * kalemden biridir. Taşıma bunu bilinçli olarak DÜZELTMEDİ — düzeltmek
 * davranış değiştirir ve bu paket mekaniktir.
 */
import { createPortal } from "react-dom";

import { StockLedgerPanel } from "@/components/admin/StockLedgerPanel";
import { useAdminProduct } from "@/hooks/useStore";

import { ProductForm } from "./ProductForm";

export function EditProductModal({
  id,
  onClose,
  onSaved,
}: {
  id: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, isLoading } = useAdminProduct(id);

  // Navbar backdrop-blur'ü position:fixed'i bozmasın diye body'ye portal.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Ürünü düzenle</h3>
          <button onClick={onClose} aria-label="Kapat" className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-300">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {isLoading || !data ? (
          <p className="py-8 text-center text-sm text-slate-400">Yükleniyor…</p>
        ) : (
          <>
            <ProductForm mode="edit" initial={data} onDone={onSaved} />
            <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-700">
              <StockLedgerPanel productId={data.id} kind={data.kind} />
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
