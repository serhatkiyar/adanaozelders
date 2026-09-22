// Sipariş faturası / belgesi — ekranda gösterilir, "Yazdır / PDF" ile yazdırılır
// (index.css `@media print` yalnız #order-invoice'i basar).
//
// ## İki kip, tek bileşen
//
// **Fatura kipi** (uç 200): satıcı kimliği, alıcı, oran bazında matrah/vergi
// kırılımı ve ödeme bilgisi SUNUCUDAN gelir. Vergi burada hesaplanmaz —
// sipariş anında saklanan kırılım okunur (bkz. services/invoice_service.py).
//
// **Özet kipi** (uç 404/409): fatura ucu üretimde kapalıysa ya da siparişin
// kırılımı eksikse (İP-5 öncesi sipariş, kargo oranı henüz tanımsız) belge
// **"Sipariş Özeti"** olarak başlıklanır ve vergi satırı GÖSTERİLMEZ.
// Bilmediğimiz bir kırılımı uydurmaktansa, göstermemek doğrudur.
//
// Eskiden bu bileşen belgenin tamamını kendisi üretiyordu: satıcı kimliği
// istemci sabitinden geliyordu (adres/telefon/vergi dairesi BOŞ) ve ödeme
// satırı "iyzico ile ödeme" diye SABİT YAZILIYDI — fake sağlayıcıyla ödenmiş
// siparişte bile. Yani belge gerçeği söylemiyordu.
import { OPERATOR } from "@/lib/legalContent";
import { formatDate } from "@/lib/datetime";
import { formatTL } from "@/lib/money";
import { orderPaymentLabel } from "@/lib/orderPayment";
import { useOrderInvoice } from "@/hooks/useStore";
import { STATUS_LABELS } from "@/pages/store/OrdersPage";
import type { OrderInvoiceOut, OrderOut } from "@/types";

/** Oran metnini ("0.2000") okunur yüzdeye çevirir — yalnız GÖSTERİM içindir. */
function oranEtiketi(rate: string): string {
  const sayi = Number(rate);
  if (!Number.isFinite(sayi)) return rate;
  return `%${Number((sayi * 100).toFixed(2))}`;
}

export function OrderInvoiceModal({
  order,
  buyerFallbackName,
  onClose,
}: {
  order: OrderOut;
  buyerFallbackName?: string | null;
  onClose: () => void;
}) {
  // Fatura yalnız ödenmiş siparişte anlamlıdır; ödenmemişte uç zaten 409
  // döner, gereksiz istek atmıyoruz.
  const fatura = useOrderInvoice(order.id, order.payment_status === "PAID");
  const belge = fatura.data ?? null;

  const statusLabel = STATUS_LABELS[order.status]?.label ?? order.status;
  const buyerName =
    belge?.buyer.name || order.ship_recipient || buyerFallbackName || "-";
  const cityLine = [
    belge?.buyer.district ?? order.ship_district,
    belge?.buyer.city ?? order.ship_city,
  ]
    .filter(Boolean)
    .join(" / ");
  const adres = belge?.buyer.address ?? order.ship_address;
  const telefon = belge?.buyer.phone ?? order.ship_phone;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm print:bg-transparent print:p-0 print:backdrop-blur-none"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-6 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl print:my-0 print:max-w-none print:rounded-none print:border-0 print:shadow-none"
      >
        <div id="order-invoice" className="p-8 text-slate-800 ">
          {/* Başlık */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 ">
            <div>
              <p className="text-lg font-bold text-slate-900 ">
                {belge?.seller.name ?? OPERATOR.name}
              </p>
              <p className="mt-1 text-xs text-slate-500 ">
                {belge ? belge.seller.name : OPERATOR.entity}
              </p>
              <p className="text-xs text-slate-500 ">
                {belge?.seller.address ?? OPERATOR.address}
              </p>
              {belge && (
                <p className="text-xs text-slate-500 ">
                  Vergi No: {belge.seller.tax_number} ({belge.seller.tax_office})
                </p>
              )}
              <p className="text-xs text-slate-500 ">
                {belge?.seller.email ?? OPERATOR.email}
              </p>
              {belge?.seller.phone && (
                <p className="text-xs text-slate-500 ">
                  {belge.seller.phone}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-900 ">
                {belge ? "Fatura Bilgileri" : "Sipariş Özeti"}
              </p>
              <p className="mt-1 text-xs text-slate-500 ">
                Sipariş No: <span className="font-medium text-slate-700 ">{order.order_no}</span>
              </p>
              <p className="text-xs text-slate-500 ">
                Tarih: <span className="font-medium text-slate-700 ">{formatDate(order.created_at)}</span>
              </p>
              <p className="text-xs text-slate-500 ">
                Durum: <span className="font-medium text-slate-700 ">{statusLabel}</span>
              </p>
            </div>
          </div>

          {/* Alıcı + ödeme */}
          <div className="grid grid-cols-1 gap-4 py-5 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                Alıcı
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900 ">{buyerName}</p>
              {telefon && (
                <p className="text-sm text-slate-600 ">{telefon}</p>
              )}
              {adres && (
                <p className="whitespace-pre-line text-sm text-slate-600 ">
                  {adres}
                </p>
              )}
              {cityLine && <p className="text-sm text-slate-600 ">{cityLine}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                Ödeme
              </p>
              {/* Sağlayıcı adı SUNUCUDAN gelir; bilinmiyorsa yazılmaz. */}
              {belge?.payment.provider && (
                <p className="mt-1 text-sm text-slate-600 ">
                  {belge.payment.provider}
                </p>
              )}
              <p className="text-sm text-slate-600 ">
                {orderPaymentLabel(order.payment_status)}
              </p>
              {belge?.payment.paid_at && (
                <p className="text-sm text-slate-600 ">
                  {formatDate(belge.payment.paid_at)}
                </p>
              )}
            </div>
          </div>

          {/* Ürünler */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 ">
                  <th className="py-2 font-semibold">Ürün</th>
                  <th className="py-2 text-center font-semibold">Adet</th>
                  {belge && <th className="py-2 text-center font-semibold">KDV</th>}
                  <th className="py-2 text-right font-semibold">Birim</th>
                  <th className="py-2 text-right font-semibold">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((it) => {
                  const faturaSatiri = belge?.items.find(
                    (s) => s.order_item_id === it.id
                  );
                  return (
                    <tr key={it.id} className="border-b border-slate-200 ">
                      <td className="py-2 pr-2 align-top text-slate-800 ">{it.title}</td>
                      <td className="py-2 text-center align-top text-slate-600 ">
                        {it.quantity}
                      </td>
                      {belge && (
                        <td className="py-2 text-center align-top text-slate-600 ">
                          {faturaSatiri ? oranEtiketi(faturaSatiri.tax_rate) : "-"}
                        </td>
                      )}
                      <td className="py-2 text-right align-top text-slate-600 ">
                        {formatTL(it.unit_price)}
                      </td>
                      <td className="py-2 text-right align-top text-slate-800 ">
                        {formatTL(Number(it.unit_price) * it.quantity)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

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
            {/* Vergi kırılımı YALNIZ fatura kipinde: bilinmeyen bir kırılımı
                uydurmak yerine hiç göstermiyoruz. */}
            {belge && <TaxLines belge={belge} />}
            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold ">
              <span className="text-slate-700 ">Genel Toplam</span>
              <span className="text-slate-900 ">{formatTL(order.total)}</span>
            </div>
            {belge && Number(belge.refund.refunded_amount) > 0 && (
              <div className="flex justify-between border-t border-slate-200 pt-1.5 text-slate-500 ">
                <span>
                  İade edilen (KDV {formatTL(belge.refund.tax_total)} dahil)
                </span>
                <span>−{formatTL(belge.refund.refunded_amount)}</span>
              </div>
            )}
          </div>

          <p className="mt-6 border-t border-slate-200 pt-4 text-[11px] leading-relaxed text-slate-400 ">
            {belge
              ? belge.notice
              : "Bu belge sipariş bilgilerinizi özetler; resmî fatura değildir. Vergi kırılımı bu sipariş için kayıtlı olmadığından gösterilmemiştir."}
          </p>
        </div>

        {/* Aksiyonlar (yazdırmada gizli) */}
        <div className="flex justify-end gap-3 border-t border-slate-200 p-4 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 "
          >
            Kapat
          </button>
          <button
            type="button"
            disabled={fatura.isLoading}
            onClick={() => window.print()}
            className="rounded-full bg-marka px-5 py-2 text-sm font-semibold text-marka-fg transition-colors hover:bg-marka-hover disabled:opacity-50"
          >
            Yazdır / PDF olarak kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

function TaxLines({ belge }: { belge: OrderInvoiceOut }) {
  return (
    <>
      <div className="flex justify-between border-t border-slate-200 pt-1.5 ">
        <span className="text-slate-500 ">Matrah</span>
        <span className="text-slate-800 ">
          {formatTL(belge.totals.net_total)}
        </span>
      </div>
      {belge.tax_lines.map((satir) => (
        <Row
          key={satir.rate}
          label={`KDV ${oranEtiketi(satir.rate)} (matrah ${formatTL(satir.base)})`}
          value={formatTL(satir.tax)}
        />
      ))}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500 ">{label}</span>
      <span className="text-slate-800 ">{value}</span>
    </div>
  );
}
