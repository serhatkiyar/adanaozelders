import { Badge, EmptyState, ErrorState } from "@/components/admin/ui";
import {
  formatDelta,
  movementTypeLabel,
  reasonLabel,
  type StockMovementType,
} from "@/lib/stockMovements";

import type { StockMovementOut } from "@/api/stock";

/**
 * Defter satırları tablosu — ürün detayı ve genel envanter ekranının ortak
 * gövdesi.
 *
 * Tasarım: kart yerine saç-teli çizgili satır ritmi; renk YALNIZ işaret için
 * (artış/azalış), gerisi nötr. Delta hizalansın diye tabular-nums.
 */

const REF_LABELS: Record<string, string> = {
  order: "Sipariş",
  order_item: "Sipariş kalemi",
  order_return: "İade",
  product: "Ürün",
  migration: "Migration",
};

function referans(m: StockMovementOut): string {
  if (!m.ref_type) return "-";
  const ad = REF_LABELS[m.ref_type] ?? m.ref_type;
  const kimlik = m.ref_id != null ? `#${m.ref_id}` : "";
  const satir = m.ref_line_id != null ? ` · satır ${m.ref_line_id}` : "";
  return `${ad} ${kimlik}${satir}`.trim();
}

function aktor(m: StockMovementOut): string {
  if (m.actor_type === "ADMIN") {
    return m.actor_id != null ? `Yönetici #${m.actor_id}` : "Yönetici";
  }
  return "Sistem";
}

export function StockMovementTable({
  rows,
  isLoading,
  isError,
  onRetry,
  showProduct = false,
  emptyTitle = "Bu üründe stok hareketi yok",
  emptyDescription = "Ödeme, iptal, iade ve yönetici düzeltmeleri buraya düşer.",
}: {
  rows: StockMovementOut[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  showProduct?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  // Hata ≠ boş ekran: sessiz boşluk "hareket yok" diye okunur.
  if (isError) {
    return (
      <ErrorState
        title="Stok hareketleri yüklenemedi"
        description="Defter okunamadı. Bağlantıyı kontrol edip yeniden deneyin."
        onRetry={onRetry}
      />
    );
  }
  if (isLoading) {
    return (
      <div className="space-y-2 py-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded bg-slate-100 "
          />
        ))}
      </div>
    );
  }
  if (!rows?.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 ">
            <th className="py-2 pr-4 font-medium">Tarih</th>
            {showProduct && <th className="py-2 pr-4 font-medium">Ürün</th>}
            <th className="py-2 pr-4 font-medium">Hareket</th>
            <th className="py-2 pr-4 text-right font-medium">Değişim</th>
            <th className="py-2 pr-4 text-right font-medium">Sonraki stok</th>
            <th className="py-2 pr-4 font-medium">Gerekçe</th>
            <th className="py-2 pr-4 font-medium">Kaynak</th>
            <th className="py-2 font-medium">Kim</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr
              key={m.id}
              className="border-b border-slate-200 align-top last:border-0 "
            >
              <td className="whitespace-nowrap py-2 pr-4 text-slate-600 ">
                {new Date(m.created_at).toLocaleString("tr-TR")}
              </td>
              {showProduct && (
                <td className="py-2 pr-4">
                  <div className="font-medium text-slate-800 ">
                    {m.product_title}
                  </div>
                  <div className="font-mono text-xs text-slate-500 ">
                    {m.sku}
                  </div>
                </td>
              )}
              <td className="py-2 pr-4 text-slate-700 ">
                {movementTypeLabel(m.movement_type as StockMovementType)}
              </td>
              <td
                className={`whitespace-nowrap py-2 pr-4 text-right tabular-nums font-medium ${
                  m.qty_delta > 0
                    ? "text-emerald-700 "
                    : m.qty_delta < 0
                      ? "text-rose-700 "
                      : "text-slate-500 "
                }`}
              >
                {formatDelta(m.qty_delta)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-slate-700 ">
                {m.qty_after}
              </td>
              <td className="py-2 pr-4 text-slate-600 ">
                {reasonLabel(m.reason_code)}
                {m.note && (
                  <div className="text-xs text-slate-500 ">
                    {m.note}
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap py-2 pr-4 text-slate-600 ">
                {referans(m)}
              </td>
              <td className="whitespace-nowrap py-2 text-slate-600 ">
                <Badge tone={m.actor_type === "ADMIN" ? "info" : "neutral"}>
                  {aktor(m)}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
