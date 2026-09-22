// İP-19 · Gün tahtası (§4.2) — atanmamış havuz + araç bazlı turlar tek bakışta.
// Havuzdaki sipariş kartı bir turun üzerine SÜRÜKLENİP bırakılır; bırakma
// sunucuya POST /delivery/runs/{id}/stops olarak gider (optimistic yok —
// yanıt sonrası tahta invalidate edilip tazelenir).
//
// Kapasite sözleşmesi: aracın `max_stops`'u aşılıyorsa uyarı GÖRÜNÜR ama işlem
// ENGELLENMEZ — uyarı bilgilendirir, karar operatörün (kabul matrisi D-12).
//
// Sürüklenen id `dataTransfer`'da DEĞİL component state'inde taşınır: HTML5
// dataTransfer güvenlik modeli drop'tan önce veriyi okutmaz ve jsdom'da hiç
// yoktur; state hem gerçek tarayıcıda hem testte aynı davranır (D-11).
//
// Erişim: alanın görüntüleme kapısı DeliveryLayout'tadır (delivery.view);
// yazma yetkisinin nihai otoritesi backend'dir (delivery.manage → 403).
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageSkeleton,
} from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { RunStatusChip, TruckIcon, todayIso } from "@/components/admin/delivery/bits";
import {
  useAddBoardStops,
  useVehicles,
  useDeliveryBoard,
  useDispatchDay,
} from "@/hooks/useDelivery";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { BoardPoolOrder, BoardRun } from "@/api/delivery";
import type { Vehicle } from "@/types";

/** İptal edilmiş duraklar kapasiteye sayılmaz (sipariş düşmüş, koltuk boş). */
function activeStopCount(run: BoardRun): number {
  return run.stops.filter((s) => s.status !== "CANCELLED").length;
}

/* Havuz kartı — sürüklenebilir sipariş. Tutamaç ikonu + grab imleci sürükleme
   olanağını görünür kılar; içerik iki satırda kalır (kart enflasyonu yok). */
function PoolCard({
  order,
  onDragStart,
  onDragEnd,
}: {
  order: BoardPoolOrder;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    /* Sürüklenebilir havuz kartı doğası gereği etkileşimlidir; HTML5 drag
       API listener'ları li'nin kendisinde olmak zorunda. */
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      data-testid={`havuz-siparis-${order.order_id}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="flex cursor-grab items-center gap-3 px-5 py-3 transition hover:bg-slate-50 active:cursor-grabbing "
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
        className="h-4 w-4 shrink-0 text-slate-300 "
      >
        <circle cx="9" cy="6" r="1.5" />
        <circle cx="15" cy="6" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="18" r="1.5" />
        <circle cx="15" cy="18" r="1.5" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900 ">
          {order.recipient ?? "Sipariş"}
          <span className="ml-2 text-xs font-normal tabular-nums text-slate-400">
            #{order.order_id}
          </span>
        </p>
        <p className="truncate text-xs text-slate-500 ">
          {order.address ?? "Adres yok"}
        </p>
      </div>
      {order.total != null && (
        <span className="shrink-0 text-xs tabular-nums text-slate-500 ">
          ₺{order.total}
        </span>
      )}
    </li>
  );
}

/* Tur bloğu — drop hedefi. Başlıkta araç + doluluk + durum; altında sequence
   sırasında duraklar. Sürükleme sürerken kesikli çerçeve hedefi işaret eder. */
function RunLane({
  run,
  vehicle,
  dragging,
  warned,
  onDrop,
}: {
  run: BoardRun;
  vehicle?: Vehicle;
  dragging: boolean;
  warned: boolean;
  onDrop: () => void;
}) {
  const max = vehicle?.max_stops ?? null;
  const count = activeStopCount(run);
  const over = warned || (max != null && count > max);
  const stops = [...run.stops].sort((a, b) => a.sequence - b.sequence);
  const label = vehicle?.label ?? run.vehicle ?? `Araç ${run.vehicle_id}`;

  return (
    <div
      data-testid={`tur-${run.id}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={`px-5 py-4 transition ${
        dragging
          ? "rounded-xl outline-dashed outline-1 -outline-offset-4 outline-slate-300 "
          : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 ">
          <TruckIcon className="h-4.5 w-4.5" />
        </div>
        <div className="mr-auto min-w-0">
          <p className="text-sm font-semibold text-slate-900 ">
            Tur #{run.id}
            <span className="ml-2 font-normal text-slate-500 ">
              {label}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500 ">
            {run.courier ? run.courier.name : "Kurye atanmadı"}
          </p>
        </div>
        <span
          className={`shrink-0 text-xs tabular-nums ${
            over
              ? "font-semibold text-amber-600 "
              : "text-slate-500 "
          }`}
        >
          {count}
          {max != null ? `/${max}` : ""} durak
        </span>
        <RunStatusChip status={run.status} />
      </div>

      {over && (
        <p
          data-testid={`kapasite-uyarisi-${run.id}`}
          role="status"
          className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 "
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m0 3.75h.008M10.34 3.94 1.7 18.94A1.5 1.5 0 0 0 3 21.19h18a1.5 1.5 0 0 0 1.3-2.25L13.66 3.94a1.5 1.5 0 0 0-2.62 0Z"
            />
          </svg>
          <span>
            <span className="font-semibold">Kapasite uyarısı:</span> {label} için sınır{" "}
            {max ?? "-"} durak. Ekleme engellenmedi: karar operatörün; gerekirse
            durağı başka araca taşıyın.
          </span>
        </p>
      )}

      {stops.length === 0 ? (
        <p className="mt-3 pl-12 text-xs text-slate-400 ">
          Durak yok: havuzdan bir sipariş sürükleyip bırakın.
        </p>
      ) : (
        <ol className="mt-3 space-y-1.5 pl-12">
          {stops.map((s) => (
            <li key={s.id} className="flex items-center gap-2.5 text-xs">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-semibold tabular-nums text-slate-500 ring-1 ring-slate-200 ">
                {s.sequence}
              </span>
              <span className="truncate text-slate-600 ">
                {s.address ?? `Sipariş #${s.order_id}`}
              </span>
              <span className="shrink-0 tabular-nums text-slate-400 ">
                #{s.order_id}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function DeliveryBoardPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get("tarih") ?? todayIso();

  const boardQuery = useDeliveryBoard(date);
  const { data: vehicles = [] } = useVehicles();
  const addStops = useAddBoardStops();
  const dispatchDay = useDispatchDay();

  const [dragId, setDragId] = useState<number | null>(null);
  const [warned, setWarned] = useState<Record<number, boolean>>({});
  // Pencere durumu ekranda YASAMAZ (IP-A4 sozlesmesi).
  const gunuOptimizeEt = useDuzenlemeYuzeyi<void, void>();

  const setDate = (d: string) => {
    setParams(d === todayIso() ? {} : { tarih: d }, { replace: true });
    setWarned({}); // uyarılar güne aittir
  };

  const pool = boardQuery.data?.unassigned ?? [];
  const vehicleById = useMemo(
    () => new Map(vehicles.map((v) => [v.id, v])),
    [vehicles]
  );
  const runs = useMemo(
    () => [...(boardQuery.data?.runs ?? [])].sort((a, b) => a.id - b.id),
    [boardQuery.data]
  );
  const dispatchable = pool.filter((o) => o.lat != null && o.lng != null).length;

  const handleDrop = (run: BoardRun) => {
    if (dragId == null) return;
    const orderId = dragId;
    setDragId(null);

    const max = vehicleById.get(run.vehicle_id)?.max_stops;
    if (max != null && activeStopCount(run) + 1 > max) {
      setWarned((w) => (w[run.id] ? w : { ...w, [run.id]: true }));
    }
    // Uyarı işlemi ENGELLEMEZ (D-12): istek her hâlde gider, karar operatörün.
    addStops.mutate(
      { runId: run.id, orderIds: [orderId] },
      {
        onSuccess: () => toast.success(`Sipariş #${orderId} Tur #${run.id}'e eklendi.`),
        onError: (e) => toast.error(getErrorMessage(e, "Durak eklenemedi.")),
      }
    );
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 ">
            Gün Tahtası
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 ">
            Havuzdaki siparişi bir turun üzerine sürükleyip bırakın ya da günü
            tek tuşla araçlara bölüştürün.
          </p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Tahta tarihi"
          className="input w-auto"
        />
        <Button
          size="sm"
          onClick={() => gunuOptimizeEt.yeniAc()}
          disabled={dispatchable === 0}
          isPending={dispatchDay.isPending}
          title={
            dispatchable === 0
              ? "Dağıtılacak konumlu sipariş yok"
              : `${dispatchable} sipariş araçlara bölüştürülür`
          }
        >
          Günü Optimize Et
          {dispatchable > 0 && (
            <span className="rounded-full bg-white/20 px-1.5 text-xs">{dispatchable}</span>
          )}
        </Button>
      </div>

      {boardQuery.isError ? (
        <ErrorState
          description={getErrorMessage(boardQuery.error, "Tahta yüklenemedi.")}
          onRetry={() => boardQuery.refetch()}
        />
      ) : boardQuery.isLoading ? (
        <PageSkeleton rows={4} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(260px,340px)_1fr]">
          {/* ── Havuz: atanmamış siparişler ── */}
          <section className="rounded-2xl border border-slate-200 bg-white ">
            <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3.5 ">
              <h3 className="mr-auto text-sm font-bold text-slate-900 ">
                Havuz
              </h3>
              <Badge>{pool.length}</Badge>
            </div>
            {pool.length === 0 ? (
              <p className="px-5 py-6 text-xs text-slate-400 ">
                Havuz boş: dağıtım bekleyen atanmamış sipariş yok.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200 ">
                {pool.map((o) => (
                  <PoolCard
                    key={o.order_id}
                    order={o}
                    onDragStart={() => setDragId(o.order_id)}
                    onDragEnd={() => setDragId(null)}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* ── Turlar: araç bazlı drop hedefleri ── */}
          <section className="rounded-2xl border border-slate-200 bg-white ">
            <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3.5 ">
              <h3 className="mr-auto text-sm font-bold text-slate-900 ">
                Turlar
              </h3>
              <Badge>{runs.length}</Badge>
            </div>
            {runs.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Bu tarihte tur yok"
                  description="Günü Optimize Et ile araçlara bölüştürün ya da Bugün sekmesinden elle tur kurun."
                />
              </div>
            ) : (
              <div className="divide-y divide-slate-200 ">
                {runs.map((r) => (
                  <RunLane
                    key={r.id}
                    run={r}
                    vehicle={vehicleById.get(r.vehicle_id)}
                    dragging={dragId != null}
                    warned={!!warned[r.id]}
                    onDrop={() => handleDrop(r)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={gunuOptimizeEt.acik}
        title="Günü optimize et"
        description={`${dispatchable} konumlu sipariş filo araçlarına bölüştürülüp optimize turlar kurulacak. Mevcut planlı turlara durak eklenebilir.`}
        confirmLabel="Turları kur"
        isPending={dispatchDay.isPending}
        onClose={gunuOptimizeEt.kapat}
        onConfirm={() =>
          dispatchDay.mutate(date, {
            onSuccess: (createdRuns) => {
              gunuOptimizeEt.kapat();
              setWarned({});
              toast.success(
                createdRuns.length > 1
                  ? `Gün ${createdRuns.length} araca bölüştürüldü.`
                  : "Günün turu kuruldu ve optimize edildi."
              );
            },
            onError: (e) =>
              toast.error(getErrorMessage(e, "Günü optimize etme başarısız.")),
          })
        }
      />
    </div>
  );
}
