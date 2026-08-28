import { useState } from "react";

import { StockMovementTable } from "@/components/admin/StockMovementTable";
import { Badge, Button } from "@/components/admin/ui";
import { useProductStockMovements, useProductStockVerify } from "@/hooks/useStock";
import { consistencyBadge } from "@/lib/stockMovements";

const SAYFA = 20;

/**
 * Ürün detayındaki "Stok hareketleri" bölümü.
 *
 * Bu bir **teşhis** yüzeyidir: defter tutarsızlık raporlasa bile burada
 * düzeltme aksiyonu YOKTUR. Sayım ve düzeltme ayrı bir paket; bulguyu bir
 * butona çevirmek, denetlenmemiş bir yazma yolu açmak olurdu.
 */
export function StockLedgerPanel({
  productId,
  kind,
}: {
  productId: number;
  kind: string;
}) {
  const [offset, setOffset] = useState(0);
  const dijital = kind === "DIGITAL";

  const hareketler = useProductStockMovements(
    productId,
    { limit: SAYFA, offset },
    !dijital,
  );
  const dogrulama = useProductStockVerify(productId, !dijital);

  // Dijital ürün stok yönetimine tabi değildir. "Hareket yok" demek yanıltıcı
  // olurdu — defter TUTULMUYOR, boş değil.
  if (dijital) {
    return (
      <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-600 ">
        <p className="font-medium text-slate-800 ">
          Bu ürün için stok defteri tutulmuyor
        </p>
        <p className="mt-1">
          Dijital ürünler stok yönetimine tabi değildir: satış adedi sınırsızdır
          ve stok hareketi üretilmez. Ürün yine de kendi SKU'sunu taşır.
        </p>
      </div>
    );
  }

  const rozet = consistencyBadge(dogrulama.data ?? null);
  const toplam = hareketler.data?.total ?? 0;
  const sonSayfa = offset + SAYFA >= toplam;

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800 ">
            Stok hareketleri
          </h3>
          <span className="text-xs text-slate-500 ">
            {toplam} kayıt
          </span>
        </div>
        <Badge tone={rozet.tone === "warning" ? "warning" : "neutral"}>
          {rozet.label}
        </Badge>
      </header>

      {dogrulama.data && !dogrulama.data.consistent && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900 ">
          {dogrulama.data.problems.map((p, i) => (
            <li key={`${p.code}-${i}`}>
              <span className="font-medium">{p.message}</span>
              {p.expected != null && p.actual != null && (
                <>
                  {" "}
                  — beklenen <b>{p.expected}</b>, görülen <b>{p.actual}</b>
                </>
              )}
              {p.movement_id != null && <> (hareket #{p.movement_id})</>}
            </li>
          ))}
          <li className="pt-1 text-amber-800/80 ">
            Bu ekran yalnız teşhis gösterir; düzeltme sayım paketiyle gelecek.
          </li>
        </ul>
      )}

      <StockMovementTable
        rows={hareketler.data?.rows}
        isLoading={hareketler.isLoading}
        isError={hareketler.isError}
        onRetry={() => hareketler.refetch()}
      />

      {toplam > SAYFA && (
        <div className="flex items-center justify-between text-xs text-slate-500 ">
          <span>
            {offset + 1}–{Math.min(offset + SAYFA, toplam)} / {toplam}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - SAYFA))}
            >
              Önceki
            </Button>
            <Button
              variant="secondary"
              disabled={sonSayfa}
              onClick={() => setOffset((o) => o + SAYFA)}
            >
              Sonraki
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
