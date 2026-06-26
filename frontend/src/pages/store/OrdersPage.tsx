import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { FullScreenSpinner } from "@/components/Spinner";
import { formatTRY } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { useMyOrders, usePayOrder } from "@/hooks/useStore";
import { toast } from "@/store/toastStore";
import type { OrderOut } from "@/types";

export const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Ödeme bekliyor", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" },
  PAID: { label: "Ödendi", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" },
  SHIPPED: { label: "Kargoda", cls: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400" },
  DELIVERED: { label: "Teslim edildi", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" },
  CANCELLED: { label: "İptal", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
  REFUNDED: { label: "İade edildi", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
};

export default function OrdersPage() {
  const { data: orders, isLoading } = useMyOrders();
  const [params, setParams] = useSearchParams();

  // iyzico callback dönüşü (?odeme=basarili|basarisiz) → tek seferlik toast.
  useEffect(() => {
    const odeme = params.get("odeme");
    if (odeme === "basarili") toast.success("Ödemen alındı, siparişin onaylandı.");
    else if (odeme === "basarisiz") toast.error("Ödeme tamamlanamadı.");
    if (odeme) {
      params.delete("odeme");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  if (isLoading) return <FullScreenSpinner />;

  return (
    <StoreLayout title="Siparişlerim">
      <Seo title="Siparişlerim — Mağaza" noindex />
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Siparişlerim</h1>

        {!orders || orders.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-slate-100 py-16 text-center dark:border-slate-800">
            <p className="text-slate-500 dark:text-slate-400">Henüz siparişin yok.</p>
            <Link
              to={ROUTES.store}
              className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
            >
              Alışverişe başla
            </Link>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {orders.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        )}
      </div>
    </StoreLayout>
  );
}

function OrderCard({ order }: { order: OrderOut }) {
  const pay = usePayOrder();
  const badge = STATUS_LABELS[order.status] ?? {
    label: order.status,
    cls: "bg-slate-100 text-slate-500",
  };

  return (
    <div className="rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to={ROUTES.orderDetail(order.id)}
            className="text-sm font-semibold text-slate-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
          >
            Sipariş #{order.id}
          </Link>
          <span className="ml-2 text-xs text-slate-400">
            {formatDateTime(order.created_at)}
          </span>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        {order.items.map((it) => (
          <div key={it.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-700 dark:text-slate-300">
              {it.title} × {it.quantity}
            </span>
            <div className="flex items-center gap-3">
              {it.download_url && (
                <a
                  href={it.download_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-slate-900 underline dark:text-white"
                >
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

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
        <span className="text-sm text-slate-500">Toplam</span>
        <span className="text-base font-semibold text-slate-900 dark:text-white">
          {formatTRY(order.total)}
        </span>
      </div>

      {order.tracking_no && (
        <p className="mt-2 text-xs text-slate-500">
          Kargo takip: <span className="font-medium">{order.tracking_no}</span>
        </p>
      )}

      <Link
        to={ROUTES.orderDetail(order.id)}
        className="mt-3 inline-block text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
      >
        Detayı gör →
      </Link>

      {order.payment_status === "PENDING" && order.status !== "CANCELLED" && (
        <button
          type="button"
          disabled={pay.isPending}
          onClick={() =>
            pay.mutate(order.id, {
              onSuccess: (updated) => {
                if (updated.redirect_url) {
                  window.location.href = updated.redirect_url;
                  return;
                }
                toast.success("Ödeme tamamlandı");
              },
              onError: () => toast.error("Ödeme başlatılamadı"),
            })
          }
          className="mt-3 w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          Ödemeyi tamamla
        </button>
      )}
    </div>
  );
}
