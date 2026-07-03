// Dağıtım planlama paneli (ADMIN) — kendi-filo kitap teslimatı (Faz A).
// Günlük tur kur → ödenmiş fiziksel siparişleri durak olarak ekle → sırala →
// QR etiketleri yazdır → turu başlat. Saha akışı DeliveryDriver ekranındadır.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";

import {
  useAddStops,
  useCreateDeliveryRun,
  useDeliveryRuns,
  useEligibleOrders,
  useRemoveStop,
  useReorderStops,
  useRunAction,
} from "@/hooks/useDelivery";
import {
  RUN_STATUS_LABEL,
  STOP_STATUS_LABEL,
  VEHICLE_LABEL,
  runProgress,
} from "@/lib/deliveryRun";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { DeliveryRun, DeliveryStop, DeliveryVehicle } from "@/types";

function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD (yerel gün)
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

function RunDetail({ run }: { run: DeliveryRun }) {
  const [showLabels, setShowLabels] = useState(false);
  const runAction = useRunAction();
  const reorder = useReorderStops();
  const addStops = useAddStops();
  const planning = run.status === "PLANNED" || run.status === "ACTIVE";
  const { data: eligible = [], isLoading: eligibleLoading } = useEligibleOrders(planning);
  const [done, total] = runProgress(run);
  const sorted = useMemo(
    () => [...run.stops].sort((a, b) => a.sequence - b.sequence),
    [run.stops]
  );

  const move = (stopId: number, dir: -1 | 1) => {
    const ids = sorted.map((s) => s.id);
    const i = ids.indexOf(stopId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate({ runId: run.id, stopIds: ids });
  };

  const act = (action: "start" | "complete" | "cancel", confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    runAction.mutate(
      { runId: run.id, action },
      {
        onSuccess: () =>
          toast.success(
            action === "start"
              ? "Tur başlatıldı — siparişler 'dağıtımda' olarak işaretlendi."
              : action === "complete"
                ? "Tur tamamlandı."
                : "Tur iptal edildi."
          ),
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
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
              onClick={() =>
                act(
                  "cancel",
                  "Tur iptal edilsin mi? Bekleyen duraklar 'teslim edilemedi' sayılır ve siparişler yeniden planlanabilir."
                )
              }
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
    </div>
  );
}

/* ─── Ana bileşen ────────────────────────────────────── */

export default function AdminDelivery() {
  const [date, setDate] = useState(todayIso());
  const [vehicle, setVehicle] = useState<DeliveryVehicle>("LADA");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: runs = [], isLoading } = useDeliveryRuns(date);
  const createRun = useCreateDeliveryRun();

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
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Tur Oluştur
        </button>
      </div>

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
  );
}
