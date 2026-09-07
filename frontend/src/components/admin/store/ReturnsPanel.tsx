/**
 * Mağaza "İadeler" (RMA) sekmesi.
 *
 * ## İP-A6 · Görev 4c/4d — göç
 *
 *   - İki ham `<button>` ortak `Button`a geçti.
 *   - Karar penceresinin durumu (`decision`) ekrandan `ui2/duzenlemeYuzeyi`ne
 *     taşındı; bu dosyada pencere `useState`i kalmadı.
 *
 * "Yalnız bekleyenler" kutucuğu bir PENCERE durumu değil, listenin filtresidir
 * ve `<label>` içinde sarmalı olduğu için zaten adlandırılmıştır — göçte
 * dokunulmadı.
 */
import { useState } from "react";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Button, ConfirmDialog, ErrorState, ReasonDialog } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/yuzeyDurumu";
import { useAdminReturns, useResolveReturn } from "@/hooks/useStore";
import { formatDateTime } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import { toast } from "@/store/toastStore";

const RETURN_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Bekliyor", cls: "bg-amber-100 text-amber-700 " },
  APPROVED: { label: "Onaylandı", cls: "bg-emerald-100 text-emerald-700 " },
  REJECTED: { label: "Reddedildi", cls: "bg-rose-100 text-rose-700 " },
};

export function ReturnsPanel() {
  const { canView, canManage } = useAdminAreaAccess("returns");
  // Pencere durumu EKRANDA yaşamaz (İP-A4 sözleşmesi): kararın hedefi ve türü
  // düzenleme yüzeyinde tutulur.
  const kararYuzeyi = useDuzenlemeYuzeyi<{ id: number; action: "approve" | "reject" }>();
  const [onlyPending, setOnlyPending] = useState(true);
  const { data: returns, isLoading, isError, error, refetch } =
    useAdminReturns(onlyPending ? "PENDING" : undefined);
  const resolve = useResolveReturn();

  function approve(id: number) {
    resolve.mutate(
      { id, action: "approve" },
      {
        onSuccess: () => { toast.success("İade onaylandı, ödeme iade edildi"); kararYuzeyi.kapat(); },
        onError: (err: unknown) => {
          const detail =
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
            "İade onaylanamadı";
          toast.error(detail);
        },
      }
    );
  }

  function reject(id: number, note: string) {
    resolve.mutate(
      { id, action: "reject", adminNote: note || null },
      {
        onSuccess: () => { toast.success("İade talebi reddedildi"); kararYuzeyi.kapat(); },
        onError: () => toast.error("İşlem başarısız"),
      }
    );
  }

  if (!canView) return <AccessDenied area="İadeler" />;
  // P1-6: "Bekleyen iade talebi yok." metni hata hâlinde BASILAMAZ — yönetici
  // kuyruğu boş sanıp bekleyen iadeyi atlar (denetim raporunun örneği).
  if (isError) {
    return (
      <ErrorState
        description={getErrorDetail(error, "İade talepleri yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }
  if (isLoading) return <p className="text-sm text-slate-400">Yükleniyor…</p>;

  return (
    <div className="space-y-3">
      {!canManage && <ReadOnlyNotice />}
      <label className="flex items-center gap-2 text-sm text-slate-600 ">
        <input
          type="checkbox"
          checked={onlyPending}
          onChange={(e) => setOnlyPending(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-panel-accent-text focus:ring-panel-focus accent-marka"
        />
        Yalnız bekleyenler
      </label>

      {returns && returns.length > 0 ? (
        returns.map((r) => {
          const badge = RETURN_STATUS_LABELS[r.status] ?? { label: r.status, cls: "bg-slate-100 text-slate-500" };
          return (
            <div key={r.id} className="rounded-xl border border-slate-100 p-3 ">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800 ">
                  Sipariş #{r.order_id}
                  {r.order && <> · {formatTL(r.order.total)}</>}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{formatDateTime(r.created_at)}</p>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700 ">
                {r.reason}
              </p>
              {r.order?.ship_recipient && (
                <p className="mt-1 text-xs text-slate-500">
                  {r.order.ship_recipient}
                  {r.order.ship_address ? `: ${r.order.ship_address}` : ""}
                </p>
              )}
              {r.admin_note && (
                <p className="mt-2 text-xs text-slate-500">
                  <span className="font-medium">Not:</span> {r.admin_note}
                </p>
              )}
              {canManage && r.status === "PENDING" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="success"
                    isPending={resolve.isPending}
                    onClick={() => kararYuzeyi.ac({ id: r.id, action: "approve" })}
                  >
                    Onayla & iade et
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    isPending={resolve.isPending}
                    onClick={() => kararYuzeyi.ac({ id: r.id, action: "reject" })}
                  >
                    Reddet
                  </Button>
                </div>
              )}
            </div>
          );
        })
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">
          {onlyPending ? "Bekleyen iade talebi yok." : "İade talebi yok."}
        </p>
      )}
      <ConfirmDialog
        open={kararYuzeyi.kayit?.action === "approve"}
        title="İade talebini onayla"
        description="Müşteriye ödeme iadesi yapılacak ve ürün stoğu geri yüklenecek."
        confirmLabel="Onayla ve iade et"
        danger
        isPending={resolve.isPending}
        onClose={kararYuzeyi.kapat}
        onConfirm={() => kararYuzeyi.kayit && approve(kararYuzeyi.kayit.id)}
      />
      <ReasonDialog
        open={kararYuzeyi.kayit?.action === "reject"}
        title="İade talebini reddet"
        description="Moderasyon notu müşteriye iletilecek."
        label="Red gerekçesi"
        confirmLabel="Talebi reddet"
        danger
        isPending={resolve.isPending}
        onClose={kararYuzeyi.kapat}
        onConfirm={(note) => kararYuzeyi.kayit && reject(kararYuzeyi.kayit.id, note)}
      />
    </div>
  );
}
