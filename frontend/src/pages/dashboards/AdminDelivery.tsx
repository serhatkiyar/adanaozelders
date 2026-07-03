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

const RUN_STATUS_TONE: Record<string, string> = {
  PLANNED: "text-slate-600 dark:text-slate-300",
  ACTIVE: "text-indigo-600 dark:text-indigo-400",
  DONE: "text-emerald-600 dark:text-emerald-400",
  CANCELLED: "text-rose-600 dark:text-rose-400",
};

const STOP_STATUS_TONE: Record<string, string> = {
  PENDING: "text-slate-500 dark:text-slate-400",
  DELIVERED: "text-emerald-600 dark:text-emerald-400",
  FAILED: "text-rose-600 dark:text-rose-400",
};

/* ─── Etiket sayfası (yazdırma) ──────────────────────────
   Portal body'ye açılır (#root dışına) — @media print'te yalnız bu kalır. */

function LabelSheet({ run, onClose }: { run: DeliveryRun; onClose: () => void }) {
  return createPortal(
    <div className="delivery-label-sheet fixed inset-0 z-[100] overflow-auto bg-white text-slate-900">
      <style>{`@media print { body > #root { display: none !important; } .delivery-label-sheet { position: static !important; inset: auto !important; } .delivery-label-noprint { display: none !important; } }`}</style>
      <div className="delivery-label-noprint sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <p className="text-sm font-semibold">
          Tur #{run.id} — {run.stops.length} etiket
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white"
          >
            Yazdır
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
          >
            Kapat
          </button>
        </div>
      </div>
      <div className="mx-auto grid max-w-3xl grid-cols-2 gap-4 p-6">
        {run.stops.map((s) => (
          <div
            key={s.id}
            className="flex gap-3 break-inside-avoid rounded border border-slate-300 p-3"
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
}: {
  stop: DeliveryStop;
  run: DeliveryRun;
  onMove: (stopId: number, dir: -1 | 1) => void;
}) {
  const removeStop = useRemoveStop();
  const editable = run.status === "PLANNED" || run.status === "ACTIVE";
  const pending = stop.status === "PENDING";

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="w-7 text-right text-sm font-semibold tabular-nums text-slate-400">
        {stop.sequence}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
          {stop.recipient ?? "—"}
          <span className="ml-2 font-normal text-slate-400">#{stop.order_id}</span>
          {stop.lat == null && (
            <span className="ml-2 text-xs font-medium text-amber-600 dark:text-amber-400">
              konumsuz
            </span>
          )}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {stop.address ?? "Adres yok"}
        </p>
      </div>
      <span className={`text-xs font-medium ${STOP_STATUS_TONE[stop.status]}`}>
        {STOP_STATUS_LABEL[stop.status]}
        {stop.proof === "ADMIN" && " (notlu)"}
      </span>
      {editable && pending && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMove(stop.id, -1)}
            title="Yukarı taşı"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            ↑
          </button>
          <button
            onClick={() => onMove(stop.id, 1)}
            title="Aşağı taşı"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            ↓
          </button>
          <button
            onClick={() =>
              removeStop.mutate(stop.id, {
                onSuccess: () => toast.success("Durak çıkarıldı."),
              })
            }
            title="Turdan çıkar"
            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
          >
            ✕
          </button>
        </div>
      )}
    </li>
  );
}

/* ─── Tur detayı ─────────────────────────────────────── */

function RunDetail({ run }: { run: DeliveryRun }) {
  const [showLabels, setShowLabels] = useState(false);
  const runAction = useRunAction();
  const reorder = useReorderStops();
  const addStops = useAddStops();
  const { data: eligible = [], isLoading: eligibleLoading } = useEligibleOrders(
    run.status === "PLANNED" || run.status === "ACTIVE"
  );
  const [done, total] = runProgress(run);

  const move = (stopId: number, dir: -1 | 1) => {
    const ids = [...run.stops]
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => s.id);
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
        onError: (e: any) =>
          toast.error(e?.response?.data?.detail ?? "İşlem başarısız."),
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Başlık + aksiyonlar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            Tur #{run.id} · {VEHICLE_LABEL[run.vehicle] ?? run.vehicle}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <span className={`font-medium ${RUN_STATUS_TONE[run.status]}`}>
              {RUN_STATUS_LABEL[run.status]}
            </span>
            {" · "}
            {done}/{total} durak sonuçlandı
          </p>
        </div>
        {run.stops.length > 0 && run.status !== "CANCELLED" && (
          <button
            onClick={() => setShowLabels(true)}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-700"
          >
            Etiketleri Yazdır
          </button>
        )}
        {run.status === "ACTIVE" && (
          <Link
            to={ROUTES.deliveryRun(run.id)}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50 dark:text-indigo-400 dark:ring-indigo-500/40 dark:hover:bg-indigo-500/10"
          >
            Saha Ekranı →
          </Link>
        )}
        {run.status === "PLANNED" && (
          <button
            onClick={() => act("start")}
            disabled={runAction.isPending || run.stops.length === 0}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Turu Başlat
          </button>
        )}
        {run.status === "ACTIVE" && (
          <button
            onClick={() => act("complete")}
            disabled={runAction.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Turu Tamamla
          </button>
        )}
        {(run.status === "PLANNED" || run.status === "ACTIVE") && (
          <button
            onClick={() =>
              act(
                "cancel",
                "Tur iptal edilsin mi? Bekleyen duraklar 'teslim edilemedi' sayılır ve siparişler yeniden planlanabilir."
              )
            }
            disabled={runAction.isPending}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 dark:ring-rose-500/40 dark:hover:bg-rose-500/10"
          >
            İptal
          </button>
        )}
      </div>

      {/* Duraklar */}
      {run.stops.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Henüz durak yok — aşağıdan sipariş ekleyin.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {[...run.stops]
            .sort((a, b) => a.sequence - b.sequence)
            .map((s) => (
              <StopRow key={s.id} stop={s} run={run} onMove={move} />
            ))}
        </ul>
      )}

      {/* Eklenebilecek siparişler */}
      {(run.status === "PLANNED" || run.status === "ACTIVE") && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Dağıtıma hazır siparişler
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
                Tümünü ekle ({eligible.length})
              </button>
            )}
          </div>
          {eligibleLoading ? (
            <p className="py-4 text-sm text-slate-400">Yükleniyor…</p>
          ) : eligible.length === 0 ? (
            <p className="py-4 text-sm text-slate-500 dark:text-slate-400">
              Bekleyen fiziksel sipariş yok.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {eligible.map((o) => (
                <li key={o.order_id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                      {o.recipient ?? "—"}
                      <span className="ml-2 font-normal text-slate-400">
                        #{o.order_id}
                      </span>
                      {o.lat == null && (
                        <span className="ml-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                          konumsuz
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {o.item_count} parça · ₺{o.total} · {o.address ?? "Adres yok"}
                    </p>
                  </div>
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
                    className="rounded-lg px-3 py-1 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50 dark:text-indigo-400 dark:ring-indigo-500/40 dark:hover:bg-indigo-500/10"
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

  return (
    <section className="space-y-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
      {/* Üst çubuk: tarih + tur oluştur */}
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 pb-4 dark:border-slate-700">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Tarih
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSelectedId(null);
            }}
            className="input"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Araç
          </label>
          <select
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value as DeliveryVehicle)}
            className="input"
          >
            <option value="LADA">{VEHICLE_LABEL.LADA}</option>
            <option value="COROLLA">{VEHICLE_LABEL.COROLLA}</option>
          </select>
        </div>
        <button
          onClick={() =>
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
            )
          }
          disabled={createRun.isPending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Tur Oluştur
        </button>
        {runs.length > 1 && (
          <div className="ml-auto flex gap-1.5">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  selected?.id === r.id
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "text-slate-600 ring-1 ring-slate-200 dark:text-slate-300 dark:ring-slate-600"
                }`}
              >
                #{r.id} {VEHICLE_LABEL[r.vehicle]?.split(" ")[0] ?? r.vehicle}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-slate-400">Yükleniyor…</p>
      ) : selected == null ? (
        <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
          Bu tarihte tur yok — yukarıdan oluşturun.
        </p>
      ) : (
        <RunDetail run={selected} />
      )}
    </section>
  );
}
