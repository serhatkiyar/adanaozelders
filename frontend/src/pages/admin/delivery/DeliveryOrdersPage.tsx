// "Siparişler" — sipariş havuzu. Ödenmiş siparişi hazır pakete, hazır paketi
// tura, bölge dışını dış kargoya akıtır. Üç kuyruk URL'de (?kuyruk=):
//   hazirlik  → prep-queue: paketlenecek (SALT OKUNUR — eylem paketleme
//               istasyonundadır: /yonetim/paketleme)
//   hazir     → eligible:   tura eklenebilir ("Tura ekle")
//   dis-kargo → outsourced: bölge dışı ("Kargola" — orders.manage ile yerinde)
//
// F30: elle "Hazırla" / "Tümünü hazırla" / "Geri Al" butonları ve uçları
// KALDIRILDI (boşluk G1). Hazır damgası artık yalnız kalem kalem doğrulanmış
// bir paketten doğar; bu sayfa o işi BAŞLATMAZ, yalnız gösterir ve paketleme
// istasyonuna yönlendirir.
import { ItemLines } from "@/components/admin/delivery/ItemLines";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { PromiseChip, todayIso } from "@/components/admin/delivery/bits";
import { shipOrder } from "@/api/store";
import {
  useAddStops,
  useDeliveryRuns,
  useEligibleOrders,
  useOutsourcedOrders,
  usePrepQueue,
} from "@/hooks/useDelivery";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { DeliveryEligibleOrder } from "@/types";

type Queue = "hazirlik" | "hazir" | "dis-kargo";

const QUEUE_TABS: { value: Queue; label: string }[] = [
  { value: "hazirlik", label: "Paketlenecek" },
  { value: "hazir", label: "Tura hazır" },
  { value: "dis-kargo", label: "Dış kargo" },
];

/* Ortak sipariş satırı — sağdaki aksiyonlar kuyruk türüne göre değişir.
   Aksiyonlar KALICI (hover değil): tablet/dokunmatik kullanım birinci sınıf. */
function OrderRow({
  order,
  children,
}: {
  order: DeliveryEligibleOrder;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1 basis-52">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
          {order.recipient ?? "—"}
          <span className="ml-2 text-xs font-normal text-slate-400">#{order.order_id}</span>
          {order.lat == null && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              konumsuz
            </span>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span className="truncate">{order.address ?? "Adres yok"}</span>
          <PromiseChip date={order.promised_delivery_date} />
        </p>
        {/* Toplama listesi: operatör NE toplayacağını görmeden paket hazırlamaz.
            "N parça" özeti sağda kalır ama bunun yerine geçmez. */}
        <ItemLines items={order.items} className="mt-1.5" />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
        {order.item_count} parça · ₺{order.total}
      </span>
      {children}
    </li>
  );
}

function QueueShell({
  query,
  children,
}: {
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
  children: React.ReactNode;
}) {
  if (query.isError) {
    return (
      <div className="p-6">
        <ErrorState
          description={getErrorMessage(query.error, "Kuyruk yüklenemedi.")}
          onRetry={query.refetch}
        />
      </div>
    );
  }
  if (query.isLoading) {
    return (
      <div className="p-6">
        <PageSkeleton rows={3} />
      </div>
    );
  }
  return <>{children}</>;
}

/* ── Hazırlanacaklar: paketleme istasyonuna giden kuyruk ──
 *
 * F30 commit 5: elle "Hazırla" / "Tümünü hazırla" butonları KALDIRILDI. Uçları
 * (`/delivery/orders/{id}/prepare`, `/unprepare`) backend'den silindi çünkü iki
 * kapı bırakmak "eksik kalem kabul edilmez" ilkesini boşa çıkarıyordu (boşluk
 * G1): tek tıkla, hiçbir kalem okutulmadan sipariş dağıtıma hazır sayılıyordu.
 *
 * Kuyruk GÖRÜNÜR kalır — operatör ne toplanacağını buradan görür — ama hazır
 * etme eylemi paketleme istasyonundadır (paket aç → barkod okut → tamamla):
 * `/yonetim/paketleme`. Bu kuyruk oraya YÖNLENDİRİR, iş yapmaz.
 */
function PrepQueue() {
  const query = usePrepQueue();
  const queue = query.data ?? [];

  return (
    <QueueShell query={query}>
      {queue.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="Paketlenecek sipariş yok"
            description="Yeni fiziksel siparişler ödendikçe burada belirir."
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-3 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Hazırlama paketleme istasyonunda yapılır: paketi aç, her kalemi okut,
              tamamla. Sipariş ancak bütün kalemler doğrulanınca tura hazır olur.
            </p>
            <Link
              to={ROUTES.adminPacking}
              className="shrink-0 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Paketleme istasyonunu aç →
            </Link>
          </div>
          <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
            {queue.map((o) => (
              <OrderRow key={o.order_id} order={o} />
            ))}
          </ul>
        </>
      )}
    </QueueShell>
  );
}

/* ── Tura hazır: eligible siparişler — tura ekle ya da hazırlığı geri al ── */
function ReadyQueue() {
  const { canManage } = useAdminAreaAccess("delivery");
  const query = useEligibleOrders();
  const addStops = useAddStops();
  const runsQuery = useDeliveryRuns(todayIso());
  const eligible = query.data ?? [];

  // Bugünün açık (PLANNED/ACTIVE) turları — "Tura ekle" hedefleri.
  const openRuns = useMemo(
    () => (runsQuery.data ?? []).filter((r) => r.status === "PLANNED" || r.status === "ACTIVE"),
    [runsQuery.data]
  );
  const [targetRun, setTargetRun] = useState<number | null>(null);
  const target: number | null = targetRun ?? openRuns[0]?.id ?? null;

  const addTo = (orderIds: number[]) => {
    if (target == null) return;
    addStops.mutate(
      { runId: target, orderIds },
      {
        onSuccess: () =>
          toast.success(
            orderIds.length > 1
              ? `${orderIds.length} sipariş tura eklendi.`
              : "Sipariş tura eklendi."
          ),
        onError: (e) => toast.error(getErrorMessage(e, "Tura eklenemedi.")),
      }
    );
  };

  return (
    <QueueShell query={query}>
      {eligible.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="Tura hazır sipariş yok"
            description="Paketleme istasyonunda tamamlanan paketler burada belirir."
          />
        </div>
      ) : (
        <>
          {canManage && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-100 px-6 py-3 dark:border-slate-800">
              {openRuns.length > 0 ? (
                <>
                  <label className="text-xs text-slate-500 dark:text-slate-400" htmlFor="target-run">
                    Hedef tur
                  </label>
                  <select
                    id="target-run"
                    value={target ?? ""}
                    onChange={(e) => setTargetRun(Number(e.target.value))}
                    className="input w-auto"
                  >
                    {openRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        Tur #{r.id} · {r.vehicle}
                      </option>
                    ))}
                  </select>
                  {eligible.length > 1 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => addTo(eligible.map((o) => o.order_id))}
                      isPending={addStops.isPending}
                    >
                      Tümünü ekle
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Bugün açık tur yok —{" "}
                  <Link to={ROUTES.adminDelivery} className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                    Bugün sekmesinden
                  </Link>{" "}
                  tur oluştur.
                </p>
              )}
            </div>
          )}
          <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
            {eligible.map((o) => (
              <OrderRow key={o.order_id} order={o}>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => addTo([o.order_id])}
                      disabled={addStops.isPending || target == null}
                      title={target == null ? "Önce bugün için bir tur oluşturun" : undefined}
                    >
                      Tura ekle
                    </Button>
                  </div>
                )}
              </OrderRow>
            ))}
          </ul>
        </>
      )}
    </QueueShell>
  );
}

/* ── Dış kargo: bölge dışı ödenmiş siparişler — Kargola YERİNDE ──
   Aksiyon /store/admin/orders/{id}/ship ucudur (orders.manage izni ayrı);
   izin yoksa buton yerine Mağaza sayfasına yönlendirme gösterilir. */
function OutsourcedQueue() {
  const { canManage: canShip } = useAdminAreaAccess("orders");
  const query = useOutsourcedOrders();
  const qc = useQueryClient();
  const [trackingByOrder, setTrackingByOrder] = useState<Record<number, string>>({});
  const ship = useMutation({
    mutationFn: ({ id, tracking }: { id: number; tracking: string }) => shipOrder(id, tracking),
    onSuccess: (_d, v) => {
      toast.success(`#${v.id} kargolandı.`);
      qc.invalidateQueries({ queryKey: ["delivery"] });
    },
    onError: (e) => toast.error(getErrorMessage(e, "Kargolanamadı.")),
  });
  const orders = query.data ?? [];

  return (
    <QueueShell query={query}>
      {orders.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="Dış kargo bekleyen sipariş yok"
            description="Adana Merkez dışına giden ödenmiş siparişler burada listelenir ve kargo firmasıyla gönderilir."
          />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
          {orders.map((o) => (
            <OrderRow key={o.order_id} order={o}>
              {(o.district || o.city) && (
                <Badge tone="neutral">{[o.district, o.city].filter(Boolean).join(" / ")}</Badge>
              )}
              {canShip ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <input
                    value={trackingByOrder[o.order_id] ?? ""}
                    onChange={(e) =>
                      setTrackingByOrder((s) => ({ ...s, [o.order_id]: e.target.value }))
                    }
                    placeholder="Takip no"
                    aria-label={`#${o.order_id} kargo takip numarası`}
                    className="input w-32 py-1.5 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      ship.mutate({ id: o.order_id, tracking: trackingByOrder[o.order_id] ?? "" })
                    }
                    disabled={!(trackingByOrder[o.order_id] ?? "").trim()}
                    isPending={ship.isPending && ship.variables?.id === o.order_id}
                  >
                    Kargola
                  </Button>
                </div>
              ) : (
                <Link
                  to={ROUTES.adminStoreOrders}
                  className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Mağaza siparişlerinde aç →
                </Link>
              )}
            </OrderRow>
          ))}
        </ul>
      )}
    </QueueShell>
  );
}

export default function DeliveryOrdersPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("kuyruk");
  const queue: Queue = raw === "hazir" || raw === "dis-kargo" ? raw : "hazirlik";
  const setQueue = (q: Queue) =>
    setParams(q === "hazirlik" ? {} : { kuyruk: q }, { replace: true });

  // Sekme rozetleri: sayılar operatörün "nerede iş var" sorusuna cevap.
  const prep = usePrepQueue();
  const ready = useEligibleOrders();
  const outsourced = useOutsourcedOrders();
  const counts: Record<Queue, number | undefined> = {
    hazirlik: prep.data?.length,
    hazir: ready.data?.length,
    "dis-kargo": outsourced.data?.length,
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Sipariş Havuzu</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Ödenmiş sipariş → paket hazırla → tura ekle; bölge dışı → dış kargo.
          </p>
        </div>
        <div role="group" aria-label="Sipariş kuyrukları" className="flex flex-wrap gap-1.5">
          {QUEUE_TABS.map((t) => (
            <button
              key={t.value}
              aria-pressed={queue === t.value}
              onClick={() => setQueue(t.value)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                queue === t.value
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
              }`}
            >
              {t.label}
              {counts[t.value] != null && counts[t.value]! > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                    queue === t.value
                      ? "bg-white/20 dark:bg-slate-900/10"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {counts[t.value]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {queue === "hazirlik" ? <PrepQueue /> : queue === "hazir" ? <ReadyQueue /> : <OutsourcedQueue />}
    </section>
  );
}
