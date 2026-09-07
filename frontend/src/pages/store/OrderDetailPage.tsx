import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { DeliveryFeedbackSection } from "@/components/store/DeliveryFeedbackSection";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { FullScreenSpinner } from "@/components/Spinner";
import { formatTL, parseMoney } from "@/lib/money";
import { formatDate } from "@/lib/datetime";
import { promisedDateLabel } from "@/lib/deliveryPromise";
import { formatEventTime, proofLabel } from "@/lib/deliveryTimeline";
import { useOrderTracking } from "@/hooks/useDelivery";
import { ShipAddressUpdate } from "@/components/store/ShipAddressUpdate";
import { DeliveryPrefControls } from "@/components/store/DeliveryPrefControls";
import { OrderInvoiceModal } from "@/components/store/OrderInvoiceModal";
import { useOrder, useCancelOrder, useRequestReturn } from "@/hooks/useStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCartStore } from "@/store/cartStore";
import { STATUS_LABELS, OrderItemRow, orderItemToProduct } from "@/pages/store/OrdersPage";
import { toast } from "@/store/toastStore";
import type { OrderOut,
  ReturnType,
} from "@/types";

const RETURN_BADGE: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "İade talebi inceleniyor", cls: "bg-amber-100 text-amber-700 " },
  APPROVED: { label: "İade onaylandı", cls: "bg-emerald-100 text-emerald-700 " },
  REJECTED: { label: "İade talebi reddedildi", cls: "bg-rose-100 text-rose-700 " },
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
  // Teslim kanıtı (foto/OTP/yönetici) yalnız oturumlu sahibe döner — public
  // token projeksiyonunda foto yoktur (PII), bu yüzden kanıt burada gösterilir.
  // Açık siparişte de çekilir: teslimat tercihi + erteleme buradan beslenir
  // (backend uçları oturumlu sahibe tüm tercihleri açar).
  const { data: tracking } = useOrderTracking(
    orderId ?? null,
    !!order?.has_physical &&
      order?.payment_status === "PAID" &&
      (order?.status === "PAID" || order?.status === "SHIPPED" || order?.status === "DELIVERED")
  );

  if (isLoading) return <FullScreenSpinner />;
  if (isError || !order) {
    return (
      <StoreLayout title="Sipariş" showCategoryBar={false}>
        <div className="mx-auto max-w-3xl px-4 py-20 text-center md:px-0">
          <p className="text-slate-600 ">Sipariş bulunamadı.</p>
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
      ? "Teslim edildi, teslimat özetini görüntüle"
      : order.status === "SHIPPED"
        ? "Kuryemiz yolda, canlı konumu ve tahmini varışı izle"
        : "Siparişin hazırlanıyor, kuryeye verildiğinde canlı izle";

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
    <StoreLayout title={`Sipariş ${order.order_no}`} showCategoryBar={false}>
      <Seo title={`Sipariş ${order.order_no}, Mağaza`} noindex />
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        {/* Breadcrumb */}
        <nav className="mb-3 flex items-center gap-1.5 text-sm text-slate-500 ">
          <Link to={ROUTES.orders} className="hover:text-marka-metin ">
            Siparişlerim
          </Link>
          <span className="text-slate-300 ">/</span>
          <span className="text-slate-700 ">Sipariş Bilgileri</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 ">Sipariş Bilgileri</h1>
            <p className="mt-1 text-sm text-slate-500 ">
              Sipariş Tarihi {formatDate(order.created_at)} · Sipariş No {order.order_no}
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
        <div className="mt-5 flex flex-col divide-y divide-slate-200 rounded-2xl border border-slate-200 sm:flex-row sm:divide-x sm:divide-y-0">
          {/* Teslimat */}
          <div className={cell}>
            <h2 className="mb-2 text-sm font-semibold text-slate-900 ">Teslimat Adresi</h2>
            {order.has_physical && order.ship_recipient ? (
              <div className="space-y-0.5 text-sm text-slate-600 ">
                <p className="font-medium text-slate-800 ">{order.ship_recipient}</p>
                {order.ship_phone && <p>{order.ship_phone}</p>}
                <p className="whitespace-pre-line">{order.ship_address}</p>
                {(order.ship_district || order.ship_city) && (
                  <p>{[order.ship_district, order.ship_city].filter(Boolean).join(" / ")}</p>
                )}
                {order.promised_delivery_date &&
                  order.status !== "DELIVERED" &&
                  order.status !== "CANCELLED" &&
                  order.status !== "REFUNDED" && (
                    <p className="pt-1 text-emerald-700 ">
                      Söz verilen teslimat:{" "}
                      <span className="font-medium">
                        {promisedDateLabel(order.promised_delivery_date)}
                      </span>
                    </p>
                  )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 ">
                Dijital teslimat, ürünler hesabından indirilir.
              </p>
            )}
            <ShipAddressUpdate order={order} />
          </div>

          {/* Ödeme */}
          <div className={cell}>
            <h2 className="mb-2 text-sm font-semibold text-slate-900 ">Ödeme</h2>
            <p className="text-sm text-slate-600 ">iyzico ile ödeme</p>
            <p className="mt-1 text-sm">
              <span className="text-slate-500 ">Durum: </span>
              <span className="font-medium text-slate-800 ">
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
            <h2 className="mb-2 text-sm font-semibold text-slate-900 ">Sipariş Özeti</h2>
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
              <div className="flex justify-between border-t border-slate-100 pt-1.5 ">
                <dt className="font-semibold text-slate-700 ">Genel Toplam</dt>
                <dd className="font-semibold text-slate-900 ">{formatTL(order.total)}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Kargo takibi — tam ekran takip sayfasına götüren belirgin giriş */}
        {canTrack && (
          <Link
            to={ROUTES.cargoTracking(order.track_token!)}
            className="mt-5 flex items-center gap-4 rounded-2xl border border-slate-200 p-5 transition-colors hover:border-marka-mid "
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-marka-soft text-marka-soft-fg ">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 ">Kargo Takibi</p>
              <p className="mt-0.5 text-sm text-slate-500 ">{trackSub}</p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-marka-metin ">
              Takip et →
            </span>
          </Link>
        )}

        {/* Teslimat tercihi + erteleme — oturumlu sahibin tam yetkili yüzeyi
            (SMS'teki token sayfasında kapıya/komşuya kilitlidir, burada serbest). */}
        {canTrack && order.status !== "DELIVERED" && tracking && orderId != null && (
          <div className="mt-5 rounded-2xl border border-slate-200 ">
            <DeliveryPrefControls t={tracking} mode={{ kind: "order", orderId }} />
          </div>
        )}

        {/* Teslim kanıtı — foto + yöntem + saat (yalnız sahibin oturumlu görünümünde) */}
        {order.status === "DELIVERED" && tracking?.delivered_at && (
          <div className="mt-5 flex items-center gap-4 rounded-2xl border border-slate-200 p-5 ">
            {tracking.proof_photo_url ? (
              <a
                href={tracking.proof_photo_url}
                target="_blank"
                rel="noreferrer"
                title="Teslim fotoğrafını büyüt"
                className="block h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-slate-200 "
              >
                <img
                  src={tracking.proof_photo_url}
                  alt="Teslim kanıtı fotoğrafı"
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </a>
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 ">Teslim Kanıtı</p>
              <p className="mt-0.5 text-sm text-slate-500 ">
                {proofLabel(tracking.proof) ?? "Teslim edildi"}
                {" · "}
                {formatEventTime(tracking.delivered_at)}
              </p>
            </div>
          </div>
        )}

        {order.status === "DELIVERED" && order.has_physical && tracking && (
          <div className="mt-5">
            <DeliveryFeedbackSection
              mode="order"
              orderId={order.id}
              canFeedback={tracking.can_feedback}
              feedbackGiven={tracking.feedback_given}
            />
          </div>
        )}

        {/* Ürünler */}
        <div className="mt-5 rounded-2xl border border-slate-200 p-5 ">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 ">{badge.label}</h2>
            {order.tracking_no &&
              (order.tracking_no.startsWith("ELDEN-") ? (
                // Kendi filo teslimatı — canlı takip yukarıdaki haritada; dış kargo linki anlamsız.
                <span className="text-xs font-medium text-slate-500 ">
                  Kuryemizle teslim · {order.tracking_no}
                </span>
              ) : (
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent("kargo takip " + order.tracking_no)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-marka-metin hover:underline "
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
                  ? "text-xs text-slate-400 "
                  : "text-xs text-slate-500 "
              }
            >
              {returnWindowClosed ? (
                <>İade süresi doldu, son iade tarihi {formatDate(order.return_deadline)} idi.</>
              ) : (
                <>
                  Son iade tarihi:{" "}
                  <span className="font-medium text-slate-700 ">
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
                className="rounded-full border border-rose-200 px-5 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 "
              >
                Siparişi iptal et
              </button>
            )}
            {showInvoice && (
              <button
                type="button"
                onClick={() => setInvoiceOpen(true)}
                className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-marka-mid hover:text-marka-metin "
              >
                Fatura
              </button>
            )}
            {canRequestReturn && (
              <button
                type="button"
                onClick={() => setReturnOpen(true)}
                className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-rose-300 hover:text-rose-600 "
              >
                İade talebi oluştur
              </button>
            )}
            <button
              type="button"
              onClick={reorder}
              className="rounded-full bg-marka px-5 py-2 text-sm font-semibold text-marka-fg transition-colors hover:bg-marka-hover"
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
      <dt className="text-slate-500 ">{label}</dt>
      <dd className={accent === "emerald" ? "font-medium text-emerald-600 " : "text-slate-800 "}>
        {value}
      </dd>
    </div>
  );
}

function ReturnModal({ order, onClose }: { order: OrderOut; onClose: () => void }) {
  const [type, setType] = useState<ReturnType>("CAYMA");
  const [reason, setReason] = useState("");
  // Kalem başına iade adedi: order_item_id -> adet (0 = iade edilmiyor).
  const [quantities, setQuantities] = useState<Record<number, number>>(() =>
    Object.fromEntries(order.items.map((it) => [it.id, it.quantity]))
  );
  const request = useRequestReturn(order.id);

  // Cayma hakkı KOŞULSUZDUR (Mesafeli Sözleşmeler Yönetmeliği m.9): gerekçe
  // istenmez ve talep otomatik onaylanır. Diğer türlerde gerekçe zorunludur.
  const reasonRequired = type !== "CAYMA";
  const selected = order.items.filter((it) => (quantities[it.id] ?? 0) > 0);
  const isFull = order.items.every(
    (it) => (quantities[it.id] ?? 0) >= it.quantity
  );

  // Tahmini iade tutarı — kesin tutarı SUNUCU hesaplar (kupon payı, kargo
  // kuralı). Burada yalnız kalem toplamı gösteriliyor.
  const estimate = selected.reduce(
    (sum, it) => sum + (parseMoney(it.unit_price) ?? 0) * (quantities[it.id] ?? 0),
    0
  );

  function setQty(itemId: number, qty: number) {
    setQuantities((q) => ({ ...q, [itemId]: qty }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length === 0) {
      toast.error("En az bir ürün seç.");
      return;
    }
    if (reasonRequired && reason.trim().length < 3) {
      toast.error("Bu iade türü için gerekçe yazman gerekiyor.");
      return;
    }
    request.mutate(
      {
        type,
        reason: reason.trim(),
        items: selected.map((it) => ({
          order_item_id: it.id,
          quantity: quantities[it.id] ?? 0,
        })),
      },
      {
        onSuccess: (ret) => {
          toast.success(
            ret.status === "APPROVED"
              ? "İade talebin onaylandı; ödemen iade ediliyor."
              : "İade talebin alındı; en kısa sürede değerlendirilecek."
          );
          onClose();
        },
        onError: (err: unknown) => {
          const detail =
            (err as { response?: { data?: { detail?: string } } })?.response?.data
              ?.detail ?? "İade talebi oluşturulamadı";
          toast.error(detail);
        },
      }
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl "
      >
        <h2 className="text-lg font-semibold text-slate-900 ">
          İade talebi, Sipariş {order.order_no}
        </h2>

        {/* Tür */}
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-700 ">
            İade nedeni
          </legend>
          <div className="mt-2 space-y-2">
            {(
              [
                {
                  value: "CAYMA" as const,
                  label: "Cayma hakkı (14 gün)",
                  hint: "Gerekçe belirtmene gerek yok; talebin anında onaylanır.",
                },
                {
                  value: "AYIPLI" as const,
                  label: "Ürün kusurlu / hasarlı",
                  hint: "İncelenmek üzere ekibimize iletilir.",
                },
                {
                  value: "DIGER" as const,
                  label: "Diğer (yanlış ürün, eksik gönderim…)",
                  hint: "İncelenmek üzere ekibimize iletilir.",
                },
              ]
            ).map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-3 text-sm transition-colors hover:border-slate-300 "
              >
                <input
                  type="radio"
                  name="return-type"
                  value={opt.value}
                  checked={type === opt.value}
                  onChange={() => setType(opt.value)}
                  className="mt-0.5 accent-marka"
                />
                <span>
                  <span className="font-medium text-slate-800 ">
                    {opt.label}
                  </span>
                  <span className="block text-xs text-slate-500 ">
                    {opt.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Kalemler */}
        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-slate-700 ">
            İade edilecek ürünler
          </legend>
          <div className="mt-2 space-y-2">
            {order.items.map((it) => (
              <div
                key={it.id}
                className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0 "
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800 ">
                    {it.title}
                  </p>
                  <p className="text-xs text-slate-500 ">
                    {formatTL(it.unit_price)} · {it.quantity} adet
                  </p>
                </div>
                <select
                  value={quantities[it.id] ?? 0}
                  onChange={(e) => setQty(it.id, Number(e.target.value))}
                  className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-sm "
                  aria-label={`${it.title} için iade adedi`}
                >
                  {Array.from({ length: it.quantity + 1 }, (_, n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "İade etme" : `${n} adet`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </fieldset>

        {/* Gerekçe */}
        <label className="mt-5 block">
          <span className="text-sm font-medium text-slate-700 ">
            Açıklama {reasonRequired ? <span className="text-red-500">*</span> : "(isteğe bağlı)"}
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={
              reasonRequired
                ? "Ürün hasarlı geldi / yanlış ürün gönderildi…"
                : "İstersen kısa bir not bırakabilirsin."
            }
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-marka-mid focus:ring-2 focus:ring-marka/20 "
          />
        </label>

        <p className="mt-3 text-xs text-slate-500 ">
          Tahmini iade: <strong>{formatTL(estimate)}</strong>
          {isFull
            ? " · Tüm sipariş iade edildiği için kargo ücreti de geri ödenir."
            : " · Kısmi iadede kargo ücreti geri ödenmez."}{" "}
          Kesin tutar kupon indirimin dikkate alınarak hesaplanır.
        </p>

        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 "
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={request.isPending || selected.length === 0}
            className="rounded-full bg-marka px-5 py-2 text-sm font-semibold text-marka-fg transition-colors hover:bg-marka-hover disabled:opacity-50"
          >
            {request.isPending ? "Gönderiliyor…" : "Talebi gönder"}
          </button>
        </div>
      </form>
    </div>
  );
}
