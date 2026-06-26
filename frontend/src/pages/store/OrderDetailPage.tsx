import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { FullScreenSpinner } from "@/components/Spinner";
import { formatTRY } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { useOrder, useCancelOrder, useRequestReturn } from "@/hooks/useStore";
import { useCartStore } from "@/store/cartStore";
import { STATUS_LABELS } from "@/pages/store/OrdersPage";
import { toast } from "@/store/toastStore";
import type { OrderOut, ProductSearchOut } from "@/types";

const RETURN_BADGE: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "İade talebi inceleniyor", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" },
  APPROVED: { label: "İade onaylandı", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" },
  REJECTED: { label: "İade talebi reddedildi", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400" },
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orderId = id ? Number(id) : undefined;
  const { data: order, isLoading, isError } = useOrder(orderId);
  const add = useCartStore((s) => s.add);
  const cancel = useCancelOrder();
  const navigate = useNavigate();
  const [returnOpen, setReturnOpen] = useState(false);

  if (isLoading) return <FullScreenSpinner />;
  if (isError || !order) {
    return (
      <StoreLayout title="Sipariş">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center md:px-0">
          <p className="text-slate-600 dark:text-slate-300">Sipariş bulunamadı.</p>
          <Link to={ROUTES.orders} className="mt-4 inline-block text-sm font-medium underline">
            Siparişlerime dön
          </Link>
        </div>
      </StoreLayout>
    );
  }

  const badge = STATUS_LABELS[order.status] ?? { label: order.status, cls: "bg-slate-100 text-slate-500" };
  const cancellable = order.status === "PENDING" || order.status === "PAID";
  const returnBadge = order.return_status ? RETURN_BADGE[order.return_status] : null;
  // İade talebi: kargolanmış/teslim, ödenmiş fiziksel sipariş; açık/onaylı talep yokken.
  const canRequestReturn =
    order.has_physical &&
    (order.status === "SHIPPED" || order.status === "DELIVERED") &&
    order.payment_status === "PAID" &&
    order.return_status !== "PENDING" &&
    order.return_status !== "APPROVED";

  function handleCancel() {
    if (!order) return;
    const msg =
      order.payment_status === "PAID"
        ? "Siparişi iptal et? Ödemen iade edilecek."
        : "Siparişi iptal etmek istiyor musun?";
    if (!window.confirm(msg)) return;
    cancel.mutate(order.id, {
      onSuccess: () => toast.success("Siparişin iptal edildi"),
      onError: (err: unknown) => {
        const detail =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Sipariş iptal edilemedi";
        toast.error(detail);
      },
    });
  }

  function reorder() {
    if (!order) return;
    const reAddable = order.items.filter((it) => it.product_id);
    if (reAddable.length === 0) {
      toast.error("Bu siparişteki ürünler artık mevcut değil.");
      return;
    }
    for (const it of reAddable) {
      // OrderItemOut tam ürün taşımaz; sepet için gereken minimal alanlarla kur
      // (slug = product_id; storeProduct route'u id'yi de kabul eder).
      const product = {
        id: it.product_id!,
        slug: String(it.product_id),
        title: it.title,
        kind: it.kind,
        seller_type: it.seller_type,
        price: it.unit_price,
        currency: order.currency,
        in_stock: true,
        rating_count: 0,
      } as ProductSearchOut;
      add(product, it.kind === "PHYSICAL" ? it.quantity : 1);
    }
    toast.success("Ürünler sepete eklendi");
    navigate(ROUTES.storeCart);
  }

  return (
    <StoreLayout title={`Sipariş #${order.id}`}>
      <Seo title={`Sipariş #${order.id} — Mağaza`} noindex />
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-0">
        {/* Breadcrumb */}
        <nav className="mb-4 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          <Link to={ROUTES.orders} className="hover:text-indigo-600 dark:hover:text-indigo-400">
            Siparişlerim
          </Link>
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <span className="text-slate-700 dark:text-slate-300">#{order.id}</span>
        </nav>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Sipariş #{order.id}</h1>
            <p className="mt-0.5 text-sm text-slate-400">{formatDateTime(order.created_at)}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
            {returnBadge && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${returnBadge.cls}`}>
                {returnBadge.label}
              </span>
            )}
          </div>
        </div>

        {/* Kalemler */}
        <div className="mt-6 rounded-2xl border border-slate-100 p-5 dark:border-slate-800">
          <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Ürünler</h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {order.items.map((it) => (
              <div key={it.id} className="flex items-center justify-between py-3 text-sm">
                <span className="text-slate-700 dark:text-slate-300">
                  {it.product_id ? (
                    <Link to={ROUTES.storeProduct(it.product_id)} className="hover:text-indigo-600 dark:hover:text-indigo-400">
                      {it.title}
                    </Link>
                  ) : (
                    it.title
                  )}
                  <span className="text-slate-400"> × {it.quantity}</span>
                </span>
                <div className="flex items-center gap-3">
                  {it.download_url && (
                    <a href={it.download_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-600 underline dark:text-indigo-400">
                      İndir
                    </a>
                  )}
                  <span className="text-slate-900 dark:text-white">
                    {formatTRY(Number(it.unit_price) * it.quantity)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Tutar dökümü */}
          <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
            <div className="flex justify-between text-slate-500">
              <span>Ara toplam</span>
              <span className="text-slate-900 dark:text-white">{formatTRY(order.subtotal)}</span>
            </div>
            {order.discount && Number(order.discount) > 0 && (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <span>İndirim{order.coupon_code ? ` (${order.coupon_code})` : ""}</span>
                <span>−{formatTRY(order.discount)}</span>
              </div>
            )}
            {order.has_physical && (
              <div className="flex justify-between text-slate-500">
                <span>Kargo</span>
                <span className={Number(order.shipping_fee) === 0 ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white"}>
                  {Number(order.shipping_fee) === 0 ? "Ücretsiz" : formatTRY(order.shipping_fee)}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-1.5 dark:border-slate-800">
              <span className="font-medium text-slate-700 dark:text-slate-200">Toplam</span>
              <span className="text-base font-semibold text-slate-900 dark:text-white">{formatTRY(order.total)}</span>
            </div>
          </div>
        </div>

        {/* Teslimat */}
        {order.has_physical && order.ship_recipient && (
          <div className="mt-4 rounded-2xl border border-slate-100 p-5 dark:border-slate-800">
            <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Teslimat adresi</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {order.ship_recipient}
              {order.ship_phone && <> · {order.ship_phone}</>}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {order.ship_address}
              {(order.ship_district || order.ship_city) && (
                <>
                  {" "}
                  {[order.ship_district, order.ship_city].filter(Boolean).join(" / ")}
                </>
              )}
            </p>
            {order.tracking_no && (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                Kargo takip no:{" "}
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent("kargo takip " + order.tracking_no)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-indigo-600 underline dark:text-indigo-400"
                >
                  {order.tracking_no}
                </a>
              </p>
            )}
          </div>
        )}

        {/* Ödeme + aksiyonlar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-slate-500">
            Ödeme durumu:{" "}
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {order.payment_status === "PAID" ? "Ödendi" : order.payment_status === "PENDING" ? "Bekliyor" : order.payment_status}
            </span>
          </span>
          <div className="flex items-center gap-3">
            {cancellable && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancel.isPending}
                className="rounded-full border border-rose-200 px-5 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
              >
                Siparişi iptal et
              </button>
            )}
            {canRequestReturn && (
              <button
                type="button"
                onClick={() => setReturnOpen(true)}
                className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:text-slate-200 dark:hover:text-rose-400"
              >
                İade talebi oluştur
              </button>
            )}
            <button
              type="button"
              onClick={reorder}
              className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-200 dark:hover:text-indigo-400"
            >
              Tekrar sipariş et
            </button>
          </div>
        </div>
      </div>

      {returnOpen && (
        <ReturnModal order={order} onClose={() => setReturnOpen(false)} />
      )}
    </StoreLayout>
  );
}

function ReturnModal({ order, onClose }: { order: OrderOut; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const request = useRequestReturn(order.id);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) {
      toast.error("Lütfen iade gerekçeni yaz (en az 3 karakter).");
      return;
    }
    request.mutate(reason.trim(), {
      onSuccess: () => {
        toast.success("İade talebin alındı; en kısa sürede değerlendirilecek.");
        onClose();
      },
      onError: (err: unknown) => {
        const detail =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "İade talebi oluşturulamadı";
        toast.error(detail);
      },
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          İade talebi — Sipariş #{order.id}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          İade gerekçeni yaz. Talebin onaylanırsa ödemen iade edilir.
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Ürün hasarlı geldi / yanlış ürün / beklentimi karşılamadı…"
          className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:ring-indigo-500/20"
        />
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-white"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={request.isPending}
            className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            Talebi gönder
          </button>
        </div>
      </form>
    </div>
  );
}
