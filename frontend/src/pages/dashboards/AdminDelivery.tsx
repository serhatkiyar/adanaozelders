// Dağıtım planlama paneli (ADMIN) — kendi-filo kitap teslimatı (Faz A).
// Günlük tur kur → ödenmiş fiziksel siparişleri durak olarak ekle → sırala →
// QR etiketleri yazdır → turu başlat. Saha akışı DeliveryDriver ekranındadır.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";

import { DeliveryRouteMap } from "@/components/DeliveryRouteMap";
import { CourierManager } from "@/components/admin/CourierManager";
import { ConfirmDialog } from "@/components/admin/ui";
import {
  useAddClosedDay,
  useAddStops,
  useAttentionOrders,
  useCapacityOverview,
  useClosedDays,
  useCouriers,
  useCreateDeliveryRun,
  useDeliveryKpi,
  useRecentDeliveryFeedback,
  useDeliveryRuns,
  useDispatchDay,
  useEligibleOrders,
  useMarkPrepared,
  useOptimizeRun,
  useOutsourcedOrders,
  usePrepQueue,
  useRemoveClosedDay,
  useRemoveStop,
  useReorderStops,
  useRetryExhausted,
  useSeedHolidays,
  useRunAction,
  useRunPosition,
  useUpdateDeliveryRun,
} from "@/hooks/useDelivery";
import { FEEDBACK_PROBLEM_LABEL } from "@/lib/deliveryFeedback";
import { promisedDateLabel } from "@/lib/deliveryPromise";
import { formatDuration, formatEta } from "@/lib/polyline";
import {
  FAIL_REASON_LABEL,
  RUN_STATUS_LABEL,
  STOP_STATUS_LABEL,
  VEHICLE_LABEL,
  hasRunExceptions,
  runExceptions,
  runProgress,
} from "@/lib/deliveryRun";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { DeliveryRun, DeliveryStop, DeliveryVehicle } from "@/types";

function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD (yerel gün)
}

/* ─── Kapasite şeridi (Faz 1): 14 günlük söz doluluğu ──────────────────────
   Renk yalnız istisna için: ≥%90 amber, dolu rose; ↻ = söz borcu (başarısız
   denemesi olan, ertesi güne öncelikli sipariş). Kapasite kontrolü kapalıysa
   (capacity=0) yalnız sayı gösterilir. */

const WEEKDAY_FMT = new Intl.DateTimeFormat("tr-TR", { weekday: "short" });

function CapacityStrip() {
  const { data: days } = useCapacityOverview();
  if (!days || days.length === 0) return null;

  return (
    <div
      className="flex items-stretch gap-1.5 overflow-x-auto border-b border-slate-100 px-6 py-3 dark:border-slate-700"
      aria-label="Önümüzdeki günlerin teslimat kapasitesi"
    >
      {days.map((d, i) => {
        const date = new Date(`${d.day}T00:00:00`);
        const ratio = d.capacity > 0 ? d.booked / d.capacity : null;
        const full = ratio != null && ratio >= 1;
        const tight = ratio != null && ratio >= 0.9 && !full;
        const label = !d.is_working_day
          ? "kapalı gün"
          : d.capacity > 0
            ? `${d.booked} söz / ${d.capacity} kapasite`
            : `${d.booked} söz (kapasite kontrolü kapalı)`;
        return (
          <div
            key={d.day}
            title={`${label}${d.retry_debt > 0 ? ` · ${d.retry_debt} öncelikli yeniden deneme` : ""}`}
            className={`min-w-[3.6rem] shrink-0 rounded-lg px-2 py-1.5 text-center ring-1 ${
              i === 0
                ? "ring-slate-300 dark:ring-slate-500"
                : "ring-slate-100 dark:ring-slate-700"
            } ${!d.is_working_day ? "opacity-40" : ""}`}
          >
            <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {WEEKDAY_FMT.format(date)} {date.getDate()}
            </p>
            <p
              className={`mt-0.5 text-xs font-semibold tabular-nums ${
                full
                  ? "text-rose-600 dark:text-rose-400"
                  : tight
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-slate-700 dark:text-slate-200"
              }`}
            >
              {!d.is_working_day
                ? "—"
                : d.capacity > 0
                  ? `${d.booked}/${d.capacity}`
                  : d.booked}
            </p>
            {d.retry_debt > 0 && (
              <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                ↻ {d.retry_debt}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── küçük görsel parçalar ──────────────────────────── */

function TruckIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
    </svg>
  );
}

const RUN_CHIP: Record<string, { dot: string; text: string; bg: string }> = {
  PLANNED: { dot: "bg-slate-400", text: "text-slate-600 dark:text-slate-300", bg: "bg-slate-100 dark:bg-slate-700/60" },
  ACTIVE: { dot: "bg-indigo-500 animate-pulse", text: "text-indigo-700 dark:text-indigo-300", bg: "bg-indigo-50 dark:bg-indigo-500/10" },
  DONE: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
  CANCELLED: { dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-300", bg: "bg-rose-50 dark:bg-rose-500/10" },
};

function RunStatusChip({ status }: { status: string }) {
  const c = RUN_CHIP[status] ?? RUN_CHIP.PLANNED;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {RUN_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Söz verilen teslim günü chip'i — bugün=vurgulu, geçmiş=amber (söz riskte). */
function PromiseChip({ date }: { date?: string | null }) {
  const label = promisedDateLabel(date);
  if (!label) return null;
  const overdue =
    !!date && new Date(`${date}T23:59:59`).getTime() < Date.now() && label !== "bugün";
  const tone = overdue
    ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
    : label === "bugün"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
      : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      Söz: {overdue ? `${label} (gecikti)` : label}
    </span>
  );
}

/** Durak sıra rozeti — durumuna göre renklenir (rota noktası hissi). */
function SeqBadge({ stop }: { stop: DeliveryStop }) {
  const tone =
    stop.status === "DELIVERED"
      ? "bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/30"
      : stop.status === "FAILED"
        ? "bg-rose-50 text-rose-600 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/30"
        : "bg-white text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-600";
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ring-1 ${tone}`}>
      {stop.status === "DELIVERED" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        stop.sequence
      )}
    </span>
  );
}

/* ─── Etiket sayfası (yazdırma) ──────────────────────────
   Portal body'ye açılır (#root dışına) — @media print'te yalnız bu kalır. */

function LabelSheet({ run, onClose }: { run: DeliveryRun; onClose: () => void }) {
  return createPortal(
    <div className="delivery-label-sheet fixed inset-0 z-[100] overflow-auto bg-slate-100 text-slate-900">
      <style>{`@media print { body > #root { display: none !important; } .delivery-label-sheet { position: static !important; inset: auto !important; background: white !important; } .delivery-label-noprint { display: none !important; } .delivery-label-paper { box-shadow: none !important; margin: 0 !important; } }`}</style>
      <div className="delivery-label-noprint sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <p className="text-sm font-semibold">
          Tur #{run.id} — {run.stops.length} etiket
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Yazdır
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            Kapat
          </button>
        </div>
      </div>
      <div className="delivery-label-paper mx-auto my-6 grid max-w-3xl grid-cols-2 gap-4 rounded-xl bg-white p-8 shadow-sm">
        {run.stops.map((s) => (
          <div
            key={s.id}
            className="flex gap-3 break-inside-avoid rounded-lg border border-slate-300 p-3"
          >
            <QRCodeSVG value={s.qr_payload} size={96} />
            <div className="min-w-0 text-xs leading-5">
              <p className="text-sm font-bold">
                #{s.sequence} · Sipariş {s.order_id}
              </p>
              <p className="truncate font-semibold">{s.recipient ?? "—"}</p>
              <p className="line-clamp-3 whitespace-pre-line">{s.address ?? "—"}</p>
              <p>{s.phone ?? ""}</p>
              <p className="text-slate-500">
                {s.items.reduce((n, it) => n + it.quantity, 0)} parça
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}

/* ─── Durak satırı ───────────────────────────────────── */

function StopRow({
  stop,
  run,
  onMove,
  isFirst,
  isLast,
}: {
  stop: DeliveryStop;
  run: DeliveryRun;
  onMove: (stopId: number, dir: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const removeStop = useRemoveStop();
  const editable =
    (run.status === "PLANNED" || run.status === "ACTIVE") && stop.status === "PENDING";

  const iconBtn =
    "rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-700 dark:hover:text-slate-200";

  return (
    <li className="group flex items-center gap-3 py-3">
      <SeqBadge stop={stop} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
          {stop.recipient ?? "—"}
          <span className="ml-2 text-xs font-normal text-slate-400">#{stop.order_id}</span>
          {stop.lat == null && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              konumsuz
            </span>
          )}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {stop.address ?? "Adres yok"}
        </p>
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
      <span
        className={`shrink-0 text-xs font-medium ${
          stop.status === "DELIVERED"
            ? "text-emerald-600 dark:text-emerald-400"
            : stop.status === "FAILED"
              ? "text-rose-600 dark:text-rose-400"
              : "text-slate-400 dark:text-slate-500"
        }`}
      >
        {STOP_STATUS_LABEL[stop.status]}
        {stop.proof === "ADMIN" && " · notlu"}
      </span>
      {/* Hover'da beliren aksiyonlar — yer ayrılır, layout kaymaz */}
      <div
        className={`flex shrink-0 items-center opacity-0 transition group-hover:opacity-100 ${
          editable ? "" : "invisible"
        }`}
      >
        <button onClick={() => onMove(stop.id, -1)} disabled={isFirst} title="Yukarı taşı" className={iconBtn}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
          </svg>
        </button>
        <button onClick={() => onMove(stop.id, 1)} disabled={isLast} title="Aşağı taşı" className={iconBtn}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        <button
          onClick={() =>
            removeStop.mutate(stop.id, {
              onSuccess: () => toast.success("Durak turdan çıkarıldı."),
            })
          }
          title="Turdan çıkar"
          className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </li>
  );
}

/* ─── Tur detayı ─────────────────────────────────────── */

/** Tur kurye ataması — isim satırı + hover'da değiştirme select'i. */
function RunCourier({ run }: { run: DeliveryRun }) {
  const { data: couriers = [] } = useCouriers();
  const updateRun = useUpdateDeliveryRun();
  const active = couriers.filter((c) => c.is_active || c.id === run.courier?.id);
  if (active.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-slate-300 dark:text-slate-600">·</span>
      <select
        value={run.courier?.id ?? ""}
        onChange={(e) =>
          updateRun.mutate(
            {
              runId: run.id,
              courierId: e.target.value ? Number(e.target.value) : null,
            },
            { onError: (err: any) => toast.error(err?.response?.data?.detail ?? "Atanamadı.") }
          )
        }
        aria-label="Kurye"
        className="cursor-pointer rounded-md border-0 bg-transparent py-0 pl-0 pr-6 text-xs text-slate-500 focus:ring-0 dark:text-slate-400"
      >
        <option value="">Kurye seç…</option>
        {active.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.vehicle_plate ? ` · ${c.vehicle_plate}` : ""}
          </option>
        ))}
      </select>
    </span>
  );
}

/* İstisna şeridi (PDS O2): turun bekleyen duraklarındaki sorunları renk = aksiyon
   diliyle özetler. Sorun yoksa hiç render olmaz (sakin varsayılan). */
function RunExceptionStrip({ run }: { run: DeliveryRun }) {
  const x = runExceptions(run);
  if (!hasRunExceptions(x)) return null;

  const chips = (
    [
      { key: "promise", n: x.promiseRisk, label: "söz riski", tone: "rose" },
      { key: "pinless", n: x.pinless, label: "pinsiz", tone: "amber" },
      { key: "retry", n: x.retry, label: "yeniden deneme", tone: "amber" },
      { key: "outlier", n: x.outlier, label: "rotayı bozan", tone: "amber" },
    ] as const
  ).filter((c) => c.n > 0);

  const toneCls = {
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  } as const;

  return (
    <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
      {chips.map((c) => (
        <span
          key={c.key}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${toneCls[c.tone]}`}
        >
          <span className="font-semibold tabular-nums">{c.n}</span>
          {c.label}
        </span>
      ))}
    </div>
  );
}

function RunDetail({ run }: { run: DeliveryRun }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const runAction = useRunAction();
  const reorder = useReorderStops();
  const addStops = useAddStops();
  const optimize = useOptimizeRun();
  const planning = run.status === "PLANNED" || run.status === "ACTIVE";
  const { data: eligible = [], isLoading: eligibleLoading } = useEligibleOrders(planning);
  const [done, total] = runProgress(run);
  const sorted = useMemo(
    () => [...run.stops].sort((a, b) => a.sequence - b.sequence),
    [run.stops]
  );
  const locatedPending = run.stops.filter(
    (s) => s.status === "PENDING" && s.lat != null
  ).length;
  // Sahadayken kuryenin canlı konumu haritada gösterilir (10 sn poll).
  const { data: courierPos } = useRunPosition(run.id, run.status === "ACTIVE");

  const move = (stopId: number, dir: -1 | 1) => {
    const ids = sorted.map((s) => s.id);
    const i = ids.indexOf(stopId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate({ runId: run.id, stopIds: ids });
  };

  const act = (action: "start" | "complete" | "cancel") => {
    runAction.mutate(
      { runId: run.id, action },
      {
        onSuccess: () => {
          if (action === "cancel") setCancelOpen(false);
          toast.success(
            action === "start"
              ? "Tur başlatıldı — siparişler 'dağıtımda' olarak işaretlendi."
              : action === "complete"
                ? "Tur tamamlandı."
                : "Tur iptal edildi."
          );
        },
        onError: (e: any) => toast.error(e?.response?.data?.detail ?? "İşlem başarısız."),
      }
    );
  };

  const ghostBtn =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-700/60";

  return (
    <div>
      {/* Tur başlığı + aksiyonlar */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300">
          <TruckIcon className="h-6 w-6" />
        </div>
        <div className="mr-auto">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            Tur #{run.id}
            <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
              {VEHICLE_LABEL[run.vehicle] ?? run.vehicle}
            </span>
          </p>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
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
            <button
              onClick={() =>
                optimize.mutate(run.id, {
                  onSuccess: (r) =>
                    toast.success(
                      r.optimize_provider === "vroom"
                        ? "Rota optimize edildi (yol ağı)."
                        : "Rota optimize edildi (yaklaşık — VROOM kapalı)."
                    ),
                  onError: (e: any) =>
                    toast.error(e?.response?.data?.detail ?? "Optimize edilemedi."),
                })
              }
              disabled={optimize.isPending}
              className={ghostBtn}
            >
              {optimize.isPending ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 animate-spin">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
                </svg>
              )}
              Rotayı Optimize Et
            </button>
          )}
          {run.stops.length > 0 && run.status !== "CANCELLED" && (
            <button onClick={() => setShowLabels(true)} className={ghostBtn}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659" />
              </svg>
              Etiketler
            </button>
          )}
          {run.status === "ACTIVE" && (
            <Link
              to={ROUTES.deliveryRun(run.id)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 transition hover:bg-indigo-50 dark:text-indigo-400 dark:ring-indigo-500/40 dark:hover:bg-indigo-500/10"
            >
              Saha Ekranı
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          )}
          {run.status === "PLANNED" && (
            <button
              onClick={() => act("start")}
              disabled={runAction.isPending || run.stops.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M8 5.14v13.72L19 12 8 5.14z" />
              </svg>
              Turu Başlat
            </button>
          )}
          {run.status === "ACTIVE" && (
            <button
              onClick={() => act("complete")}
              disabled={runAction.isPending}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-40"
            >
              Turu Tamamla
            </button>
          )}
          {planning && (
            <button
              onClick={() => setCancelOpen(true)}
              disabled={runAction.isPending}
              title="Turu iptal et"
              className="rounded-lg p-2 text-slate-400 ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200 dark:ring-slate-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* İstisna şeridi (PDS O2) — turu başlatmadan görülmesi gereken sorunlar */}
      <RunExceptionStrip run={run} />

      {/* İlerleme çubuğu */}
      {total > 0 && (
        <div className="px-6 pb-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div
              className={`h-full rounded-full transition-all ${
                run.status === "DONE" ? "bg-emerald-500" : "bg-indigo-500"
              }`}
              style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Rota özeti + harita (optimize sonrası) */}
      {run.optimized_at && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-3 text-xs text-slate-500 dark:text-slate-400">
          {run.total_distance_km != null && (
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {run.total_distance_km.toLocaleString("tr-TR")} km
            </span>
          )}
          {run.total_duration_seconds != null && (
            <span>~{formatDuration(run.total_duration_seconds)}</span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              run.optimize_provider === "vroom"
                ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
            }`}
            title={
              run.optimize_provider === "vroom"
                ? "Gerçek yol ağı üzerinden hesaplandı (OSRM+VROOM)"
                : "Kuş uçuşu yaklaşımı — OSRM/VROOM kapalıyken kullanılan tahmindir"
            }
          >
            {run.optimize_provider === "vroom" ? "yol ağı" : "yaklaşık"}
          </span>
          <button
            onClick={() => setShowMap((v) => !v)}
            className="ml-auto font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {showMap ? "Haritayı gizle" : "Haritayı göster"}
          </button>
        </div>
      )}
      {run.optimized_at && showMap && run.stops.some((s) => s.lat != null) && (
        <div className="px-6 pb-4">
          <DeliveryRouteMap run={run} courier={courierPos} />
        </div>
      )}

      {/* Duraklar */}
      <div className="border-t border-slate-100 px-6 py-4 dark:border-slate-700">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Rota — {run.stops.length} durak
        </h3>
        {run.stops.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
            Henüz durak yok — aşağıdaki hazır siparişlerden ekleyin.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-700/60">
            {sorted.map((s, i) => (
              <StopRow
                key={s.id}
                stop={s}
                run={run}
                onMove={move}
                isFirst={i === 0}
                isLast={i === sorted.length - 1}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Eklenebilecek siparişler */}
      {planning && (
        <div className="border-t border-slate-100 px-6 py-4 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Dağıtıma hazır siparişler
              {eligible.length > 0 && (
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                  {eligible.length}
                </span>
              )}
            </h3>
            {eligible.length > 1 && (
              <button
                onClick={() =>
                  addStops.mutate(
                    { runId: run.id, orderIds: eligible.map((o) => o.order_id) },
                    {
                      onSuccess: () => toast.success("Tüm siparişler tura eklendi."),
                      onError: (e: any) =>
                        toast.error(e?.response?.data?.detail ?? "Eklenemedi."),
                    }
                  )
                }
                disabled={addStops.isPending}
                className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Tümünü ekle
              </button>
            )}
          </div>
          {eligibleLoading ? (
            <div className="space-y-2 py-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/50" />
              ))}
            </div>
          ) : eligible.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
              Bekleyen fiziksel sipariş yok — yeni siparişler ödendikçe burada belirir.
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-700/60">
              {eligible.map((o) => (
                <li key={o.order_id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                      {o.recipient ?? "—"}
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        #{o.order_id}
                      </span>
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
                  <span className="shrink-0 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    {o.item_count} parça · ₺{o.total}
                  </span>
                  <button
                    onClick={() =>
                      addStops.mutate(
                        { runId: run.id, orderIds: [o.order_id] },
                        {
                          onError: (e: any) =>
                            toast.error(e?.response?.data?.detail ?? "Eklenemedi."),
                        }
                      )
                    }
                    disabled={addStops.isPending}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 transition hover:bg-indigo-50 dark:text-indigo-400 dark:ring-indigo-500/40 dark:hover:bg-indigo-500/10"
                  >
                    Ekle
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showLabels && <LabelSheet run={run} onClose={() => setShowLabels(false)} />}
      <ConfirmDialog
        open={cancelOpen}
        title="Dağıtım turunu iptal et"
        description="Bekleyen duraklar teslim edilemedi olarak kapanacak ve siparişler yeniden planlanabilir hale gelecek."
        confirmLabel="Turu iptal et"
        danger
        isPending={runAction.isPending}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => act("cancel")}
      />
    </div>
  );
}

/* ─── Hazırlama istasyonu (Faz 2, PDS O1) ──────────────────────────────────
   Ödenmiş fiziksel Adana-içi siparişler önce burada toplanır + etiketlenir;
   "hazır" işaretlenene dek tura EKLENEMEZ. Depo görevlisinin tek yüzeyi. */

function PrepStation() {
  const { data: queue = [], isLoading } = usePrepQueue();
  const mark = useMarkPrepared();

  const prepare = (orderId: number) =>
    mark.mutate(
      { orderId, prepared: true },
      {
        onSuccess: () => toast.success(`#${orderId} hazır — artık tura eklenebilir.`),
        onError: (e: any) =>
          toast.error(e?.response?.data?.detail ?? "Hazır işaretlenemedi."),
      }
    );

  if (!isLoading && queue.length === 0) return null;

  return (
    <section className="mb-6 rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4 dark:border-slate-700">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7 12 3 4 7m16 0-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Hazırlama İstasyonu
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Paketi topla, etiketi bas, hazır işaretle — hazır olmayan sipariş sahaya çıkmaz.
          </p>
        </div>
        {queue.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
            {queue.length} bekliyor
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/50" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-700/60">
          {queue.map((o) => (
            <li key={o.order_id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                  {o.recipient ?? "—"}
                  <span className="ml-2 text-xs font-normal text-slate-400">#{o.order_id}</span>
                  <span className="ml-2">
                    <PromiseChip date={o.promised_delivery_date} />
                  </span>
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {o.address ?? "Adres yok"}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {o.item_count} parça · ₺{o.total}
              </span>
              <button
                onClick={() => prepare(o.order_id)}
                disabled={mark.isPending}
                className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Hazır & Etiketle
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─── KPI paneli (Faz 6, PDS §14) ──────────────────────────────────────────
   Ham sayı + oran; HEDEF YOK (ilk 90 gün baseline). Renk yalnız neden dağılımı
   Pareto çubuğunda; sayılar nötr. Grafik değil, etiketli sayı ritmi. */

function pct(rate: number | null): string {
  return rate == null ? "—" : `%${Math.round(rate * 100)}`;
}

function KpiPanel() {
  const { data: k, isLoading } = useDeliveryKpi(30);
  const { data: feedback = [] } = useRecentDeliveryFeedback(50);
  if (isLoading || !k) return null;
  // Hiç sonuçlanmış teslim yoksa panel gösterme (baseline birikmemiş).
  if (k.delivered + k.failed + k.rescheduled === 0) return null;

  const tiles = [
    { label: "Söz tutma", value: pct(k.on_time_rate), sub: `${k.on_time_delivered}/${k.promised_delivered} teslim` },
    { label: "İlk denemede teslim", value: pct(k.first_attempt_rate), sub: `${k.first_attempt_delivered}/${k.delivered_count} sipariş` },
    { label: "Teslim edildi", value: String(k.delivered), sub: "son 30 gün" },
    { label: "Teslim edilemedi", value: String(k.failed), sub: `${k.failed_not_courier_fault} kurye dışı` },
  ];

  const reasons = Object.entries(k.fail_by_reason).sort((a, b) => b[1] - a[1]);
  const maxReason = reasons.length ? reasons[0][1] : 0;
  const feedbackProblems = Object.entries(k.feedback_problems).sort((a, b) => b[1] - a[1]);
  const maxFeedbackProblem = feedbackProblems.length ? feedbackProblems[0][1] : 0;
  const recentFeedback = [...feedback].sort(
    (a, b) =>
      Number(a.thumbs_up) - Number(b.thumbs_up) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <section className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-700">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">
          Teslimat Göstergeleri
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Son 30 gün · baseline ölçümü (hedef konmadı — yalnız yön)
        </p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-slate-100 dark:bg-slate-700/60 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="bg-white px-6 py-4 dark:bg-slate-800">
            <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
              {t.value}
            </p>
            <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              {t.label}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">{t.sub}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 px-6 py-4 dark:border-slate-700">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Teslimat memnuniyeti
            </p>
            {k.satisfaction_rate == null ? (
              <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">henüz veri yok</p>
            ) : (
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
                👍 {pct(k.satisfaction_rate)}
              </p>
            )}
          </div>
          <p className="text-sm tabular-nums text-slate-500 dark:text-slate-400">
            👍 {k.feedback_up} · 👎 {k.feedback_down}
          </p>
        </div>

        {feedbackProblems.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Bildirilen sorunlar
            </p>
            <ul className="space-y-1.5">
              {feedbackProblems.map(([code, count]) => (
                <li key={code} className="flex items-center gap-3 text-sm">
                  <span className="w-44 shrink-0 truncate text-slate-600 dark:text-slate-300">
                    {FEEDBACK_PROBLEM_LABEL[code] ?? code}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <span
                      className="block h-full rounded-full bg-slate-400 dark:bg-slate-500"
                      style={{
                        width: `${maxFeedbackProblem ? (count / maxFeedbackProblem) * 100 : 0}%`,
                      }}
                    />
                  </span>
                  <span className="w-6 shrink-0 text-right tabular-nums text-slate-500 dark:text-slate-400">
                    {count}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {reasons.length > 0 && (
        <div className="border-t border-slate-100 px-6 py-4 dark:border-slate-700">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Teslim edilememe nedenleri
          </p>
          <ul className="space-y-1.5">
            {reasons.map(([code, count]) => (
              <li key={code} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0 truncate text-slate-600 dark:text-slate-300">
                  {FAIL_REASON_LABEL[code] ?? code}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <span
                    className="block h-full rounded-full bg-slate-400 dark:bg-slate-500"
                    style={{ width: `${maxReason ? (count / maxReason) * 100 : 0}%` }}
                  />
                </span>
                <span className="w-6 shrink-0 text-right tabular-nums text-slate-500 dark:text-slate-400">
                  {count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="border-t border-slate-100 px-6 py-4 dark:border-slate-700">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Son değerlendirmeler
        </p>
        {recentFeedback.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">Henüz değerlendirme yok.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">
            {recentFeedback.map((item) => (
              <li key={item.id} className="py-3 first:pt-1 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {item.thumbs_up ? "👍" : "👎"} Sipariş #{item.order_id}
                  </p>
                  <time
                    dateTime={item.created_at}
                    className="text-xs tabular-nums text-slate-400 dark:text-slate-500"
                  >
                    {new Date(item.created_at).toLocaleString("tr-TR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {item.problem_codes.length > 0
                    ? item.problem_codes
                        .map((code) => FEEDBACK_PROBLEM_LABEL[code] ?? code)
                        .join(" · ")
                    : "Sorun bildirilmedi"}
                </p>
                {item.comment && (
                  <p className="mt-1 text-sm leading-5 text-slate-700 dark:text-slate-300">
                    {item.comment}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ─── İstisna kuyruğu (Faz 5, PDS O3) ──────────────────────────────────────
   Deneme hakkı dolmuş (3 kez teslim edilemeyen) siparişler otomatik yeniden
   dağıtılmaz — operatör kararı bekler: bir tur daha hak tanı (müşteriyle
   görüşüldü) ya da iptal+iade (mağaza yönetimi). Sonsuz döngünün kırıldığı yer. */

function AttentionQueue() {
  const [retrying, setRetrying] = useState<number | null>(null);
  const { data: orders = [], isLoading } = useAttentionOrders();
  const retry = useRetryExhausted();

  const doRetry = (orderId: number) => {
    retry.mutate(orderId, {
      onSuccess: () => { toast.success(`#${orderId} yeniden dağıtım kuyruğuna alındı.`); setRetrying(null); },
      onError: (e: any) =>
        toast.error(e?.response?.data?.detail ?? "İşlem başarısız."),
    });
  };

  if (!isLoading && orders.length === 0) return null;

  return (
    <section className="mb-6 rounded-2xl bg-white shadow-sm ring-1 ring-rose-200 dark:bg-slate-800 dark:ring-rose-500/30">
      <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4 dark:border-slate-700">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008M10.34 3.94 1.7 18.94A1.5 1.5 0 0 0 3 21.19h18a1.5 1.5 0 0 0 1.3-2.25L13.66 3.94a1.5 1.5 0 0 0-2.62 0Z" />
          </svg>
        </div>
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            İstisna Kuyruğu
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Birkaç kez teslim edilemeyen siparişler — karar bekliyor (yeniden dene / iade).
          </p>
        </div>
        {orders.length > 0 && (
          <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
            {orders.length}
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/50" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-700/60">
          {orders.map((o) => (
            <li key={o.order_id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                  {o.recipient ?? "—"}
                  <span className="ml-2 text-xs font-normal text-slate-400">#{o.order_id}</span>
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {o.address ?? "Adres yok"}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                ₺{o.total}
              </span>
              <button
                onClick={() => setRetrying(o.order_id)}
                disabled={retry.isPending}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 transition hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-400 dark:ring-indigo-500/40 dark:hover:bg-indigo-500/10"
              >
                Yeniden Dene
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={retrying !== null}
        title="Yeni teslimat denemesi planla"
        description={retrying ? `Sipariş #${retrying} müşteriyle görüşüldüğü kabul edilerek yeniden dağıtım kuyruğuna alınacak.` : ""}
        confirmLabel="Yeniden dene"
        isPending={retry.isPending}
        onClose={() => setRetrying(null)}
        onConfirm={() => retrying !== null && doRetry(retrying)}
      />
    </section>
  );
}

/* ─── Dış kargo kuyruğu ──────────────────────────────── */

/** Bölge dışı (Cıncık kapsamına girmeyen) ödenmiş siparişler. Salt liste —
 * aksiyon Mağaza sekmesindeki manuel "Kargola" akışıdır; kargo firması API
 * entegrasyonu şirket kurulup sandbox alınınca yazılacak. */
function OutsourcedQueue() {
  const { data: orders = [], isLoading } = useOutsourcedOrders();
  if (isLoading || orders.length === 0) return null;
  return (
    <section className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <div className="border-b border-slate-100 px-6 py-4 dark:border-slate-700">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">
          Dış kargo bekleyenler
          <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            {orders.length}
          </span>
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Adana Merkez dışı siparişler — Mağaza sekmesinden kargo firmasıyla gönderilir.
        </p>
      </div>
      <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-700/60">
        {orders.map((o) => (
          <li key={o.order_id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                {o.recipient ?? "—"}
                <span className="ml-2 text-xs font-normal text-slate-400">#{o.order_id}</span>
                {(o.district || o.city) && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                    {[o.district, o.city].filter(Boolean).join(" / ")}
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {o.address ?? "Adres yok"}
              </p>
            </div>
            <span className="shrink-0 text-xs text-slate-500 tabular-nums dark:text-slate-400">
              {o.item_count} parça · ₺{o.total}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ─── Teslimat takvimi (kapalı günler) — admin yönetir ─────────────────────
   Operasyon kendi takvimini kontrol eder: hangi gün teslimata kapalı (resmî
   tatil / özel gün). Söz motoru bu günleri atlar. "Her şey otomatik" değil —
   resmî tatiller tek tıkla yüklenir ama admin istemediğini siler, ek gün ekler. */

const CLOSED_DAY_FMT = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  weekday: "long",
});

function CalendarManager() {
  const { data: days = [], isLoading } = useClosedDays();
  const add = useAddClosedDay();
  const remove = useRemoveClosedDay();
  const seed = useSeedHolidays();
  const [newDay, setNewDay] = useState("");
  const [newLabel, setNewLabel] = useState("");

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
        onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Eklenemedi."),
      }
    );
  };

  return (
    <section className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-700">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Teslimat Takvimi
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Kapalı günler — söz motoru bu tarihlere teslimat sözü vermez. Hafta 7 gün açık.
          </p>
        </div>
        <button
          onClick={() =>
            seed.mutate(new Date().getFullYear(), {
              onSuccess: (r) => toast.success(`${r.length} resmî tatil yüklendi.`),
              onError: (e: any) =>
                toast.error(e?.response?.data?.detail ?? "Yüklenemedi."),
            })
          }
          disabled={seed.isPending}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-700/60"
        >
          Resmî tatilleri yükle
        </button>
      </div>

      {/* Ekleme satırı */}
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-6 py-4 dark:border-slate-700">
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
        <button
          onClick={doAdd}
          disabled={add.isPending || !newDay}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          Kapat
        </button>
      </div>

      {/* Yaklaşan kapalı günler */}
      {isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/50" />
          ))}
        </div>
      ) : days.length === 0 ? (
        <p className="px-6 py-6 text-center text-sm text-slate-400 dark:text-slate-500">
          Yaklaşan kapalı gün yok — teslimat her gün açık.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-700/60">
          {days.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-3">
              <span className="w-52 shrink-0 text-sm font-medium text-slate-900 dark:text-white">
                {CLOSED_DAY_FMT.format(new Date(`${d.day}T00:00:00`))}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-slate-400">
                {d.label ?? (d.source === "holiday" ? "Resmî tatil" : "Kapalı")}
              </span>
              <button
                onClick={() => remove.mutate(d.id)}
                disabled={remove.isPending}
                title="Bu günü yeniden aç"
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─── Ana bileşen ────────────────────────────────────── */

export default function AdminDelivery() {
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [vehicle, setVehicle] = useState<DeliveryVehicle>("LADA");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: runs = [], isLoading } = useDeliveryRuns(date);
  const { data: eligibleAll = [] } = useEligibleOrders();
  const createRun = useCreateDeliveryRun();
  const dispatchDay = useDispatchDay();

  const dispatchable = eligibleAll.filter((o) => o.lat != null && o.lng != null).length;

  const doDispatch = () => {
    dispatchDay.mutate(date, {
      onSuccess: (createdRuns) => {
        setDispatchOpen(false);
        if (createdRuns[0]) setSelectedId(createdRuns[0].id);
        toast.success(
          createdRuns.length > 1
            ? `Gün ${createdRuns.length} araca bölüştürüldü.`
            : "Günün turu kuruldu ve optimize edildi."
        );
      },
      onError: (e: any) =>
        toast.error(e?.response?.data?.detail ?? "Dispatch başarısız."),
    });
  };

  const selected = useMemo(
    () => runs.find((r) => r.id === selectedId) ?? runs[0] ?? null,
    [runs, selectedId]
  );

  const create = () =>
    createRun.mutate(
      { run_date: date, vehicle },
      {
        onSuccess: (r) => {
          setSelectedId(r.id);
          toast.success("Tur oluşturuldu.");
        },
        onError: (e: any) =>
          toast.error(e?.response?.data?.detail ?? "Tur oluşturulamadı."),
      }
    );

  return (
    <>
    <AttentionQueue />
    <PrepStation />
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      {/* Başlık şeridi */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-700">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Dağıtım Turları
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Kendi filo teslimatı — turu planla, etiketleri bas, sahaya çık.
          </p>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setSelectedId(null);
          }}
          aria-label="Tur tarihi"
          className="input w-auto"
        />
        <select
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value as DeliveryVehicle)}
          aria-label="Araç"
          className="input w-auto"
        >
          <option value="LADA">{VEHICLE_LABEL.LADA}</option>
          <option value="COROLLA">{VEHICLE_LABEL.COROLLA}</option>
        </select>
        <button
          onClick={create}
          disabled={createRun.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-700/60"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Tur Oluştur
        </button>
        <button
          onClick={() => setDispatchOpen(true)}
          disabled={dispatchDay.isPending || dispatchable === 0}
          title={
            dispatchable === 0
              ? "Dağıtılacak konumlu sipariş yok"
              : `${dispatchable} sipariş araçlara bölüştürülür`
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {dispatchDay.isPending ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 animate-spin">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          )}
          Günü Optimize Et
          {dispatchable > 0 && (
            <span className="rounded-full bg-white/20 px-1.5 text-xs">{dispatchable}</span>
          )}
        </button>
      </div>

      {/* Kapasite şeridi — 14 günlük söz doluluğu + söz borcu */}
      <CapacityStrip />

      {/* Birden çok tur → seçici şerit */}
      {runs.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-6 py-3 dark:border-slate-700">
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                selected?.id === r.id
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-600 dark:hover:bg-slate-700/60"
              }`}
            >
              Tur #{r.id} · {(VEHICLE_LABEL[r.vehicle] ?? r.vehicle).split(" ")[0]}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3 px-6 py-6">
          <div className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700/50" />
          <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700/50" />
        </div>
      ) : selected == null ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-700/60 dark:text-slate-400">
            <TruckIcon className="h-7 w-7" />
          </div>
          <p className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">
            Bu tarihte tur yok
          </p>
          <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
            Ödenmiş fiziksel siparişleri dağıtmak için yukarıdan aracı seçip yeni bir
            tur oluşturun.
          </p>
        </div>
      ) : (
        <RunDetail run={selected} />
      )}
      </section>
      <OutsourcedQueue />
      <KpiPanel />
      <CalendarManager />
      <CourierManager />
      <ConfirmDialog
        open={dispatchOpen}
        title="Günü optimize et"
        description={`${dispatchable} konumlu sipariş ${dispatchable > 12 ? "Lada ve Corolla" : "Lada"} araçlarına bölüştürülüp optimize turlar kurulacak.`}
        confirmLabel="Turları kur"
        isPending={dispatchDay.isPending}
        onClose={() => setDispatchOpen(false)}
        onConfirm={doDispatch}
      />
    </>
  );
}
