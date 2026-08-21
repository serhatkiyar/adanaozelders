// Tur Detayı (/yonetim/dagitim/turlar/:id) — tek turun kurulumu ve canlı
// yürütülmesi. Deep-link'lenebilir: istisna kuyruğu, arşiv ve iki operatör
// arası paylaşım buraya işaret eder. ACTIVE turda 15 sn poll + canlı kurye pini.
//
// Sıralama: sürükle-bırak (masaüstü, HTML5 dnd — kütüphanesiz) + KALICI ▲▼
// butonları (dokunmatik/klavye). Hover-only aksiyon kalmadı.
import { ItemLines } from "@/components/admin/delivery/ItemLines";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { DeliveryRouteMap } from "@/components/DeliveryRouteMap";
import { useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, ConfirmDialog, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import {
  DeliveryPrefBadge,
  PromiseChip,
  RunStatusChip,
  SeqBadge,
  TruckIcon,
  stopStatusText,
} from "@/components/admin/delivery/bits";
import { LabelSheet } from "@/components/admin/delivery/LabelSheet";
import {
  useAddStops,
  useCouriers,
  useDeliveryRun,
  useEligibleOrders,
  useOptimizeRun,
  useRemoveStop,
  useReorderStops,
  useRunAction,
  useRunPosition,
  useUpdateDeliveryRun,
} from "@/hooks/useDelivery";
import { getErrorMessage } from "@/lib/errors";
import { formatDuration, formatEta } from "@/lib/polyline";
import {
  FAIL_REASON_LABEL,
  coLocatedPendingStops,
  hasRunExceptions,
  runExceptions,
  runProgress,
} from "@/lib/deliveryRun";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { DeliveryRun, DeliveryStop } from "@/types";

/* İstisna şeridi (PDS O2): bekleyen duraklardaki sorunlar. Sorun yoksa hiç
   render olmaz (sakin varsayılan). */
function RunExceptionStrip({ run }: { run: DeliveryRun }) {
  const x = runExceptions(run);
  if (!hasRunExceptions(x)) return null;
  const chips = (
    [
      { key: "promise", n: x.promiseRisk, label: "söz riski", tone: "danger" },
      { key: "eta", n: x.etaDelayed, label: "ETA aşıldı", tone: "danger" },
      { key: "pinless", n: x.pinless, label: "pinsiz", tone: "warning" },
      { key: "retry", n: x.retry, label: "yeniden deneme", tone: "warning" },
      { key: "outlier", n: x.outlier, label: "rotayı bozan", tone: "warning" },
    ] as const
  ).filter((c) => c.n > 0);
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
      {chips.map((c) => (
        <Badge key={c.key} tone={c.tone}>
          <span className="mr-1 font-semibold tabular-nums">{c.n}</span>
          {c.label}
        </Badge>
      ))}
    </div>
  );
}

/* Kurye ataması — KALICI select (hover'da beliren select dokunmatikte
   erişilemiyordu). Salt-görüntülemede düz metin. */
function RunCourier({ run }: { run: DeliveryRun }) {
  const { canManage } = useAdminAreaAccess("delivery");
  const { data: couriers = [] } = useCouriers();
  const updateRun = useUpdateDeliveryRun();
  const active = couriers.filter((c) => c.is_active || c.id === run.courier?.id);
  if (!canManage) {
    return run.courier ? (
      <span className="text-xs text-slate-500 dark:text-slate-400">{run.courier.name}</span>
    ) : null;
  }
  if (active.length === 0) {
    return (
      <Link
        to={ROUTES.adminDeliveryCouriers}
        className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
      >
        Kurye ekle →
      </Link>
    );
  }
  return (
    <select
      value={run.courier?.id ?? ""}
      onChange={(e) =>
        updateRun.mutate(
          { runId: run.id, courierId: e.target.value ? Number(e.target.value) : null },
          { onError: (err) => toast.error(getErrorMessage(err, "Kurye atanamadı.")) }
        )
      }
      aria-label="Kurye"
      className="input w-auto py-1 text-xs"
    >
      <option value="">Kurye seç…</option>
      {active.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

/* Durak satırı — aksiyonlar kalıcı; sürükleme tutamacı ile dnd. */
function StopRow({
  stop,
  run,
  editable,
  onMove,
  isFirst,
  isLast,
  dragProps,
  isDragTarget,
}: {
  stop: DeliveryStop;
  run: DeliveryRun;
  editable: boolean;
  onMove: (stopId: number, dir: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
  dragProps: React.HTMLAttributes<HTMLLIElement> & { draggable?: boolean };
  isDragTarget: boolean;
}) {
  const removeStop = useRemoveStop();
  const status = stopStatusText(stop);
  const coLocated = stop.status === "PENDING" ? coLocatedPendingStops(run, stop) : [];

  // min-h/w-9: dokunmatik hedef boyutu (Button `sm` ölçeğiyle hizalı).
  const iconBtn =
    "inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200";

  return (
    <li
      {...dragProps}
      className={`flex flex-wrap items-center gap-3 py-3 ${
        isDragTarget ? "rounded-lg bg-indigo-50/60 dark:bg-indigo-500/10" : ""
      } ${dragProps.draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <SeqBadge stop={stop} />
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
          {stop.recipient ?? "—"}
          <span className="ml-2 text-xs font-normal text-slate-400">#{stop.order_id}</span>
          {stop.lat == null && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              konumsuz
            </span>
          )}
          {coLocated.length > 0 && (
            <span
              className="ml-2 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
              title={`Aynı adrese ${coLocated.length} paket daha var — birlikte teslim edilir`}
            >
              +{coLocated.length} paket
            </span>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span className="truncate">{stop.address ?? "Adres yok"}</span>
          <DeliveryPrefBadge pref={stop.delivery_pref} note={stop.delivery_pref_note} />
        </p>
        {/* Durakta ne var — kurye/operatör paketi eşleştirebilsin. */}
        <ItemLines items={stop.items} className="mt-1.5" />
      </div>
      {stop.is_outlier && stop.status === "PENDING" && (
        <span
          className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
          title="Bu durak rotaya ciddi ek yol katıyor — dış kuryeye devretmeyi düşünün"
        >
          rotayı bozuyor · +{stop.detour_km} km
        </span>
      )}
      {stop.eta && stop.status === "PENDING" && (
        <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
          ~{formatEta(stop.eta)}
        </span>
      )}
      <span className={`shrink-0 text-xs font-medium ${status.cls}`} title={
        stop.status === "FAILED" && stop.fail_reason
          ? FAIL_REASON_LABEL[stop.fail_reason] ?? stop.fail_reason
          : undefined
      }>
        {status.label}
      </span>
      {editable && (
        <div className="flex shrink-0 items-center">
          {/* İP-A7d3: üç ham `<button>` ortak `Button`a geçti. Erişilebilir
              adlar (`aria-label`) AYNEN korundu — sürükle-bırak dokunmatikte
              çalışmadığı için bu üç düğme sıralamanın TEK klavye/dokunma
              yoludur ve adları sözleşmedir. */}
          <Button
            size="sm"
            variant="ghost"
            className={iconBtn}
            onClick={() => onMove(stop.id, -1)}
            disabled={isFirst}
            title="Yukarı taşı"
            aria-label={"Durak " + stop.sequence + " yukarı taşı"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={iconBtn}
            onClick={() => onMove(stop.id, 1)}
            disabled={isLast}
            title="Aşağı taşı"
            aria-label={"Durak " + stop.sequence + " aşağı taşı"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-9 min-w-9 px-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
            onClick={() =>
              removeStop.mutate(stop.id, {
                onSuccess: () => toast.success("Durak turdan çıkarıldı."),
                onError: (e) => toast.error(getErrorMessage(e, "Çıkarılamadı.")),
              })
            }
            title="Turdan çıkar"
            aria-label={"Durak " + stop.sequence + " turdan çıkar"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>
      )}
    </li>
  );
}

export default function DeliveryRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const runId = id ? Number(id) : null;
  const navigate = useNavigate();
  const { canManage } = useAdminAreaAccess("delivery");

  // İP-A7d3: pencere durumu ekranda yaşamaz.
  const iptalYuzeyi = useDuzenlemeYuzeyi<never, void>();
  const [showLabels, setShowLabels] = useState(false);
  const [showMap, setShowMap] = useState(true);
  // Sürükle-bırak durumu (yalnız görsel; bırakınca tek reorder mutasyonu).
  const dragId = useRef<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  const runQuery = useDeliveryRun(runId, { poll: true });
  const run = runQuery.data ?? null;
  const runAction = useRunAction();
  const reorder = useReorderStops();
  const addStops = useAddStops();
  const optimize = useOptimizeRun();

  const planning = !!run && canManage && (run.status === "PLANNED" || run.status === "ACTIVE");
  const { data: eligible = [], isLoading: eligibleLoading } = useEligibleOrders(planning);
  const { data: courierPos } = useRunPosition(runId, run?.status === "ACTIVE");

  const sorted = useMemo(
    () => (run ? [...run.stops].sort((a, b) => a.sequence - b.sequence) : []),
    [run]
  );
  const [done, total] = run ? runProgress(run) : [0, 0];
  const pendingCount = sorted.filter((s) => s.status === "PENDING").length;
  const locatedPending = sorted.filter((s) => s.status === "PENDING" && s.lat != null).length;

  if (runQuery.isError || (runQuery.isSuccess && !run)) {
    return (
      <ErrorState
        title="Tur bulunamadı"
        description={getErrorMessage(runQuery.error, "Tur silinmiş ya da bağlantı bayat olabilir.")}
        onRetry={() => navigate(ROUTES.adminDeliveryRuns)}
      />
    );
  }
  if (runQuery.isLoading || !run) return <PageSkeleton rows={4} />;

  const move = (stopId: number, dir: -1 | 1) => {
    const ids = sorted.map((s) => s.id);
    const i = ids.indexOf(stopId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(
      { runId: run.id, stopIds: ids },
      { onError: (e) => toast.error(getErrorMessage(e, "Sıralanamadı.")) }
    );
  };

  const dropOn = (targetId: number) => {
    const fromId = dragId.current;
    dragId.current = null;
    setDragOverId(null);
    if (fromId == null || fromId === targetId) return;
    const ids = sorted.map((s) => s.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    reorder.mutate(
      { runId: run.id, stopIds: ids },
      { onError: (e) => toast.error(getErrorMessage(e, "Sıralanamadı.")) }
    );
  };

  const act = (action: "start" | "complete" | "cancel") =>
    runAction.mutate(
      { runId: run.id, action },
      {
        onSuccess: () => {
          if (action === "cancel") iptalYuzeyi.kapat();
          toast.success(
            action === "start"
              ? "Tur başlatıldı — siparişler 'dağıtımda' olarak işaretlendi."
              : action === "complete"
                ? "Tur tamamlandı."
                : "Tur iptal edildi."
          );
        },
        onError: (e) => toast.error(getErrorMessage(e, "İşlem başarısız.")),
      }
    );

  // Sıralama kilidi: sonuçlanmış duraklar başta sabit — dnd yalnız PENDING'lerde.
  const editableStop = (s: DeliveryStop) => planning && s.status === "PENDING";

  return (
    <div>
      <div className="mb-3">
        <Link
          to={ROUTES.adminDeliveryRuns}
          className="text-xs font-semibold text-slate-500 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Turlar
        </Link>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {/* Başlık + kalıcı aksiyonlar */}
        <div className="flex flex-wrap items-center gap-3 px-6 py-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <TruckIcon className="h-6 w-6" />
          </div>
          <div className="mr-auto">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Tur #{run.id}
              <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                {run.vehicle} ·{" "}
                {new Date(`${run.run_date}T00:00:00`).toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "long",
                })}
              </span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <RunStatusChip status={run.status} />
              {total > 0 && (
                <span>
                  {done}/{total} durak
                </span>
              )}
              <RunCourier run={run} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {planning && locatedPending >= 2 && (
              <Button
                size="sm"
                variant="secondary"
                isPending={optimize.isPending}
                onClick={() =>
                  optimize.mutate(run.id, {
                    onSuccess: (r) =>
                      toast.success(
                        r.optimize_provider === "vroom"
                          ? "Rota optimize edildi (yol ağı)."
                          : "Rota optimize edildi (yaklaşık — yol ağı servisi kapalı)."
                      ),
                    onError: (e) => toast.error(getErrorMessage(e, "Optimize edilemedi.")),
                  })
                }
              >
                Rotayı Optimize Et
              </Button>
            )}
            {run.stops.length > 0 && run.status !== "CANCELLED" && (
              <Button size="sm" variant="secondary" onClick={() => setShowLabels(true)}>
                Etiketler
              </Button>
            )}
            {run.status === "ACTIVE" && (
              <Link
                to={ROUTES.deliveryRun(run.id)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 transition hover:bg-indigo-50 dark:text-indigo-400 dark:ring-indigo-500/40 dark:hover:bg-indigo-500/10"
              >
                Saha Ekranı →
              </Link>
            )}
            {canManage && run.status === "PLANNED" && (
              <Button
                size="sm"
                onClick={() => act("start")}
                disabled={run.stops.length === 0}
                isPending={runAction.isPending}
                title={run.stops.length === 0 ? "Önce tura durak ekleyin" : undefined}
              >
                Turu Başlat
              </Button>
            )}
            {canManage && run.status === "ACTIVE" && (
              <Button
                size="sm"
                variant="success"
                onClick={() => act("complete")}
                disabled={pendingCount > 0}
                isPending={runAction.isPending}
                title={
                  pendingCount > 0
                    ? `${pendingCount} durak henüz sonuçlanmadı — önce teslim et ya da "teslim edilemedi" işaretle`
                    : undefined
                }
              >
                Turu Tamamla
              </Button>
            )}
            {planning && (
              <Button size="sm" variant="ghost" onClick={() => iptalYuzeyi.yeniAc()} title="Turu iptal et">
                İptal
              </Button>
            )}
          </div>
        </div>

        <RunExceptionStrip run={run} />

        {total > 0 && (
          <div className="px-6 pb-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all ${
                  run.status === "DONE" ? "bg-emerald-500" : "bg-indigo-500"
                }`}
                style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Rota özeti + harita */}
        {run.optimized_at && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-3 text-xs text-slate-500 dark:text-slate-400">
            {run.total_distance_km != null && (
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {run.total_distance_km.toLocaleString("tr-TR")} km
              </span>
            )}
            {run.total_duration_seconds != null && <span>~{formatDuration(run.total_duration_seconds)}</span>}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                run.optimize_provider === "vroom"
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
              }`}
              title={
                run.optimize_provider === "vroom"
                  ? "Gerçek yol ağı üzerinden hesaplandı (OSRM+VROOM)"
                  : "Kuş uçuşu yaklaşımı — yol ağı servisi kapalıyken kullanılan tahmindir; ETA'lar yaklaşıktır"
              }
            >
              {run.optimize_provider === "vroom" ? "yol ağı" : "yaklaşık"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto px-1 font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              aria-expanded={showMap}
              onClick={() => setShowMap((v) => !v)}
            >
              {showMap ? "Haritayı gizle" : "Haritayı göster"}
            </Button>
          </div>
        )}
        {run.optimized_at && showMap && run.stops.some((s) => s.lat != null) && (
          <div className="px-6 pb-4">
            <DeliveryRouteMap run={run} courier={courierPos} />
          </div>
        )}

        {/* Duraklar */}
        <div className="border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Rota — {run.stops.length} durak
            </h3>
            {planning && run.status === "ACTIVE" && pendingCount > 1 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Tur sahada — sıra değişikliği kuryeye anında yansır.
              </p>
            )}
          </div>
          {run.stops.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
              Henüz durak yok — aşağıdaki hazır siparişlerden ekleyin.
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
              {sorted.map((s, i) => (
                <StopRow
                  key={s.id}
                  stop={s}
                  run={run}
                  editable={editableStop(s)}
                  onMove={move}
                  isFirst={i === 0}
                  isLast={i === sorted.length - 1}
                  isDragTarget={dragOverId === s.id && dragId.current !== s.id}
                  dragProps={
                    editableStop(s)
                      ? {
                          draggable: true,
                          onDragStart: (e) => {
                            dragId.current = s.id;
                            e.dataTransfer.effectAllowed = "move";
                          },
                          onDragOver: (e) => {
                            e.preventDefault();
                            setDragOverId(s.id);
                          },
                          onDragLeave: () => setDragOverId((v) => (v === s.id ? null : v)),
                          onDrop: (e) => {
                            e.preventDefault();
                            dropOn(s.id);
                          },
                          onDragEnd: () => {
                            dragId.current = null;
                            setDragOverId(null);
                          },
                        }
                      : {}
                  }
                />
              ))}
            </ul>
          )}
        </div>

        {/* Eklenebilecek siparişler */}
        {planning && (
          <div className="border-t border-slate-100 px-6 py-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Dağıtıma hazır siparişler
                {eligible.length > 0 && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    {eligible.length}
                  </span>
                )}
              </h3>
              {eligible.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                  isPending={addStops.isPending}
                  onClick={() =>
                    addStops.mutate(
                      { runId: run.id, orderIds: eligible.map((o) => o.order_id) },
                      {
                        onSuccess: () => toast.success("Tüm siparişler tura eklendi."),
                        onError: (e) => toast.error(getErrorMessage(e, "Eklenemedi.")),
                      }
                    )
                  }
                >
                  Tümünü ekle
                </Button>
              )}
            </div>
            {eligibleLoading ? (
              <div className="py-3">
                <PageSkeleton rows={2} />
              </div>
            ) : eligible.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
                Tura hazır sipariş yok —{" "}
                <Link to={ROUTES.adminDeliveryOrders} className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                  Siparişler
                </Link>{" "}
                sekmesinden paket hazırlayın.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
                {eligible.map((o) => (
                  <li key={o.order_id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                        {o.recipient ?? "—"}
                        <span className="ml-2 text-xs font-normal text-slate-400">#{o.order_id}</span>
                        {o.lat == null && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                            konumsuz
                          </span>
                        )}
                        <span className="ml-2">
                          <PromiseChip date={o.promised_delivery_date} />
                        </span>
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {o.address ?? "Adres yok"}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {o.item_count} parça · ₺{o.total}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        addStops.mutate(
                          { runId: run.id, orderIds: [o.order_id] },
                          { onError: (e) => toast.error(getErrorMessage(e, "Eklenemedi.")) }
                        )
                      }
                      disabled={addStops.isPending}
                    >
                      Ekle
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {showLabels && <LabelSheet run={run} onClose={() => setShowLabels(false)} />}
      <ConfirmDialog
        open={iptalYuzeyi.acik}
        title="Dağıtım turunu iptal et"
        description={`Tur #${run.id}: bekleyen ${pendingCount} durak "teslim edilemedi" olarak kapanacak ve siparişler yeniden planlanabilir hale gelecek. Teslim edilmiş duraklar etkilenmez.`}
        confirmLabel="Turu iptal et"
        danger
        isPending={runAction.isPending}
        onClose={iptalYuzeyi.kapat}
        onConfirm={() => act("cancel")}
      />
    </div>
  );
}
