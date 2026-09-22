// Gösterge paneli: eski AdminDashboardPage verisi, canlı ikas "Giriş" geometrisi
// (üst şerit → KPI şeridi → solda geniş alan, sağda dar metrik sütunu).
// Zaman serisi/satış kanalı ucu yok; grafik ve kanal kartları çizilmez.
import { Link, useSearchParams } from "react-router-dom";
import { Button, Flex, Select, Tag, Typography, theme } from "antd";
import type { ReactNode } from "react";
import { CalendarOutlined, SwapOutlined } from "@ant-design/icons";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { useAdminDashboard, useAdminRevenue } from "@/hooks/useAdmin";
import { useStoreConfig } from "@/hooks/useStore";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { getErrorMessage } from "@/lib/errors";
import { formatTRY, parseMoney } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import type { AdminDashboardOut, AdminRevenueOut } from "@/types";

type Donem = "day" | "week" | "month";
const DONEMLER: { value: Donem; label: string; period: string }[] = [
  { value: "day", label: "Son 24 Saat", period: "önceki 24 saate göre" },
  { value: "week", label: "Son 7 Gün", period: "önceki 7 güne göre" },
  { value: "month", label: "Son 30 Gün", period: "önceki 30 güne göre" },
];

type Yon = 1 | 0 | -1;
type Degisim = { metin: string; yon: Yon };

function yuzde(simdi: number, once: number): Degisim {
  if (once === 0) return simdi > 0 ? { metin: "yeni", yon: 1 } : { metin: "değişim yok", yon: 0 };
  const pct = Math.round(((simdi - once) / once) * 100);
  return { metin: `${pct > 0 ? "+" : ""}%${pct}`, yon: pct > 0 ? 1 : pct < 0 ? -1 : 0 };
}
function adet(simdi: number, once: number): Degisim {
  const fark = simdi - once;
  return { metin: `${fark > 0 ? "+" : ""}${fark} dönem farkı`, yon: fark > 0 ? 1 : fark < 0 ? -1 : 0 };
}

// ikas'taki gibi her durumda ikincil gri (#4B5565); yön yalnız +/− işaretiyle okunur.
function DegisimMetni({ metin }: Degisim) {
  const { token } = theme.useToken();
  return <span style={{ fontSize: 12, fontWeight: 500, color: token.colorTextSecondary, whiteSpace: "nowrap" }}>{metin}</span>;
}

// ikas kartı: beyaz, 4px köşe, 0.8px #EEF2F6 kenarlık, 24px dolgu, 16px başlık.
function Kart({ baslik, ekstra, children }: { baslik?: string; ekstra?: ReactNode; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <section
      aria-label={baslik}
      style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4, padding: 24 }}
    >
      {baslik ? (
        <Flex justify="space-between" align="center" gap={12} style={{ paddingBottom: 16, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Typography.Text style={{ fontSize: 16 }}>{baslik}</Typography.Text>
          {ekstra}
        </Flex>
      ) : null}
      {children}
    </section>
  );
}

type Kalem = { etiket: string; deger: string; degisim: Degisim; ipucu?: string };

// ikas KPI şeridi: etiket 14/500 gri, değer 20/500, yanında %değişim; dikey ayırıcı.
function KpiSeridi({ kalemler }: { kalemler: Kalem[] }) {
  const { token } = theme.useToken();
  return (
    <div role="list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", rowGap: 24 }}>
      {kalemler.map((k, i) => (
        <div role="listitem" key={k.etiket} style={{ padding: "0 16px", borderLeft: i ? `1px solid ${token.colorBorderSecondary}` : undefined }}>
          <Typography.Text style={{ fontWeight: 500, color: token.colorTextTertiary }}>{k.etiket}</Typography.Text>
          <Flex align="baseline" gap={12} wrap style={{ marginTop: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>{k.deger}</span>
            <DegisimMetni {...k.degisim} />
          </Flex>
          {k.ipucu ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{k.ipucu}</Typography.Text> : null}
        </div>
      ))}
    </div>
  );
}

// ikas "Büyüme Metrikleri" satırı: etiket solda, %değişim sağda, değer altta; 24px dikey dolgu, ince çizgi.
function MetrikSatiri({ etiket, deger, degisim, son }: { etiket: string; deger: string; degisim?: Degisim; son?: boolean }) {
  const { token } = theme.useToken();
  return (
    <div role="listitem" style={{ padding: "24px 0", borderBottom: son ? undefined : `1px solid ${token.colorBorderSecondary}` }}>
      <Flex justify="space-between" align="center" gap={12}>
        <Typography.Text style={{ fontWeight: 500, color: token.colorTextTertiary }}>{etiket}</Typography.Text>
        {degisim ? <DegisimMetni {...degisim} /> : null}
      </Flex>
      <div style={{ fontSize: 20, fontWeight: 500, lineHeight: "30px", marginTop: 6 }}>{deger}</div>
    </div>
  );
}

type Kuyruk = { etiket: string; deger: number; hedef: string; ton?: string; aciklama: string };

function kuyruklar(d: AdminDashboardOut, donemEtiketi: string, esik?: number): Kuyruk[] {
  const liste = [
    { etiket: "Öğretmen başvuruları", deger: d.pending_tutors, hedef: ROUTES.adminNewTutors, ton: "warning", aciklama: "Onay veya ret kararı bekliyor." },
    { etiket: "Diploma doğrulamaları", deger: d.pending_diplomas, hedef: ROUTES.adminNewTutorDiplomas, ton: "warning", aciklama: "Belge teyidi bekleyen eğitim kayıtları." },
    { etiket: "Açık şikâyetler", deger: d.open_reports, hedef: ROUTES.adminNewReports, ton: "error", aciklama: "Moderasyon kararı bekleyen bildirimler." },
    { etiket: "İhtilaflı rezervasyonlar", deger: d.disputed_bookings, hedef: ROUTES.adminNewBookings, ton: "error", aciklama: `${d.active_bookings} aktif rezervasyon içinde.` },
    { etiket: "Açık öğrenci talepleri", deger: d.open_demands, hedef: ROUTES.adminNewDemands, ton: "processing", aciklama: "Öğretmenlerden yanıt bekleyen ders ilanları." },
    { etiket: "Hazırlanacak siparişler", deger: d.paid_orders, hedef: ROUTES.adminNewPacking, ton: "processing", aciklama: `${d.pending_returns} açık iade talebi bulunuyor.` },
    { etiket: "Düşük stok", deger: d.low_stock_products, hedef: `${ROUTES.adminNewProducts}?stok=kritik`, ton: "warning", aciklama: `Aktif fiziksel ürünlerde stok ${esik ?? "eşiğin"} veya altında.` },
    { etiket: "Kütüphane başvuruları", deger: d.pending_libraries, hedef: ROUTES.adminNewLibraries, ton: "warning", aciklama: "Katalog onayı bekleyen işletmeler." },
    { etiket: "Aktif dağıtım turları", deger: d.active_delivery_runs, hedef: ROUTES.adminNewDelivery, ton: "processing", aciklama: "Şu anda sahada olan kendi-filo turları." },
    { etiket: "Denetim kayıtları", deger: d.period_audit_logs, hedef: ROUTES.adminNewAuditLogs, aciklama: `${donemEtiketi} içindeki yönetim işlemleri.` },
  ];
  // Dashboard önce gerçekten işlem/takip isteyen işleri göstermeli. Sıfır
  // kayıtlı modüller erişim bağlantısı olarak kalır, ancak iş kuyruğunun
  // önüne geçmez. Aynı gruptaki sunucu/anlam sırası korunur.
  return liste.sort((a, b) => Number(b.deger > 0) - Number(a.deger > 0));
}

function ParaSutunu({ p }: { p: AdminRevenueOut }) {
  const n = (v: string) => parseMoney(v) ?? 0;
  const satirlar = [
    { etiket: "Emanetteki para", deger: formatTRY(p.held), degisim: yuzde(n(p.held), n(p.previous_held)) },
    { etiket: "Sepet ortalaması", deger: formatTRY(p.aov), degisim: yuzde(n(p.aov), n(p.previous_aov)) },
    { etiket: "Ders hacmi", deger: formatTRY(p.lesson_gmv), degisim: yuzde(n(p.lesson_gmv), n(p.previous_lesson_gmv)) },
    { etiket: "Kütüphane hacmi", deger: formatTRY(p.library_gmv), degisim: yuzde(n(p.library_gmv), n(p.previous_library_gmv)) },
    { etiket: "Mağaza hacmi", deger: formatTRY(p.store_gmv), degisim: yuzde(n(p.store_gmv), n(p.previous_store_gmv)) },
    { etiket: "Komisyon geliri", deger: formatTRY(p.commission_revenue), degisim: yuzde(n(p.commission_revenue), n(p.previous_commission_revenue)) },
    { etiket: `İade (hacmin %${Math.round(p.refund_rate * 1000) / 10}'i)`, deger: formatTRY(p.refunded), degisim: yuzde(n(p.refunded), n(p.previous_refunded)) },
  ];
  return (
    <div role="list">
      {satirlar.map((s, i) => <MetrikSatiri key={s.etiket} {...s} son={i === satirlar.length - 1} />)}
    </div>
  );
}

export function GostergePaneli() {
  const { token } = theme.useToken();
  const mobil = useMobil();
  const { canView } = useAdminAreaAccess("dashboard");
  const [params, setParams] = useSearchParams();
  const ham = params.get("range");
  const donem: Donem = ham === "day" || ham === "month" ? ham : "week";
  const secili = DONEMLER.find((d) => d.value === donem)!;
  const ozet = useAdminDashboard(donem, canView);
  const para = useAdminRevenue(donem, canView);
  const esik = useStoreConfig(canView).data?.low_stock_threshold;

  const donemDegisti = (yeniDonem: Donem) => {
    const siradaki = new URLSearchParams(params);
    if (yeniDonem === "week") siradaki.delete("range");
    else siradaki.set("range", yeniDonem);
    setParams(siradaki, { replace: true });
  };

  if (!canView) return <AccessDenied area="Gösterge paneli" />;

  const d = ozet.data;
  const p = para.data;

  return (
    <Flex vertical gap={16}>
      <Flex align="center" gap={16} wrap style={{ minHeight: 40 }}>
        <Select<Donem>
          aria-label="Dönem"
          value={donem}
          prefix={<CalendarOutlined aria-hidden="true" />}
          options={DONEMLER.map((x) => ({ value: x.value, label: x.label }))}
          onChange={donemDegisti}
          style={{ width: 160 }}
        />
        <Typography.Text type="secondary">
          <SwapOutlined aria-hidden="true" style={{ marginRight: 8 }} />
          Önceki döneme göre
        </Typography.Text>
      </Flex>

      {ozet.isPending ? (
        <Kart><YukleniyorDurumu etiket="Yönetim özeti yükleniyor…" /></Kart>
      ) : ozet.isError || !d ? (
        <HataDurumu
          hata={getErrorMessage(ozet.error, "Yönetim özeti yüklenemedi.")}
          hataAksiyon={<Button size="small" onClick={() => void ozet.refetch()}>Tekrar dene</Button>}
        />
      ) : (
        <>
          <Kart baslik="Dönem hareketi">
            <div style={{ paddingTop: 24 }}>
              <KpiSeridi
                kalemler={[
                  { etiket: "Yeni öğrenciler", deger: String(d.new_clients), degisim: adet(d.new_clients, d.previous_new_clients), ipucu: "hesap" },
                  { etiket: "Yeni öğretmenler", deger: String(d.new_tutors), degisim: adet(d.new_tutors, d.previous_new_tutors), ipucu: "başvuru" },
                  { etiket: "Yeni siparişler", deger: String(d.new_orders), degisim: adet(d.new_orders, d.previous_new_orders), ipucu: "sipariş" },
                  ...(p
                    ? [
                        { etiket: "İşlem hacmi (GMV)", deger: formatTRY(p.gmv), degisim: yuzde(parseMoney(p.gmv) ?? 0, parseMoney(p.previous_gmv) ?? 0), ipucu: "ders + kütüphane + mağaza" },
                        { etiket: "Platform geliri", deger: formatTRY(p.revenue), degisim: yuzde(parseMoney(p.revenue) ?? 0, parseMoney(p.previous_revenue) ?? 0), ipucu: "komisyon + kendi satış" },
                      ]
                    : []),
                ]}
              />
            </div>
          </Kart>

          {/* ikas alt bölge: solda geniş ana alan (2fr), sağda dar sütun (1fr). */}
          <div style={{ display: "grid", gridTemplateColumns: mobil ? "1fr" : "2fr 1fr", gap: 24, alignItems: "start" }}>
            <div>
              <Kart baslik="Operasyon kuyrukları" ekstra={<Typography.Text type="secondary">Karar veya takip bekleyen iş yükü</Typography.Text>}>
                <div role="list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", columnGap: 24 }}>
                  {kuyruklar(d, secili.label, esik).map((k) => (
                    <div role="listitem" key={k.etiket} style={{ padding: "16px 0", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                      <Flex justify="space-between" align="center" gap={12}>
                        <Typography.Text style={{ fontWeight: 500, color: token.colorTextTertiary }}>{k.etiket}</Typography.Text>
                        <Tag color={k.deger > 0 ? k.ton : undefined} style={{ marginInlineEnd: 0 }}>{k.deger}</Tag>
                      </Flex>
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>{k.aciklama}</Typography.Text>
                      <Link to={k.hedef} style={{ fontSize: 12, fontWeight: 500 }}>Kuyruğu aç →</Link>
                    </div>
                  ))}
                </div>
              </Kart>
            </div>
            <Kart baslik="Para">
              {para.isError ? (
                <div style={{ paddingTop: 16 }}>
                  <HataDurumu
                    hata={getErrorMessage(para.error, "Para özeti yüklenemedi.")}
                    hataAksiyon={<Button size="small" onClick={() => void para.refetch()}>Tekrar dene</Button>}
                  />
                </div>
              ) : p ? (
                <ParaSutunu p={p} />
              ) : (
                <div style={{ paddingTop: 16 }}><YukleniyorDurumu /></div>
              )}
            </Kart>
          </div>
        </>
      )}
    </Flex>
  );
}
