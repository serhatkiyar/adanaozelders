import { Link, useSearchParams } from "react-router-dom";
import { AccessDenied } from "@/components/admin/AccessState";
import { Badge, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { useAdminDashboard, useAdminRevenue } from "@/hooks/useAdmin";
import { useStoreConfig } from "@/hooks/useStore";
import { adminAreaAccess } from "@/lib/adminAccess";
import { formatTRY, parseMoney } from "@/lib/money";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
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
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-950 ">{value}</p>
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
    <Link to={to} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-panel-accent/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus ">
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-semibold text-slate-900 ">{label}</p><p className="mt-1 text-xs leading-5 text-slate-500 ">{description}</p></div>
        <Badge tone={tone}>{value}</Badge>
      </div>
      <p className="mt-3 text-xs font-semibold text-panel-accent-text group-hover:opacity-80">Kuyruğu aç →</p>
    </Link>
  );
}

export default function AdminDashboardPage() {
  const [params, setParams] = useSearchParams();
  const rawRange = params.get("range");
  const range: Range = rawRange === "day" || rawRange === "month" ? rawRange : "week";
  // Uçlar tam kod ister (`api/routers/admin.py`): özet `dashboard.view`,
  // para bölümü `payments.view`. İzin yoksa sorgu HİÇ çalışmaz; eskiden
  // özet 403'ü "yüklenemedi, tekrar dene" olarak görünüyordu.
  const permissions = useAuthStore((state) => state.user?.admin_permissions);
  const gorur = (alan: string) => adminAreaAccess(permissions, alan).canView;
  const canView = gorur("dashboard");
  const query = useAdminDashboard(range, canView);
  const revenue = useAdminRevenue(range, gorur("payments"));
  // Eşik SUNUCUDAN okunur; kart metnine sabit "5" yazmak, değeri üç yerde
  // gömülü tutan eski kusuru geri getirirdi (tek kaynak: core/stock_policy).
  const storeConfig = useStoreConfig();
  const lowStockThreshold = storeConfig.data?.low_stock_threshold;
  const selected = RANGES.find((item) => item.value === range)!;

  if (!canView) return <AccessDenied area="Genel Bakış" />;
  if (query.isLoading) return <PageSkeleton rows={6} />;
  if (query.isError || !query.data) {
    return <ErrorState description={getErrorMessage(query.error, "Yönetim özeti yüklenemedi.")} onRetry={() => query.refetch()} />;
  }
  const data = query.data;

  // Her kart, hedef ekranın alanına bağlı (menüdeki `requiredPermission`
  // ile aynı alan): izni olmayan yönetici kartı görmez, 403 ekranına düşmez.
  const tumKuyruklar: (QueueCardProps & { alan: string })[] = [
    { alan: "tutors", label: "Öğretmen başvuruları", value: data.pending_tutors, to: ROUTES.adminTutors, tone: "warning", description: "Onay veya ret kararı bekliyor." },
    { alan: "tutors", label: "Diploma doğrulamaları", value: data.pending_diplomas, to: ROUTES.adminDiplomas, tone: "warning", description: "Belge teyidi bekleyen eğitim kayıtları." },
    { alan: "reports", label: "Açık şikâyetler", value: data.open_reports, to: ROUTES.adminReports, tone: "danger", description: "Moderasyon kararı bekleyen bildirimler." },
    { alan: "bookings", label: "İhtilaflı rezervasyonlar", value: data.disputed_bookings, to: ROUTES.adminBookings, tone: "danger", description: `${data.active_bookings} aktif rezervasyon içinde.` },
    { alan: "demands", label: "Açık öğrenci talepleri", value: data.open_demands, to: ROUTES.adminDemands, tone: "info", description: "Öğretmenlerden yanıt bekleyen ders ilanları." },
    // Kart, işin YAPILDIĞI ekrana gider: ödenmiş sipariş hazırlanmak üzere
    // paketleme kuyruğuna düşer; sipariş listesi bir kayıt görünümüdür, kuyruk değil.
    { alan: "packing", label: "Hazırlanacak siparişler", value: data.paid_orders, to: ROUTES.adminPacking, tone: "info", description: `${data.pending_returns} açık iade talebi bulunuyor.` },
    // Filtreli hedef: alarm kartının sayısı ile açtığı listenin AYNI kümeyi
    // göstermesi gerekir. `kritik` = tükenenler + azalanlar, yani sayacın
    // (`stock <= eşik`) tam karşılığı; `azalan` stoğu 0 olanları dışarıda
    // bırakır ve sayı ile liste ayrışırdı.
    { alan: "products", label: "Düşük stok", value: data.low_stock_products, to: `${ROUTES.adminStoreProducts}?stok=kritik`, tone: "warning", description: `Aktif fiziksel ürünlerde stok ${lowStockThreshold ?? "eşiğin"} veya altında.` },
    { alan: "libraries", label: "Kütüphane başvuruları", value: data.pending_libraries, to: ROUTES.adminLibraries, tone: "warning", description: "Katalog onayı bekleyen işletmeler." },
    { alan: "delivery", label: "Aktif dağıtım turları", value: data.active_delivery_runs, to: ROUTES.adminDelivery, tone: "info", description: "Şu anda sahada olan kendi-filo turları." },
    { alan: "audit", label: "Denetim kayıtları", value: data.period_audit_logs, to: ROUTES.adminAuditLogs, description: `Son ${selected.label} içindeki yönetim işlemleri.` },
  ];
  const kuyruklar = tumKuyruklar.filter((kart) => gorur(kart.alan));

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-12">
      <section aria-labelledby="period-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="period-title" className="text-lg font-bold text-slate-950 ">Dönem hareketi</h2><p className="text-sm text-slate-500">Yeni hesap ve sipariş oluşumu; {selected.period}.</p></div>
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 ">
            {RANGES.map((item) => (
              <button key={item.value} type="button" onClick={() => setParams(item.value === "week" ? {} : { range: item.value })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus ${range === item.value ? "bg-panel-accent text-panel-accent-fg" : "text-slate-500 hover:bg-slate-100 "}`}>{item.label}</button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Yeni öğrenciler" value={data.new_clients} previous={data.previous_new_clients} description="hesap" />
          <MetricCard label="Yeni öğretmenler" value={data.new_tutors} previous={data.previous_new_tutors} description="başvuru" />
          <MetricCard label="Yeni siparişler" value={data.new_orders} previous={data.previous_new_orders} description="sipariş" />
        </div>
      </section>

      {revenue.data && <MoneySection data={revenue.data} periodLabel={selected.period} />}

      {kuyruklar.length > 0 && (
        <section aria-labelledby="queue-title">
          <div className="mb-4"><h2 id="queue-title" className="text-lg font-bold text-slate-950 ">Operasyon kuyrukları</h2><p className="text-sm text-slate-500">Karar veya takip bekleyen gerçek zamanlı iş yükü.</p></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {kuyruklar.map((kart) => <QueueCard key={kart.label} {...kart} />)}
          </div>
        </section>
      )}
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
      ? "text-emerald-600 "
      : tone === "muted"
        ? "text-slate-500 "
        : "text-slate-950 ";

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ">
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
        <h2 id="money-title" className="text-lg font-bold text-slate-950 ">
          Para
        </h2>
        <p className="text-sm text-slate-500">
          İşlem hacmi ve platform geliri: {periodLabel}.
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
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 ">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 font-semibold text-slate-900 ">
        {formatTRY(value)}
      </p>
      {suffix && <p className="mt-0.5 text-xs text-slate-400">{suffix}</p>}
    </div>
  );
}
