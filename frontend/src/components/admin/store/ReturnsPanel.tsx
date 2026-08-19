/**
 * Mağaza "İadeler" (RMA) sekmesi — İP-A5'te `AdminStore.tsx`ten AYNEN taşındı.
 */
import { useState } from "react";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ConfirmDialog, ErrorState, ReasonDialog } from "@/components/admin/ui";
import { useAdminReturns, useResolveReturn } from "@/hooks/useStore";
import { formatDateTime } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import { toast } from "@/store/toastStore";

const RETURN_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Bekliyor", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" },
  APPROVED: { label: "Onaylandı", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" },
  REJECTED: { label: "Reddedildi", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400" },
};

export function ReturnsPanel() {
  const { canView, canManage } = useAdminAreaAccess("returns");
  const [decision, setDecision] = useState<{ id: number; action: "approve" | "reject" } | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);
  const { data: returns, isLoading, isError, error, refetch } =
    useAdminReturns(onlyPending ? "PENDING" : undefined);
  const resolve = useResolveReturn();

  function approve(id: number) {
    resolve.mutate(
      { id, action: "approve" },
      {
        onSuccess: () => { toast.success("İade onaylandı, ödeme iade edildi"); setDecision(null); },
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
        onSuccess: () => { toast.success("İade talebi reddedildi"); setDecision(null); },
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
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={onlyPending}
          onChange={(e) => setOnlyPending(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        Yalnız bekleyenler
      </label>

      {returns && returns.length > 0 ? (
        returns.map((r) => {
          const badge = RETURN_STATUS_LABELS[r.status] ?? { label: r.status, cls: "bg-slate-100 text-slate-500" };
          return (
            <div key={r.id} className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Sipariş #{r.order_id}
                  {r.order && <> · {formatTL(r.order.total)}</>}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{formatDateTime(r.created_at)}</p>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
                {r.reason}
              </p>
              {r.order?.ship_recipient && (
                <p className="mt-1 text-xs text-slate-500">
                  {r.order.ship_recipient}
                  {r.order.ship_address ? ` — ${r.order.ship_address}` : ""}
                </p>
              )}
              {r.admin_note && (
                <p className="mt-2 text-xs text-slate-500">
                  <span className="font-medium">Not:</span> {r.admin_note}
                </p>
              )}
              {canManage && r.status === "PENDING" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => setDecision({ id: r.id, action: "approve" })}
                    className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Onayla & iade et
                  </button>
                  <button
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => setDecision({ id: r.id, action: "reject" })}
                    className="rounded-lg border border-rose-200 px-3 py-1 text-xs text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
                  >
                    Reddet
                  </button>
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
        open={decision?.action === "approve"}
        title="İade talebini onayla"
        description="Müşteriye ödeme iadesi yapılacak ve ürün stoğu geri yüklenecek."
        confirmLabel="Onayla ve iade et"
        danger
        isPending={resolve.isPending}
        onClose={() => setDecision(null)}
        onConfirm={() => decision && approve(decision.id)}
      />
      <ReasonDialog
        open={decision?.action === "reject"}
        title="İade talebini reddet"
        description="Moderasyon notu müşteriye iletilecek."
        label="Red gerekçesi"
        confirmLabel="Talebi reddet"
        danger
        isPending={resolve.isPending}
        onClose={() => setDecision(null)}
        onConfirm={(note) => decision && reject(decision.id, note)}
      />
    </div>
  );
}
