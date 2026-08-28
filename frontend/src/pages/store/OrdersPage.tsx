import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ROUTES } from "@/lib/routes";
import { Seo } from "@/components/Seo";
import { StoreLayout } from "@/pages/store/StoreLayout";
import { FullScreenSpinner } from "@/components/Spinner";
import { formatTL } from "@/lib/money";
import { formatDate } from "@/lib/datetime";
import { useMyOrders, usePayOrder } from "@/hooks/useStore";
import { useCartStore } from "@/store/cartStore";
import { toast } from "@/store/toastStore";
import type { OrderItemOut, OrderOut, ProductSearchOut } from "@/types";

export const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Ödeme bekliyor", cls: "bg-amber-100 text-amber-700 " },
  PAID: { label: "Hazırlanıyor", cls: "bg-emerald-100 text-emerald-700 " },
  SHIPPED: { label: "Kargoda", cls: "bg-blue-100 text-blue-700 " },
  DELIVERED: { label: "Teslim edildi", cls: "bg-emerald-100 text-emerald-700 " },
  CANCELLED: { label: "İptal edildi", cls: "bg-slate-100 text-slate-500 " },
  REFUNDED: { label: "İade edildi", cls: "bg-slate-100 text-slate-500 " },
};

const TABS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "all", label: "Siparişler", match: () => true },
  { key: "cancelled", label: "İptal/İade", match: (s) => ["CANCELLED", "REFUNDED"].includes(s) },
];

/** Sipariş kaleminden sepete eklemek için minimal ürün (slug=id; route id'yi kabul eder). */
export function orderItemToProduct(it: OrderItemOut, currency: string): ProductSearchOut {
  return {
    id: it.product_id!,
    slug: String(it.product_id),
    title: it.title,
    kind: it.kind,
    seller_type: it.seller_type,
    price: it.unit_price,
    currency,
    cover_url: it.cover_url,
    in_stock: true,
    rating_count: 0,
  };
}

export default function OrdersPage() {
  const { data: orders, isLoading } = useMyOrders();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [year, setYear] = useState("all");

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

  const years = useMemo(() => {
    const set = new Set((orders ?? []).map((o) => new Date(o.created_at).getFullYear()));
    return Array.from(set).sort((a, b) => b - a);
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    const tabDef = TABS.find((t) => t.key === tab) ?? TABS[0];
    return (orders ?? []).filter((o) => {
      if (!tabDef.match(o.status)) return false;
      if (year !== "all" && new Date(o.created_at).getFullYear() !== Number(year)) return false;
      if (q) {
        const hit =
          String(o.id).includes(q) ||
          o.items.some((it) => it.title.toLocaleLowerCase("tr").includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [orders, search, tab, year]);

  if (isLoading) return <FullScreenSpinner />;

  return (
    <StoreLayout title="Siparişlerim" showCategoryBar={false}>
      <Seo title="Siparişlerim — Mağaza" noindex />
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold text-slate-900 ">Siparişlerim</h1>
          <div className="relative w-full sm:w-80">
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Siparişlerimde ara"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 "
            />
          </div>
        </div>

        {!orders || orders.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-slate-200 py-16 text-center ">
            <p className="text-slate-500 ">Henüz siparişin yok.</p>
            <Link
              to={ROUTES.store}
              className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Alışverişe başla
            </Link>
          </div>
        ) : (
          <>
            {/* Filtre satırı */}
            <div className="mt-5 flex flex-col gap-2 border-b border-slate-200 pb-3 ">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                {years.length > 1 && (
                  <select
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none "
                  >
                    <option value="all">Tüm yıllar</option>
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                )}
                <div className="flex flex-wrap gap-1">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        tab === t.key
                          ? "bg-indigo-600 text-white"
                          : "text-slate-500 hover:bg-slate-100 "
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <span className="text-sm font-medium text-slate-700 ">
                {filtered.length} sipariş
              </span>
            </div>

            {filtered.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-500 ">
                Bu filtreye uygun sipariş yok.
              </p>
            ) : (
              <div className="mt-5 space-y-5">
                {filtered.map((o) => (
                  <OrderCard key={o.id} order={o} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </StoreLayout>
  );
}

function OrderCard({ order }: { order: OrderOut }) {
  const pay = usePayOrder();
  const add = useCartStore((s) => s.add);
  const badge = STATUS_LABELS[order.status] ?? { label: order.status, cls: "bg-slate-100 text-slate-500" };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 ">
      {/* Başlık bandı — gövdeden ayrışsın diye belirgin */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-100 px-5 py-3 ">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <Meta label="Sipariş Tarihi" value={formatDate(order.created_at)} />
          <Meta label="Toplam" value={formatTL(order.total)} />
          <Meta
            label={order.has_physical ? "Teslimat" : "Teslim"}
            value={order.ship_recipient ?? "Dijital teslimat"}
          />
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-xs">
            <p className="text-slate-400 ">SİPARİŞ NO #{order.id}</p>
            <div className="flex items-center justify-end gap-3">
              {/* Takip kısayolu — dağıtımdaki sipariş için listeden tek tık
                  (önceden takip yalnız detay sayfasının içindeydi). */}
              {order.track_token &&
                order.has_physical &&
                order.payment_status === "PAID" &&
                (order.status === "PAID" || order.status === "SHIPPED") && (
                  <Link
                    to={ROUTES.cargoTracking(order.track_token)}
                    className="font-semibold text-indigo-600 hover:underline "
                  >
                    Kargo takibi
                  </Link>
                )}
              <Link
                to={ROUTES.orderDetail(order.id)}
                className="font-medium text-indigo-600 hover:underline "
              >
                Sipariş ayrıntıları
              </Link>
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>
            {badge.label}
          </span>
        </div>
      </div>

      {/* Gövde */}
      <div className="p-5">
        <div className="space-y-4">
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
            className="mt-4 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50 sm:w-auto sm:px-8"
          >
            Ödemeyi tamamla
          </button>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <p className="uppercase tracking-wide text-slate-400 ">{label}</p>
      <p className="mt-0.5 max-w-[12rem] truncate font-medium text-slate-700 ">{value}</p>
    </div>
  );
}

/** Görselli sipariş kalemi satırı (iki sayfada ortak). */
export function OrderItemRow({
  item,
  onReorder,
}: {
  item: OrderItemOut;
  onReorder?: () => void;
}) {
  const productLink = item.product_id ? ROUTES.storeProduct(item.product_id) : null;
  return (
    <div className="flex gap-4">
      <div className="h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-100 bg-white ">
        {productLink ? (
          <Link to={productLink} className="block h-full w-full">
            <ItemImg item={item} />
          </Link>
        ) : (
          <ItemImg item={item} />
        )}
      </div>

      <div className="flex flex-1 flex-col">
        {productLink ? (
          <Link to={productLink} className="line-clamp-2 text-sm font-medium text-slate-800 transition-colors hover:text-indigo-600 ">
            {item.title}
          </Link>
        ) : (
          <span className="line-clamp-2 text-sm font-medium text-slate-800 ">{item.title}</span>
        )}
        <span className="mt-0.5 text-xs text-slate-400">
          {item.kind === "DIGITAL" ? "Dijital ürün" : `Adet: ${item.quantity}`}
        </span>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          {item.download_url && (
            <a
              href={item.download_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 "
            >
              İndir
            </a>
          )}
          {onReorder && item.product_id && (
            <button
              type="button"
              onClick={onReorder}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-600 "
            >
              Tekrar al
            </button>
          )}
          {productLink && (
            <Link
              to={productLink}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-600 "
            >
              Ürünü gör
            </Link>
          )}
        </div>
      </div>

      <div className="shrink-0 text-right text-sm font-semibold text-slate-900 ">
        {formatTL(Number(item.unit_price) * item.quantity)}
      </div>
    </div>
  );
}

function ItemImg({ item }: { item: OrderItemOut }) {
  if (item.cover_url) {
    return (
      <img
        src={item.cover_url}
        alt={item.title}
        className="h-full w-full object-contain p-1.5 mix-blend-multiply"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-slate-200 ">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 5h11a2 2 0 0 1 2 2v12l-3-2-3 2-3-2-3 2V7a2 2 0 0 1 2-2Z" />
      </svg>
    </div>
  );
}
