import { useState } from "react";
import { Link } from "react-router-dom";

import { DashboardShell } from "@/components/DashboardShell";
import { SegmentedControl } from "@/components/SegmentedControl";
import { ErrorState } from "@/components/admin/ui/PageState";
import {
  ACIKLAMA,
  KART,
  KUCUK_ACIKLAMA,
  SAYFA_BASLIGI,
} from "@/components/pano/stil";
import { useTutorOverview, useTutorSeries } from "@/hooks/useTutorAnalytics";
import { formatDate } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { formatTRY } from "@/lib/money";
import { TUTOR_NAV } from "@/lib/nav";
import type {
  AnalyticsPeriod,
  AnalyticsSeriesPoint,
  MetricTrend,
} from "@/types";

const DONEMLER: { value: AnalyticsPeriod; label: string }[] = [
  { value: "week", label: "7 gün" },
  { value: "month", label: "30 gün" },
  { value: "quarter", label: "90 gün" },
];

function Trend({ trend }: { trend: MetricTrend }) {
  if (trend.trend_pct === null) return null;
  const artis = trend.trend_pct > 0;
  const sabit = trend.trend_pct === 0;
  const renk = sabit ? "text-slate-600" : artis ? "text-emerald-700" : "text-red-700";
  const ok = sabit ? "" : artis ? "↑ " : "↓ ";
  return (
    <span className={`text-sm font-semibold leading-5 ${renk}`}>
      <span aria-hidden>{ok}</span>
      <span className="sr-only">{sabit ? "Değişim yok, " : artis ? "Artış " : "Düşüş "}</span>%
      {Math.abs(trend.trend_pct)}
    </span>
  );
}

/** Dönem kovalarına göre kazanç çubuk grafiği — harici kütüphane yok. */
function KazancGrafigi({ points, periyot }: { points: AnalyticsSeriesPoint[]; periyot: AnalyticsPeriod }) {
  if (points.length === 0) return null;
  const enBuyuk = Math.max(0, ...points.map((p) => p.earnings));
  const genislik = points.length;
  const ortaEtiket =
    points.length > 2 ? points[Math.floor((points.length - 1) / 2)] : null;
  // quarter kovaları haftalık, week/month günlük (bkz. backend series_buckets) —
  // eksen etiketi buna göre değişmezse 13 çubuk 13 gün sanılır.
  const birim = periyot === "quarter" ? "haftalık" : "günlük";

  return (
    <div className="mt-6">
      <svg
        viewBox={`0 0 ${genislik} 100`}
        preserveAspectRatio="none"
        className="h-24 w-full sm:h-28"
        role="img"
        aria-label={`${birim} kazanç dağılımı`}
      >
        <line
          x1={0}
          y1={100}
          x2={genislik}
          y2={100}
          className="stroke-slate-200"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => {
          const yukseklik = enBuyuk > 0 ? (p.earnings / enBuyuk) * 96 : 0;
          return (
            <rect
              key={p.date}
              x={i + 0.15}
              y={100 - yukseklik}
              width={0.7}
              height={yukseklik}
              className="fill-marka"
            />
          );
        })}
      </svg>
      {points.length === 1 ? (
        <p className="mt-2 text-center text-xs leading-4 text-slate-500">{points[0].label}</p>
      ) : (
        <div className="mt-2 flex justify-between text-xs leading-4 text-slate-500">
          <span>{points[0].label}</span>
          {ortaEtiket && <span>{ortaEtiket.label}</span>}
          <span>{points[points.length - 1].label}</span>
        </div>
      )}
    </div>
  );
}

function MetrikKarti({
  etiket,
  deger,
  trend,
  onceki,
  to,
  kucuk,
}: {
  etiket: string;
  deger: string;
  trend: MetricTrend;
  onceki: string;
  to?: string;
  kucuk?: boolean;
}) {
  const icerik = (
    <>
      <p className={kucuk ? KUCUK_ACIKLAMA : ACIKLAMA}>{etiket}</p>
      <p
        className={`mt-2 font-bold tabular-nums text-slate-900 ${
          kucuk ? "text-xl leading-7" : "text-2xl leading-8"
        }`}
      >
        {deger}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2">
        <Trend trend={trend} />
        <span className={KUCUK_ACIKLAMA}>Önceki: {onceki}</span>
      </p>
    </>
  );
  const kartSinif = kucuk ? "rounded-lg border border-slate-200 bg-white p-4" : KART;
  return to ? (
    <Link to={to} className={`${kartSinif} block transition hover:border-slate-900`}>
      {icerik}
    </Link>
  ) : (
    <div className={kartSinif}>{icerik}</div>
  );
}

function Iskelet({ adet, yukseklik }: { adet: number; yukseklik: string }) {
  return (
    <>
      {Array.from({ length: adet }, (_, i) => (
        <div key={i} className={`${yukseklik} animate-pulse rounded-lg bg-slate-100`} />
      ))}
    </>
  );
}

export default function TutorAnalytics() {
  const [donem, setDonem] = useState<AnalyticsPeriod>("month");
  const genel = useTutorOverview(donem);
  const seri = useTutorSeries(donem);
  const o = genel.data;

  return (
    <DashboardShell title="Analizler" navItems={TUTOR_NAV} genislik="orta">
      <div className="space-y-10 pb-16 pt-2">
        <header className="space-y-4">
          <div>
            <h1 className={SAYFA_BASLIGI}>Analizler</h1>
            <p className={`mt-2 ${ACIKLAMA}`}>
              Derslerinin ve öğrencilerinin gidişatı; rakamlar önceki eşit dönemle karşılaştırılır.
            </p>
          </div>
          <div className="w-full sm:w-72">
            <SegmentedControl options={DONEMLER} value={donem} onChange={setDonem} />
          </div>
        </header>

        <section aria-labelledby="genel-bakis" className="space-y-4">
          <h2 id="genel-bakis" className="sr-only">
            Genel bakış
          </h2>

          {genel.isError && !o ? (
            <ErrorState
              description={getErrorMessage(genel.error, "Genel bakış yüklenemedi.")}
              onRetry={() => void genel.refetch()}
            />
          ) : !o ? (
            <div className="space-y-4">
              <div className="h-64 animate-pulse rounded-lg bg-slate-100" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Iskelet adet={3} yukseklik="h-24" />
              </div>
            </div>
          ) : (
            <>
              {/* Hero: öğretmenin gerçekten takip ettiği tek şey — kazanç trendi. */}
              <div aria-busy={genel.isFetching} className={genel.isPlaceholderData ? "opacity-60" : ""}>
                {/* Bağlantı değil: ayrı kazanç ekranı yok (cüzdan üst barda). */}
                <div className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8">
                  <p className={ACIKLAMA}>Kazanç</p>
                  <p className="mt-2 text-4xl font-bold leading-10 tabular-nums text-slate-900 sm:text-5xl sm:leading-[1.1]">
                    {formatTRY(o.earnings.value, "0 TL")}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-2">
                    <Trend trend={o.earnings} />
                    <span className={KUCUK_ACIKLAMA}>Önceki: {formatTRY(o.earnings.previous, "0 TL")}</span>
                  </p>

                  {seri.isError && !seri.data ? (
                    <p className={`mt-6 ${KUCUK_ACIKLAMA}`}>Kazanç grafiği yüklenemedi.</p>
                  ) : !seri.data ? (
                    <div className="mt-6 h-24 animate-pulse rounded-lg bg-slate-100 sm:h-28" />
                  ) : (
                    <div className={seri.isPlaceholderData ? "opacity-60" : ""}>
                      <KazancGrafigi points={seri.data.points} periyot={donem} />
                    </div>
                  )}

                  <p className={`mt-4 ${KUCUK_ACIKLAMA}`}>
                    {formatDate(o.current_start)} – {formatDate(o.current_end)}, önceki dönemle
                    karşılaştırıldı.
                  </p>
                </div>
              </div>

              <div
                aria-busy={genel.isFetching}
                className={`grid grid-cols-1 gap-4 sm:grid-cols-3 ${
                  genel.isPlaceholderData ? "opacity-60" : ""
                }`}
              >
                <MetrikKarti
                  etiket="Ders"
                  deger={String(o.lessons.value)}
                  trend={o.lessons}
                  onceki={String(o.lessons.previous)}
                  kucuk
                />
                <MetrikKarti
                  etiket="Aktif öğrenci"
                  deger={String(o.active_students.value)}
                  trend={o.active_students}
                  onceki={String(o.active_students.previous)}
                  kucuk
                />
                <MetrikKarti
                  etiket="Yeni öğrenci"
                  deger={String(o.new_students.value)}
                  trend={o.new_students}
                  onceki={String(o.new_students.previous)}
                  kucuk
                />
              </div>
            </>
          )}
        </section>

      </div>
    </DashboardShell>
  );
}
