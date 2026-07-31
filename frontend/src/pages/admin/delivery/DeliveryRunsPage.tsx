// "Turlar" — tur listesi ve arşivi. İki mod: tarihe göre (tek günün turları)
// ya da arşiv (tüm turlar, sayfalı — backend offset). Satır → tur detayı.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Button, EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { RunStatusChip, TruckIcon } from "@/components/admin/delivery/bits";
import { useDeliveryRunArchive, useDeliveryRuns } from "@/hooks/useDelivery";
import { getErrorMessage } from "@/lib/errors";
import { runProgress, VEHICLE_LABEL } from "@/lib/deliveryRun";
import { ROUTES } from "@/lib/routes";
import type { DeliveryRun } from "@/types";

const PAGE_SIZE = 20;

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  weekday: "short",
});

function RunArchiveRow({ run }: { run: DeliveryRun }) {
  const [done, total] = runProgress(run);
  const failed = run.stops.filter((s) => s.status === "FAILED").length;
  return (
    <li>
      <Link
        to={ROUTES.adminDeliveryRun(run.id)}
        className="flex flex-wrap items-center gap-3 px-6 py-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {DATE_FMT.format(new Date(`${run.run_date}T00:00:00`))}
        </span>
        <div className="min-w-0 flex-1 basis-36">
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            Tur #{run.id}
            <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
              {(VEHICLE_LABEL[run.vehicle] ?? run.vehicle).split(" ")[0]}
            </span>
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {run.courier?.name ?? "Kurye atanmadı"}
          </p>
        </div>
        {total > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {done}/{total} durak
            {failed > 0 && (
              <span className="ml-1.5 text-rose-600 dark:text-rose-400">· {failed} başarısız</span>
            )}
          </span>
        )}
        {run.total_distance_km != null && (
          <span className="hidden shrink-0 text-xs tabular-nums text-slate-400 sm:inline dark:text-slate-500">
            {run.total_distance_km.toLocaleString("tr-TR")} km
          </span>
        )}
        <RunStatusChip status={run.status} />
      </Link>
    </li>
  );
}

export default function DeliveryRunsPage() {
  const [params, setParams] = useSearchParams();
  const dateFilter = params.get("tarih") ?? "";
  const [page, setPage] = useState(0);

  // Tarih filtresi varsa o günün turları; yoksa sayfalı arşiv.
  const byDate = useDeliveryRuns(dateFilter || undefined);
  const archive = useDeliveryRunArchive(page, PAGE_SIZE);
  const query = dateFilter ? byDate : archive;
  const runs = query.data ?? [];
  const isLastPage = !dateFilter && runs.length < PAGE_SIZE;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Turlar</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Geçmiş ve planlı dağıtım turları — detay için satıra tıkla.
          </p>
        </div>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => {
            setPage(0);
            setParams(e.target.value ? { tarih: e.target.value } : {}, { replace: true });
          }}
          aria-label="Tarihe göre filtrele"
          className="input w-auto"
        />
        {dateFilter && (
          <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>
            Filtreyi kaldır
          </Button>
        )}
      </div>

      {query.isError ? (
        <div className="p-6">
          <ErrorState
            description={getErrorMessage(query.error, "Turlar yüklenemedi.")}
            onRetry={() => query.refetch()}
          />
        </div>
      ) : query.isLoading ? (
        <div className="p-6">
          <PageSkeleton rows={4} />
        </div>
      ) : runs.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title={dateFilter ? "Bu tarihte tur yok" : page > 0 ? "Arşivin sonu" : "Henüz tur yok"}
            description={
              dateFilter
                ? "Farklı bir tarih seçin ya da filtreyi kaldırın."
                : "Turlar Bugün sekmesinden oluşturulur."
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {runs.map((r) => (
            <RunArchiveRow key={r.id} run={r} />
          ))}
        </ul>
      )}

      {!dateFilter && (page > 0 || !isLastPage) && (
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 dark:border-slate-800">
          <Button
            size="sm"
            variant="ghost"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Daha yeni
          </Button>
          <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">
            Sayfa {page + 1}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={isLastPage}
            onClick={() => setPage((p) => p + 1)}
          >
            Daha eski →
          </Button>
        </div>
      )}
      <p className="flex items-center gap-1.5 border-t border-slate-100 px-6 py-2 text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
        <TruckIcon className="h-3.5 w-3.5" />
        Turlar en yeni tarihten eskiye sıralanır.
      </p>
    </section>
  );
}
