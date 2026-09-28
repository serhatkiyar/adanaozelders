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
import { isAxiosError } from "axios";

import { StockLedgerPanel } from "@/components/admin/StockLedgerPanel";
import { ErrorState } from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { useAdminProduct } from "@/hooks/useStore";
import { getErrorMessage } from "@/lib/errors";

import { ProductForm } from "./ProductForm";
import { ProductMediaManager } from "./ProductMediaManager";
import { VariantMatrixPanel } from "./VariantMatrixPanel";

export function EditProductModal({
  yuzey,
  onSaved,
}: {
  /** Düzenlenen ürünün kimliğini taşıyan yüzey; kapalıyken `kayit` null. */
  yuzey: DuzenlemeYuzeyiDurumu<number, void>;
  onSaved: () => void;
}) {
  // Yüzey kapalıyken sorgu da uyumalı: `useAdminProduct(null)` isteği atmaz.
  const { data, isLoading, isError, error, refetch } = useAdminProduct(
    yuzey.kayit ?? undefined,
  );

  if (!yuzey.acik) return null;

  return (
    <DuzenlemePenceresi yuzey={yuzey} baslik="Ürünü düzenle">
      {isError && !data ? (
        // Hata dalı olmadan `!data` koşulu pencereyi sonsuza dek "Yükleniyor…"
        // durumunda bırakıyordu. `!data`: arka plan tazelemesi düşerse eldeki
        // veri kalır, açık form (kaydedilmemiş düzenleme) sökülmez. Kapatma
        // × / ESC ile pencerenin kendisinde.
        isAxiosError(error) && error.response?.status === 404 ? (
          <ErrorState
            title="Ürün bulunamadı"
            description="Bu ürün silinmiş ya da taşınmış olabilir."
          />
        ) : (
          <ErrorState
            title="Ürün yüklenemedi"
            description={getErrorMessage(error, "Ürün bilgileri alınamadı.")}
            onRetry={() => void refetch()}
          />
        )
      ) : isLoading || !data ? (
        <p className="py-8 text-center text-sm text-slate-400">Yükleniyor…</p>
      ) : (
        <>
          <ProductForm mode="edit" initial={data} onDone={onSaved} />
          {/* Görseller formun KARDEŞİDİR, içinde değil: yükleme/silme anında
              sunucuya yazar ve formun "kaydet"ine bağlı değildir. Forma
              gömülseydi kirli form bekçisi yüklenmiş bir görseli
              "kaydedilmemiş değişiklik" sanardı. `StockLedgerPanel` aynı
              gerekçeyle burada duruyor. */}
          <div className="mt-6 border-t border-slate-200 pt-5 ">
            <ProductMediaManager product={data} />
          </div>
          {data.variants && (
            <div className="mt-6 border-t border-slate-200 pt-5 ">
              <VariantMatrixPanel product={data} />
            </div>
          )}
          <div className="mt-6 border-t border-slate-200 pt-5 ">
            <StockLedgerPanel productId={data.id} kind={data.kind} />
          </div>
        </>
      )}
    </DuzenlemePenceresi>
  );
}
