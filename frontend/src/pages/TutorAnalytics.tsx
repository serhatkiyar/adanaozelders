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
import { useTutorGoals, useTutorOverview } from "@/hooks/useTutorAnalytics";
import { formatDate } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { formatTRY } from "@/lib/money";
import { TUTOR_NAV } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
import type { AnalyticsPeriod, MetricTrend, SuccessGoal, SuccessGoalCode } from "@/types";

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

function MetrikKarti({
  etiket,
  deger,
  trend,
  onceki,
  to,
}: {
  etiket: string;
  deger: string;
  trend: MetricTrend;
  onceki: string;
  to?: string;
}) {
  const icerik = (
    <>
      <p className={ACIKLAMA}>{etiket}</p>
      <p className="mt-2 text-2xl font-bold leading-8 tabular-nums text-slate-900">{deger}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2">
        <Trend trend={trend} />
        <span className={KUCUK_ACIKLAMA}>Önceki: {onceki}</span>
      </p>
    </>
  );
  return to ? (
    <Link to={to} className={`${KART} block transition hover:border-slate-900`}>
      {icerik}
    </Link>
  ) : (
    <div className={KART}>{icerik}</div>
  );
}

function HedefKarti({ hedef }: { hedef: SuccessGoal }) {
  const metin = HEDEF_METNI[hedef.code];
  const durum =
    hedef.achieved === null
      ? { yazi: "Veri yetersiz", sinif: "text-slate-500", isaret: "" }
      : hedef.achieved
        ? { yazi: "Hedefte", sinif: "text-emerald-700", isaret: "✓" }
        : { yazi: "Hedefin dışında", sinif: "text-red-700", isaret: "✗" };
  return (
    <article className={KART}>
      <div className="flex items-start justify-between gap-3">
        <h3 className={ETIKET}>{metin.baslik}</h3>
        {hedef.live && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold leading-5 text-emerald-700">
            Canlı
          </span>
        )}
      </div>
      <p className={KUCUK_ACIKLAMA}>
        Hedef: {KARSILASTIRMA[hedef.comparator]} {metin.bicim(hedef.target)}
      </p>
      <p className="mt-3 text-[32px] font-bold leading-9 tabular-nums text-slate-900">
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
  const o = genel.data;

  return (
    <DashboardShell title="Analizler" navItems={TUTOR_NAV} genislik="orta">
      <div className="space-y-10 pb-16 pt-2">
        <header>
          <h1 className={SAYFA_BASLIGI}>Analizler</h1>
          <p className={`mt-2 ${ACIKLAMA}`}>
            Derslerinin ve öğrencilerinin gidişatı; rakamlar önceki eşit dönemle karşılaştırılır.
          </p>
        </header>

        <section aria-labelledby="genel-bakis" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="genel-bakis" className={BOLUM_BASLIGI}>
              Genel bakış
            </h2>
            <div className="w-full sm:w-72">
              <SegmentedControl options={DONEMLER} value={donem} onChange={setDonem} />
            </div>
          </div>

          {genel.isError && !o ? (
            <ErrorState
              description={getErrorMessage(genel.error, "Genel bakış yüklenemedi.")}
              onRetry={() => void genel.refetch()}
            />
          ) : (
            <div
              aria-busy={genel.isFetching}
              className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 ${
                genel.isPlaceholderData ? "opacity-60" : ""
              }`}
            >
              {!o ? (
                <Iskelet adet={4} yukseklik="h-32" />
              ) : (
                <>
                  <MetrikKarti
                    etiket="Kazanç"
                    deger={formatTRY(o.earnings.value, "0 TL")}
                    trend={o.earnings}
                    onceki={formatTRY(o.earnings.previous, "0 TL")}
                    to={ROUTES.tutorEarnings}
                  />
                  <MetrikKarti
                    etiket="Ders"
                    deger={String(o.lessons.value)}
                    trend={o.lessons}
                    onceki={String(o.lessons.previous)}
                  />
                  <MetrikKarti
                    etiket="Aktif öğrenci"
                    deger={String(o.active_students.value)}
                    trend={o.active_students}
                    onceki={String(o.active_students.previous)}
                  />
                  <MetrikKarti
                    etiket="Yeni öğrenci"
                    deger={String(o.new_students.value)}
                    trend={o.new_students}
                    onceki={String(o.new_students.previous)}
                  />
                </>
              )}
            </div>
          )}
          {o && (
            <p className={KUCUK_ACIKLAMA}>
              {formatDate(o.current_start)} – {formatDate(o.current_end)}, önceki dönemle
              karşılaştırıldı.
            </p>
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
                hedefler.data.map((h) => <HedefKarti key={h.code} hedef={h} />)
              )}
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
