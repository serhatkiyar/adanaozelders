import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { ProductCard } from "@/components/store/ProductCard";
import { getRecentlyViewedProducts } from "@/lib/recentlyViewedProducts";
import { formatTRY } from "@/lib/money";
import {
  SHIPPING_FREE_THRESHOLD,
  remainingForFreeShipping,
  shippingFor,
} from "@/lib/shipping";
import { useCartStore } from "@/store/cartStore";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS } from "@/types";
import { toast } from "@/store/toastStore";

export default function CartPage() {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const remove = useCartStore((s) => s.remove);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);

  const subtotal = items.reduce(
    (sum, i) => sum + Number(i.price) * i.quantity,
    0
  );
  const hasPhysical = items.some((i) => i.kind === "PHYSICAL");
  const shipping = hasPhysical ? shippingFor(subtotal) : 0;
  const remaining = remainingForFreeShipping(subtotal);
  const freeProgress = Math.min(100, (subtotal / SHIPPING_FREE_THRESHOLD) * 100);

  // Son görüntülenenler — sepettekiler hariç (ödeme öncesi öneri rayı).
  const viewed = useMemo(() => {
    const inCart = new Set(items.map((i) => i.product_id));
    return getRecentlyViewedProducts()
      .filter((p) => !inCart.has(p.id))
      .slice(0, 6);
  }, [items]);

  function goCheckout() {
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
    <StoreLayout title="Sepet">
      <Seo title="Sepet — Mağaza" noindex />
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Sepetim</h1>

        {items.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-slate-100 py-16 text-center dark:border-slate-800">
            <p className="text-slate-500 dark:text-slate-400">Sepetin boş.</p>
            <Link
              to={ROUTES.store}
              className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
            >
              Ürünlere göz at
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-6 divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((item) => (
                <div key={item.product_id} className="flex gap-4 py-4">
                  <Link
                    to={ROUTES.storeProduct(item.slug)}
                    className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
                  >
                    {item.cover_url && (
                      <img src={item.cover_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </Link>
                  <div className="flex flex-1 flex-col">
                    <Link
                      to={ROUTES.storeProduct(item.slug)}
                      className="text-sm font-medium text-slate-800 dark:text-slate-200"
                    >
                      {item.title}
                    </Link>
                    <span className="mt-0.5 text-xs text-slate-400">
                      {item.kind === "DIGITAL" ? "Dijital" : "Basılı"}
                    </span>
                    <div className="mt-auto flex items-center gap-3">
                      {item.kind === "PHYSICAL" ? (
                        <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700">
                          <button
                            type="button"
                            onClick={() => setQuantity(item.product_id, item.quantity - 1)}
                            className="px-2.5 py-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                          >
                            −
                          </button>
                          <span className="min-w-7 text-center text-sm">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => setQuantity(item.product_id, item.quantity + 1)}
                            className="px-2.5 py-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">1 adet</span>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(item.product_id)}
                        className="text-xs text-rose-500 hover:underline"
                      >
                        Kaldır
                      </button>
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {formatTRY(Number(item.price) * item.quantity)}
                  </div>
                </div>
              ))}
            </div>

            {/* Ücretsiz kargo eşik çubuğu (yalnız fiziksel ürün varsa) */}
            {hasPhysical && (
              <div className="mt-6 rounded-xl border border-slate-100 px-4 py-3 dark:border-slate-800">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {remaining > 0 ? (
                    <>
                      Ücretsiz kargoya{" "}
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                        {formatTRY(remaining)}
                      </span>{" "}
                      kaldı
                    </>
                  ) : (
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      Siparişin ücretsiz kargo 🎉
                    </span>
                  )}
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all ${remaining > 0 ? "bg-indigo-500" : "bg-emerald-500"}`}
                    style={{ width: `${freeProgress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="mt-4 space-y-2 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>Ara toplam</span>
                <span className="text-slate-900 dark:text-white">{formatTRY(subtotal)}</span>
              </div>
              {hasPhysical && (
                <div className="flex items-center justify-between text-sm text-slate-500">
                  <span>Kargo</span>
                  <span className={shipping === 0 ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white"}>
                    {shipping === 0 ? "Ücretsiz" : formatTRY(shipping)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Tahmini toplam</span>
                <span className="text-lg font-semibold text-slate-900 dark:text-white">
                  {formatTRY(subtotal + shipping)}
                </span>
              </div>
            </div>
            <p className="mt-1 text-right text-xs text-slate-400">
              Nihai tutar ödeme adımında sunucuda onaylanır.
            </p>

            <button
              type="button"
              onClick={goCheckout}
              className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-slate-900"
            >
              Ödemeye geç
            </button>
          </>
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
    </StoreLayout>
  );
}
