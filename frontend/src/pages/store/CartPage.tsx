import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { ProductCard } from "@/components/store/ProductCard";
import { getRecentlyViewedProducts } from "@/lib/recentlyViewedProducts";
import { formatTL } from "@/lib/money";
import { shippingFor } from "@/lib/shipping";
import { estimateDelivery } from "@/lib/delivery";
import { isSelected, selectedSubtotal, type CartItem } from "@/lib/cart";
import { useCartStore } from "@/store/cartStore";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS } from "@/types";
import { toast } from "@/store/toastStore";

export default function CartPage() {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const remove = useCartStore((s) => s.remove);
  const toggleSelected = useCartStore((s) => s.toggleSelected);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const [pickupOpen, setPickupOpen] = useState(false);

  const subtotal = selectedSubtotal(items);
  const hasPhysicalSelected = items.some(
    (i) => isSelected(i) && i.kind === "PHYSICAL"
  );
  const shipping = hasPhysicalSelected ? shippingFor(subtotal) : 0;
  const total = subtotal + shipping;
  const selectedCount = items.filter(isSelected).length;

  // Son görüntülenenler — sepettekiler hariç (ödeme öncesi öneri rayı).
  const viewed = useMemo(() => {
    const inCart = new Set(items.map((i) => i.product_id));
    return getRecentlyViewedProducts()
      .filter((p) => !inCart.has(p.id))
      .slice(0, 6);
  }, [items]);

  function goCheckout() {
    if (selectedCount === 0) {
      toast.info("Lütfen en az bir ürün seç");
      return;
    }
    if (!token) {
      toast.info("Ödeme için giriş yapmalısın");
      navigate(ROUTES.login);
      return;
    }
    if (user?.role_id !== ROLE_IDS.CLIENT) {
      toast.error("Yalnızca öğrenci hesabıyla alışveriş yapılabilir");
      return;
    }
    navigate(ROUTES.storeCheckout);
  }

  return (
    <StoreLayout title="Sepet" showCategoryBar={false}>
      <Seo title="Sepet — Mağaza" noindex />
      <div className="mx-auto max-w-[1464px] px-4 py-6 md:px-8">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          Sepetim{" "}
          <span className="font-normal text-slate-400 dark:text-slate-500">
            ({items.length} Ürün)
          </span>
        </h1>

        {items.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-slate-200 py-16 text-center dark:border-slate-800">
            <p className="text-slate-500 dark:text-slate-400">Sepetin boş.</p>
            <Link
              to={ROUTES.store}
              className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Ürünlere göz at
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]">
            {/* Sol: ürün kartları */}
            <div className="space-y-4">
              {items.map((item) => (
                <CartLine
                  key={item.product_id}
                  item={item}
                  onToggle={() => toggleSelected(item.product_id)}
                  onQuantity={(q) => setQuantity(item.product_id, q)}
                  onRemove={() => remove(item.product_id)}
                />
              ))}
            </div>

            {/* Sağ: sepet özeti (sticky) */}
            <aside className="h-fit rounded-2xl border border-slate-200 p-5 dark:border-slate-800 lg:sticky lg:top-24">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Sepet Özeti
              </h2>

              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Ara toplam</span>
                  <span className="font-medium text-slate-900 dark:text-white">
                    {formatTL(subtotal)}
                  </span>
                </div>
                {hasPhysicalSelected && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Kargo ücreti</span>
                    <span
                      className={
                        shipping === 0
                          ? "font-medium text-emerald-600 dark:text-emerald-400"
                          : "font-medium text-slate-900 dark:text-white"
                      }
                    >
                      {shipping === 0 ? "Ücretsiz" : formatTL(shipping)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-3 dark:border-slate-700">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Toplam</span>
                  <span className="text-lg font-semibold text-slate-900 dark:text-white">
                    {formatTL(total)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={goCheckout}
                disabled={selectedCount === 0}
                className="mt-5 w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
              >
                Sepeti Onayla
              </button>

              {/* Gel Al Noktası bilgi kartı */}
              <button
                type="button"
                onClick={() => setPickupOpen(true)}
                className="mt-3 flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-indigo-300 dark:border-slate-700 dark:hover:border-indigo-500/60"
              >
                <svg className="shrink-0 text-indigo-600 dark:text-indigo-400" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="flex-1">
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    Gel Al Noktası Nedir?
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Kütüphaneden ücretsiz teslim al
                  </span>
                </span>
                <svg className="shrink-0 text-slate-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>

              <p className="mt-3 text-center text-xs text-slate-400">
                Nihai tutar ödeme adımında sunucuda onaylanır.
              </p>
            </aside>
          </div>
        )}

        {viewed.length > 0 && (
          <div className="mt-12">
            <h2 className="mb-5 text-lg font-semibold text-slate-900 dark:text-white">
              Son görüntülediklerin
            </h2>
            <div className="hide-scrollbar flex snap-x gap-4 overflow-x-auto pb-4">
              {viewed.map((p) => (
                <div key={p.id} className="w-[150px] shrink-0 snap-start md:w-[180px]">
                  <ProductCard product={p} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {pickupOpen && <PickupModal onClose={() => setPickupOpen(false)} />}
    </StoreLayout>
  );
}

/* ── Sepet satırı (ürün kartı) ── */
function CartLine({
  item,
  onToggle,
  onQuantity,
  onRemove,
}: {
  item: CartItem;
  onToggle: () => void;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const sel = isSelected(item);
  const isPhysical = item.kind === "PHYSICAL";

  return (
    <div
      className={`relative flex gap-4 rounded-2xl border border-slate-200 p-4 transition-opacity dark:border-slate-800 ${
        sel ? "" : "opacity-60"
      }`}
    >
      {/* Sol blok: checkbox + görsel (dikey ortalı), altında adet */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Checkbox checked={sel} onChange={onToggle} />
          <Link
            to={ROUTES.storeProduct(item.slug)}
            className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
          >
            {item.cover_url && (
              <img src={item.cover_url} alt="" className="h-full w-full object-cover" />
            )}
          </Link>
        </div>
        {/* Adet — görselin altında (checkbox+gap kadar sağa kaydırılmış) */}
        <div className="pl-8">
          {isPhysical ? (
            <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                aria-label="Azalt"
                onClick={() => onQuantity(item.quantity - 1)}
                className="px-2.5 py-1 text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-white"
              >
                −
              </button>
              <span className="min-w-7 text-center text-sm text-slate-900 dark:text-white">
                {item.quantity}
              </span>
              <button
                type="button"
                aria-label="Artır"
                onClick={() => onQuantity(item.quantity + 1)}
                className="px-2.5 py-1 text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-white"
              >
                +
              </button>
            </div>
          ) : (
            <span className="text-xs text-slate-400">Dijital · 1 adet</span>
          )}
        </div>
      </div>

      {/* Orta: başlık + tahmini teslimat */}
      <div className="flex flex-1 flex-col pr-16">
        <Link
          to={ROUTES.storeProduct(item.slug)}
          className="text-sm font-medium leading-snug text-slate-800 transition-colors hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-400"
        >
          {item.title}
        </Link>
        <span className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Tahmini teslimat: {estimateDelivery(item.kind)}
        </span>
      </div>

      {/* Sağ üst: sil */}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-4 top-4 flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-rose-500"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        Sil
      </button>

      {/* Sağ alt: satır fiyatı */}
      <div className="absolute bottom-4 right-4 text-base font-semibold text-slate-900 dark:text-white">
        {formatTL(Number(item.price) * item.quantity)}
      </div>
    </div>
  );
}

/* ── Özel seçim kutusu ── */
function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "Seçimi kaldır" : "Seç"}
      onClick={onChange}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
        checked
          ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500"
          : "border-slate-300 bg-white hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-800"
      }`}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

/* ── "Gel Al Noktası" bilgi modalı ── */
function PickupModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Gel Al Noktası
          </h3>
          <button
            type="button"
            aria-label="Kapat"
            onClick={onClose}
            className="text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          <p>
            Gel al noktası, siparişini kargoyla beklemek yerine sana yakın bir
            <span className="font-medium text-slate-900 dark:text-white"> kütüphane / etüt merkezinden</span>{" "}
            teslim alabildiğin noktadır.
          </p>
          <p>
            Anlaşmalı noktadan teslim almak{" "}
            <span className="font-medium text-emerald-600 dark:text-emerald-400">kargo ücreti ödemeden</span>{" "}
            ürününe ulaşmanı sağlar; siparişin hazır olduğunda haber verilir.
          </p>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            Gel al noktası seçimi <span className="font-medium">ödeme adımında</span> yapılır.
            İstersen klasik kargo teslimatıyla da devam edebilirsin.
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <Link
            to={ROUTES.libraries}
            className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Noktaları gör →
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            Anladım
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
