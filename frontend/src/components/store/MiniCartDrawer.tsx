/**
 * Sepete ekleme onayı — sağdan kayan panel.
 *
 * ## NEDEN TOAST YETMİYOR
 *
 * Sepete ekledikten sonra kullanıcı üç yoldan birine gider: alışverişe devam,
 * sepeti incele, ödemeye geç. Bir toast bu üç yolun hiçbirini açmaz ve saniyeler
 * içinde kaybolur; ekranın neresinde ne olduğunu da göstermez. Onay ekranı üç
 * yolu da AÇIK ve net etiketle sunmak zorundadır.
 *
 * ## OTOMATİK KAPANMA VE OTOMATİK YÖNLENDİRME YOK
 *
 * Otomatik kapanma yavaş okuyanı onaysız bırakır. Otomatik yönlendirme ise
 * çoklu ürün alan kullanıcıyı her seferinde geri gelmeye zorlar — ikisi de
 * sık yapılan ve ölçülmüş hatalardır.
 *
 * ## HANGİ VARYANTIN EKLENDİĞİ YAZAR
 *
 * "Sepete eklendi" tek başına, sekiz renkli bir üründe hangi rengin gittiğini
 * söylemez. Panel seçili varyantı adıyla gösterir.
 *
 * ## PORTAL ZORUNLU
 *
 * Navbar `backdrop-blur` kullanıyor ve blur'lu bir ata, içindeki
 * `position: fixed` ögeyi kendi kutusuna hapsediyor: panel ekranın sağına
 * değil navbar'ın içine çizilirdi (bu depoda yaşanmış bir hata).
 */
import { useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { PlainButton } from "@/components/ui/PlainButton";
import { useModalA11y } from "@/hooks/useModalA11y";
import { cartCount, selectedSubtotal } from "@/lib/cart";
import { formatTL } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import { remainingForFreeShipping, type ShippingConfig } from "@/lib/shipping";
import { useCartStore } from "@/store/cartStore";
import type { ProductDetailOut } from "@/types";

export function MiniCartDrawer({
  open,
  onClose,
  product,
  variantOzeti,
  shipping,
}: {
  open: boolean;
  onClose: () => void;
  /** Az önce eklenen ürün. */
  product: ProductDetailOut;
  variantOzeti?: string | null;
  shipping: ShippingConfig;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const items = useCartStore((s) => s.items);
  useModalA11y({ open, onClose, panelRef });

  if (!open) return null;

  const araToplam = selectedSubtotal(items);
  const adet = cartCount(items);
  const kalan = remainingForFreeShipping(araToplam, shipping);
  const ilerleme =
    shipping.freeThreshold > 0
      ? Math.min(100, Math.round((araToplam / shipping.freeThreshold) * 100))
      : 100;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end">
      <PlainButton
        aria-label="Pencereyi kapat"
        className="absolute inset-0 bg-slate-950/40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Sepete eklendi"
        className="relative flex h-full w-full max-w-sm flex-col overflow-y-auto bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Sepete eklendi</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Sepetinizde {adet} ürün var.
            </p>
          </div>
          <PlainButton
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span className="sr-only">Kapat</span>
            <span aria-hidden="true" className="text-xl leading-none">
              ×
            </span>
          </PlainButton>
        </div>

        <div className="flex gap-3 p-5">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {product.cover_url ? (
              <img
                src={product.cover_url}
                alt=""
                width={80}
                height={80}
                className="h-full w-full object-contain mix-blend-multiply"
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium leading-snug text-slate-900">
              {product.title}
            </p>
            {variantOzeti && (
              <p className="mt-0.5 text-xs text-slate-500">{variantOzeti}</p>
            )}
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {formatTL(product.price)}
            </p>
          </div>
        </div>

        <div className="mt-auto border-t border-slate-100 p-5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-slate-500">Ara toplam</span>
            <span className="font-semibold text-slate-900">
              {formatTL(String(araToplam))}
            </span>
          </div>

          {/* Ücretsiz kargo eşiği: kalan tutarı söylemek sepet ortalamasını
              yükselten en ucuz bilgidir. Eşik SUNUCUDAN gelir. */}
          {kalan > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-slate-500">
                Ücretsiz kargo için {formatTL(String(kalan))} daha ekleyin
              </p>
              <div
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuenow={ilerleme}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Ücretsiz kargo ilerlemesi"
              >
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${ilerleme}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs font-medium text-emerald-700">
              Kargo ücretsiz
            </p>
          )}

          {/* Üç yol da AÇIK: devam et (kapat), sepeti gör, ödemeye geç. */}
          <div className="mt-4 space-y-2">
            <Link
              to={ROUTES.storeCheckout}
              className="flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Ödemeye geç
            </Link>
            <Link
              to={ROUTES.storeCart}
              className="flex h-11 items-center justify-center rounded-lg border border-slate-200 px-6 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Sepeti gör
            </Link>
            <PlainButton
              onClick={onClose}
              className="flex h-11 w-full items-center justify-center rounded-lg px-6 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50"
            >
              Alışverişe devam et
            </PlainButton>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
