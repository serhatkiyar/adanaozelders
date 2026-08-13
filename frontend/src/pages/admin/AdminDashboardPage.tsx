import { Link, useSearchParams } from "react-router-dom";
import { Badge, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { useAdminDashboard, useAdminRevenue } from "@/hooks/useAdmin";
import { useStoreConfig } from "@/hooks/useStore";
import { formatTRY, parseMoney } from "@/lib/money";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import type { AdminRevenueOut } from "@/types";

type Range = "day" | "week" | "month";
const RANGES: { value: Range; label: string; period: string }[] = [
  { value: "day", label: "24 saat", period: "önceki 24 saate göre" },
  { value: "week", label: "7 gün", period: "önceki 7 güne göre" },
  { value: "month", label: "30 gün", period: "önceki 30 güne göre" },
];

function Change({ current, previous }: { current: number; previous: number }) {
  const delta = current - previous;
  return (
    <span className={`text-xs font-semibold ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-slate-400"}`}>
      {delta > 0 ? "+" : ""}{delta} dönem farkı
    </span>
  );
}

function MetricCard({ label, value, previous, description }: { label: string; value: number; previous: number; description: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">{value}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Change current={value} previous={previous} />
        <span className="text-xs text-slate-400">{description}</span>
      </div>
    </article>
  );
}

interface QueueCardProps {
  label: string;
  value: number;
  to: string;
  tone?: "warning" | "danger" | "info" | "neutral";
  description: string;
}

function QueueCard({ label, value, to, tone = "neutral", description }: QueueCardProps) {
  return (
    <Link to={to} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700">
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-semibold text-slate-900 dark:text-white">{label}</p><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p></div>
        <Badge tone={tone}>{value}</Badge>
      </div>
      <p className="mt-3 text-xs font-semibold text-indigo-600 group-hover:text-indigo-700 dark:text-indigo-400">Kuyruğu aç →</p>
    </Link>
  );
}

export default function AdminDashboardPage() {
  const [params, setParams] = useSearchParams();
  const rawRange = params.get("range");
  const range: Range = rawRange === "day" || rawRange === "month" ? rawRange : "week";
  const query = useAdminDashboard(range);
  const revenue = useAdminRevenue(range);
  // Eşik SUNUCUDAN okunur; kart metnine sabit "5" yazmak, değeri üç yerde
  // gömülü tutan eski kusuru geri getirirdi (tek kaynak: core/stock_policy).
  const storeConfig = useStoreConfig();
  const lowStockThreshold = storeConfig.data?.low_stock_threshold;
  const selected = RANGES.find((item) => item.value === range)!;

  if (query.isLoading) return <PageSkeleton rows={6} />;
  if (query.isError || !query.data) {
    return <ErrorState description={getErrorMessage(query.error, "Yönetim özeti yüklenemedi.")} onRetry={() => query.refetch()} />;
  }
  const data = query.data;

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-12">
      <section aria-labelledby="period-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="period-title" className="text-lg font-bold text-slate-950 dark:text-white">Dönem hareketi</h2><p className="text-sm text-slate-500">Yeni hesap ve sipariş oluşumu; {selected.period}.</p></div>
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            {RANGES.map((item) => (
              <button key={item.value} type="button" onClick={() => setParams(item.value === "week" ? {} : { range: item.value })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${range === item.value ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"}`}>{item.label}</button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Yeni öğrenciler" value={data.new_clients} previous={data.previous_new_clients} description="hesap" />
          <MetricCard label="Yeni eğitmenler" value={data.new_tutors} previous={data.previous_new_tutors} description="başvuru" />
          <MetricCard label="Yeni siparişler" value={data.new_orders} previous={data.previous_new_orders} description="sipariş" />
        </div>
      </section>

      {revenue.data && <MoneySection data={revenue.data} periodLabel={selected.period} />}

      <section aria-labelledby="queue-title">
        <div className="mb-4"><h2 id="queue-title" className="text-lg font-bold text-slate-950 dark:text-white">Operasyon kuyrukları</h2><p className="text-sm text-slate-500">Karar veya takip bekleyen gerçek zamanlı iş yükü.</p></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QueueCard label="Eğitmen başvuruları" value={data.pending_tutors} to={ROUTES.adminTutors} tone="warning" description="Onay veya ret kararı bekliyor." />
          <QueueCard label="Diploma doğrulamaları" value={data.pending_diplomas} to={ROUTES.adminDiplomas} tone="warning" description="Belge teyidi bekleyen eğitim kayıtları." />
          <QueueCard label="Açık şikâyetler" value={data.open_reports} to={ROUTES.adminReports} tone="danger" description="Moderasyon kararı bekleyen bildirimler." />
          <QueueCard label="İhtilaflı rezervasyonlar" value={data.disputed_bookings} to={ROUTES.adminBookings} tone="danger" description={`${data.active_bookings} aktif rezervasyon içinde.`} />
          <QueueCard label="Açık öğrenci talepleri" value={data.open_demands} to={ROUTES.adminDemands} tone="info" description="Eğitmenlerden yanıt bekleyen ders ilanları." />
          {/* Kart, işin YAPILDIĞI ekrana gider: ödenmiş sipariş hazırlanmak
              üzere paketleme kuyruğuna düşer; sipariş listesi bir kayıt
              görünümüdür, kuyruk değil. */}
          <QueueCard label="Hazırlanacak siparişler" value={data.paid_orders} to={ROUTES.adminPacking} tone="info" description={`${data.pending_returns} açık iade talebi bulunuyor.`} />
          {/* Filtreli hedef: alarm kartının sayısı ile açtığı listenin AYNI
              kümeyi göstermesi gerekir. `kritik` = tükenenler + azalanlar,
              yani sayacın (`stock <= eşik`) tam karşılığı; `azalan` stoğu 0
              olanları dışarıda bırakır ve sayı ile liste ayrışırdı. */}
          <QueueCard label="Düşük stok" value={data.low_stock_products} to={`${ROUTES.adminStoreProducts}?stok=kritik`} tone="warning" description={`Aktif fiziksel ürünlerde stok ${lowStockThreshold ?? "eşiğin"} veya altında.`} />
          <QueueCard label="Kütüphane başvuruları" value={data.pending_libraries} to={ROUTES.adminLibraries} tone="warning" description="Katalog onayı bekleyen işletmeler." />
          <QueueCard label="Aktif dağıtım turları" value={data.active_delivery_runs} to={ROUTES.adminDelivery} tone="info" description="Şu anda sahada olan kendi-filo turları." />
          <QueueCard label="Denetim kayıtları" value={data.period_audit_logs} to={ROUTES.adminAuditLogs} description={`Son ${selected.label} içindeki yönetim işlemleri.`} />
        </div>
      </section>
    </div>
  );
}


/** Para kartı — tutar + önceki döneme göre yüzde değişim.
 *
 *  Sayaç kartlarından ayrı bir bileşen: para farkı adet farkı gibi "+3"
 *  okunmaz, oransal okunur ("%12 arttı"). Önceki dönem sıfırsa yüzde
 *  tanımsızdır; "yeni" denir — %∞ göstermek yanıltıcıdır.
 */
function MoneyCard({
  label,
  value,
  previous,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  previous?: string;
  hint?: string;
  tone?: "neutral" | "positive" | "muted";
}) {
  const current = parseMoney(value) ?? 0;
  const before = previous === undefined ? null : parseMoney(previous) ?? 0;
  const pct =
    before === null || before === 0
      ? null
      : Math.round(((current - before) / before) * 100);

  const valueTone =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "muted"
        ? "text-slate-500 dark:text-slate-400"
        : "text-slate-950 dark:text-white";

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${valueTone}`}>{formatTRY(value)}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {before !== null && (
          <span
            className={`text-xs font-semibold ${
              pct === null
                ? "text-slate-400"
                : pct > 0
                  ? "text-emerald-600"
                  : pct < 0
                    ? "text-rose-600"
                    : "text-slate-400"
            }`}
          >
            {pct === null
              ? before === 0 && current > 0
                ? "yeni"
                : "değişim yok"
              : `${pct > 0 ? "+" : ""}%${pct}`}
          </span>
        )}
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
    </article>
  );
}

function MoneySection({
  data,
  periodLabel,
}: {
  data: AdminRevenueOut;
  periodLabel: string;
}) {
  const refundPct = Math.round(data.refund_rate * 1000) / 10;
  return (
    <section aria-labelledby="money-title">
      <div className="mb-4">
        <h2 id="money-title" className="text-lg font-bold text-slate-950 dark:text-white">
          Para
        </h2>
        <p className="text-sm text-slate-500">
          İşlem hacmi ve platform geliri — {periodLabel}.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MoneyCard
          label="İşlem hacmi (GMV)"
          value={data.gmv}
          previous={data.previous_gmv}
          hint="ders + kütüphane + mağaza"
        />
        <MoneyCard
          label="Platform geliri"
          value={data.revenue}
          previous={data.previous_revenue}
          tone="positive"
          hint="komisyon + kendi satış"
        />
        <MoneyCard
          label="Emanetteki para"
          value={data.held}
          previous={data.previous_held}
          tone="muted"
          hint="henüz gelir değil"
        />
        <MoneyCard
          label="Sepet ortalaması"
          value={data.aov}
          previous={data.previous_aov}
          hint={`${data.orders} sipariş`}
        />
      </div>

      {/* Kırılım: gelirin nereden geldiği ve hacmin nasıl dağıldığı. Tek bir
          GMV rakamı hangi dikeyin çalıştığını göstermez. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <BreakdownRow label="Ders hacmi" value={data.lesson_gmv} />
        <BreakdownRow label="Kütüphane hacmi" value={data.library_gmv} />
        <BreakdownRow label="Mağaza hacmi" value={data.store_gmv} />
        <BreakdownRow label="Komisyon geliri" value={data.commission_revenue} />
        <BreakdownRow
          label="İade"
          value={data.refunded}
          suffix={`hacmin %${refundPct}'i`}
        />
      </div>
    </section>
  );
}

function BreakdownRow({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 font-semibold text-slate-900 dark:text-white">
        {formatTRY(value)}
      </p>
      {suffix && <p className="mt-0.5 text-xs text-slate-400">{suffix}</p>}
    </div>
  );
}
