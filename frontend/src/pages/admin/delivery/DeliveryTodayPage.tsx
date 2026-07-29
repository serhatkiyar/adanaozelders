// "Bugün" — operasyon kokpiti. Amaç: yoğun günde 5 saniyede durum okumak:
// istisna var mı, turlar nerede, kapasite ne durumda. 30 sn'de bir tazelenir.
// Renk yalnız istisna için; sorun yokken ekran nötrdür.
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { CapacityStrip } from "@/components/admin/delivery/CapacityStrip";
import { RunStatusChip, TruckIcon, todayIso } from "@/components/admin/delivery/bits";
import {
  useAttentionOrders,
  useCreateDeliveryRun,
  useDeliveryRuns,
  useDispatchDay,
  useEligibleOrders,
  useRetryExhausted,
  useRoutingHealth,
  useRunPosition,
} from "@/hooks/useDelivery";
import { getErrorMessage } from "@/lib/errors";
import { runProgress, VEHICLE_LABEL } from "@/lib/deliveryRun";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { DeliveryRun, DeliveryVehicle } from "@/types";

/* Rota altyapısı bozulma şeridi — yalnız degraded iken görünür. VROOM/OSRM
   düşükken sistem çalışmaya devam eder ama optimize kuş uçuşu tahmine düşer;
   operatör verdiği ETA sözlerinin yaklaşık olduğunu BİLMELİ. */
function RoutingHealthStrip() {
  const { data: health } = useRoutingHealth();
  if (!health?.degraded) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2.5 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4 shrink-0">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008M10.34 3.94 1.7 18.94A1.5 1.5 0 0 0 3 21.19h18a1.5 1.5 0 0 0 1.3-2.25L13.66 3.94a1.5 1.5 0 0 0-2.62 0Z" />
      </svg>
      <span>
        <span className="font-semibold">Rota optimizasyonu yaklaşık modda.</span>{" "}
        Yol ağı servisi (VROOM/OSRM) erişilemiyor — durak sıraları ve ETA'lar kuş
        uçuşu tahminle hesaplanır.
      </span>
    </div>
  );
}

/* İstisna kuyruğu — sayfanın tek kalıcı renk alanı. Deneme hakkı dolmuş
   siparişler operatör kararı bekler; boşken nötr tek satıra iner. */
function ExceptionQueue() {
  const { canManage } = useAdminAreaAccess("delivery");
  const [retrying, setRetrying] = useState<number | null>(null);
  const query = useAttentionOrders();
  const retry = useRetryExhausted();
  const orders = query.data ?? [];

  if (query.isError) {
    return (
      <div className="mb-6">
        <ErrorState
          title="İstisna kuyruğu yüklenemedi"
          description={getErrorMessage(query.error, "Sunucuya ulaşılamadı.")}
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }
  if (query.isLoading) return null; // kokpit açılışında ayrı skeleton'a gerek yok
  if (orders.length === 0) {
    return (
      <p className="mb-6 flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        İstisna yok — karar bekleyen sipariş bulunmuyor.
      </p>
    );
  }

  return (
    <section className="mb-6 rounded-2xl border border-rose-200 bg-white dark:border-rose-500/30 dark:bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">İstisna Kuyruğu</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Birkaç kez teslim edilemeyen siparişler — karar bekliyor (yeniden dene / iade).
          </p>
        </div>
        <Badge tone="danger">{orders.length}</Badge>
      </div>
      <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
        {orders.map((o) => (
          <li key={o.order_id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1 basis-48">
              <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                {o.recipient ?? "—"}
                <span className="ml-2 text-xs font-normal text-slate-400">#{o.order_id}</span>
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {o.address ?? "Adres yok"}
              </p>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
              ₺{o.total}
            </span>
            {canManage && (
              <Button size="sm" variant="secondary" onClick={() => setRetrying(o.order_id)}>
                Yeniden Dene
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={retrying !== null}
        title="Yeni teslimat denemesi planla"
        description={
          retrying
            ? `Sipariş #${retrying} müşteriyle görüşüldüğü kabul edilerek yeniden dağıtım kuyruğuna alınacak.`
            : ""
        }
        confirmLabel="Yeniden dene"
        isPending={retry.isPending}
        onClose={() => setRetrying(null)}
        onConfirm={() =>
          retrying !== null &&
          retry.mutate(retrying, {
            onSuccess: () => {
              toast.success(`#${retrying} yeniden dağıtım kuyruğuna alındı.`);
              setRetrying(null);
            },
            onError: (e) => toast.error(getErrorMessage(e, "İşlem başarısız.")),
          })
        }
      />
    </section>
  );
}

/* Tur satırı — araç, kurye, durum, ilerleme, canlı konum tazeliği. Satırın
   tamamı detay sayfasına götürür (hover aksiyonu yok; dokunmatik dostu). */
function RunRow({ run }: { run: DeliveryRun }) {
  const [done, total] = runProgress(run);
  const { data: pos } = useRunPosition(run.id, run.status === "ACTIVE");
  return (
    <li>
      <Link
        to={ROUTES.adminDeliveryRun(run.id)}
        className="flex flex-wrap items-center gap-3 px-6 py-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          <TruckIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            Tur #{run.id}
            <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
              {VEHICLE_LABEL[run.vehicle] ?? run.vehicle}
            </span>
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {run.courier ? run.courier.name : "Kurye atanmadı"}
            {run.status === "ACTIVE" && pos?.age_seconds != null && (
              <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                · konum {pos.age_seconds < 30 ? "canlı" : `${Math.round(pos.age_seconds / 60)} dk önce`}
              </span>
            )}
          </p>
        </div>
        {total > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {done}/{total} durak
          </span>
        )}
        <RunStatusChip status={run.status} />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </Link>
    </li>
  );
}

export default function DeliveryTodayPage() {
  const { canManage } = useAdminAreaAccess("delivery");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const date = params.get("tarih") ?? todayIso();
  const setDate = (d: string) =>
    setParams(d === todayIso() ? {} : { tarih: d }, { replace: true });

  const [vehicle, setVehicle] = useState<DeliveryVehicle>("LADA");
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const runsQuery = useDeliveryRuns(date);
  const { data: eligibleAll = [] } = useEligibleOrders();
  const createRun = useCreateDeliveryRun();
  const dispatchDay = useDispatchDay();

  const runs = runsQuery.data ?? [];
  const dispatchable = eligibleAll.filter((o) => o.lat != null && o.lng != null).length;
  const sortedRuns = useMemo(
    () =>
      [...runs].sort((a, b) => {
        const rank: Record<string, number> = { ACTIVE: 0, PLANNED: 1, DONE: 2, CANCELLED: 3 };
        return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.id - b.id;
      }),
    [runs]
  );

  const create = () =>
    createRun.mutate(
      { run_date: date, vehicle },
      {
        onSuccess: (r) => {
          toast.success("Tur oluşturuldu.");
          navigate(ROUTES.adminDeliveryRun(r.id));
        },
        onError: (e) => toast.error(getErrorMessage(e, "Tur oluşturulamadı.")),
      }
    );

  return (
    <div>
      <RoutingHealthStrip />
      <ExceptionQueue />

      <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div className="mr-auto">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Günün Turları</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Turu planla, etiketleri bas, sahaya çık — detay için tura tıkla.
            </p>
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Tur tarihi"
            className="input w-auto"
          />
          {canManage && (
            <>
              <select
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value as DeliveryVehicle)}
                aria-label="Araç"
                className="input w-auto"
              >
                <option value="LADA">{VEHICLE_LABEL.LADA}</option>
                <option value="COROLLA">{VEHICLE_LABEL.COROLLA}</option>
              </select>
              <Button size="sm" variant="secondary" onClick={create} isPending={createRun.isPending}>
                Yeni Tur
              </Button>
              <Button
                size="sm"
                onClick={() => setDispatchOpen(true)}
                disabled={dispatchable === 0}
                isPending={dispatchDay.isPending}
                title={
                  dispatchable === 0
                    ? "Dağıtılacak konumlu sipariş yok — önce Siparişler sekmesinden hazırla"
                    : `${dispatchable} sipariş araçlara bölüştürülür`
                }
              >
                Günü Optimize Et
                {dispatchable > 0 && (
                  <span className="rounded-full bg-white/20 px-1.5 text-xs">{dispatchable}</span>
                )}
              </Button>
            </>
          )}
        </div>

        <CapacityStrip selectedDate={date} onSelectDate={setDate} />

        {runsQuery.isError ? (
          <div className="p-6">
            <ErrorState
              description={getErrorMessage(runsQuery.error, "Turlar yüklenemedi.")}
              onRetry={() => runsQuery.refetch()}
            />
          </div>
        ) : runsQuery.isLoading ? (
          <div className="p-6">
            <PageSkeleton rows={2} />
          </div>
        ) : sortedRuns.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Bu tarihte tur yok"
              description="Ödenmiş fiziksel siparişleri dağıtmak için yeni bir tur oluşturun ya da Günü Optimize Et ile araçlara bölüştürün."
              action={
                canManage ? (
                  <Button size="sm" onClick={create} isPending={createRun.isPending}>
                    Yeni Tur
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {sortedRuns.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={dispatchOpen}
        title="Günü optimize et"
        description={`${dispatchable} konumlu sipariş ${dispatchable > 12 ? "Lada ve Corolla" : "Lada"} ${
          dispatchable > 12 ? "araçlarına" : "aracına"
        } bölüştürülüp optimize turlar kurulacak. Mevcut planlı turlara durak eklenebilir.`}
        confirmLabel="Turları kur"
        isPending={dispatchDay.isPending}
        onClose={() => setDispatchOpen(false)}
        onConfirm={() =>
          dispatchDay.mutate(date, {
            onSuccess: (createdRuns) => {
              setDispatchOpen(false);
              toast.success(
                createdRuns.length > 1
                  ? `Gün ${createdRuns.length} araca bölüştürüldü.`
                  : "Günün turu kuruldu ve optimize edildi."
              );
              if (createdRuns[0]) navigate(ROUTES.adminDeliveryRun(createdRuns[0].id));
            },
            onError: (e) => toast.error(getErrorMessage(e, "Günü optimize etme başarısız.")),
          })
        }
      />
    </div>
  );
}
