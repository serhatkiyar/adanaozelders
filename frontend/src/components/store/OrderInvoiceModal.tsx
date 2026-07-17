// Sipariş faturası/belgesi — ekranda gösterilir, "Yazdır / PDF" ile yazdırılır
// (index.css `@media print` yalnız #order-invoice'i basar). Gerçek e-Fatura/
// e-Arşiv şahıs şirketi kurulunca entegre edilecek (bkz. legalContent OPERATOR
// TODO); şimdilik sipariş verisinden üretilen bilgilendirme belgesidir.
import { OPERATOR } from "@/lib/legalContent";
import { formatDate } from "@/lib/datetime";
import { formatTL } from "@/lib/money";
import { STATUS_LABELS } from "@/pages/store/OrdersPage";
import type { OrderOut } from "@/types";

export function OrderInvoiceModal({
  order,
  buyerFallbackName,
  onClose,
}: {
  order: OrderOut;
  buyerFallbackName?: string | null;
  onClose: () => void;
}) {
  const statusLabel = STATUS_LABELS[order.status]?.label ?? order.status;
  const buyerName = order.ship_recipient || buyerFallbackName || "—";
  const cityLine = [order.ship_district, order.ship_city].filter(Boolean).join(" / ");

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm print:bg-transparent print:p-0 print:backdrop-blur-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-6 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 print:my-0 print:max-w-none print:rounded-none print:border-0 print:shadow-none"
      >
        <div id="order-invoice" className="p-8 text-slate-800 dark:text-slate-100">
          {/* Başlık */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-700">
            <div>
              <p className="text-lg font-bold text-slate-900 dark:text-white">{OPERATOR.name}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{OPERATOR.entity}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{OPERATOR.address}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{OPERATOR.email}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-900 dark:text-white">
                Fatura / Sipariş Belgesi
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Sipariş No: <span className="font-medium text-slate-700 dark:text-slate-200">#{order.id}</span>
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tarih: <span className="font-medium text-slate-700 dark:text-slate-200">{formatDate(order.created_at)}</span>
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Durum: <span className="font-medium text-slate-700 dark:text-slate-200">{statusLabel}</span>
              </p>
            </div>
          </div>

          {/* Alıcı */}
          <div className="grid grid-cols-1 gap-4 py-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Alıcı
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{buyerName}</p>
              {order.ship_phone && (
                <p className="text-sm text-slate-600 dark:text-slate-300">{order.ship_phone}</p>
              )}
              {order.ship_address && (
                <p className="whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">
                  {order.ship_address}
                </p>
              )}
              {cityLine && <p className="text-sm text-slate-600 dark:text-slate-300">{cityLine}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Ödeme
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">iyzico ile ödeme</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {order.payment_status === "PAID"
                  ? "Ödendi"
                  : order.payment_status === "REFUNDED"
                    ? "İade edildi"
                    : order.payment_status === "PENDING"
                      ? "Bekliyor"
                      : order.payment_status}
              </p>
            </div>
          </div>

          {/* Ürünler */}
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
                <th className="py-2 font-semibold">Ürün</th>
                <th className="py-2 text-center font-semibold">Adet</th>
                <th className="py-2 text-right font-semibold">Birim</th>
                <th className="py-2 text-right font-semibold">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-2 align-top text-slate-800 dark:text-slate-200">{it.title}</td>
                  <td className="py-2 text-center align-top text-slate-600 dark:text-slate-300">
                    {it.quantity}
                  </td>
                  <td className="py-2 text-right align-top text-slate-600 dark:text-slate-300">
                    {formatTL(it.unit_price)}
                  </td>
                  <td className="py-2 text-right align-top text-slate-800 dark:text-slate-200">
                    {formatTL(Number(it.unit_price) * it.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Toplamlar */}
          <div className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
            <Row label="Ara Toplam" value={formatTL(order.subtotal)} />
            {order.has_physical && (
              <Row
                label="Kargo"
                value={Number(order.shipping_fee) === 0 ? "Ücretsiz" : formatTL(order.shipping_fee)}
              />
            )}
            {order.discount && Number(order.discount) > 0 && (
              <Row
                label={`İndirim${order.coupon_code ? ` (${order.coupon_code})` : ""}`}
                value={`−${formatTL(order.discount)}`}
              />
            )}
            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold dark:border-slate-700">
              <span className="text-slate-700 dark:text-slate-200">Genel Toplam</span>
              <span className="text-slate-900 dark:text-white">{formatTL(order.total)}</span>
            </div>
          </div>

          <p className="mt-6 border-t border-slate-100 pt-4 text-[11px] leading-relaxed text-slate-400 dark:border-slate-800 dark:text-slate-500">
            Bu belge sipariş bilgilerinizi özetler. Resmi e-Fatura/e-Arşiv belgesi,
            işletmenin kuruluşu tamamlandığında ayrıca düzenlenecektir.
          </p>
        </div>

        {/* Aksiyonlar (yazdırmada gizli) */}
        <div className="flex justify-end gap-3 border-t border-slate-200 p-4 dark:border-slate-700 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-white"
          >
            Kapat
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            Yazdır / PDF olarak kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-slate-800 dark:text-slate-200">{value}</span>
    </div>
  );
}
