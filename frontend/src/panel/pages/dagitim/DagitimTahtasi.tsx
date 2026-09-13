// Dağıtım → Tahta — eski DeliveryBoardPage panel düzeninde: atanmamış sipariş havuzu + sunucunun döndürdüğü
// araç/tur şeritleri. Havuzdaki sipariş bir tura SÜRÜKLENİP bırakılır ya da aynı işlemi yapan erişilebilir
// "Tura ekle" aksiyonuyla gönderilir (POST /delivery/runs/{id}/stops). Sürüklenen kimlik `dataTransfer`'da DEĞİL
// component state'inde taşınır (D-11): HTML5 dataTransfer drop öncesi okunamaz ve jsdom'da yoktur.
//
// Kapasite sözleşmesi (D-12): açık `max_stops` aşılıyorsa uyarı GÖRÜNÜR ama işlem ENGELLENMEZ — karar operatörün.
// `max_stops = null` "sınırsız" DEĞİL, sunucu varsayılanıdır (`DELIVERY_MAX_STOPS_PER_RUN`): istemci sayısal
// tavan uydurmaz ve null için aşım hesaplamaz.
import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, App, Button, Flex, Input, Select, Tag, Tooltip, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { todayIso } from "@/components/admin/delivery/bits";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { tarihNo } from "@/panel/pages/dagitim/DagitimBugun";
import { useAddBoardStops, useDeliveryBoard, useDispatchDay, useVehicles } from "@/hooks/useDelivery";
import { RUN_STATUS_LABEL } from "@/lib/deliveryRun";
import { getErrorDetail } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import type { BoardPoolOrder, BoardRun } from "@/api/delivery";
import type { Vehicle } from "@/types";

const DURUM_RENGI: Record<string, string> = { PLANNED: "default", ACTIVE: "processing", DONE: "success", CANCELLED: "error" };
const SAYI: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
const SAR: React.CSSProperties = { overflowWrap: "anywhere" };
// Görsel olarak gizli ama ekran okuyucuya açık etiket: rc-select `aria-label`'ı kök `div`'e basar, odaklanan
// `role="combobox"` girdisi bunu ad olarak saymaz — gerçek `label htmlFor` + `Select id` gerekir.
const GIZLI_ETIKET: React.CSSProperties = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

/** İptal edilmiş duraklar kapasiteye sayılmaz (sipariş düşmüş, koltuk boş). */
export function aktifDurakSayisi(run: BoardRun): number {
  return run.stops.filter((s) => s.status !== "CANCELLED").length;
}
/** Turlar id artan; duraklar sequence artan. */
export function turlariSirala(runs: BoardRun[]): BoardRun[] {
  return [...runs].sort((a, b) => a.id - b.id);
}
export function duraklariSirala(run: BoardRun): BoardRun["stops"] {
  return [...run.stops].sort((a, b) => a.sequence - b.sequence);
}
/** Araç adı: vehicles.label → run.vehicle → "Araç {id}". */
export function aracAdi(run: BoardRun, arac?: Vehicle): string {
  return arac?.label ?? run.vehicle ?? `Araç ${run.vehicle_id}`;
}
/**
 * Doluluk metni. Açık `max_stops` varsa "N/max durak"; null ise sunucu varsayılanı geçerlidir ve istemci sayı
 * uydurmaz — "N durak · varsayılan tavan".
 */
export function dolulukMetni(sayi: number, max: number | null | undefined): string {
  return max != null ? `${sayi}/${max} durak` : `${sayi} durak · varsayılan tavan`;
}
/** Yalnız açık tavan aşılıyorsa uyarı; null tavanda istemci aşım hesaplamaz. */
export function tavaniAsarMi(sayi: number, max: number | null | undefined): boolean {
  return max != null && sayi > max;
}
/**
 * Dağıtım adayları — backend `dispatch_day` filtresiyle BİREBİR: konumu olan (lat+lng) ve sözü seçili günü
 * aşmayan siparişler (`promised_delivery_date` null ya da <= tarih). Gelecek güne sözlenmiş sipariş bugünkü
 * sayıya girmez. Sayı bir GARANTİ değildir: araç kapasitesine sığmayanlar havuzda kalabilir.
 */
export function dagitimAdaylari(havuz: BoardPoolOrder[], tarih: string): BoardPoolOrder[] {
  return havuz.filter((o) => o.lat != null && o.lng != null && (o.promised_delivery_date == null || o.promised_delivery_date <= tarih));
}
export function dagitilabilirSayisi(havuz: BoardPoolOrder[], tarih: string): number {
  return dagitimAdaylari(havuz, tarih).length;
}

/** Sunucu tutarı (Decimal → string) güvenli biçimlendirme; sayısal olmayan değer ekranı çökertmez. */
const TUTAR_BICIMI = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" });
export function tutarMetni(deger: string | number | null | undefined): string | null {
  const n = parseMoney(deger);
  return n === null ? null : TUTAR_BICIMI.format(n);
}

export function DagitimTahtasi() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("delivery");
  const [params, setParams] = useSearchParams();
  const tarih = tarihNo(params.get("tarih"));

  const tahta = useDeliveryBoard(tarih, canView);
  const araclar = useVehicles(canView);
  const durakEkle = useAddBoardStops();
  const gunuOptimize = useDispatchDay();

  // Sürüklenen sipariş, yerel kapasite uyarıları ve "Tura ekle" hedef seçimleri güne aittir: tarih değişince silinir.
  const [suruklenen, setSuruklenen] = useState<number | null>(null);
  const [surukleHedefi, setSurukleHedefi] = useState<number | null>(null);
  // Kalıcı uyarı YALNIZ başarıya ulaşan ekleme sonrası yazılır; pending sırasında geçici sayaç gösterilir
  // (aynı tura sıralanmış eklemelerde biri diğerinin uyarısını silmesin diye sayaç, bayrak değil).
  const [uyarilar, setUyarilar] = useState<Record<number, boolean>>({});
  const [bekleyenAsimlar, setBekleyenAsimlar] = useState<Record<number, number>>({});
  const [hedefler, setHedefler] = useState<Record<number, number>>({});
  const [hatalar, setHatalar] = useState<Record<number, string | undefined>>({});

  // Yazma koordinasyonu: aynı sipariş iki kez gönderilmez; aynı tura eklemeler SIRAYA alınır (backend `sequence`'i
  // istek başına kilitsiz hesaplıyor), farklı turlar paralel çalışır; optimize ile ekleme birbirini dışlar.
  const ucustakiSiparisRef = useRef(new Set<number>());
  const [ucustakiSiparisler, setUcustakiSiparisler] = useState<number[]>([]);
  const turZinciriRef = useRef(new Map<number, Promise<unknown>>());
  const eklemeSayaciRef = useRef(0);
  const [eklemeKuyrugu, setEklemeKuyrugu] = useState(0);
  const optimizeRef = useRef<Promise<unknown> | null>(null);
  const [optimizeSuruyor, setOptimizeSuruyor] = useState(false);

  const tarihiAyarla = (ham: string) => {
    const yeni = tarihNo(ham);
    // Bugün seçilince yalnız `tarih` anahtarı silinir; ilgisiz parametreler korunur.
    const sonraki = new URLSearchParams(params);
    if (yeni === todayIso()) sonraki.delete("tarih");
    else sonraki.set("tarih", yeni);
    setParams(sonraki, { replace: true });
    setSuruklenen(null);
    setSurukleHedefi(null);
    setUyarilar({});
    setBekleyenAsimlar({});
    setHedefler({});
    setHatalar({});
  };

  const havuz: BoardPoolOrder[] = Array.isArray(tahta.data?.unassigned) ? tahta.data!.unassigned : [];
  const turlar = useMemo(() => turlariSirala(Array.isArray(tahta.data?.runs) ? tahta.data!.runs : []), [tahta.data]);
  // Destek sorgusu: veri yoksa etiket yedeğine düşülür, önbellekli veri arka plan hatasında çöpe atılmaz.
  const aracHazir = Array.isArray(araclar.data);
  const aracHatasi = araclar.isError && !aracHazir;
  const aracUyarisi = araclar.isError && aracHazir;
  const aracHaritasi = useMemo(() => new Map((aracHazir ? (araclar.data as Vehicle[]) : []).map((v) => [v.id, v])), [araclar.data, aracHazir]);
  const aktifAracSayisi = aracHazir ? (araclar.data as Vehicle[]).filter((v) => v.is_active).length : 0;
  const dagitilabilir = dagitilabilirSayisi(havuz, tarih);
  const tahtaHazir = Boolean(tahta.data);

  const ekleniyorMu = (siparisId: number) => ucustakiSiparisler.includes(siparisId);
  /** Ekleme neden kapalı (görünür ve erişilebilir neden); null ise açık. */
  const eklemeEngeli = (siparisId: number): string | null => {
    if (optimizeSuruyor) return "Gün optimize ediliyor; bitince deneyin.";
    if (turlar.length === 0) return "Bu tarihte tur yok: önce tur kurun.";
    if (ekleniyorMu(siparisId)) return "Bu sipariş için ekleme sürüyor.";
    return null;
  };
  /** Optimize neden kapalı; null ise açık. */
  const optimizeEngeli = (): string | null => {
    if (eklemeKuyrugu > 0) return "Tura sipariş ekleniyor; bitince deneyin.";
    if (tahta.isError && !tahtaHazir) return "Tahta yüklenemedi: dağıtılacak sipariş sayısı bilinmiyor.";
    if (!tahtaHazir) return "Tahta yükleniyor.";
    // Filoyu bilmeden dağıtım başlatılmaz; önbellekli veri + tazeleme hatasında mevcut bilgiyle devam edilir.
    if (!aracHazir && araclar.isPending) return "Araçlar yükleniyor.";
    if (!aracHazir) return "Aktif araç bilgisi yüklenemedi.";
    if (aktifAracSayisi === 0) return "Aktif araç yok.";
    if (dagitilabilir === 0) return "Dağıtılacak konumlu sipariş yok.";
    return null;
  };

  /** Havuzdaki siparişi tura ekler. Hedef tarih/tur/sipariş kimlikleri çağrı anında sabitlenir. */
  const turaEkle = async (siparisId: number, run: BoardRun) => {
    if (!canManage) return;
    // Senkron kapılar: aynı sipariş iki kez uçmaz, optimize sürerken ekleme başlamaz.
    if (optimizeRef.current !== null || ucustakiSiparisRef.current.has(siparisId)) return;
    const hedefTurId = run.id;
    const max = aracHaritasi.get(run.vehicle_id)?.max_stops;
    // Uyarı işlemi ENGELLEMEZ (D-12): istek her hâlde gider. Ama kalıcı uyarı yalnız ekleme BAŞARIRSA yazılır —
    // aksi hâlde başarısız eklemeden sonra eklenmemiş durak eklenmiş sanılırdı.
    const asacak = tavaniAsarMi(aktifDurakSayisi(run) + 1, max);
    if (asacak) setBekleyenAsimlar((b) => ({ ...b, [hedefTurId]: (b[hedefTurId] ?? 0) + 1 }));

    ucustakiSiparisRef.current.add(siparisId);
    setUcustakiSiparisler([...ucustakiSiparisRef.current]);
    eklemeSayaciRef.current += 1;
    setEklemeKuyrugu(eklemeSayaciRef.current);
    setHatalar((h) => ({ ...h, [siparisId]: undefined }));
    try {
      // Tur düzeyinde sıraya alma: aynı tura iki farklı sipariş paralel gitmez (aynı `sequence` üretilebilirdi);
      // önceki halkanın hatası sıradakini durdurmaz.
      const onceki = turZinciriRef.current.get(hedefTurId) ?? Promise.resolve();
      const soz = onceki.catch(() => undefined).then(() => durakEkle.mutateAsync({ runId: hedefTurId, orderIds: [siparisId] }));
      turZinciriRef.current.set(hedefTurId, soz);
      await soz;
      if (asacak) setUyarilar((u) => (u[hedefTurId] ? u : { ...u, [hedefTurId]: true }));
      message.success(`Sipariş #${siparisId} Tur #${hedefTurId}'e eklendi.`);
    } catch (e) {
      setHatalar((h) => ({ ...h, [siparisId]: getErrorDetail(e, "Durak eklenemedi.") }));
    } finally {
      if (asacak) {
        setBekleyenAsimlar((b) => {
          const kalan = Math.max(0, (b[hedefTurId] ?? 0) - 1);
          const sonraki = { ...b };
          if (kalan === 0) delete sonraki[hedefTurId];
          else sonraki[hedefTurId] = kalan;
          return sonraki;
        });
      }
      ucustakiSiparisRef.current.delete(siparisId);
      setUcustakiSiparisler([...ucustakiSiparisRef.current]);
      eklemeSayaciRef.current -= 1;
      setEklemeKuyrugu(eklemeSayaciRef.current);
      if (turZinciriRef.current.get(hedefTurId) !== undefined && eklemeSayaciRef.current === 0) turZinciriRef.current.delete(hedefTurId);
    }
  };

  const birak = (run: BoardRun) => {
    const siparisId = suruklenen;
    setSuruklenen(null);
    setSurukleHedefi(null);
    if (siparisId == null) return;
    void turaEkle(siparisId, run);
  };

  const optimizeOnayi = () => {
    if (!canManage || optimizeEngeli() !== null || optimizeRef.current !== null) return;
    const hedefTarih = tarih;
    const adet = dagitilabilir;
    modal.confirm({
      title: "Günü optimize et",
      content: `${adet} konumlu sipariş aktif filo araçlarına dağıtılmak üzere değerlendirilecek ve turlar optimize edilecek. Araç kapasitesine sığmayan siparişler havuzda kalabilir; mevcut planlı turlara durak eklenebilir.`,
      okText: "Turları kur",
      cancelText: "Vazgeç",
      // ESC pending'de kapatabilir ve onCancel dönüşünü yok sayar; klavye kapatması kapalı.
      keyboard: false,
      onCancel: () => (optimizeRef.current !== null ? Promise.reject(new Error("bekleniyor")) : undefined),
      onOk: () => {
        // Aynı tick çift onay: uçuştaki söz paylaşılır, ikinci mutation çıkmaz.
        if (optimizeRef.current) return optimizeRef.current;
        // Onay penceresi açıkken ekleme başlamış olabilir: çapraz kilit ONAY ANINDA da senkron doğrulanır
        // (backend `add_stops` sıra numarasını kilitsiz hesaplıyor; paralel dispatch çakışan sequence üretebilir).
        if (eklemeSayaciRef.current > 0) {
          message.warning("Tura sipariş ekleniyor; bitince deneyin.");
          return Promise.reject(new Error("bekleniyor"));
        }
        const soz = gunuOptimize
          .mutateAsync(hedefTarih)
          .then((kurulan) => {
            message.success(kurulan.length > 1 ? `Gün ${kurulan.length} araca bölüştürüldü.` : "Günün turu kuruldu ve optimize edildi.");
            setUyarilar({});
          })
          .catch((e: unknown) => {
            message.error(getErrorDetail(e, "Günü optimize etme başarısız."));
            throw e;
          })
          .finally(() => {
            optimizeRef.current = null;
            setOptimizeSuruyor(false);
          });
        optimizeRef.current = soz;
        setOptimizeSuruyor(true);
        return soz;
      },
    });
  };

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
  const optimizeNedeni = optimizeEngeli();

  const bolumHatasi = <Typography.Text type="secondary" style={{ display: "block", padding: "16px 0" }}>Tahta yüklenemedi; yukarıdan tekrar deneyin.</Typography.Text>;
  const havuzGovdesi = tahta.isError && !tahtaHazir ? bolumHatasi : !tahtaHazir ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Havuz yükleniyor…" /></div>
  ) : havuz.length === 0 ? (
    <div style={{ padding: "16px 0" }}><BosDurumu baslik="Havuz boş" aciklama="Dağıtım bekleyen atanmamış sipariş yok." /></div>
  ) : (
    havuz.map((o, i, dizi) => {
      const engel = eklemeEngeli(o.order_id);
      const hedef = hedefler[o.order_id] ?? turlar[0]?.id;
      const satirHatasi = hatalar[o.order_id];
      return (
        <div
          key={o.order_id}
          data-testid={`havuz-siparis-${o.order_id}`}
          draggable={canManage && !optimizeSuruyor}
          onDragStart={canManage ? (e) => {
            // Kimlik STATE'te taşınır (D-11); `setData` yalnız sürüklemenin başlaması için beyan (Firefox şart koşar).
            e.dataTransfer.setData("text/plain", String(o.order_id));
            e.dataTransfer.effectAllowed = "move";
            setSuruklenen(o.order_id);
          } : undefined}
          onDragEnd={canManage ? () => { setSuruklenen(null); setSurukleHedefi(null); } : undefined}
          style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}`, cursor: canManage && !optimizeSuruyor ? "grab" : undefined }}
        >
          <Flex align="center" justify="space-between" gap={12} wrap>
            <div style={{ minWidth: 0, flex: "1 1 200px" }}>
              <Flex align="baseline" gap={8} wrap>
                <Typography.Text style={{ fontWeight: 500, ...SAR }}>{o.recipient ?? "Sipariş"}</Typography.Text>
                <Link to={ROUTES.adminNewOrder(o.order_id)} style={SAYI}>#{o.order_id}</Link>
              </Flex>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", ...SAR }}>{o.address ?? "Adres yok"}</Typography.Text>
            </div>
            {tutarMetni(o.total) ? <Typography.Text type="secondary" style={{ fontSize: 12, ...SAYI }}>{tutarMetni(o.total)}</Typography.Text> : null}
            {canManage ? (
              <Flex align="center" gap={8} wrap style={{ minWidth: 0 }}>
                {/* Sürükle-bırak tek yol değil: aynı `useAddBoardStops` işleminin klavye/dokunma karşılığı. */}
                <label htmlFor={`hedef-tur-${o.order_id}`} style={GIZLI_ETIKET}>{`Sipariş #${o.order_id} için hedef tur`}</label>
                <Select<number>
                  id={`hedef-tur-${o.order_id}`}
                  value={turlar.length > 0 ? hedef : undefined}
                  placeholder="Tur yok"
                  disabled={turlar.length === 0}
                  onChange={(v) => setHedefler((h) => ({ ...h, [o.order_id]: v }))}
                  style={{ minWidth: 148, maxWidth: 240 }}
                  options={turlar.map((r) => ({ value: r.id, label: `Tur #${r.id} · ${aracAdi(r, aracHaritasi.get(r.vehicle_id))}` }))}
                />
                {/* Kapalı düğmede tarayıcı `title`'ı çoğu kez görünmez: neden Tooltip sarmalayıcıda da verilir. */}
                <Tooltip title={engel ?? undefined}>
                  <Button
                    aria-label={`Sipariş #${o.order_id} için tura ekle`}
                    loading={ekleniyorMu(o.order_id)}
                    disabled={engel !== null && !ekleniyorMu(o.order_id)}
                    title={engel ?? undefined}
                    onClick={() => {
                      const run = turlar.find((r) => r.id === hedef);
                      if (run) void turaEkle(o.order_id, run);
                    }}
                  >
                    Tura ekle
                  </Button>
                </Tooltip>
              </Flex>
            ) : null}
          </Flex>
          {satirHatasi ? <div style={{ marginTop: 8 }}><HataDurumu hata={satirHatasi} /></div> : null}
        </div>
      );
    })
  );

  const turGovdesi = tahta.isError && !tahtaHazir ? bolumHatasi : !tahtaHazir ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Turlar yükleniyor…" /></div>
  ) : turlar.length === 0 ? (
    <div style={{ padding: "16px 0" }}><BosDurumu baslik="Bu tarihte tur yok" aciklama="Günü Optimize Et ile araçlara bölüştürün ya da Bugün ekranından elle tur kurun." /></div>
  ) : (
    turlar.map((run, i, dizi) => {
      const arac = aracHaritasi.get(run.vehicle_id);
      const sayi = aktifDurakSayisi(run);
      const max = arac?.max_stops ?? null;
      // Sunucu verisi zaten tavan üstündeyse ya da BAŞARILI bir ekleme aşımı ürettiyse kalıcı uyarı.
      const asiyor = Boolean(uyarilar[run.id]) || tavaniAsarMi(sayi, max);
      const bekleyenAsim = !asiyor && (bekleyenAsimlar[run.id] ?? 0) > 0;
      const duraklar = duraklariSirala(run);
      const etiket = aracAdi(run, arac);
      const surukleniyor = suruklenen != null;
      return (
        <div
          key={run.id}
          data-testid={`tur-${run.id}`}
          onDragOver={canManage ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } : undefined}
          onDragEnter={canManage ? () => setSurukleHedefi(run.id) : undefined}
          onDragLeave={canManage ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSurukleHedefi((h) => (h === run.id ? null : h)); } : undefined}
          onDrop={canManage ? (e) => { e.preventDefault(); birak(run); } : undefined}
          style={{
            padding: "12px 0",
            borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}`,
            // Sürükleme sürerken geçerli hedefler işaretlenir; üzerinde durulan şerit ayrıca zeminle ayrışır.
            outline: canManage && surukleniyor ? `2px dashed ${token.colorPrimary}` : undefined,
            outlineOffset: canManage && surukleniyor ? -4 : undefined,
            borderRadius: canManage && surukleniyor ? 4 : undefined,
            background: canManage && surukleniyor && surukleHedefi === run.id ? token.colorPrimaryBg : undefined,
          }}
        >
          <Flex align="center" justify="space-between" gap={12} wrap>
            <div style={{ minWidth: 0, flex: "1 1 200px" }}>
              <Flex align="baseline" gap={8} wrap>
                <Link to={ROUTES.adminNewDeliveryRun(run.id)} style={{ fontWeight: 500, ...SAYI }}>Tur #{run.id}</Link>
                <Typography.Text type="secondary" style={{ fontSize: 12, ...SAR }}>{etiket}</Typography.Text>
              </Flex>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", ...SAR }}>{run.courier ? run.courier.name : "Kurye atanmadı"}</Typography.Text>
            </div>
            <Flex align="center" gap={8} wrap>
              <Typography.Text type={asiyor ? "warning" : "secondary"} style={{ fontSize: 12, ...SAYI }}>{dolulukMetni(sayi, max)}</Typography.Text>
              <Tag color={DURUM_RENGI[run.status] ?? "default"} style={{ marginInlineEnd: 0 }}>{RUN_STATUS_LABEL[run.status] ?? run.status}</Tag>
            </Flex>
          </Flex>
          {asiyor ? (
            <div data-testid={`kapasite-uyarisi-${run.id}`} style={{ marginTop: 8 }}>
              <Alert
                type="warning"
                showIcon
                message={`Kapasite uyarısı: ${etiket} için sınır ${max ?? "-"} durak. Ekleme engellenmedi: karar operatörün; gerekirse durağı başka araca taşıyın.`}
              />
            </div>
          ) : null}
          {bekleyenAsim ? (
            <div data-testid={`kapasite-bekleyen-${run.id}`} style={{ marginTop: 8 }}>
              <Typography.Text type="warning" style={{ fontSize: 12 }}>Bu ekleme kapasiteyi aşacak; sonuç bekleniyor.</Typography.Text>
            </div>
          ) : null}
          {duraklar.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
              Durak yok: havuzdan bir sipariş sürükleyip bırakın ya da "Tura ekle" ile gönderin.
            </Typography.Text>
          ) : (
            <Flex vertical gap={4} style={{ marginTop: 8 }}>
              {duraklar.map((s) => (
                <Flex key={s.id} align="baseline" gap={8} wrap>
                  <Typography.Text type="secondary" style={{ fontSize: 12, minWidth: 20, ...SAYI }}>{s.sequence}.</Typography.Text>
                  <Typography.Text style={{ fontSize: 12, flex: "1 1 160px", minWidth: 0, ...SAR }}>{s.address ?? `Sipariş #${s.order_id}`}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12, ...SAYI }}>#{s.order_id}</Typography.Text>
                </Flex>
              ))}
            </Flex>
          )}
        </div>
      );
    })
  );

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Tahta</Typography.Title>
        <Flex align="center" gap={8} wrap>
          <label htmlFor="tahta-tarih" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Typography.Text type="secondary">Tarih</Typography.Text>
            <Input id="tahta-tarih" type="date" value={tarih} onChange={(e) => tarihiAyarla(e.target.value)} style={{ width: 172, height: 40 }} />
          </label>
          {canManage ? (
            <Tooltip title={optimizeNedeni ?? `${dagitilabilir} konumlu sipariş dağıtım için değerlendirilecek.`}>
              <Button
                type="primary"
                loading={optimizeSuruyor}
                disabled={optimizeNedeni !== null}
                title={optimizeNedeni ?? `${dagitilabilir} konumlu sipariş dağıtım için değerlendirilecek.`}
                onClick={optimizeOnayi}
              >
                Günü Optimize Et{dagitilabilir > 0 ? ` (${dagitilabilir})` : ""}
              </Button>
            </Tooltip>
          ) : null}
        </Flex>
      </Flex>
      {!canManage ? <Typography.Text type="secondary">Salt okunur görünüm: tura sipariş ekleme ve günü optimize etme için delivery.manage izni gerekir.</Typography.Text> : null}
      {aracHatasi ? <HataDurumu hata="Araçlar yüklenemedi." hataAksiyon={<Button size="small" onClick={() => void araclar.refetch()}>Tekrar dene</Button>} /> : null}
      {aracUyarisi ? <HataDurumu hata="Araç bilgisi güncellenemedi; etiket ve kapasite önceki yüklemeden." hataAksiyon={<Button size="small" onClick={() => void araclar.refetch()}>Tekrar dene</Button>} /> : null}
      {araclar.isPending && !aracHatasi && tahtaHazir ? <Typography.Text type="secondary">Araçlar yükleniyor: etiket ve kapasite birazdan görünecek.</Typography.Text> : null}
      {tahta.isError ? <HataDurumu hata={getErrorDetail(tahta.error, "Tahta yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void tahta.refetch()}>Tekrar dene</Button>} /> : null}

      {/* Masaüstünde dengeli iki sütun, dar ekranda tek sütun (flex-basis + wrap). */}
      <Flex gap={16} wrap align="flex-start">
        <section aria-label="Havuz" style={{ ...kart, flex: "1 1 320px", minWidth: 0 }}>
          {bolumBasligi("Havuz", "Atanmamış siparişler: bir tura sürükleyin ya da \"Tura ekle\" ile gönderin.", tahtaHazir ? <Tag style={{ marginInlineEnd: 0 }}>{havuz.length}</Tag> : undefined)}
          <div style={{ padding: "0 24px" }}>{havuzGovdesi}</div>
        </section>
        <section aria-label="Turlar" style={{ ...kart, flex: "1 1 320px", minWidth: 0 }}>
          {bolumBasligi("Turlar", "Günün araç şeritleri: durak sırası sunucudan gelir.", tahtaHazir ? <Tag style={{ marginInlineEnd: 0 }}>{turlar.length}</Tag> : undefined)}
          <div style={{ padding: "0 24px" }}>{turGovdesi}</div>
        </section>
      </Flex>
    </Flex>
  );
}
