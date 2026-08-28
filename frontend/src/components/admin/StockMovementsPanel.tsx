import { useState } from "react";

import { StockMovementTable } from "@/components/admin/StockMovementTable";
import { Badge, Button, ErrorState } from "@/components/admin/ui";
import { useLedgerAudit, useStockMovements } from "@/hooks/useStock";
import { movementTypeLabel, type StockMovementType } from "@/lib/stockMovements";

import type { MovementFilters } from "@/api/stock";

const SAYFA = 25;

const TURLER: StockMovementType[] = [
  "OPENING_BALANCE",
  "INITIAL",
  "SALE",
  "SALE_CANCEL",
  "RETURN",
  "ADMIN_ADJUSTMENT",
];

/**
 * Genel envanter hareketleri ekranı (Mağaza → Stok hareketleri).
 *
 * Yalnız **teşhis ve görünürlük**: defter append-only'dir, bu ekranda hareket
 * oluşturma/düzenleme/silme yoktur. Doğrulama bulguları da bir düzeltme
 * butonuna dönüştürülmez — sayım/düzeltme ayrı bir paket.
 */
export function StockMovementsPanel() {
  const [offset, setOffset] = useState(0);
  const [tur, setTur] = useState<string>("");
  const [sku, setSku] = useState("");
  const [aktor, setAktor] = useState<string>("");
  const [denetimAcik, setDenetimAcik] = useState(false);

  const filtreler: MovementFilters = {
    limit: SAYFA,
    offset,
    movement_type: tur || undefined,
    sku: sku.trim() || undefined,
    actor_type: aktor || undefined,
  };
  const liste = useStockMovements(filtreler);
  const denetim = useLedgerAudit({ limit: 100, offset: 0 }, denetimAcik);

  const toplam = liste.data?.total ?? 0;
  const sonSayfa = offset + SAYFA >= toplam;

  const filtreDegisti = (fn: () => void) => {
    fn();
    setOffset(0);   // filtre değişince sayfayı başa al
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500 ">
          <span className="mb-1 block">Hareket türü</span>
          <select
            className="input w-48"
            value={tur}
            onChange={(e) => filtreDegisti(() => setTur(e.target.value))}
          >
            <option value="">Tümü</option>
            {TURLER.map((t) => (
              <option key={t} value={t}>
                {movementTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500 ">
          <span className="mb-1 block">SKU</span>
          <input
            className="input w-40"
            placeholder="FZK-000042"
            value={sku}
            onChange={(e) => filtreDegisti(() => setSku(e.target.value))}
          />
        </label>
        <label className="text-xs text-slate-500 ">
          <span className="mb-1 block">Kim</span>
          <select
            className="input w-36"
            value={aktor}
            onChange={(e) => filtreDegisti(() => setAktor(e.target.value))}
          >
            <option value="">Tümü</option>
            <option value="SYSTEM">Sistem</option>
            <option value="ADMIN">Yönetici</option>
          </select>
        </label>
        <Button variant="secondary" onClick={() => setDenetimAcik((v) => !v)}>
          {denetimAcik ? "Denetimi gizle" : "Defteri denetle"}
        </Button>
      </div>

      {denetimAcik && (
        <div className="rounded-xl border border-slate-200 p-4 text-sm ">
          {denetim.isError ? (
            <ErrorState
              title="Denetim çalıştırılamadı"
              description="Defter okunamadı; bağlantıyı kontrol edip yeniden deneyin."
              onRetry={() => denetim.refetch()}
            />
          ) : denetim.isLoading ? (
            <p className="text-slate-500 ">Denetleniyor…</p>
          ) : denetim.data ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={denetim.data.inconsistent ? "warning" : "neutral"}>
                  {denetim.data.inconsistent
                    ? `${denetim.data.inconsistent} üründe sapma`
                    : "Bu sayfada sapma yok"}
                </Badge>
                <span className="text-xs text-slate-500 ">
                  {denetim.data.checked} ürün denetlendi
                  {denetim.data.next_offset != null &&
                    " — defterin tamamı için sonraki sayfalar da denetlenmeli"}
                </span>
              </div>
              {denetim.data.problems.length > 0 && (
                <ul className="space-y-1 text-xs text-amber-900 ">
                  {denetim.data.problems.slice(0, 20).map((p, i) => (
                    <li key={`${p.product_id}-${p.code}-${i}`}>
                      <span className="font-mono">{p.sku ?? p.product_id}</span> —{" "}
                      {p.message}
                      {p.expected != null && p.actual != null && (
                        <>
                          {" "}
                          (beklenen <b>{p.expected}</b>, görülen <b>{p.actual}</b>)
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-slate-500 ">
                Bu ekran yalnız teşhis gösterir; hiçbir kayıt düzeltilmez.
              </p>
            </div>
          ) : null}
        </div>
      )}

      <StockMovementTable
        rows={liste.data?.rows}
        isLoading={liste.isLoading}
        isError={liste.isError}
        onRetry={() => liste.refetch()}
        showProduct
        emptyTitle="Kayıt bulunamadı"
        emptyDescription="Filtreleri gevşetin ya da defter henüz boş olabilir."
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
    </div>
  );
}
