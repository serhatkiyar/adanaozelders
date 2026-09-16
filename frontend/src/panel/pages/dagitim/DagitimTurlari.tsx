// Dağıtım → Turlar — eski DeliveryRunsPage panel düzeninde: tur listesi ve arşivi. İki mod:
// geçerli `?tarih=` varsa o günün turları (useDeliveryRuns), yoksa sunucu offset sayfalı arşiv
// (useDeliveryRunArchive, 20 satır, `?sayfa=`). Aynı anda yalnız etkin modun sorgusu çalışır. Salt okunur.
// Satır ve tur kodu yeni tur detayına (ROUTES.adminNewDeliveryRun) gider.
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Flex, Input, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { useDeliveryRunArchive, useDeliveryRuns } from "@/hooks/useDelivery";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { RUN_STATUS_LABEL, runProgress } from "@/lib/deliveryRun";
import { getErrorDetail } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import type { DeliveryRun } from "@/types";

export const SAYFA_BOYUTU = 20;

/** URL tarihi yalnız takvimde gerçekten var olan ISO gün ise kabul edilir; aksi hâlde filtre yok (arşiv modu). */
export function tarihSuzgeci(ham: unknown): string | null {
  if (typeof ham !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ham)) return null;
  const d = new Date(`${ham}T00:00:00`);
  return Number.isNaN(d.getTime()) || d.toLocaleDateString("sv-SE") !== ham ? null : ham;
}

/** Arşiv sayfası: yalnız düz pozitif tam sayı ("1e3", "abc", "-2" değil); varsayılan 1. */
export function sayfaNo(ham: unknown): number {
  if (typeof ham === "string" && !/^\d+$/.test(ham)) return 1;
  const n = typeof ham === "number" ? ham : Number(ham);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

const DURUM_RENGI: Record<string, string> = { PLANNED: "default", ACTIVE: "processing", DONE: "success", CANCELLED: "error" };
const TARIH_BICIMI = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", weekday: "short" });

function TurSatiri({ run, sonMu, ayrac }: { run: DeliveryRun; sonMu: boolean; ayrac: string }) {
  const navigate = useNavigate();
  const [biten, toplam] = runProgress(run);
  const basarisiz = run.stops.filter((s) => s.status === "FAILED").length;
  const hedef = ROUTES.adminNewDeliveryRun(run.id);
  return (
    // Satırın tamamı detaya götürür; gerçek bağlantı tur kodundadır (orta tık / değiştirici tuş korunur), iç içe a/button yok.
    <Flex
      data-testid={`tur-${run.id}`}
      align="center"
      justify="space-between"
      gap={12}
      wrap
      onClick={(e) => {
        // Değiştirici tuş / birincil olmayan tık satırı yönlendirmez; o niyet gerçek bağlantıya (Tur #id) aittir.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        navigate(hedef);
      }}
      style={{ padding: "12px 0", cursor: "pointer", borderBottom: sonMu ? "none" : `1px solid ${ayrac}` }}
    >
      <Flex align="center" gap={12} wrap style={{ minWidth: 0, flex: "1 1 240px" }}>
        <Typography.Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", width: 96, flexShrink: 0 }}>
          {TARIH_BICIMI.format(new Date(`${run.run_date}T00:00:00`))}
        </Typography.Text>
        <div style={{ minWidth: 0 }}>
          <Link to={hedef} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 500 }}>Tur #{run.id}</Link>
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>{run.vehicle}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }}>{run.courier?.name ?? "Kurye atanmadı"}</Typography.Text>
        </div>
      </Flex>
      <Flex align="center" gap={8} wrap>
        {toplam > 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            {biten}/{toplam} durak{basarisiz > 0 ? <Typography.Text type="danger" style={{ fontSize: 12 }}> · {basarisiz} başarısız</Typography.Text> : null}
          </Typography.Text>
        ) : null}
        {run.total_distance_km != null ? (
          <Typography.Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{run.total_distance_km.toLocaleString("tr-TR")} km</Typography.Text>
        ) : null}
        <Tag color={DURUM_RENGI[run.status] ?? "default"} style={{ marginInlineEnd: 0 }}>{RUN_STATUS_LABEL[run.status] ?? run.status}</Tag>
      </Flex>
    </Flex>
  );
}

export function DagitimTurlari() {
  const { token } = theme.useToken();
  const { canView } = useAdminAreaAccess("delivery");
  // Tarih değişince/temizlenince sayfa 1 (sayfaAnahtari); tarih modunda `sayfa` sorguyu etkilemez.
  const url = useUrlDurumu({ tarih: "", sayfa: 1 }, { sayfaAnahtari: "sayfa", filtreDisi: ["sayfa"] });
  // Sayfa ham metinden okunur: "1e3" gibi sayıya benzeyen değerler 1'e düşer.
  const [params] = useSearchParams();
  const tarih = tarihSuzgeci(url.degerler.tarih);
  const sayfa = sayfaNo(params.get("sayfa"));
  const tarihModu = tarih !== null;

  // Aynı anda yalnız etkin modun sorgusu çalışır; izinsizde ikisi de kapalı.
  const gunTurlari = useDeliveryRuns(tarih ?? undefined, canView && tarihModu);
  const arsiv = useDeliveryRunArchive(sayfa - 1, SAYFA_BOYUTU, canView && !tarihModu);
  const sorgu = tarihModu ? gunTurlari : arsiv;
  const turlar = Array.isArray(sorgu.data) ? sorgu.data : [];
  // Uç toplam döndürmez: sayfa 20'den kısaysa son sayfadır.
  const sonSayfa = !tarihModu && turlar.length < SAYFA_BOYUTU;

  if (!canView) return <AccessDenied area="Dağıtım" />;
  const ayrac = token.colorBorderSecondary;

  const govde = sorgu.isError ? (
    <div style={{ padding: "16px 0" }}>
      <HataDurumu hata={getErrorDetail(sorgu.error, "Turlar yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />
    </div>
  ) : sorgu.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Turlar yükleniyor…" /></div>
  ) : turlar.length === 0 ? (
    <div style={{ padding: "16px 0" }}>
      <BosDurumu
        baslik={tarihModu ? "Bu tarihte tur yok" : sayfa > 1 ? "Arşivin sonu" : "Henüz tur yok"}
        aciklama={tarihModu ? "Farklı bir tarih seçin ya da filtreyi kaldırın." : "Turlar Bugün ekranından oluşturulur."}
      />
    </div>
  ) : (
    turlar.map((r, i, d) => <TurSatiri key={r.id} run={r} sonMu={i === d.length - 1} ayrac={ayrac} />)
  );

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Turlar</Typography.Title>
        <Flex align="center" gap={8} wrap>
          <Input
            type="date"
            aria-label="Tarihe göre filtrele"
            value={tarih ?? ""}
            onChange={(e) => url.ayarla({ tarih: tarihSuzgeci(e.target.value) ?? "" })}
            style={{ width: 170, height: 40 }}
          />
          {tarihModu ? <Button onClick={() => url.ayarla({ tarih: "" })}>Filtreyi kaldır</Button> : null}
        </Flex>
      </Flex>
      <section aria-label="Turlar" style={{ background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 }}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
          <Typography.Text type="secondary">Geçmiş ve planlı dağıtım turları: detay için satıra tıklayın. Turlar en yeni tarihten eskiye sıralanır.</Typography.Text>
        </div>
        <div style={{ padding: "0 24px" }}>{govde}</div>
        {!tarihModu && !sorgu.isPending && (sayfa > 1 || !sonSayfa) ? (
          <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 24px", borderTop: `1px solid ${ayrac}` }}>
            {/* Sayfa 1'de "Daha yeni" yok (sahte kapalı düğme yerine); son sayfada "Daha eski" yok. */}
            {sayfa > 1 ? <Button onClick={() => url.ayarla({ sayfa: sayfa - 1 })}>← Daha yeni</Button> : <span />}
            <Typography.Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>Sayfa {sayfa}</Typography.Text>
            {!sonSayfa ? <Button onClick={() => url.ayarla({ sayfa: sayfa + 1 })}>Daha eski →</Button> : <span />}
          </Flex>
        ) : null}
      </section>
    </Flex>
  );
}
