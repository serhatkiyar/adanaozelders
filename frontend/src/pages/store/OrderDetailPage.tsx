import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { FullScreenSpinner } from "@/components/Spinner";
import { formatTL } from "@/lib/money";
import { formatDate } from "@/lib/datetime";
import { promisedDateLabel } from "@/lib/deliveryPromise";
import { ShipAddressUpdate } from "@/components/store/ShipAddressUpdate";
import { OrderInvoiceModal } from "@/components/store/OrderInvoiceModal";
import { useOrder, useCancelOrder, useRequestReturn } from "@/hooks/useStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCartStore } from "@/store/cartStore";
import { STATUS_LABELS, OrderItemRow, orderItemToProduct } from "@/pages/store/OrdersPage";
import { toast } from "@/store/toastStore";
import type { OrderOut } from "@/types";

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
  const { data: user } = useCurrentUser();
  const [returnOpen, setReturnOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  if (isLoading) return <FullScreenSpinner />;
  if (isError || !order) {
    return (
      <StoreLayout title="Sipariş" showCategoryBar={false}>
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
  // Sipariş oluşturuldu (PENDING) / hazırlanıyor (PAID) → iptal edilebilir.
  const cancellable = order.status === "PENDING" || order.status === "PAID";
  // Dağıtımda (SHIPPED) / teslim edildi (DELIVERED) → iade talebi + fatura yüzeyi.
  const isFulfilled = order.status === "SHIPPED" || order.status === "DELIVERED";
  const returnBadge = order.return_status ? RETURN_BADGE[order.return_status] : null;
  // Teslim edilmişse iade penceresi (teslim + 14 gün) kapanmış olabilir.
  const returnWindowClosed =
    order.status === "DELIVERED" &&
    !!order.return_deadline &&
    new Date() > new Date(order.return_deadline);
  const canRequestReturn =
    order.has_physical &&
    isFulfilled &&
    order.payment_status === "PAID" &&
    order.return_status !== "PENDING" &&
    order.return_status !== "APPROVED" &&
    !returnWindowClosed;
  const showInvoice = isFulfilled;

  // Kargo takibi: ödenmiş fiziksel sipariş, iptal/iade değil, token var.
  const canTrack =
    !!order.track_token &&
    order.has_physical &&
    order.payment_status === "PAID" &&
    (order.status === "PAID" || order.status === "SHIPPED" || order.status === "DELIVERED");
  const trackSub =
    order.status === "DELIVERED"
      ? "Teslim edildi — teslimat özetini görüntüle"
      : order.status === "SHIPPED"
        ? "Kuryemiz yolda — canlı konumu ve tahmini varışı izle"
        : "Siparişin hazırlanıyor — kuryeye verildiğinde canlı izle";

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
      add(orderItemToProduct(it, order.currency), it.kind === "PHYSICAL" ? it.quantity : 1);
    }
    toast.success("Ürünler sepete eklendi");
    navigate(ROUTES.storeCart);
  }

  const cell = "flex-1 p-5";

  return (
    <StoreLayout title={`Sipariş #${order.id}`} showCategoryBar={false}>
      <Seo title={`Sipariş #${order.id} — Mağaza`} noindex />
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        {/* Breadcrumb */}
        <nav className="mb-3 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          <Link to={ROUTES.orders} className="hover:text-indigo-600 dark:hover:text-indigo-400">
            Siparişlerim
          </Link>
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <span className="text-slate-700 dark:text-slate-300">Sipariş Bilgileri</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Sipariş Bilgileri</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Sipariş Tarihi {formatDate(order.created_at)} · Sipariş No #{order.id}
            </p>
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

        {/* 3 kolon bilgi kutusu */}
        <div className="mt-5 flex flex-col divide-y divide-slate-200 rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800 sm:flex-row sm:divide-x sm:divide-y-0">
          {/* Teslimat */}
          <div className={cell}>
            <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Teslimat Adresi</h2>
            {order.has_physical && order.ship_recipient ? (
              <div className="space-y-0.5 text-sm text-slate-600 dark:text-slate-300">
                <p className="font-medium text-slate-800 dark:text-slate-200">{order.ship_recipient}</p>
                {order.ship_phone && <p>{order.ship_phone}</p>}
                <p className="whitespace-pre-line">{order.ship_address}</p>
                {(order.ship_district || order.ship_city) && (
                  <p>{[order.ship_district, order.ship_city].filter(Boolean).join(" / ")}</p>
                )}
                {order.promised_delivery_date &&
                  order.status !== "DELIVERED" &&
                  order.status !== "CANCELLED" &&
                  order.status !== "REFUNDED" && (
                    <p className="pt-1 text-emerald-700 dark:text-emerald-400">
                      Söz verilen teslimat:{" "}
                      <span className="font-medium">
                        {promisedDateLabel(order.promised_delivery_date)}
                      </span>
                    </p>
                  )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Dijital teslimat — ürünler hesabından indirilir.
              </p>
            )}
            <ShipAddressUpdate order={order} />
          </div>

          {/* Ödeme */}
          <div className={cell}>
            <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Ödeme</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">iyzico ile ödeme</p>
            <p className="mt-1 text-sm">
              <span className="text-slate-500 dark:text-slate-400">Durum: </span>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {order.payment_status === "PAID"
                  ? "Ödendi"
                  : order.payment_status === "PENDING"
                    ? "Bekliyor"
                    : order.payment_status === "REFUNDED"
                      ? "İade edildi"
                      : order.payment_status}
              </span>
            </p>
          </div>

          {/* Sipariş Özeti */}
          <div className={cell}>
            <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Sipariş Özeti</h2>
            <dl className="space-y-1 text-sm">
              <SummaryRow label="Ürün Ara Toplamı" value={formatTL(order.subtotal)} />
              {order.has_physical && (
                <SummaryRow
                  label="Kargo"
                  value={Number(order.shipping_fee) === 0 ? "Ücretsiz" : formatTL(order.shipping_fee)}
                  accent={Number(order.shipping_fee) === 0 ? "emerald" : undefined}
                />
              )}
              {order.discount && Number(order.discount) > 0 && (
                <SummaryRow
                  label={`İndirim${order.coupon_code ? ` (${order.coupon_code})` : ""}`}
                  value={`−${formatTL(order.discount)}`}
                  accent="emerald"
                />
              )}
              <div className="flex justify-between border-t border-slate-100 pt-1.5 dark:border-slate-800">
                <dt className="font-semibold text-slate-700 dark:text-slate-200">Genel Toplam</dt>
                <dd className="font-semibold text-slate-900 dark:text-white">{formatTL(order.total)}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Kargo takibi — tam ekran takip sayfasına götüren belirgin giriş */}
        {canTrack && (
          <Link
            to={ROUTES.cargoTracking(order.track_token!)}
            className="mt-5 flex items-center gap-4 rounded-2xl border border-slate-200 p-5 transition-colors hover:border-indigo-300 dark:border-slate-800 dark:hover:border-indigo-500/40"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Kargo Takibi</p>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{trackSub}</p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-indigo-600 dark:text-indigo-400">
              Takip et →
            </span>
          </Link>
        )}

        {/* Ürünler */}
        <div className="mt-5 rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{badge.label}</h2>
            {order.tracking_no &&
              (order.tracking_no.startsWith("ELDEN-") ? (
                // Kendi filo teslimatı — canlı takip yukarıdaki haritada; dış kargo linki anlamsız.
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Kuryemizle teslim · {order.tracking_no}
                </span>
              ) : (
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent("kargo takip " + order.tracking_no)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Kargo takibi: {order.tracking_no}
                </a>
              ))}
          </div>
          <div className="space-y-5">
            {order.items.map((it) => (
              <OrderItemRow
                key={it.id}
                item={it}
                onReorder={() => {
                  add(orderItemToProduct(it, order.currency), it.kind === "PHYSICAL" ? it.quantity : 1);
                  toast.success("Sepete eklendi");
                }}
              />
            ))}
          </div>
        </div>

        {/* Aksiyonlar — sipariş durumuna göre gruplu */}
        <div className="mt-5 flex flex-col items-end gap-2">
          {/* İade penceresi bilgisi — iade talebi seçeneğinin yanında (teslim edildi) */}
          {order.status === "DELIVERED" && order.has_physical && order.return_deadline && (
            <p
              className={
                returnWindowClosed
                  ? "text-xs text-slate-400 dark:text-slate-500"
                  : "text-xs text-slate-500 dark:text-slate-400"
              }
            >
              {returnWindowClosed ? (
                <>İade süresi doldu — son iade tarihi {formatDate(order.return_deadline)} idi.</>
              ) : (
                <>
                  Son iade tarihi:{" "}
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {formatDate(order.return_deadline)}
                  </span>
                </>
              )}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
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
            {showInvoice && (
              <button
                type="button"
                onClick={() => setInvoiceOpen(true)}
                className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-200 dark:hover:text-indigo-400"
              >
                Fatura
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
              className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Tekrar sipariş et
            </button>
          </div>
        </div>
      </div>

      {returnOpen && <ReturnModal order={order} onClose={() => setReturnOpen(false)} />}
      {invoiceOpen && (
        <OrderInvoiceModal
          order={order}
          buyerFallbackName={user?.full_name}
          onClose={() => setInvoiceOpen(false)}
        />
      )}
    </StoreLayout>
  );
}

function SummaryRow({ label, value, accent }: { label: string; value: string; accent?: "emerald" }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={accent === "emerald" ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-slate-800 dark:text-slate-200"}>
        {value}
      </dd>
    </div>
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
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
