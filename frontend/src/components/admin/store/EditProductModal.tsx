/**
 * Ürün düzenleme penceresi.
 *
 * ## İP-A6 · Görev 4b — göç
 *
 * Bu dosya nöbetçinin BEŞ etiketsiz overlay'inden biriydi: kendi
 * `createPortal` + `fixed inset-0` katmanını kuruyor, `role="dialog"` ve
 * `aria-modal` taşımıyor, odak tuzağı/ESC/arka plan kilidi yoktu. Kapatmanın
 * tek yolu arkaplan tıklaması ve sağ üstteki × idi; kirli formda hiçbir uyarı
 * çıkmıyordu.
 *
 * Artık `ui2/duzenlemeYuzeyi`nin `DuzenlemePenceresi`ni kullanıyor. Gelen:
 * `role="dialog"` + `aria-modal` + odak tuzağı + ESC + arka plan kilidi
 * (`Dialog`/`useModalA11y`) ve **kirli formda kapatma onayı** — pencereyi
 * kapatan HER yol bekçiden geçiyor.
 *
 * Pencere durumu da ekrandan çıktı: hangi ürünün düzenlendiği artık
 * `useDuzenlemeYuzeyi`de yaşıyor (`ProductsPanel`), bu bileşende `useState`
 * yok.
 */
import { StockLedgerPanel } from "@/components/admin/StockLedgerPanel";
import {
  DuzenlemePenceresi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useAdminProduct } from "@/hooks/useStore";

import { ProductForm } from "./ProductForm";

export function EditProductModal({
  yuzey,
  onSaved,
}: {
  /** Düzenlenen ürünün kimliğini taşıyan yüzey; kapalıyken `kayit` null. */
  yuzey: DuzenlemeYuzeyiDurumu<number, void>;
  onSaved: () => void;
}) {
  // Yüzey kapalıyken sorgu da uyumalı: `useAdminProduct(null)` isteği atmaz.
  const { data, isLoading } = useAdminProduct(yuzey.kayit ?? undefined);

  if (!yuzey.acik) return null;

  return (
    <DuzenlemePenceresi yuzey={yuzey} baslik="Ürünü düzenle">
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
    </DuzenlemePenceresi>
  );
}
