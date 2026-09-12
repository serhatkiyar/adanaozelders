// Dağıtım → Bugün — eski DeliveryTodayPage panel düzeninde: operasyon kokpiti.
// Sıra: rota altyapısı şeridi (yalnız degraded), istisna kuyruğu (tek uyarı yüzeyi / sakin tek satır),
// günün turları (tarih URL'de, kapasite şeridi, araç seçimi ve yazma aksiyonları yalnız delivery.manage).
// Hiçbir tur/FSM verisi uydurulmaz; adetler, konum ve kapasite sunucudan gelir.
// GEÇİCİ: tur satırları ve oluşturma/optimize sonrası yönlendirme çalışan ESKİ tur detayına
// (ROUTES.adminDeliveryRun) gider; yeni tur detayı ekranı gelince bu bağlantılar çevrilecek.
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, App, Button, Flex, Input, Select, Tag, Tooltip, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { CapacityStrip } from "@/components/admin/delivery/CapacityStrip";
import { todayIso } from "@/components/admin/delivery/bits";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import {
  useAttentionOrders,
  useCreateDeliveryRun,
  useDeliveryRuns,
  useDispatchDay,
  useEligibleOrders,
  useRetryExhausted,
  useRoutingHealth,
  useRunPosition,
  useVehicles,
} from "@/hooks/useDelivery";
import { RUN_STATUS_LABEL, runProgress } from "@/lib/deliveryRun";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import type { DeliveryEligibleOrder, DeliveryRun, Vehicle } from "@/types";

/** URL tarihi yalnız gerçek bir ISO gün (YYYY-MM-DD) ise kabul edilir; aksi hâlde bugün. Geçersiz değer sunucuya gitmez. */
export function tarihNo(ham: string | null): string {
  if (!ham || !/^\d{4}-\d{2}-\d{2}$/.test(ham)) return todayIso();
  const d = new Date(`${ham}T00:00:00`);
  return Number.isNaN(d.getTime()) || d.toLocaleDateString("sv-SE") !== ham ? todayIso() : ham;
}

const DURUM_SIRASI: Record<string, number> = { ACTIVE: 0, PLANNED: 1, DONE: 2, CANCELLED: 3 };
const DURUM_RENGI: Record<string, string> = { PLANNED: "default", ACTIVE: "processing", DONE: "success", CANCELLED: "error" };

/** ACTIVE · PLANNED · DONE · CANCELLED, sonra id; bilinmeyen durum sona. */
export function turlariSirala(runs: DeliveryRun[]): DeliveryRun[] {
  return [...runs].sort((a, b) => (DURUM_SIRASI[a.status] ?? 9) - (DURUM_SIRASI[b.status] ?? 9) || a.id - b.id);
}

/** Konum tazeliği metni: 30 sn altı "canlı", aksi hâlde "N dk önce"; veri yoksa null. */
export function konumMetni(ageSeconds: number | null | undefined): string | null {
  if (ageSeconds == null) return null;
  return ageSeconds < 30 ? "konum canlı" : `konum ${Math.round(ageSeconds / 60)} dk önce`;
}

function TurSatiri({ run, sonMu, ayrac }: { run: DeliveryRun; sonMu: boolean; ayrac: string }) {
  const navigate = useNavigate();
  const [biten, toplam] = runProgress(run);
  const { data: konum } = useRunPosition(run.id, run.status === "ACTIVE");
  const konumYazisi = run.status === "ACTIVE" ? konumMetni(konum?.age_seconds) : null;
  return (
    // Satırın tamamı detaya götürür (dokunmatik dostu); bağlantı klavye erişimi için kalır, iç içe a/button yok.
    <Flex
      data-testid={`tur-${run.id}`}
      align="center"
      justify="space-between"
      gap={12}
      wrap
      onClick={() => navigate(ROUTES.adminDeliveryRun(run.id))}
      style={{ padding: "12px 0", cursor: "pointer", borderBottom: sonMu ? "none" : `1px solid ${ayrac}` }}
    >
      <div style={{ minWidth: 0, flex: "1 1 200px" }}>
        {/* GEÇİCİ: eski tur detayı rotası; yeni detay gelince çevrilecek. */}
        <Link to={ROUTES.adminDeliveryRun(run.id)} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 500 }}>Tur #{run.id}</Link>
        <Typography.Text type="secondary" style={{ marginLeft: 8 }}>{run.vehicle}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }}>
          {run.courier ? run.courier.name : "Kurye atanmadı"}
          {konumYazisi ? <Typography.Text type="success" style={{ fontSize: 12 }}> · {konumYazisi}</Typography.Text> : null}
        </Typography.Text>
      </div>
      <Flex align="center" gap={8} wrap>
        {toplam > 0 ? <Typography.Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{biten}/{toplam} durak</Typography.Text> : null}
        <Tag color={DURUM_RENGI[run.status] ?? "default"} style={{ marginInlineEnd: 0 }}>{RUN_STATUS_LABEL[run.status] ?? run.status}</Tag>
      </Flex>
    </Flex>
  );
}

export function DagitimBugun() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const { canView, canManage } = useAdminAreaAccess("delivery");
  const [params, setParams] = useSearchParams();
  const tarih = tarihNo(params.get("tarih"));
  const tarihiAyarla = (d: string) => {
    const yeni = tarihNo(d);
    setParams(yeni === todayIso() ? {} : { tarih: yeni });
  };

  const saglik = useRoutingHealth(canView);
  const istisnalar = useAttentionOrders(canView);
  const turlar = useDeliveryRuns(tarih, canView);
  const araclar = useVehicles(canView && canManage);
  const uygunlar = useEligibleOrders(canView && canManage);
  const yenidenDene = useRetryExhausted();
  const turOlustur = useCreateDeliveryRun();
  const gunuOptimize = useDispatchDay();

  const [aracId, setAracId] = useState<number | null>(null);
  // İşlem bazlı kilitler: uçuştaki söz aynı tick'te yeniden kullanılır; işlemler birbirini kilitlemez.
  const kilitRef = useRef(new Map<string, Promise<unknown>>());

  const istisnaListesi: DeliveryEligibleOrder[] = Array.isArray(istisnalar.data) ? istisnalar.data : [];
  // Destek sorguları: kullanılabilir veri yoksa (ilk yükleme ya da hata) yazma işlemi çalışmaz;
  // önbellekte veri varken arka plan tazeleme hatası mevcut veriyi çöpe atmaz, yalnız uyarı gösterir.
  const aracHazir = Array.isArray(araclar.data);
  const aracHatasi = araclar.isError && !aracHazir;
  const aracUyarisi = araclar.isError && aracHazir;
  const uygunHazir = Array.isArray(uygunlar.data);
  const uygunHatasi = uygunlar.isError && !uygunHazir;
  const uygunUyarisi = uygunlar.isError && uygunHazir;
  const aracListesi = aracHazir ? (araclar.data as Vehicle[]) : [];
  const aktifAraclar = aracListesi.filter((v) => v.is_active);
  // Seçim yalnız hâlâ aktif bir araçsa geçerlidir; aksi hâlde ilk aktif araç (bayat id sunucuya gitmez).
  const seciliArac = aracId != null && aktifAraclar.some((v) => v.id === aracId) ? aracId : aktifAraclar[0]?.id ?? null;
  const uygunListesi = uygunHazir ? (uygunlar.data as DeliveryEligibleOrder[]) : [];
  // Yalnız konumu (lat/lng) olan uygun siparişler bölüştürülebilir.
  const dagitilabilir = uygunListesi.filter((o) => o.lat != null && o.lng != null).length;
  const turListesi = useMemo(() => turlariSirala(Array.isArray(turlar.data) ? turlar.data : []), [turlar.data]);

  /** Uçuştaki işi yeniden kullanan onay/aksiyon sarmalayıcısı (aynı tick çift tık → tek mutation). */
  const kilitli = (anahtar: string, calistir: () => Promise<unknown>) => {
    const uctaki = kilitRef.current.get(anahtar);
    if (uctaki) return uctaki;
    const soz = calistir().finally(() => kilitRef.current.delete(anahtar));
    kilitRef.current.set(anahtar, soz);
    return soz;
  };

  const yenidenDeneOnayi = (siparisId: number) => {
    const anahtar = `retry:${siparisId}`;
    if (kilitRef.current.has(anahtar)) return;
    modal.confirm({
      title: "Yeni teslimat denemesi planla",
      content: `Sipariş #${siparisId} müşteriyle görüşüldüğü kabul edilerek yeniden dağıtım kuyruğuna alınacak.`,
      okText: "Yeniden dene",
      cancelText: "Vazgeç",
      // ESC onayı pending'de kapatabilir ve onCancel dönüşünü yok sayar; klavye kapatması kapalı.
      keyboard: false,
      onCancel: () => (kilitRef.current.has(anahtar) ? Promise.reject(new Error("bekleniyor")) : undefined),
      onOk: () =>
        kilitli(anahtar, () =>
          yenidenDene
            .mutateAsync(siparisId)
            .then(() => {
              message.success(`#${siparisId} yeniden dağıtım kuyruğuna alındı.`);
            })
            .catch((e: unknown) => {
              message.error(getErrorDetail(e, "İşlem başarısız."));
              throw e;
            }),
        ),
    });
  };

  const yeniTur = () => {
    // Araç sorgusu bitmeden ya da hatalıyken istek atılmaz; hata/yükleme durumu ekranda yazılıdır.
    if (!aracHazir) return;
    if (seciliArac == null) {
      message.error("Önce bir araç tanımlayın: Araçlar sekmesinden eklenir.");
      return;
    }
    // Hedef tarih ve araç tıklama anında sabitlenir.
    const govde = { run_date: tarih, vehicle_id: seciliArac };
    void kilitli("create", () =>
      turOlustur
        .mutateAsync(govde)
        .then((r) => {
          message.success("Tur oluşturuldu.");
          // GEÇİCİ: sunucunun döndürdüğü tur ID'siyle eski tur detayına gidilir.
          navigate(ROUTES.adminDeliveryRun(r.id));
        })
        .catch((e: unknown) => {
          message.error(getErrorDetail(e, "Tur oluşturulamadı."));
        }),
    );
  };

  const optimizeOnayi = () => {
    // Uygun sipariş sorgusu bitmeden ya da hatalıyken onay açılmaz (dağıtılabilir sayısı bilinmiyor).
    if (!uygunHazir || dagitilabilir === 0 || kilitRef.current.has("dispatch")) return;
    const hedefTarih = tarih;
    const adet = dagitilabilir;
    modal.confirm({
      title: "Günü optimize et",
      content: `${adet} konumlu sipariş aktif araçlara bölüştürülüp optimize turlar kurulacak. Mevcut planlı turlara durak eklenebilir.`,
      okText: "Turları kur",
      cancelText: "Vazgeç",
      keyboard: false,
      onCancel: () => (kilitRef.current.has("dispatch") ? Promise.reject(new Error("bekleniyor")) : undefined),
      onOk: () =>
        kilitli("dispatch", () =>
          gunuOptimize
            .mutateAsync(hedefTarih)
            .then((kurulan) => {
              message.success(kurulan.length > 1 ? `Gün ${kurulan.length} araca bölüştürüldü.` : "Günün turu kuruldu ve optimize edildi.");
              // GEÇİCİ: ilk kurulan tur eski detayda açılır.
              if (kurulan[0]) navigate(ROUTES.adminDeliveryRun(kurulan[0].id));
            })
            .catch((e: unknown) => {
              message.error(getErrorDetail(e, "Günü optimize etme başarısız."));
              throw e;
            }),
        ),
    });
  };

  if (!canView) return <AccessDenied area="Dağıtım" />;

  const kart = { background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4 };
  const ayrac = token.colorBorderSecondary;

  const istisnaYuzeyi = istisnalar.isError ? (
    <HataDurumu hata={getErrorDetail(istisnalar.error, "İstisna kuyruğu yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void istisnalar.refetch()}>Tekrar dene</Button>} />
  ) : istisnalar.isPending ? null : istisnaListesi.length === 0 ? (
    <Typography.Text type="secondary">İstisna yok: karar bekleyen sipariş bulunmuyor.</Typography.Text>
  ) : (
    <section aria-label="İstisna kuyruğu" style={{ ...kart, borderColor: token.colorErrorBorder }}>
      <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
        <div>
          <Typography.Text style={{ fontWeight: 500, display: "block" }}>İstisna kuyruğu</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Birkaç kez teslim edilemeyen siparişler: karar bekliyor (yeniden dene / iade).</Typography.Text>
        </div>
        <Tag color="error" style={{ marginInlineEnd: 0 }}>{istisnaListesi.length}</Tag>
      </Flex>
      <div style={{ padding: "0 24px" }}>
        {istisnaListesi.map((o, i, dizi) => (
          <Flex key={o.order_id} data-testid={`istisna-${o.order_id}`} align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}>
            <div style={{ minWidth: 0, flex: "1 1 200px" }}>
              <Typography.Text style={{ fontWeight: 500 }}>{o.recipient ?? "-"}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>#{o.order_id}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", overflowWrap: "anywhere" }}>{o.address ?? "Adres yok"}</Typography.Text>
            </div>
            <Flex align="center" gap={8} wrap>
              <Typography.Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{formatTL(o.total)}</Typography.Text>
              {canManage ? <Button onClick={() => yenidenDeneOnayi(o.order_id)}>Yeniden Dene</Button> : null}
            </Flex>
          </Flex>
        ))}
      </div>
    </section>
  );

  const yeniTurDugmesi = (
    <Button disabled={!aracHazir} loading={turOlustur.isPending} onClick={yeniTur}>Yeni Tur</Button>
  );
  const optimizeDugmesi = (
    <Button type="primary" disabled={!uygunHazir || dagitilabilir === 0} loading={gunuOptimize.isPending} onClick={optimizeOnayi}>
      Günü Optimize Et{dagitilabilir > 0 ? ` (${dagitilabilir})` : ""}
    </Button>
  );

  const turGovdesi = turlar.isError ? (
    <div style={{ padding: "16px 0" }}>
      <HataDurumu hata={getErrorDetail(turlar.error, "Turlar yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void turlar.refetch()}>Tekrar dene</Button>} />
    </div>
  ) : turlar.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Turlar yükleniyor…" /></div>
  ) : turListesi.length === 0 ? (
    <div style={{ padding: "16px 0" }}>
      <BosDurumu baslik="Bu tarihte tur yok" aciklama="Ödenmiş fiziksel siparişleri dağıtmak için yeni bir tur oluşturun ya da Günü Optimize Et ile araçlara bölüştürün." aksiyon={canManage ? yeniTurDugmesi : undefined} />
    </div>
  ) : (
    turListesi.map((r, i, dizi) => <TurSatiri key={r.id} run={r} sonMu={i === dizi.length - 1} ayrac={ayrac} />)
  );

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Bugün</Typography.Title>
        <Flex align="center" gap={8} wrap>
          <Input type="date" aria-label="Tur tarihi" value={tarih} onChange={(e) => tarihiAyarla(e.target.value)} style={{ width: 170, height: 40 }} />
          {canManage ? (
            <>
              {/* Araç seçimi yalnız "Yeni Tur"un girdisidir; salt okunur kullanıcıya çizilmez. */}
              <Typography.Text type="secondary">Araç</Typography.Text>
              <Select<number>
                aria-label="Araç"
                value={seciliArac ?? undefined}
                placeholder={araclar.isPending ? "Araçlar yükleniyor…" : aracHatasi ? "Araçlar yüklenemedi" : "Araç yok"}
                loading={araclar.isPending}
                options={aktifAraclar.map((v) => ({ value: v.id, label: v.label }))}
                onChange={(v) => setAracId(v)}
                disabled={aktifAraclar.length === 0}
                style={{ width: 180 }}
              />
              {yeniTurDugmesi}
              {!uygunHazir ? (
                <Tooltip title={uygunHatasi ? "Dağıtılabilir siparişler yüklenemedi." : "Dağıtılabilir siparişler yükleniyor…"}>{optimizeDugmesi}</Tooltip>
              ) : dagitilabilir === 0 ? (
                <Tooltip title="Dağıtılacak konumlu sipariş yok: önce Siparişler sekmesinden hazırlayın.">{optimizeDugmesi}</Tooltip>
              ) : (
                optimizeDugmesi
              )}
            </>
          ) : null}
        </Flex>
      </Flex>

      {!canManage ? <Alert type="info" showIcon message="Salt okunur görünüm: tur oluşturma, optimize ve yeniden deneme için delivery.manage izni gerekir." /> : null}

      {/* Sağlık şeridi yalnız degraded=true iken; sağlık hatası kokpiti bloklamaz. */}
      {saglik.data?.degraded ? (
        <Alert type="warning" showIcon message="Rota optimizasyonu yaklaşık modda." description="Yol ağı servisi (VROOM/OSRM) erişilemiyor: durak sıraları ve ETA'lar kuş uçuşu tahminle hesaplanır." />
      ) : null}

      {/* Destek sorgularının hata/yükleme durumları; istisna kuyruğunu ve turları bloklamaz. */}
      {canManage && aracHatasi ? (
        <HataDurumu hata="Araçlar yüklenemedi." hataAksiyon={<Button size="small" onClick={() => void araclar.refetch()}>Tekrar dene</Button>} />
      ) : null}
      {canManage && aracUyarisi ? <Alert type="warning" showIcon message="Araç listesi tazelenemedi; son bilinen araç listesiyle devam edebilirsiniz." /> : null}
      {canManage && araclar.isPending ? <Typography.Text type="secondary">Araçlar yükleniyor…</Typography.Text> : null}
      {canManage && uygunHatasi ? (
        <HataDurumu hata="Dağıtılabilir siparişler yüklenemedi." hataAksiyon={<Button size="small" onClick={() => void uygunlar.refetch()}>Tekrar dene</Button>} />
      ) : null}
      {canManage && uygunUyarisi ? <Alert type="warning" showIcon message="Dağıtılabilir sipariş listesi tazelenemedi; son bilinen hesapla devam edebilirsiniz." /> : null}
      {canManage && uygunlar.isPending ? <Typography.Text type="secondary">Dağıtılabilir siparişler yükleniyor…</Typography.Text> : null}
      {canManage && uygunHazir && dagitilabilir === 0 ? (
        <Typography.Text type="secondary">Dağıtılacak konumlu sipariş yok; Günü Optimize Et kapalı.</Typography.Text>
      ) : null}

      {istisnaYuzeyi}

      <section aria-label="Günün turları" style={kart}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
          <Typography.Text style={{ fontWeight: 500, display: "block" }}>Günün turları</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Turu planla, etiketleri bas, sahaya çık: detay için tura tıkla.</Typography.Text>
        </div>
        <CapacityStrip selectedDate={tarih} onSelectDate={tarihiAyarla} />
        <div style={{ padding: "0 24px" }}>{turGovdesi}</div>
      </section>
    </Flex>
  );
}
