import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { PaymentConsentNote } from "@/components/LegalConsent";
import { formatTRY } from "@/lib/money";
import { validateCart } from "@/api/store";
import { useCreateOrder } from "@/hooks/useStore";
import { useMyAddresses, useAddAddress } from "@/hooks/useAddresses";
import { useCartStore } from "@/store/cartStore";
import { toast } from "@/store/toastStore";

export default function CheckoutPage() {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clear);
  const couponCode = useCartStore((s) => s.couponCode);
  const setCoupon = useCartStore((s) => s.setCoupon);
  const [couponInput, setCouponInput] = useState(couponCode ?? "");

  const cartLines = useMemo(
    () => items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
    [items]
  );

  const { data: validation, isLoading } = useQuery({
    queryKey: ["store", "cart", "validate", cartLines, couponCode],
    queryFn: () => validateCart(cartLines, couponCode),
    enabled: cartLines.length > 0,
  });

  const discount = Number(validation?.discount ?? 0);
  const couponError = validation?.coupon_error ?? null;

  const { data: addresses } = useMyAddresses();
  const [addressId, setAddressId] = useState<number | undefined>(undefined);
  const createOrder = useCreateOrder();

  const hasPhysical = validation?.has_physical ?? false;
  const defaultAddr = addresses?.find((a) => a.is_default) ?? addresses?.[0];
  const selectedAddr = addressId ?? defaultAddr?.id;

  if (items.length === 0) {
    return (
      <StoreLayout title="Ödeme">
        <div className="mx-auto max-w-md py-20 text-center">
          <p className="text-slate-600 dark:text-slate-300">Sepetin boş.</p>
          <Link to={ROUTES.store} className="mt-4 inline-block text-sm font-medium underline">
            Mağazaya dön
          </Link>
        </div>
      </StoreLayout>
    );
  }

  function placeOrder() {
    if (validation?.issues && validation.issues.length > 0) {
      toast.error("Sepette sorunlar var, lütfen kontrol et.");
      return;
    }
    if (hasPhysical && !selectedAddr) {
      toast.error("Teslimat adresi seç.");
      return;
    }
    if (couponError) {
      toast.error("Kupon geçersiz, kaldır veya düzelt.");
      return;
    }
    createOrder.mutate(
      {
        items: cartLines,
        address_id: hasPhysical ? selectedAddr : undefined,
        coupon_code: couponCode || undefined,
      },
      {
        onSuccess: (order) => {
          if (order.redirect_url) {
            // iyzico hosted checkout (3DS) → tarayıcıyı yönlendir.
            window.location.href = order.redirect_url;
            return;
          }
          clearCart();
          toast.success("Siparişin alındı!");
          navigate(ROUTES.orders);
        },
        onError: (err: unknown) => {
          const detail =
            (err as { response?: { data?: { detail?: string } } })?.response?.data
              ?.detail ?? "Sipariş oluşturulamadı";
          toast.error(detail);
        },
      }
    );
  }

  return (
    <StoreLayout title="Ödeme">
      <Seo title="Ödeme — Mağaza" noindex />
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Ödeme</h1>

        {/* Teslimat adresi (yalnız fiziksel ürün varsa) */}
        {hasPhysical && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Teslimat adresi
            </h2>
            {addresses && addresses.length > 0 ? (
              <div className="mt-3 space-y-2">
                {addresses.map((a) => (
                  <label
                    key={a.id}
                    className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${
                      selectedAddr === a.id
                        ? "border-slate-900 dark:border-white"
                        : "border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="address"
                      checked={selectedAddr === a.id}
                      onChange={() => setAddressId(a.id)}
                      className="mt-1"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        {a.title}
                      </p>
                      <p className="text-sm text-slate-500">{a.address_line}</p>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <NewAddressForm onCreated={(id) => setAddressId(id)} />
            )}
          </section>
        )}

        {/* Özet */}
        <section className="mt-6 rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Sipariş özeti
          </h2>
          {isLoading ? (
            <p className="mt-3 text-sm text-slate-400">Hesaplanıyor…</p>
          ) : validation ? (
            <>
              <div className="mt-3 space-y-2">
                {validation.items.map((it) => (
                  <div key={it.product_id} className="flex justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-300">
                      {it.title} × {it.quantity}
                    </span>
                    <span className="text-slate-900 dark:text-white">
                      {formatTRY(Number(it.unit_price) * it.quantity)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
                <div className="flex justify-between text-slate-500">
                  <span>Ara toplam</span>
                  <span>{formatTRY(validation.subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>İndirim{validation.coupon_code ? ` (${validation.coupon_code})` : ""}</span>
                    <span>−{formatTRY(validation.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-500">
                  <span>Kargo</span>
                  <span>
                    {Number(validation.shipping_fee) === 0
                      ? "Ücretsiz"
                      : formatTRY(validation.shipping_fee)}
                  </span>
                </div>
                <div className="flex justify-between pt-1 text-base font-semibold text-slate-900 dark:text-white">
                  <span>Toplam</span>
                  <span>{formatTRY(validation.total)}</span>
                </div>
              </div>
              {validation.issues.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-lg bg-rose-50 p-3 text-sm text-rose-600 dark:bg-rose-500/10">
                  {validation.issues.map((iss, i) => (
                    <li key={i}>• {iss}</li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </section>

        {/* Kupon */}
        <section className="mt-4 rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">İndirim kuponu</h2>
          {couponCode && !couponError ? (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-500/10">
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                {couponCode} uygulandı
              </span>
              <button
                type="button"
                onClick={() => {
                  setCoupon(null);
                  setCouponInput("");
                }}
                className="text-xs font-medium text-slate-500 hover:text-rose-600"
              >
                Kaldır
              </button>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="Kupon kodu"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <button
                type="button"
                disabled={!couponInput.trim()}
                onClick={() => setCoupon(couponInput.trim())}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                Uygula
              </button>
            </div>
          )}
          {couponError && (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{couponError}</p>
          )}
        </section>

        <PaymentConsentNote className="mt-4" />

        <button
          type="button"
          onClick={placeOrder}
          disabled={createOrder.isPending || isLoading || !!couponError}
          className="mt-4 w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          {createOrder.isPending ? "İşleniyor…" : "Siparişi tamamla ve öde"}
        </button>
      </div>
    </StoreLayout>
  );
}

function NewAddressForm({ onCreated }: { onCreated: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [line, setLine] = useState("");
  const add = useAddAddress();

  return (
    <div className="mt-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <p className="text-sm text-slate-500">Kayıtlı adresin yok. Yeni ekle:</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Başlık (ör. Ev)"
        className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
      />
      <textarea
        value={line}
        onChange={(e) => setLine(e.target.value)}
        placeholder="Açık adres"
        rows={2}
        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
      />
      <button
        type="button"
        disabled={add.isPending || !title || !line}
        onClick={() =>
          add.mutate(
            { title, address_line: line, is_default: true },
            {
              onSuccess: (created) => {
                onCreated(created.id);
                toast.success("Adres eklendi");
              },
            }
          )
        }
        className="mt-2 rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
      >
        Adresi kaydet
      </button>
    </div>
  );
}
