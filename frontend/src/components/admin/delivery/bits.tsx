// Dağıtım panelinin küçük ortak görsel parçaları — Bugün / Havuz / Tur detayı
// sayfaları paylaşır. Renk disiplini: renk yalnız durum/istisna anlatır,
// dekorasyon değil (bkz. tasarım notu: "renk yalnız aksiyon/istisna").
import { promisedDateLabel } from "@/lib/deliveryPromise";
import { RUN_STATUS_LABEL, STOP_STATUS_LABEL } from "@/lib/deliveryRun";
import type { DeliveryStop } from "@/types";

export function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD (yerel gün)
}

export function TruckIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
    </svg>
  );
}

const RUN_CHIP: Record<string, { dot: string; text: string; bg: string }> = {
  PLANNED: { dot: "bg-slate-400", text: "text-slate-600 ", bg: "bg-slate-100 " },
  ACTIVE: { dot: "bg-panel-accent animate-pulse", text: "text-panel-accent", bg: "bg-panel-accent-soft" },
  DONE: { dot: "bg-emerald-500", text: "text-emerald-700 ", bg: "bg-emerald-50 " },
  CANCELLED: { dot: "bg-rose-500", text: "text-rose-700 ", bg: "bg-rose-50 " },
};

export function RunStatusChip({ status }: { status: string }) {
  const c = RUN_CHIP[status] ?? RUN_CHIP.PLANNED;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {RUN_STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Söz verilen teslim günü chip'i — bugün=vurgulu, geçmiş=amber (söz riskte). */
export function PromiseChip({ date }: { date?: string | null }) {
  const label = promisedDateLabel(date);
  if (!label) return null;
  const overdue =
    !!date && new Date(`${date}T23:59:59`).getTime() < Date.now() && label !== "bugün";
  const tone = overdue
    ? "bg-amber-50 text-amber-700 "
    : label === "bugün"
      ? "bg-emerald-50 text-emerald-700 "
      : "bg-slate-100 text-slate-500 ";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      Söz: {overdue ? `${label} (gecikti)` : label}
    </span>
  );
}

/** Durak sıra rozeti — durumuna göre renklenir (rota noktası hissi).
 * RESCHEDULED (müşteri erteledi) ve CANCELLED (sipariş iptal) artık ayırt
 * edilir: erteleme amber (aksiyon: yarın yeniden), iptal soluk (arşiv). */
export function SeqBadge({ stop }: { stop: DeliveryStop }) {
  const tone =
    stop.status === "DELIVERED"
      ? "bg-emerald-50 text-emerald-600 ring-emerald-200 "
      : stop.status === "FAILED"
        ? "bg-rose-50 text-rose-600 ring-rose-200 "
        : stop.status === "RESCHEDULED"
          ? "bg-amber-50 text-amber-600 ring-amber-200 "
          : stop.status === "CANCELLED"
            ? "bg-slate-50 text-slate-400 ring-slate-100 "
            : "bg-white text-slate-500 ring-slate-200 ";
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

/** Durak durum metni rengi (satır sonu etiketi). */
export function stopStatusText(stop: DeliveryStop): { label: string; cls: string } {
  const cls =
    stop.status === "DELIVERED"
      ? "text-emerald-600 "
      : stop.status === "FAILED"
        ? "text-rose-600 "
        : stop.status === "RESCHEDULED"
          ? "text-amber-600 "
          : "text-slate-400 ";
  return {
    label: `${STOP_STATUS_LABEL[stop.status] ?? stop.status}${stop.proof === "ADMIN" ? " · notlu" : ""}`,
    cls,
  };
}

/** Müşteri teslimat tercihi rozeti — kurye talimatı admin/etiket yüzeyinde de
 * görünür olmalı (yalnız sahada görünüyordu). ADRESIMDEYIM varsayılandır,
 * rozet basılmaz (gürültü olmasın). */
const PREF_BADGE: Record<string, string> = {
  KAPIYA_BIRAK: "Kapıya bırak",
  KOMSUYA_BIRAK: "Komşuya bırak",
  BENI_ARA: "Beni ara",
};

export function DeliveryPrefBadge({
  pref,
  note,
}: {
  pref?: string | null;
  note?: string | null;
}) {
  if (!pref || !(pref in PREF_BADGE)) return null;
  return (
    <span
      title={note ?? undefined}
      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 "
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
      </svg>
      {PREF_BADGE[pref]}
    </span>
  );
}
