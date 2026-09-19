import { useState } from "react";
import { Link } from "react-router-dom";

import { DashboardShell } from "@/components/DashboardShell";
import { SegmentedControl } from "@/components/SegmentedControl";
import { ErrorState } from "@/components/admin/ui/PageState";
import {
  ACIKLAMA,
  BOLUM_BASLIGI,
  ETIKET,
  KART,
  KUCUK_ACIKLAMA,
  SAYFA_BASLIGI,
} from "@/components/pano/stil";
import { useTutorGoals, useTutorOverview, useTutorSeries } from "@/hooks/useTutorAnalytics";
import { formatDate } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { formatTRY } from "@/lib/money";
import { TUTOR_NAV } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
import type {
  AnalyticsPeriod,
  AnalyticsSeriesPoint,
  MetricTrend,
  SuccessGoal,
  SuccessGoalCode,
} from "@/types";

const DONEMLER: { value: AnalyticsPeriod; label: string }[] = [
  { value: "week", label: "7 gün" },
  { value: "month", label: "30 gün" },
  { value: "quarter", label: "90 gün" },
];

const yuzde = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 1 });
const ondalik = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Hedef kartlarının metni. Eşik ve hesap sunucudadır; burada yalnız dil var. */
const HEDEF_METNI: Record<
  SuccessGoalCode,
  { baslik: string; aciklama: string; orneklem: string; bicim: (v: number) => string }
> = {
  CANCEL_RATE: {
    baslik: "İptal oranı",
    aciklama:
      "Senin iptal ettiğin derslerin, tamamlanan ve iptal ettiğin derslere oranı. En az 5 ders gerekir.",
    orneklem: "ders",
    bicim: (v) => yuzde.format(v),
  },
  MISSED_LESSONS: {
    baslik: "Kaçırılan ders",
    aciklama:
      "Öğrencinin “eğitmen gelmedi” bildirimi incelenip ücreti iade edilen dersler.",
    orneklem: "geçmiş ders",
    bicim: (v) => String(v),
  },
  RESPONSE_24H: {
    baslik: "24 saatte mesaj yanıtı",
    aciklama:
      "Öğrencilerin başlattığı konuşmalarda ilk mesaja 24 saat içinde yanıt verdiğin konuşmaların oranı. En az 3 konuşma gerekir.",
    orneklem: "konuşma",
    bicim: (v) => yuzde.format(v),
  },
  RATING: {
    baslik: "Ortalama puan",
    aciklama: "Tüm değerlendirmelerinin ortalaması; seçili dönemden bağımsızdır. En az 3 değerlendirme gerekir.",
    orneklem: "değerlendirme",
    bicim: (v) => ondalik.format(v),
  },
};

const KARSILASTIRMA: Record<SuccessGoal["comparator"], string> = { lte: "≤", gte: "≥", eq: "=" };

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

function HedefKarti({ hedef, kucuk }: { hedef: SuccessGoal; kucuk?: boolean }) {
  const metin = HEDEF_METNI[hedef.code];
  const durum =
    hedef.achieved === null
      ? { yazi: "Veri yetersiz", sinif: "text-slate-500", isaret: "" }
      : hedef.achieved
        ? { yazi: "Hedefte", sinif: "text-emerald-700", isaret: "✓" }
        : { yazi: "Hedefin dışında", sinif: "text-red-700", isaret: "✗" };
  return (
    <article className={kucuk ? "rounded-lg border border-slate-200 bg-white p-4" : KART}>
      <div className="flex items-start justify-between gap-3">
        <h3 className={kucuk ? "text-sm font-semibold leading-5 text-slate-900" : ETIKET}>
          {metin.baslik}
        </h3>
        {hedef.live && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold leading-5 text-emerald-700">
            Canlı
          </span>
        )}
      </div>
      <p className={KUCUK_ACIKLAMA}>
        Hedef: {KARSILASTIRMA[hedef.comparator]} {metin.bicim(hedef.target)}
      </p>
      <p
        className={`mt-3 font-bold tabular-nums text-slate-900 ${
          kucuk ? "text-2xl leading-8" : "text-[32px] leading-9"
        }`}
      >
        {hedef.value === null ? "—" : metin.bicim(hedef.value)}
      </p>
      <p className={`mt-1 text-base font-semibold leading-6 ${durum.sinif}`}>
        {durum.isaret && <span aria-hidden>{durum.isaret} </span>}
        {durum.yazi}
        <span className="font-normal text-slate-500">
          {" "}
          · {hedef.sample} {metin.orneklem}
        </span>
      </p>
      <p className={`mt-3 ${KUCUK_ACIKLAMA}`}>{metin.aciklama}</p>
    </article>
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
  const hedefler = useTutorGoals(donem);
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
              {/* Hero: eğitmenin gerçekten takip ettiği tek şey — kazanç trendi. */}
              <div aria-busy={genel.isFetching} className={genel.isPlaceholderData ? "opacity-60" : ""}>
                <Link
                  to={ROUTES.tutorEarnings}
                  className="block rounded-lg border border-slate-200 bg-white p-6 transition hover:border-slate-900 sm:p-8"
                >
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
                </Link>
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

        <section aria-labelledby="basari-hedefleri" className="space-y-4">
          <div>
            <h2 id="basari-hedefleri" className={BOLUM_BASLIGI}>
              Başarı hedefleri
            </h2>
            <p className={`mt-1 ${ACIKLAMA}`}>
              Öğrencilerin güvenini etkileyen dört ölçü. Yeterli veri yoksa değerlendirilmez.
            </p>
          </div>
          {hedefler.isError && !hedefler.data ? (
            <ErrorState
              description={getErrorMessage(hedefler.error, "Başarı hedefleri yüklenemedi.")}
              onRetry={() => void hedefler.refetch()}
            />
          ) : (
            <div
              aria-busy={hedefler.isFetching}
              className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${
                hedefler.isPlaceholderData ? "opacity-60" : ""
              }`}
            >
              {!hedefler.data ? (
                <Iskelet adet={4} yukseklik="h-48" />
              ) : (
                hedefler.data.map((h) => <HedefKarti key={h.code} hedef={h} kucuk />)
              )}
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
