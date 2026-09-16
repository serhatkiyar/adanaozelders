// Dağıtım → Performans — eski DeliveryPerformancePage panel düzeninde. SALT OKUNUR: üç bağımsız veri yüzeyi —
// operasyon metrikleri (GET /delivery/metrics, yerel takvim günü aralığı), teslimat göstergeleri (KPI, `?gun=`) ve son
// değerlendirmeler. Yazma/dışa aktarma/hedef/karşılaştırma yok; zaman serisi olmadığı için grafik çizilmez, önceki dönem
// verisi olmadığı için değişim yüzdesi üretilmez ("Baseline ölçümü: hedef konmadı, sayılar yön verir.").
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Flex, Segmented, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { useDeliveryKpi, useDeliveryMetrics, useRecentDeliveryFeedback } from "@/hooks/useDelivery";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { FEEDBACK_PROBLEM_LABEL } from "@/lib/deliveryFeedback";
import { FAIL_REASON_LABEL } from "@/lib/deliveryRun";
import { getErrorDetail } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import type { DeliveryMetrics } from "@/api/delivery";
import type { DeliveryFeedback, DeliveryKpi } from "@/types";

export const KPI_ARALIKLARI = [7, 30, 90, 180] as const;
export type KpiAraligi = (typeof KPI_ARALIKLARI)[number];
export const OPS_ARALIKLARI = [7, 30, 90] as const;
export type OpsAraligi = (typeof OPS_ARALIKLARI)[number];
export const KPI_VARSAYILAN: KpiAraligi = 30;

/** null = "bu aralıkta ölçülecek veri yok" — backend bilinçli ayırıyor, %0 DEĞİL. */
export function pct(rate: number | null): string {
  return rate == null ? "-" : `%${Math.round(rate * 100)}`;
}
export function num(v: number | null): string {
  return v == null ? "-" : v.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
}
/** Yerel takvim günü YYYY-MM-DD (`toISOString` UTC'ye kayar — kullanılmaz). */
export function yerelGun(d: Date): string {
  const ay = String(d.getMonth() + 1).padStart(2, "0");
  const gun = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${ay}-${gun}`;
}
/** Bugün dahil son N yerel takvim günü. */
export function opsAraligi(days: number, bugun = new Date()): { fromDate: string; toDate: string } {
  const from = new Date(bugun);
  from.setDate(bugun.getDate() - (days - 1));
  return { fromDate: yerelGun(from), toDate: yerelGun(bugun) };
}
/** URL'deki `gun` değeri yalnız izinli aralıklardan biriyse geçerli; aksi hâlde 30 (sunucuya geçersiz değer gitmez). */
export function kpiAraligiCoz(ham: unknown): KpiAraligi {
  return (KPI_ARALIKLARI as readonly number[]).includes(ham as number) ? (ham as KpiAraligi) : KPI_VARSAYILAN;
}
/** Pareto: büyükten küçüğe. */
export function paretoSirala(sayimlar: Record<string, number>): [string, number][] {
  return Object.entries(sayimlar).sort((a, b) => b[1] - a[1]);
}
/** Memnun olmayanlar önce (thumbs_up false), kendi grubunda en yeni önce. */
export function degerlendirmeSirala(liste: DeliveryFeedback[]): DeliveryFeedback[] {
  return [...liste].sort((a, b) => Number(a.thumbs_up) - Number(b.thumbs_up) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
/** Operasyon metrik satırları — null değer "-" + "henüz veri yok". */
export function opsSatirlari(m: DeliveryMetrics): { key: string; label: string; value: string; bos: boolean }[] {
  return [
    { key: "zamaninda", label: "Zamanında teslim", value: pct(m.on_time_rate), bos: m.on_time_rate == null },
    { key: "ilk-deneme", label: "İlk denemede başarı", value: pct(m.first_attempt_rate), bos: m.first_attempt_rate == null },
    { key: "durak-saat", label: "Durak / saat", value: num(m.stops_per_hour), bos: m.stops_per_hour == null },
    { key: "km-teslimat", label: "km / teslimat", value: num(m.km_per_delivery), bos: m.km_per_delivery == null },
    { key: "teslim-plan", label: "Teslim edilen / planlanan", value: `${m.delivered}/${m.planned}`, bos: false },
  ];
}
/** KPI boş kararı: sonuçlanmış durak yok. */
export function kpiBosMu(k: DeliveryKpi): boolean {
  return k.delivered + k.failed + k.rescheduled === 0;
}
const SAYI: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
const SAR: React.CSSProperties = { overflowWrap: "anywhere" };
const gunBicimi = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });

/** Pareto listesi: nötr çubuk (renk yalnız gerçek durum için ayrılmıştır); boşsa çizilmez. */
function ParetoListesi({ baslik, girdiler, etiketler, testId }: { baslik: string; girdiler: [string, number][]; etiketler: Record<string, string>; testId: string }) {
  const { token } = theme.useToken();
  if (girdiler.length === 0) return null;
  const enBuyuk = girdiler[0][1];
  return (
    <div data-testid={testId} style={{ padding: "16px 24px", borderTop: `1px solid ${token.colorBorderSecondary}` }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 500, display: "block", marginBottom: 8 }}>{baslik}</Typography.Text>
      <Flex vertical gap={6}>
        {girdiler.map(([kod, adet]) => (
          <Flex key={kod} align="center" gap={12}>
            <Typography.Text style={{ flex: "0 1 200px", minWidth: 0, fontSize: 14, ...SAR }}>{etiketler[kod] ?? kod}</Typography.Text>
            <span aria-hidden style={{ flex: "1 1 80px", height: 6, borderRadius: 3, background: token.colorFillTertiary, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", borderRadius: 3, background: token.colorTextQuaternary, width: `${enBuyuk ? (adet / enBuyuk) * 100 : 0}%` }} />
            </span>
            <Typography.Text type="secondary" style={{ width: 32, textAlign: "right", flexShrink: 0, ...SAYI }}>{adet}</Typography.Text>
          </Flex>
        ))}
      </Flex>
    </div>
  );
}

/** Bölüm içi tazeleme hatası: önbellek verisi varken arka plan tazelemesi düştüyse veri gizlenmez, uyarı + yeniden dene. */
function TazelemeHatasi({ metin, yenidenDene }: { metin: string; yenidenDene: () => void }) {
  return (
    <div style={{ padding: "12px 24px 0" }}>
      <HataDurumu hata={metin} hataAksiyon={<Button size="small" onClick={yenidenDene}>Tekrar dene</Button>} />
    </div>
  );
}

export function DagitimPerformans() {
  const { token } = theme.useToken();
  const { canView } = useAdminAreaAccess("delivery");

  /* ── Operasyon metrikleri: bugün dahil son N yerel gün ── */
  const [opsGun, setOpsGun] = useState<OpsAraligi>(7);
  const { fromDate, toDate } = useMemo(() => opsAraligi(opsGun), [opsGun]);
  const ops = useDeliveryMetrics(fromDate, toDate, canView);

  /* ── KPI: `?gun=` (varsayılan 30 anahtarı URL'den silinir; alakasız parametreler korunur; replace) ── */
  const url = useUrlDurumu({ gun: KPI_VARSAYILAN as number }, { replace: true });
  const gun = kpiAraligiCoz(url.degerler.gun);
  const kpi = useDeliveryKpi(gun, canView);
  const degerlendirmeler = useRecentDeliveryFeedback(50, canView);

  if (!canView) return <AccessDenied area="Dağıtım" />;
  const ayrac = token.colorBorderSecondary;
  const kart = { background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 };
  const bolumBasligi = (baslik: string, aciklama: string, sag?: React.ReactNode) => (
    <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
      <div style={{ minWidth: 0 }}>
        <Typography.Text style={{ fontWeight: 500, display: "block" }}>{baslik}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{aciklama}</Typography.Text>
      </div>
      {sag}
    </Flex>
  );
  const m = ops.data;
  const k = kpi.data;
  const liste = degerlendirmeSirala(Array.isArray(degerlendirmeler.data) ? degerlendirmeler.data : []);

  const opsGovdesi = ops.isError && !m ? (
    <div style={{ padding: "16px 24px" }}><HataDurumu hata={getErrorDetail(ops.error, "Metrikler yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void ops.refetch()}>Tekrar dene</Button>} /></div>
  ) : !m ? (
    <div style={{ padding: "16px 24px" }}><YukleniyorDurumu etiket="Metrikler yükleniyor…" /></div>
  ) : (
    <>
      {ops.isError ? <TazelemeHatasi metin={getErrorDetail(ops.error, "Metrikler güncellenemedi; gösterilen değerler önceki yüklemeden.")} yenidenDene={() => void ops.refetch()} /> : null}
      <div style={{ padding: "0 24px" }}>
        {opsSatirlari(m).map((r, i, dizi) => (
          <Flex key={r.key} data-testid={`ops-metrik-${r.key}`} align="baseline" justify="space-between" gap={16} style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}>
            <Typography.Text>{r.label}</Typography.Text>
            <span style={{ textAlign: "right" }}>
              <Typography.Text style={{ fontWeight: 500, ...SAYI }}>{r.value}</Typography.Text>
              {r.bos ? <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }}>henüz veri yok</Typography.Text> : null}
            </span>
          </Flex>
        ))}
      </div>
      <ParetoListesi baslik="Teslim edilememe nedenleri" girdiler={paretoSirala(m.fail_reasons)} etiketler={FAIL_REASON_LABEL} testId="ops-nedenler" />
    </>
  );

  const kpiKartlari = k
    ? [
        { key: "soz", label: "Söz tutma", value: pct(k.on_time_rate), sub: `${k.on_time_delivered}/${k.promised_delivered} teslim` },
        { key: "ilk", label: "İlk denemede teslim", value: pct(k.first_attempt_rate), sub: `${k.first_attempt_delivered}/${k.delivered_count} sipariş` },
        { key: "teslim", label: "Teslim edildi", value: String(k.delivered), sub: `son ${gun} gün` },
        { key: "basarisiz", label: "Teslim edilemedi", value: String(k.failed), sub: `${k.failed_not_courier_fault} kurye dışı` },
      ]
    : [];
  const kpiGovdesi = kpi.isError && !k ? (
    <div style={{ padding: "16px 24px" }}><HataDurumu hata={getErrorDetail(kpi.error, "Göstergeler yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void kpi.refetch()}>Tekrar dene</Button>} /></div>
  ) : !k ? (
    <div style={{ padding: "16px 24px" }}><YukleniyorDurumu etiket="Göstergeler yükleniyor…" /></div>
  ) : kpiBosMu(k) ? (
    <div style={{ padding: "16px 24px" }}><BosDurumu baslik="Bu aralıkta teslimat yok" aciklama={`Son ${gun} günde sonuçlanmış durak bulunmuyor. Daha geniş bir aralık deneyin.`} /></div>
  ) : (
    <>
      {kpi.isError ? <TazelemeHatasi metin={getErrorDetail(kpi.error, "Göstergeler güncellenemedi; gösterilen değerler önceki yüklemeden.")} yenidenDene={() => void kpi.refetch()} /> : null}
      {/* ikas KPI şeridi anatomisi (canlı ölçüm): yatay metrikler tek yüzeyde, etiket 14/500 ikincil üstte, değer 20/500 tabular, alt açıklama 12; ayrı kart yok. */}
      <Flex wrap style={{ padding: "8px 12px" }}>
        {kpiKartlari.map((t) => (
          <div key={t.key} data-testid={`kpi-${t.key}`} style={{ flex: "1 1 160px", minWidth: 0, padding: "12px" }}>
            <Typography.Text style={{ fontSize: 14, fontWeight: 500, display: "block", color: token.colorTextTertiary }}>{t.label}</Typography.Text>
            <Typography.Text style={{ fontSize: 20, fontWeight: 500, lineHeight: "28px", display: "block", ...SAYI }}>{t.value}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 500, display: "block", ...SAYI }}>{t.sub}</Typography.Text>
          </div>
        ))}
      </Flex>
      <Flex align="baseline" justify="space-between" gap={12} wrap data-testid="kpi-memnuniyet" style={{ padding: "16px 24px", borderTop: `1px solid ${ayrac}` }}>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 14, fontWeight: 500, display: "block" }}>Teslimat memnuniyeti</Typography.Text>
          {k.satisfaction_rate == null ? (
            <Typography.Text type="secondary">henüz veri yok</Typography.Text>
          ) : (
            <Typography.Text style={{ fontSize: 20, fontWeight: 500, lineHeight: "28px", ...SAYI }}><span role="img" aria-label="Memnun">👍</span> {pct(k.satisfaction_rate)}</Typography.Text>
          )}
        </div>
        <Typography.Text type="secondary" style={SAYI}><span role="img" aria-label="Memnun">👍</span> {k.feedback_up} · <span role="img" aria-label="Memnun değil">👎</span> {k.feedback_down}</Typography.Text>
      </Flex>
      <ParetoListesi baslik="Bildirilen sorunlar" girdiler={paretoSirala(k.feedback_problems)} etiketler={FEEDBACK_PROBLEM_LABEL} testId="kpi-sorunlar" />
      <ParetoListesi baslik="Teslim edilememe nedenleri" girdiler={paretoSirala(k.fail_by_reason)} etiketler={FAIL_REASON_LABEL} testId="kpi-nedenler" />
    </>
  );

  const degerlendirmeGovdesi = degerlendirmeler.isError && !degerlendirmeler.data ? (
    <div style={{ padding: "16px 0" }}><HataDurumu hata={getErrorDetail(degerlendirmeler.error, "Değerlendirmeler yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void degerlendirmeler.refetch()}>Tekrar dene</Button>} /></div>
  ) : degerlendirmeler.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Değerlendirmeler yükleniyor…" /></div>
  ) : liste.length === 0 ? (
    <div style={{ padding: "16px 0" }}><BosDurumu baslik="Henüz değerlendirme yok" aciklama="Teslimat sonrası müşteri değerlendirmeleri burada listelenir." /></div>
  ) : (
    <>
      {degerlendirmeler.isError ? <div style={{ padding: "12px 0 0" }}><HataDurumu hata={getErrorDetail(degerlendirmeler.error, "Değerlendirmeler güncellenemedi; liste önceki yüklemeden.")} hataAksiyon={<Button size="small" onClick={() => void degerlendirmeler.refetch()}>Tekrar dene</Button>} /></div> : null}
      {liste.map((item, i, dizi) => (
        <div key={item.id} data-testid={`degerlendirme-${item.id}`} style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}>
          <Flex align="baseline" justify="space-between" gap={12} wrap>
            <Typography.Text style={{ fontWeight: 500 }}>
              <span role="img" aria-label={item.thumbs_up ? "Memnun" : "Memnun değil"}>{item.thumbs_up ? "👍" : "👎"}</span>{" "}
              <Link to={ROUTES.adminNewOrder(item.order_id)}>Sipariş #{item.order_id}</Link>
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, ...SAYI }}>
              <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}</time>
            </Typography.Text>
          </Flex>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", ...SAR }}>
            {item.problem_codes.length > 0 ? item.problem_codes.map((c) => FEEDBACK_PROBLEM_LABEL[c] ?? c).join(" · ") : "Sorun bildirilmedi"}
          </Typography.Text>
          {item.comment ? <Typography.Paragraph style={{ margin: "4px 0 0", ...SAR }}>{item.comment}</Typography.Paragraph> : null}
        </div>
      ))}
    </>
  );

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Performans</Typography.Title>
      </Flex>

      <section aria-label="Operasyon metrikleri" data-testid="ops-metrikler" style={kart}>
        {bolumBasligi(
          "Operasyon metrikleri",
          `${gunBicimi(fromDate)} – ${gunBicimi(toDate)} · turlardan ölçülür`,
          <div role="group" aria-label="Metrik aralığı" style={{ maxWidth: "100%", overflowX: "auto" }}><Segmented<OpsAraligi> value={opsGun} onChange={(v) => setOpsGun(v)} options={OPS_ARALIKLARI.map((w) => ({ value: w, label: `${w} gün` }))} /></div>,
        )}
        {opsGovdesi}
      </section>

      <section aria-label="Teslimat göstergeleri" style={kart}>
        {bolumBasligi(
          "Teslimat göstergeleri",
          "Baseline ölçümü: hedef konmadı, sayılar yön verir.",
          <div role="group" aria-label="Gün aralığı" style={{ maxWidth: "100%", overflowX: "auto" }}><Segmented<KpiAraligi> value={gun} onChange={(v) => url.ayarla({ gun: v })} options={KPI_ARALIKLARI.map((w) => ({ value: w, label: `${w} gün` }))} /></div>,
        )}
        {kpiGovdesi}
      </section>

      <section aria-label="Son değerlendirmeler" style={kart}>
        {bolumBasligi("Son değerlendirmeler", "Memnun olmayanlar önce; satırlar sipariş detayına gider.")}
        <div style={{ padding: "0 24px" }}>{degerlendirmeGovdesi}</div>
      </section>
    </Flex>
  );
}
