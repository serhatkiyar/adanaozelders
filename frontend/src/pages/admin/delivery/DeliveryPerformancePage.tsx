// "Performans" — teslimat KPI'ları + müşteri geri bildirimi. Gün aralığı
// URL'de (?gun=7|30|90|180 — backend parametrik, sabit 30 kalktı). Kart
// enflasyonu yok: etiketli sayı ritmi + Pareto div-çubukları (grafik kütüphanesiz).
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui";
import {
  useDeliveryKpi,
  useDeliveryMetrics,
  useRecentDeliveryFeedback,
} from "@/hooks/useDelivery";
import { FEEDBACK_PROBLEM_LABEL } from "@/lib/deliveryFeedback";
import { FAIL_REASON_LABEL } from "@/lib/deliveryRun";
import { getErrorMessage } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";

const WINDOWS = [7, 30, 90, 180] as const;
type Window = (typeof WINDOWS)[number];

function pct(rate: number | null): string {
  return rate == null ? "-" : `%${Math.round(rate * 100)}`;
}

function ParetoList({
  title,
  entries,
  labels,
}: {
  title: string;
  entries: [string, number][];
  labels: Record<string, string>;
}) {
  if (entries.length === 0) return null;
  const max = entries[0][1];
  return (
    <div className="border-t border-slate-200 px-6 py-4 ">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 ">
        {title}
      </p>
      <ul className="space-y-1.5">
        {entries.map(([code, count]) => (
          <li key={code} className="flex items-center gap-3 text-sm">
            <span className="w-44 shrink-0 truncate text-slate-600 ">
              {labels[code] ?? code}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 ">
              <span
                className="block h-full rounded-full bg-slate-400 "
                style={{ width: `${max ? (count / max) * 100 : 0}%` }}
              />
            </span>
            <span className="w-6 shrink-0 text-right tabular-nums text-slate-500 ">
              {count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── İP-19: operasyon metrikleri (GET /delivery/metrics, tarih aralıklı) ── */

const OPS_WINDOWS = [7, 30, 90] as const;
type OpsWindow = (typeof OPS_WINDOWS)[number];

/** Yerel takvim günü YYYY-MM-DD (toISOString UTC'ye kayar — kullanılmaz). */
function isoDate(d: Date): string {
  const ay = String(d.getMonth() + 1).padStart(2, "0");
  const gun = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${ay}-${gun}`;
}

function num(v: number | null): string {
  return v == null ? "-" : v.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
}

function OpsMetricsSection() {
  const [days, setDays] = useState<OpsWindow>(7);
  const { fromDate, toDate } = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1)); // bugün dahil "son N gün"
    return { fromDate: isoDate(from), toDate: isoDate(to) };
  }, [days]);

  const query = useDeliveryMetrics(fromDate, toDate);
  const m = query.data;

  const fmtGun = (s: string) =>
    new Date(`${s}T00:00:00`).toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "short",
    });

  // null = "bu aralıkta ölçülecek veri yok" — backend bilinçli ayırıyor, %0 DEĞİL.
  const rows = m
    ? [
        {
          key: "zamaninda",
          label: "Zamanında teslim",
          value: pct(m.on_time_rate),
          bos: m.on_time_rate == null,
        },
        {
          key: "ilk-deneme",
          label: "İlk denemede başarı",
          value: pct(m.first_attempt_rate),
          bos: m.first_attempt_rate == null,
        },
        {
          key: "durak-saat",
          label: "Durak / saat",
          value: num(m.stops_per_hour),
          bos: m.stops_per_hour == null,
        },
        {
          key: "km-teslimat",
          label: "km / teslimat",
          value: num(m.km_per_delivery),
          bos: m.km_per_delivery == null,
        },
        {
          key: "teslim-plan",
          label: "Teslim edilen / planlanan",
          value: `${m.delivered}/${m.planned}`,
          bos: false,
        },
      ]
    : [];

  return (
    <section
      data-testid="ops-metrikler"
      className="rounded-2xl border border-slate-200 bg-white "
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-6 py-4 ">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 ">
            Operasyon Metrikleri
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 ">
            {fmtGun(fromDate)} – {fmtGun(toDate)} · turlardan ölçülür
          </p>
        </div>
        <div role="group" aria-label="Metrik aralığı" className="flex gap-1">
          {OPS_WINDOWS.map((w) => (
            <button
              key={w}
              aria-pressed={days === w}
              onClick={() => setDays(w)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition ${
                days === w
                  ? "bg-slate-900 text-white "
                  : "text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 "
              }`}
            >
              {w} gün
            </button>
          ))}
        </div>
      </div>

      {query.isError ? (
        <div className="p-6">
          <ErrorState
            description={getErrorMessage(query.error, "Metrikler yüklenemedi.")}
            onRetry={() => query.refetch()}
          />
        </div>
      ) : !m ? (
        <div className="p-6">
          <PageSkeleton rows={3} />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-slate-200 ">
            {rows.map((r) => (
              <li
                key={r.key}
                data-testid={`ops-metrik-${r.key}`}
                className="flex items-baseline justify-between gap-4 px-6 py-3"
              >
                <span className="text-sm text-slate-600 ">
                  {r.label}
                </span>
                <span className="text-right">
                  <span className="text-sm font-semibold tabular-nums text-slate-900 ">
                    {r.value}
                  </span>
                  {r.bos && (
                    <span className="block text-xs text-slate-400 ">
                      henüz veri yok
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <ParetoList
            title="Teslim edilememe nedenleri"
            entries={Object.entries(m.fail_reasons).sort((a, b) => b[1] - a[1])}
            labels={FAIL_REASON_LABEL}
          />
        </>
      )}
    </section>
  );
}

export default function DeliveryPerformancePage() {
  const [params, setParams] = useSearchParams();
  const rawDays = Number(params.get("gun"));
  const days: Window = (WINDOWS as readonly number[]).includes(rawDays)
    ? (rawDays as Window)
    : 30;
  const setDays = (d: Window) =>
    setParams(d === 30 ? {} : { gun: String(d) }, { replace: true });

  const kpiQuery = useDeliveryKpi(days);
  const feedbackQuery = useRecentDeliveryFeedback(50);
  const k = kpiQuery.data;
  const feedback = feedbackQuery.data ?? [];

  const recentFeedback = [...feedback].sort(
    (a, b) =>
      Number(a.thumbs_up) - Number(b.thumbs_up) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="space-y-6">
      <OpsMetricsSection />

      <section className="rounded-2xl border border-slate-200 bg-white ">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-6 py-4 ">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 ">
            Teslimat Göstergeleri
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 ">
            Baseline ölçümü: hedef konmadı, sayılar yön verir.
          </p>
        </div>
        <div role="group" aria-label="Gün aralığı" className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              aria-pressed={days === w}
              onClick={() => setDays(w)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition ${
                days === w
                  ? "bg-slate-900 text-white "
                  : "text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 "
              }`}
            >
              {w} gün
            </button>
          ))}
        </div>
      </div>

      {kpiQuery.isError ? (
        <div className="p-6">
          <ErrorState
            description={getErrorMessage(kpiQuery.error, "Göstergeler yüklenemedi.")}
            onRetry={() => kpiQuery.refetch()}
          />
        </div>
      ) : kpiQuery.isLoading || !k ? (
        <div className="p-6">
          <PageSkeleton rows={3} />
        </div>
      ) : k.delivered + k.failed + k.rescheduled === 0 ? (
        <div className="p-6">
          <EmptyState
            title="Bu aralıkta teslimat yok"
            description={`Son ${days} günde sonuçlanmış durak bulunmuyor. Daha geniş bir aralık deneyin.`}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
            {[
              { label: "Söz tutma", value: pct(k.on_time_rate), sub: `${k.on_time_delivered}/${k.promised_delivered} teslim` },
              { label: "İlk denemede teslim", value: pct(k.first_attempt_rate), sub: `${k.first_attempt_delivered}/${k.delivered_count} sipariş` },
              { label: "Teslim edildi", value: String(k.delivered), sub: `son ${days} gün` },
              { label: "Teslim edilemedi", value: String(k.failed), sub: `${k.failed_not_courier_fault} kurye dışı` },
            ].map((t) => (
              <div key={t.label} className="bg-white px-6 py-4 ">
                <p className="text-2xl font-semibold tabular-nums text-slate-900 ">
                  {t.value}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-600 ">{t.label}</p>
                <p className="text-xs text-slate-400 ">{t.sub}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 px-6 py-4 ">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
                  Teslimat memnuniyeti
                </p>
                {k.satisfaction_rate == null ? (
                  <p className="mt-1 text-sm text-slate-400 ">henüz veri yok</p>
                ) : (
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 ">
                    👍 {pct(k.satisfaction_rate)}
                  </p>
                )}
              </div>
              <p className="text-sm tabular-nums text-slate-500 ">
                👍 {k.feedback_up} · 👎 {k.feedback_down}
              </p>
            </div>
          </div>

          <ParetoList
            title="Bildirilen sorunlar"
            entries={Object.entries(k.feedback_problems).sort((a, b) => b[1] - a[1])}
            labels={FEEDBACK_PROBLEM_LABEL}
          />
          <ParetoList
            title="Teslim edilememe nedenleri"
            entries={Object.entries(k.fail_by_reason).sort((a, b) => b[1] - a[1])}
            labels={FAIL_REASON_LABEL}
          />
        </>
      )}

      {/* Son değerlendirmeler — 👎 önce; siparişe link (aksiyon zinciri kopmasın) */}
      <div className="border-t border-slate-200 px-6 py-4 ">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
          Son değerlendirmeler
        </p>
        {feedbackQuery.isError ? (
          <p className="mt-2 text-sm text-rose-600 ">
            Değerlendirmeler yüklenemedi.
          </p>
        ) : recentFeedback.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400 ">Henüz değerlendirme yok.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-200 ">
            {recentFeedback.map((item) => (
              <li key={item.id} className="py-3 first:pt-1 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-sm font-medium text-slate-800 ">
                    {item.thumbs_up ? "👍" : "👎"}{" "}
                    <Link
                      to={`${ROUTES.adminStoreOrders}?q=${item.order_id}`}
                      className="hover:underline"
                      title="Siparişi mağaza yönetiminde aç"
                    >
                      Sipariş #{item.order_id}
                    </Link>
                  </p>
                  <time
                    dateTime={item.created_at}
                    className="text-xs tabular-nums text-slate-400 "
                  >
                    {new Date(item.created_at).toLocaleString("tr-TR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </div>
                <p className="mt-1 text-xs text-slate-500 ">
                  {item.problem_codes.length > 0
                    ? item.problem_codes.map((c) => FEEDBACK_PROBLEM_LABEL[c] ?? c).join(" · ")
                    : "Sorun bildirilmedi"}
                </p>
                {item.comment && (
                  <p className="mt-1 text-sm leading-5 text-slate-700 ">
                    {item.comment}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      </section>
    </div>
  );
}
