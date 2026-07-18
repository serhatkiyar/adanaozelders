import { Link, useSearchParams } from "react-router-dom";
import { Badge, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { useAdminDashboard } from "@/hooks/useAdmin";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";

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

      <section aria-labelledby="queue-title">
        <div className="mb-4"><h2 id="queue-title" className="text-lg font-bold text-slate-950 dark:text-white">Operasyon kuyrukları</h2><p className="text-sm text-slate-500">Karar veya takip bekleyen gerçek zamanlı iş yükü.</p></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QueueCard label="Eğitmen başvuruları" value={data.pending_tutors} to={ROUTES.adminTutors} tone="warning" description="Onay veya ret kararı bekliyor." />
          <QueueCard label="Diploma doğrulamaları" value={data.pending_diplomas} to={ROUTES.adminDiplomas} tone="warning" description="Belge teyidi bekleyen eğitim kayıtları." />
          <QueueCard label="Açık şikâyetler" value={data.open_reports} to={ROUTES.adminReports} tone="danger" description="Moderasyon kararı bekleyen bildirimler." />
          <QueueCard label="İhtilaflı rezervasyonlar" value={data.disputed_bookings} to={ROUTES.adminBookings} tone="danger" description={`${data.active_bookings} aktif rezervasyon içinde.`} />
          <QueueCard label="Açık öğrenci talepleri" value={data.open_demands} to={ROUTES.adminDemands} tone="info" description="Eğitmenlerden yanıt bekleyen ders ilanları." />
          <QueueCard label="Hazırlanacak siparişler" value={data.paid_orders} to={ROUTES.adminStoreOrders} tone="info" description={`${data.pending_returns} açık iade talebi bulunuyor.`} />
          <QueueCard label="Düşük stok" value={data.low_stock_products} to={ROUTES.adminStoreProducts} tone="warning" description="Aktif fiziksel ürünlerde stok 5 veya altında." />
          <QueueCard label="Kütüphane başvuruları" value={data.pending_libraries} to={ROUTES.adminLibraries} tone="warning" description="Katalog onayı bekleyen işletmeler." />
          <QueueCard label="Aktif dağıtım turları" value={data.active_delivery_runs} to={ROUTES.adminDelivery} tone="info" description="Şu anda sahada olan kendi-filo turları." />
          <QueueCard label="Denetim kayıtları" value={data.period_audit_logs} to={ROUTES.adminAuditLogs} description={`Son ${selected.label} içindeki yönetim işlemleri.`} />
        </div>
      </section>
    </div>
  );
}
