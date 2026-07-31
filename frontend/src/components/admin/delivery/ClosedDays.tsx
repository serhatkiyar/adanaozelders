// Teslimat takvimi (kapalı günler) — tek runtime-yönetilebilir operasyon ayarı.
// Söz motoru bu tarihlere teslimat sözü vermez. Resmî tatiller tek tıkla
// yüklenir (yalnız 2026 verisi mevcut); admin istemediğini siler, ek gün ekler.
import { useState } from "react";

import { useAdminAreaAccess } from "@/components/admin/AccessState";
import { Button, ConfirmDialog, EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui";
import {
  useAddClosedDay,
  useClosedDays,
  useRemoveClosedDay,
  useSeedHolidays,
} from "@/hooks/useDelivery";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

const CLOSED_DAY_FMT = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  weekday: "long",
});

export function ClosedDays() {
  const { canManage } = useAdminAreaAccess("delivery");
  const query = useClosedDays();
  const add = useAddClosedDay();
  const remove = useRemoveClosedDay();
  const seed = useSeedHolidays();
  const [newDay, setNewDay] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [seedOpen, setSeedOpen] = useState(false);
  const days = query.data ?? [];
  const year = new Date().getFullYear();

  const doAdd = () => {
    if (!newDay) return;
    add.mutate(
      { day: newDay, label: newLabel.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Gün teslimata kapatıldı.");
          setNewDay("");
          setNewLabel("");
        },
        onError: (e) => toast.error(getErrorMessage(e, "Eklenemedi.")),
      }
    );
  };

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Teslimat Takvimi</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Kapalı günler — söz motoru bu tarihlere teslimat sözü vermez. Hafta 7 gün açık.
          </p>
        </div>
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setSeedOpen(true)} isPending={seed.isPending}>
            Resmî tatilleri yükle
          </Button>
        )}
      </div>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Kapatılacak gün
            </span>
            <input
              type="date"
              value={newDay}
              onChange={(e) => setNewDay(e.target.value)}
              className="input w-auto"
            />
          </label>
          <label className="min-w-[10rem] flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Açıklama (isteğe bağlı)
            </span>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="ör. Kurban Bayramı, yıllık bakım…"
              maxLength={120}
              className="input w-full"
            />
          </label>
          <Button size="sm" variant="secondary" onClick={doAdd} disabled={!newDay} isPending={add.isPending}>
            Günü kapat
          </Button>
        </div>
      )}

      {query.isError ? (
        <div className="p-6">
          <ErrorState
            description={getErrorMessage(query.error, "Takvim yüklenemedi.")}
            onRetry={() => query.refetch()}
          />
        </div>
      ) : query.isLoading ? (
        <div className="p-6">
          <PageSkeleton rows={2} />
        </div>
      ) : days.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="Yaklaşan kapalı gün yok"
            description="Teslimat her gün açık. Resmî tatilleri yükleyebilir ya da elle gün kapatabilirsiniz."
          />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
          {days.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-3">
              <span className="w-52 shrink-0 text-sm font-medium text-slate-900 dark:text-white">
                {CLOSED_DAY_FMT.format(new Date(`${d.day}T00:00:00`))}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-slate-400">
                {d.label ?? (d.source === "holiday" ? "Resmî tatil" : "Kapalı")}
              </span>
              {canManage && (
                <button
                  onClick={() =>
                    remove.mutate(d.id, {
                      onError: (e) => toast.error(getErrorMessage(e, "Açılamadı.")),
                    })
                  }
                  disabled={remove.isPending}
                  title="Bu günü yeniden aç"
                  aria-label={CLOSED_DAY_FMT.format(new Date(d.day + "T00:00:00")) + " gününü yeniden aç"}
                  className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={seedOpen}
        title={`${year} resmî tatillerini yükle`}
        description="Yılın resmî tatilleri teslimata kapalı olarak işaretlenir (yinelenenler atlanır). İstemediğiniz günü listeden silebilirsiniz. Not: tatil verisi şimdilik yalnız 2026 için tanımlı."
        confirmLabel="Yükle"
        isPending={seed.isPending}
        onClose={() => setSeedOpen(false)}
        onConfirm={() =>
          seed.mutate(year, {
            onSuccess: (r) => {
              toast.success(
                r.length > 0 ? `${r.length} resmî tatil yüklendi.` : "Bu yıl için tatil verisi yok."
              );
              setSeedOpen(false);
            },
            onError: (e) => toast.error(getErrorMessage(e, "Yüklenemedi.")),
          })
        }
      />
    </section>
  );
}
