// Hasar olayları — dört işlem + append-only geçmiş.
//
// Geçmiş satırlarında GEÇMİŞ ZAMAN kullanılır ("Hasara ayrıldı"): buton "yap"
// der, kayıt "yapıldı" der. Aynı metni ikisinde de kullanmak, liste satırını
// tıklanabilir bir eylem gibi okutur.
import { useState } from "react";

import { DamageDialog } from "@/components/admin/inventory/DamageDialog";
import { Badge, Button, EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { useCreateDamageEvent, useDamageEvents } from "@/hooks/useInventory";
import { useInventoryAccess } from "@/hooks/useInventoryAccess";
import {
  DAMAGE_KINDS,
  bucketLabel,
  damageKindPastLabel,
  damageReasonLabel,
  inventoryErrorMessage,
  type DamageKind,
} from "@/lib/inventory";

import type { DamagePayload } from "@/api/inventory";

const PAGE_SIZE = 25;

const ZAMAN = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function DamageEventsPage() {
  const { canApply } = useInventoryAccess();
  const [sayfa, setSayfa] = useState(0);
  const [urunFiltre, setUrunFiltre] = useState("");
  const [acikIslem, setAcikIslem] = useState<DamageKind | null>(null);
  const [formHatasi, setFormHatasi] = useState<string | null>(null);
  const [sonuc, setSonuc] = useState<string | null>(null);

  const sorgu = useDamageEvents({
    product_id: Number(urunFiltre) > 0 ? Number(urunFiltre) : undefined,
    limit: PAGE_SIZE,
    offset: sayfa * PAGE_SIZE,
  });
  const olustur = useCreateDamageEvent();

  const olaylar = sorgu.data?.items ?? [];
  const toplam = sorgu.data?.total ?? 0;
  const sonSayfa = (sayfa + 1) * PAGE_SIZE >= toplam;

  const gonder = (payload: DamagePayload) => {
    setFormHatasi(null);
    olustur.mutate(payload, {
      onSuccess: (r) => {
        setSonuc(
          r.replayed
            ? "Bu işlem zaten işlenmişti — aynı anahtarla ikinci kez uygulanmadı, stok değişmedi."
            : `Hasar kaydı alındı: ${damageKindPastLabel(payload.kind)}, ürün #${payload.product_id}, ${payload.qty} adet.`
        );
        setAcikIslem(null);
      },
      onError: (e) => setFormHatasi(inventoryErrorMessage(e, "İşlem tamamlanamadı.")),
    });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Hasar işlemleri</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Her işlem stok defterine yazılır ve geri alınamaz bir kayıt bırakır.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DAMAGE_KINDS.map((k) =>
            canApply ? (
              <Button
                key={k.value}
                size="sm"
                variant={k.value === "DISPOSAL" || k.value === "SUPPLIER_RETURN" ? "secondary" : "primary"}
                onClick={() => {
                  setFormHatasi(null);
                  setSonuc(null);
                  setAcikIslem(k.value);
                }}
              >
                {k.label}
              </Button>
            ) : (
              <span
                key={k.value}
                className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-400 dark:border-slate-700 dark:text-slate-500"
              >
                {k.label}
              </span>
            )
          )}
        </div>
        {!canApply && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            İşlem başlatmak için rolünüzde <code>inventory.apply</code> izni bulunmalı.
          </p>
        )}
        {sonuc && (
          <p
            role="status"
            className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
          >
            {sonuc}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div className="mr-auto">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Geçmiş</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Kayıtlar değiştirilemez; yanlış işlem ters yönde yeni bir kayıtla düzeltilir.
            </p>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Ürün numarasına göre
            </span>
            <input
              className="input w-28"
              inputMode="numeric"
              value={urunFiltre}
              onChange={(e) => {
                setSayfa(0);
                setUrunFiltre(e.target.value);
              }}
            />
          </label>
        </div>

        {sorgu.isError ? (
          <div className="p-6">
            <ErrorState
              description={inventoryErrorMessage(sorgu.error, "Hasar olayları yüklenemedi.")}
              onRetry={() => sorgu.refetch()}
            />
          </div>
        ) : sorgu.isLoading ? (
          <div className="p-6">
            <PageSkeleton rows={4} />
          </div>
        ) : olaylar.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Hasar kaydı yok"
              description="Kırık, ıslak ya da baskı hatalı ürünleri hasarlı rafa ayırdığınızda burada listelenir."
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th scope="col" className="px-4 py-2 font-semibold">İşlem</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Ürün</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">Miktar</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Kaynak kova</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Neden</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Yapan</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Zaman</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {olaylar.map((olay) => (
                    <tr key={olay.id} data-testid={`damage-row-${olay.id}`}>
                      <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-white">
                        {damageKindPastLabel(olay.kind)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">
                        Ürün #{olay.product_id}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">
                        {olay.qty}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={olay.source_bucket === "DAMAGED" ? "warning" : "neutral"}>
                          {bucketLabel(olay.source_bucket)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">
                        {damageReasonLabel(olay.reason_code)}
                        {olay.note && (
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {olay.note}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                        #{olay.actor_admin_id}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-500 dark:text-slate-400">
                        {ZAMAN.format(new Date(olay.created_at))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-6 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <span className="mr-auto tabular-nums">
                {sayfa * PAGE_SIZE + 1}–{sayfa * PAGE_SIZE + olaylar.length} / {toplam} kayıt
              </span>
              <Button size="sm" variant="secondary" disabled={sayfa === 0} onClick={() => setSayfa(sayfa - 1)}>
                Önceki
              </Button>
              <Button size="sm" variant="secondary" disabled={sonSayfa} onClick={() => setSayfa(sayfa + 1)}>
                Sonraki
              </Button>
            </div>
          </>
        )}
      </section>

      <DamageDialog
        kind={acikIslem}
        isPending={olustur.isPending}
        error={formHatasi}
        onClose={() => setAcikIslem(null)}
        onSubmit={gonder}
      />
    </div>
  );
}
