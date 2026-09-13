// Dağıtım → Tur Detayı — eski DeliveryRunDetailPage panel düzeninde: tek turun kurulumu ve canlı yürütülmesi.
// Gerçek FSM korunur (PLANNED: optimize/etiket/başlat/iptal · ACTIVE: optimize/etiket/saha/tamamla/iptal ·
// DONE/CANCELLED salt okunur); kesin karar backend'de. Tur sorgusu yalnız ACTIVE turda 15 sn poll eder.
// Sıralama: PENDING duraklar arasında yukarı/aşağı (klavye/dokunmatik) + masaüstü sürükle-bırak; sonuçlanmış
// duraklar sabittir. Koordinatlar metin olarak basılmaz; harita yalnız optimize edilmiş ve konumlu durak varsa.
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, App, Button, Flex, Progress, Select, Tag, Tooltip, Typography, theme } from "antd";
import { ArrowLeftOutlined, ArrowUpOutlined, ArrowDownOutlined, CloseOutlined } from "@ant-design/icons";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { DeliveryRouteMap } from "@/components/DeliveryRouteMap";
import { ItemLines } from "@/components/admin/delivery/ItemLines";
import { LabelSheet } from "@/components/admin/delivery/LabelSheet";
import { DeliveryPrefBadge, PromiseChip, stopStatusText } from "@/components/admin/delivery/bits";
import { HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import {
  useAddStops,
  useCouriers,
  useDeliveryRun,
  useEligibleOrders,
  useOptimizeRun,
  useRemoveStop,
  useReorderStops,
  useRunAction,
  useRunPosition,
  useUpdateDeliveryRun,
} from "@/hooks/useDelivery";
import { FAIL_REASON_LABEL, RUN_STATUS_LABEL, coLocatedPendingStops, hasRunExceptions, runExceptions, runProgress } from "@/lib/deliveryRun";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import { formatDuration, formatEta } from "@/lib/polyline";
import { ROUTES } from "@/lib/routes";
import type { DeliveryEligibleOrder, DeliveryStop } from "@/types";

/** URL kimliği yalnız düz pozitif tam sayı ("abc", "-1", "1e3", "0x10", "42.0", boşluk, güvenli aralık dışı reddedilir). */
export function turKimligi(ham: string | undefined): number | null {
  if (!ham || !/^\d+$/.test(ham)) return null;
  const n = Number(ham);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const DURUM_RENGI: Record<string, string> = { PLANNED: "default", ACTIVE: "processing", DONE: "success", CANCELLED: "error" };
const DURAK_RENGI: Record<string, string> = { PENDING: "default", DELIVERED: "success", FAILED: "error", RESCHEDULED: "warning", CANCELLED: "default" };

/** PENDING durağı sıralama içinde bir adım taşır; sonuçlanmış duraklar üzerinden GEÇİLMEZ. Yeni tam id sırası; taşınamazsa null. */
export function tasinmisSira(sirali: DeliveryStop[], stopId: number, yon: -1 | 1): number[] | null {
  const i = sirali.findIndex((s) => s.id === stopId);
  const j = i + yon;
  if (i < 0 || j < 0 || j >= sirali.length) return null;
  if (sirali[i].status !== "PENDING" || sirali[j].status !== "PENDING") return null;
  const idler = sirali.map((s) => s.id);
  [idler[i], idler[j]] = [idler[j], idler[i]];
  return idler;
}

/** Sürükleyip bırakma: iki PENDING durak arasında taşır; hedef sonuçlanmışsa ya da aynıysa null. */
export function birakilmisSira(sirali: DeliveryStop[], kaynakId: number, hedefId: number): number[] | null {
  if (kaynakId === hedefId) return null;
  const kaynak = sirali.find((s) => s.id === kaynakId);
  const hedef = sirali.find((s) => s.id === hedefId);
  if (!kaynak || !hedef || kaynak.status !== "PENDING" || hedef.status !== "PENDING") return null;
  const idler = sirali.map((s) => s.id);
  const from = idler.indexOf(kaynakId);
  const to = idler.indexOf(hedefId);
  idler.splice(to, 0, ...idler.splice(from, 1));
  return idler;
}

export function DagitimTurDetayi() {
  const { id } = useParams();
  return <DagitimTurDetayiIc key={id ?? ""} id={id} />;
}

function DagitimTurDetayiIc({ id }: { id: string | undefined }) {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const runId = turKimligi(id);
  const gecerli = runId !== null;
  const { canView, canManage } = useAdminAreaAccess("delivery");

  const sorgu = useDeliveryRun(runId, { pollWhenActive: true, enabled: canView && gecerli });
  const run = sorgu.data ?? null;
  const planlama = !!run && canManage && (run.status === "PLANNED" || run.status === "ACTIVE");
  const konum = useRunPosition(runId, canView && run?.status === "ACTIVE");
  const kuryeler = useCouriers(canView && canManage && !!run);
  const uygunlar = useEligibleOrders(canView && planlama);

  const turAksiyonu = useRunAction();
  const optimize = useOptimizeRun();
  const kuryeGuncelle = useUpdateDeliveryRun();
  const sirala = useReorderStops();
  const durakCikar = useRemoveStop();
  const duraklarEkle = useAddStops();

  const [etiketAcik, setEtiketAcik] = useState(false);
  const [haritaAcik, setHaritaAcik] = useState(true);
  const [aksiyonHatasi, setAksiyonHatasi] = useState<string | null>(null);
  const [kuryeHatasi, setKuryeHatasi] = useState<string | null>(null);
  const [bekleyenKurye, setBekleyenKurye] = useState<number | null | undefined>(undefined);
  const [siralamaHatasi, setSiralamaHatasi] = useState<string | null>(null);
  const [eklemeHatalari, setEklemeHatalari] = useState<Record<string, string | undefined>>({});
  const [ucustakiSiparisler, setUcustakiSiparisler] = useState<number[]>([]);
  const [ucustakiDuraklar, setUcustakiDuraklar] = useState<number[]>([]);
  const [surukleHedefi, setSurukleHedefi] = useState<number | null>(null);
  // ── Tur yazma koordinasyonu ──
  // Özel yazma kilidi: turun yapısını/durumunu değiştiren işlemler (start/complete/cancel/optimize/kurye/
  // reorder/remove) aynı anda yalnız BİRİ uçuşta olabilir. Kilit mutation çağrısından önce senkron alınır,
  // başarı/hata/senkron-red yollarında kesin bırakılır. Hedef run/stop/order/kurye ID'leri çağrı anında sabittir.
  // add_stops ayrı bir kuyruktur (farklı siparişler sırayla gönderilir); kuyrukta bekleyen/çalışan iş varken
  // özel yazım başlamaz, özel yazım sürerken de yeni ekleme başlamaz.
  const ozelYazimRef = useRef<{ anahtar: string; soz: Promise<unknown> } | null>(null);
  const [ozelYazim, setOzelYazim] = useState<string | null>(null);
  const eklemeSayaciRef = useRef(0);
  const [eklemeKuyrugu, setEklemeKuyrugu] = useState(0);
  const eklemeZinciriRef = useRef<Promise<unknown>>(Promise.resolve());
  const ucustakiSiparisRef = useRef(new Set<number>());
  const ucustakiDurakRef = useRef(new Set<number>());
  const surukleKaynagi = useRef<number | null>(null);

  const sirali = useMemo(() => (run ? [...run.stops].sort((a, b) => a.sequence - b.sequence) : []), [run]);
  const [biten, toplam] = run ? runProgress(run) : [0, 0];
  const bekleyenSayisi = sirali.filter((s) => s.status === "PENDING").length;
  const konumluBekleyen = sirali.filter((s) => s.status === "PENDING" && s.lat != null && s.lng != null).length;
  const uygunListesi: DeliveryEligibleOrder[] = Array.isArray(uygunlar.data) ? uygunlar.data : [];
  const kuryeListesi = Array.isArray(kuryeler.data) ? kuryeler.data : [];
  const secilebilirKuryeler = kuryeListesi.filter((c) => c.is_active || c.id === run?.courier?.id);

  /** Tur yazımı meşgul mu (özel yazım ya da ekleme kuyruğu)? Senkron, ref üzerinden. */
  const turMesgul = () => ozelYazimRef.current !== null || eklemeSayaciRef.current > 0;
  /**
   * Özel tur yazımı: kilit boşsa alır ve çalıştırır; aynı anahtar uçuştaysa aynı sözü döndürür (aynı tick çift
   * tık/onay → tek mutation); başka bir yazım ya da ekleme sürüyorsa senkron reddeder (null).
   */
  const ozelYaz = (anahtar: string, calistir: () => Promise<unknown>): Promise<unknown> | null => {
    const uctaki = ozelYazimRef.current;
    if (uctaki) return uctaki.anahtar === anahtar ? uctaki.soz : null;
    if (eklemeSayaciRef.current > 0) return null;
    const soz = calistir().finally(() => {
      ozelYazimRef.current = null;
      setOzelYazim(null);
    });
    ozelYazimRef.current = { anahtar, soz };
    setOzelYazim(anahtar);
    return soz;
  };
  const ozelYazimUcusta = (anahtar: string) => ozelYazimRef.current?.anahtar === anahtar;
  /** Senkron neden (ref tabanlı): render'daki `mesgulNedeni` ile aynı metinler. */
  const mesgulNedeniRef = () => (ozelYazimRef.current !== null ? "Turda başka bir işlem sürüyor." : "Tura sipariş ekleniyor; bitince deneyin.");

  const turIslemi = (aksiyon: "start" | "complete") => {
    // Başka yazım/ekleme sürerken istek çıkmaz ve önceki hata silinmez (aynı anahtarın çift tıkı aynı sözü paylaşır).
    if (!run || (turMesgul() && !ozelYazimUcusta(aksiyon))) return;
    const hedefId = run.id;
    setAksiyonHatasi(null);
    void ozelYaz(aksiyon, () =>
      turAksiyonu
        .mutateAsync({ runId: hedefId, action: aksiyon })
        .then(() => {
          message.success(aksiyon === "start" ? "Tur başlatıldı: siparişler 'dağıtımda' olarak işaretlendi." : "Tur tamamlandı.");
        })
        .catch((e: unknown) => setAksiyonHatasi(getErrorDetail(e, "İşlem başarısız."))),
    );
  };

  const iptalOnayi = () => {
    if (!run || turMesgul()) return;
    const hedefId = run.id;
    const bekleyen = bekleyenSayisi;
    modal.confirm({
      title: "Dağıtım turunu iptal et",
      content: `Tur #${hedefId}: bekleyen ${bekleyen} durak "teslim edilemedi" olarak kapanacak ve siparişler yeniden planlanabilir hale gelecek. Teslim edilmiş duraklar etkilenmez.`,
      okText: "Turu iptal et",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      // ESC pending'de kapatıp onCancel dönüşünü yok sayar; klavye kapatması kapalı.
      keyboard: false,
      onCancel: () => (ozelYazimUcusta("cancel") ? Promise.reject(new Error("bekleniyor")) : undefined),
      onOk: () => {
        const soz = ozelYaz("cancel", () =>
          turAksiyonu
            .mutateAsync({ runId: hedefId, action: "cancel" })
            .then(() => {
              message.success("Tur iptal edildi.");
            })
            .catch((e: unknown) => {
              message.error(getErrorDetail(e, "İşlem başarısız."));
              throw e;
            }),
        );
        // Onay açıkken başka bir yazım başladıysa istek çıkmaz; onay açık kalır, kullanıcı görünür nedeni okur.
        if (!soz) {
          message.warning("Turda başka bir işlem sürüyor.");
          return Promise.reject(new Error("mesgul"));
        }
        return soz;
      },
    });
  };

  const rotayiOptimizeEt = () => {
    if (!run || (turMesgul() && !ozelYazimUcusta("optimize"))) return;
    const hedefId = run.id;
    setAksiyonHatasi(null);
    void ozelYaz("optimize", () =>
      optimize
        .mutateAsync(hedefId)
        .then((r) => {
          message.success(r.optimize_provider === "vroom" ? "Rota optimize edildi (yol ağı)." : "Rota optimize edildi (yaklaşık: yol ağı servisi kapalı).");
        })
        .catch((e: unknown) => setAksiyonHatasi(getErrorDetail(e, "Optimize edilemedi."))),
    );
  };

  const kuryeAta = (kuryeId: number | null) => {
    if (!run || turMesgul()) return;
    const hedefId = run.id;
    setKuryeHatasi(null);
    // Açık seçim arka plan refetch'iyle ezilmez; sunucu cevabı gelince seçim sunucu değerine döner.
    setBekleyenKurye(kuryeId);
    void ozelYaz("kurye", () =>
      kuryeGuncelle
        .mutateAsync({ runId: hedefId, courierId: kuryeId })
        .catch((e: unknown) => setKuryeHatasi(getErrorDetail(e, "Kurye atanamadı.")))
        .finally(() => setBekleyenKurye(undefined)),
    );
  };

  const siralamayiGonder = (idler: number[]) => {
    if (!run) return;
    // Farklı bir sıra payload'ı uçuştaki reorder'a katılamaz; başka yazım sürerken de gönderilmez — neden görünür.
    if (turMesgul()) {
      message.warning(mesgulNedeniRef());
      return;
    }
    const hedefId = run.id;
    setSiralamaHatasi(null);
    void ozelYaz("reorder", () =>
      sirala.mutateAsync({ runId: hedefId, stopIds: idler }).catch((e: unknown) => {
        setSiralamaHatasi(getErrorDetail(e, "Sıralanamadı."));
        // Sunucudaki gerçek sırayla uzlaş; kilit tazeleme bitene kadar tutulur (ikinci reorder bayat sıradan çıkmasın).
        return sorgu.refetch();
      }),
    );
  };
  const tasi = (stopId: number, yon: -1 | 1) => {
    const idler = tasinmisSira(sirali, stopId, yon);
    if (idler) siralamayiGonder(idler);
  };
  const birak = (hedefStopId: number) => {
    const kaynak = surukleKaynagi.current;
    surukleKaynagi.current = null;
    setSurukleHedefi(null);
    if (kaynak == null || turMesgul()) return;
    const idler = birakilmisSira(sirali, kaynak, hedefStopId);
    if (idler) siralamayiGonder(idler);
  };

  const durakCikarOnayi = (durak: DeliveryStop) => {
    const hedefStop = durak.id;
    if (turMesgul()) return;
    modal.confirm({
      title: "Durağı turdan çıkar",
      content: `${durak.recipient ?? "-"} · sipariş #${durak.order_id} bu turdan çıkarılacak; sipariş yeniden dağıtıma hazır olur.`,
      okText: "Turdan çıkar",
      okButtonProps: { danger: true },
      cancelText: "Vazgeç",
      keyboard: false,
      onCancel: () => (ozelYazimUcusta(`stop:${hedefStop}`) ? Promise.reject(new Error("bekleniyor")) : undefined),
      onOk: () => {
        const soz = ozelYaz(`stop:${hedefStop}`, () => {
          ucustakiDurakRef.current.add(hedefStop);
          setUcustakiDuraklar([...ucustakiDurakRef.current]);
          return durakCikar
            .mutateAsync(hedefStop)
            .then(() => {
              message.success("Durak turdan çıkarıldı.");
            })
            .catch((e: unknown) => {
              message.error(getErrorDetail(e, "Çıkarılamadı."));
              throw e;
            })
            .finally(() => {
              ucustakiDurakRef.current.delete(hedefStop);
              setUcustakiDuraklar([...ucustakiDurakRef.current]);
            });
        });
        if (!soz) {
          message.warning("Turda başka bir işlem sürüyor.");
          return Promise.reject(new Error("mesgul"));
        }
        return soz;
      },
    });
  };

  const siparisEkle = async (anahtar: string, siparisIdleri: number[]) => {
    if (!run) return;
    const hedefId = run.id;
    const idler = [...siparisIdleri];
    // Özel tur yazımı sürerken ekleme başlamaz (neden görünür); aynı siparişi kapsayan ikinci istek çıkmaz.
    if (ozelYazimRef.current !== null) {
      message.warning(mesgulNedeniRef());
      return;
    }
    if (idler.some((x) => ucustakilerRefHas(x))) return;
    for (const x of idler) ucustakiSiparisRef.current.add(x);
    setUcustakiSiparisler([...ucustakiSiparisRef.current]);
    eklemeSayaciRef.current += 1;
    setEklemeKuyrugu(eklemeSayaciRef.current);
    setEklemeHatalari((h) => ({ ...h, [anahtar]: undefined }));
    try {
      // Ekleme istekleri tur düzeyinde SIRAYA alınır: backend sıradaki `sequence`'i istek başına hesaplar,
      // paralel iki POST aynı sıra numarasını üretebilir. Farklı siparişler reddedilmez, sırayla gönderilir.
      const onceki = eklemeZinciriRef.current;
      const soz = onceki.catch(() => undefined).then(() => duraklarEkle.mutateAsync({ runId: hedefId, orderIds: idler }));
      eklemeZinciriRef.current = soz;
      await soz;
      message.success(idler.length > 1 ? "Tüm siparişler tura eklendi." : "Sipariş tura eklendi.");
    } catch (e) {
      setEklemeHatalari((h) => ({ ...h, [anahtar]: getErrorDetail(e, "Eklenemedi.") }));
    } finally {
      for (const x of idler) ucustakiSiparisRef.current.delete(x);
      setUcustakiSiparisler([...ucustakiSiparisRef.current]);
      eklemeSayaciRef.current -= 1;
      setEklemeKuyrugu(eklemeSayaciRef.current);
    }
  };
  const ucustakilerRefHas = (x: number) => ucustakiSiparisRef.current.has(x);

  if (!canView) return <AccessDenied area="Dağıtım" />;
  const listeyeDon = <Button size="small" onClick={() => navigate(ROUTES.adminNewDeliveryRuns)}>Turlar listesine dön</Button>;
  if (!gecerli) return <HataDurumu hata="Tur adresi geçersiz. Turlar listesinden yeniden açın." hataAksiyon={listeyeDon} />;
  if (sorgu.isPending) return <YukleniyorDurumu etiket="Tur yükleniyor…" />;
  if (sorgu.isError) {
    const durum = (sorgu.error as { response?: { status?: number } })?.response?.status;
    if (durum === 404) return <HataDurumu hata="Tur bulunamadı" hataAksiyon={listeyeDon} />;
    return <HataDurumu hata={getErrorDetail(sorgu.error, "Tur yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />;
  }
  if (!run) return <HataDurumu hata="Tur bulunamadı" hataAksiyon={listeyeDon} />;

  const ayrac = token.colorBorderSecondary;
  const kart = { background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 };
  // Görünür durum: tur düzeyinde başka yazma işlemi (özel yazım ya da ekleme kuyruğu) sürüyor.
  const baskaIslem = ozelYazim !== null || eklemeKuyrugu > 0;
  const mesgulNedeni = ozelYazim !== null ? "Turda başka bir işlem sürüyor." : "Tura sipariş ekleniyor; bitince deneyin.";
  const istisnalar = runExceptions(run);
  const rozetler = (
    [
      { key: "promise", n: istisnalar.promiseRisk, label: "söz riski", color: "error" },
      { key: "eta", n: istisnalar.etaDelayed, label: "ETA aşıldı", color: "error" },
      { key: "pinless", n: istisnalar.pinless, label: "pinsiz", color: "warning" },
      { key: "retry", n: istisnalar.retry, label: "yeniden deneme", color: "warning" },
      { key: "outlier", n: istisnalar.outlier, label: "rotayı bozan", color: "warning" },
    ] as const
  ).filter((c) => c.n > 0);
  const tamTarih = new Date(`${run.run_date}T00:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" });
  const haritaVar = !!run.optimized_at && run.stops.some((s) => s.lat != null && s.lng != null);
  const seciliKurye = bekleyenKurye !== undefined ? bekleyenKurye : run.courier?.id ?? null;
  const duzenlenebilir = (s: DeliveryStop) => planlama && s.status === "PENDING";
  const ilkBekleyen = sirali.find((s) => s.status === "PENDING")?.id;
  const sonBekleyen = [...sirali].reverse().find((s) => s.status === "PENDING")?.id;

  const kuryeYuzeyi = !canManage ? (
    <Typography.Text type="secondary">{run.courier ? `Kurye: ${run.courier.name}` : "Kurye atanmadı"}</Typography.Text>
  ) : kuryeler.isError ? (
    <HataDurumu hata={getErrorDetail(kuryeler.error, "Kuryeler yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void kuryeler.refetch()}>Tekrar dene</Button>} />
  ) : kuryeler.isPending ? (
    <Typography.Text type="secondary">Kuryeler yükleniyor…</Typography.Text>
  ) : secilebilirKuryeler.length === 0 ? (
    <Link to={ROUTES.adminNewDeliveryCouriers} style={{ fontWeight: 500 }}>Kurye ekle →</Link>
  ) : (
    <Flex align="center" gap={8} wrap>
      <Typography.Text type="secondary">Kurye</Typography.Text>
      <Select<number | null>
        aria-label="Kurye"
        value={seciliKurye}
        loading={ozelYazim === "kurye"}
        // Başka yazım sürerken kapalı; nedeni erişilebilir başlıkta.
        disabled={baskaIslem}
        title={baskaIslem ? mesgulNedeni : undefined}
        options={[{ value: null, label: "Kurye seç…" }, ...secilebilirKuryeler.map((c) => ({ value: c.id, label: c.name }))]}
        onChange={(v) => kuryeAta(v ?? null)}
        style={{ width: 200 }}
      />
      {kuryeHatasi ? <Typography.Text type="danger" role="alert">{kuryeHatasi}</Typography.Text> : null}
    </Flex>
  );

  const baslatDugmesi = (
    <Button type="primary" disabled={run.stops.length === 0 || baskaIslem} title={run.stops.length === 0 ? "Önce tura durak ekleyin." : baskaIslem ? mesgulNedeni : undefined} loading={ozelYazim === "start"} onClick={() => turIslemi("start")}>
      Turu Başlat
    </Button>
  );
  const tamamlaEngeli = `${bekleyenSayisi} durak henüz sonuçlanmadı: önce teslim edin ya da "teslim edilemedi" işaretleyin.`;
  const tamamlaDugmesi = (
    <Button type="primary" disabled={bekleyenSayisi > 0 || baskaIslem} title={bekleyenSayisi > 0 ? tamamlaEngeli : baskaIslem ? mesgulNedeni : undefined} loading={ozelYazim === "complete"} onClick={() => turIslemi("complete")}>
      Turu Tamamla
    </Button>
  );

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Flex align="center" gap={12} wrap>
          <Button aria-label="Geri" icon={<ArrowLeftOutlined />} onClick={() => navigate(ROUTES.adminNewDeliveryRuns)} />
          <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Tur #{run.id}</Typography.Title>
          <Tag color={DURUM_RENGI[run.status] ?? "default"} style={{ marginInlineEnd: 0 }}>{RUN_STATUS_LABEL[run.status] ?? run.status}</Tag>
        </Flex>
        <Flex gap={8} wrap>
          {planlama && konumluBekleyen >= 2 ? (
            <Button disabled={baskaIslem} title={baskaIslem ? mesgulNedeni : undefined} loading={ozelYazim === "optimize"} onClick={rotayiOptimizeEt}>Rotayı Optimize Et</Button>
          ) : null}
          {run.stops.length > 0 && run.status !== "CANCELLED" ? <Button onClick={() => setEtiketAcik(true)}>Etiketler</Button> : null}
          {/* Gerçek bağlantı (yeni sekme/orta tık korunur); düğme içine sarılmaz. */}
          {run.status === "ACTIVE" ? (
            <Link to={ROUTES.deliveryRun(run.id)} style={{ display: "inline-flex", alignItems: "center", minHeight: 40, padding: "0 15px", border: `1px solid ${token.colorBorder}`, borderRadius: 4, fontWeight: 500 }}>
              Saha Ekranı →
            </Link>
          ) : null}
          {canManage && run.status === "PLANNED" ? (run.stops.length === 0 ? <Tooltip title="Önce tura durak ekleyin.">{baslatDugmesi}</Tooltip> : baslatDugmesi) : null}
          {canManage && run.status === "ACTIVE" ? (
            bekleyenSayisi > 0 ? <Tooltip title={tamamlaEngeli}>{tamamlaDugmesi}</Tooltip> : tamamlaDugmesi
          ) : null}
          {planlama ? <Button danger disabled={baskaIslem} title={baskaIslem ? mesgulNedeni : undefined} loading={ozelYazim === "cancel"} onClick={iptalOnayi}>İptal</Button> : null}
        </Flex>
      </Flex>

      {!canManage ? <Alert type="info" showIcon message="Salt okunur görünüm: kurye atama, sıralama ve tur aksiyonları için delivery.manage izni gerekir." /> : null}
      {aksiyonHatasi ? <Alert type="error" showIcon message={aksiyonHatasi} /> : null}

      <section aria-label="Tur özeti" style={{ ...kart, padding: 24 }}>
        <Flex vertical gap={12}>
          <Flex align="center" gap={12} wrap>
            <Typography.Text style={{ fontWeight: 500 }}>{run.vehicle}</Typography.Text>
            <Typography.Text type="secondary">{tamTarih}</Typography.Text>
            {toplam > 0 ? <Typography.Text type="secondary" style={{ fontVariantNumeric: "tabular-nums" }}>{biten}/{toplam} durak</Typography.Text> : null}
            {run.status === "ACTIVE" && konum.data?.age_seconds != null ? (
              <Typography.Text type="success">kurye konumu {konum.data.age_seconds < 30 ? "canlı" : `${Math.round(konum.data.age_seconds / 60)} dk önce`}</Typography.Text>
            ) : null}
          </Flex>
          {kuryeYuzeyi}
          {hasRunExceptions(istisnalar) ? (
            <Flex gap={8} wrap>
              {rozetler.map((c) => (
                <Tag key={c.key} color={c.color} style={{ marginInlineEnd: 0 }}>{c.n} {c.label}</Tag>
              ))}
            </Flex>
          ) : null}
          {toplam > 0 ? <Progress percent={Math.round((biten / toplam) * 100)} size="small" status={run.status === "DONE" ? "success" : "active"} showInfo={false} /> : null}
          {run.optimized_at ? (
            <Flex align="center" gap={12} wrap>
              {run.total_distance_km != null ? <Typography.Text>{run.total_distance_km.toLocaleString("tr-TR")} km</Typography.Text> : null}
              {run.total_duration_seconds != null ? <Typography.Text type="secondary">~{formatDuration(run.total_duration_seconds)}</Typography.Text> : null}
              <Tooltip title={run.optimize_provider === "vroom" ? "Gerçek yol ağı üzerinden hesaplandı (OSRM+VROOM)" : "Kuş uçuşu yaklaşımı: yol ağı servisi kapalıyken kullanılan tahmindir; ETA'lar yaklaşıktır"}>
                <Tag color={run.optimize_provider === "vroom" ? "blue" : "warning"} style={{ marginInlineEnd: 0 }}>{run.optimize_provider === "vroom" ? "yol ağı" : "yaklaşık"}</Tag>
              </Tooltip>
              {haritaVar ? (
                <Button size="small" aria-expanded={haritaAcik} onClick={() => setHaritaAcik((v) => !v)}>{haritaAcik ? "Haritayı gizle" : "Haritayı göster"}</Button>
              ) : null}
            </Flex>
          ) : null}
        </Flex>
      </section>

      {haritaVar && haritaAcik ? (
        <section aria-label="Rota haritası" style={{ ...kart, padding: 24 }}>
          <DeliveryRouteMap run={run} courier={run.status === "ACTIVE" ? konum.data : null} />
        </section>
      ) : null}

      <section aria-label="Duraklar" style={kart}>
        <Flex align="baseline" justify="space-between" gap={12} wrap style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
          <Typography.Text style={{ fontWeight: 500 }}>Rota: {run.stops.length} durak</Typography.Text>
          {planlama && run.status === "ACTIVE" && bekleyenSayisi > 1 ? <Typography.Text type="warning" style={{ fontSize: 12 }}>Tur sahada: sıra değişikliği kuryeye anında yansır.</Typography.Text> : null}
        </Flex>
        <div style={{ padding: "0 24px" }}>
          {siralamaHatasi ? <Alert type="error" showIcon message={siralamaHatasi} style={{ marginTop: 12 }} /> : null}
          {sirali.length === 0 ? (
            <Typography.Text type="secondary" style={{ display: "block", padding: "16px 0" }}>Henüz durak yok: aşağıdaki hazır siparişlerden ekleyin.</Typography.Text>
          ) : (
            sirali.map((s, i, dizi) => {
              const duzenle = duzenlenebilir(s);
              const durumMetni = stopStatusText(s);
              const ekPaket = s.status === "PENDING" ? coLocatedPendingStops(run, s).length : 0;
              const ilkMi = s.id === ilkBekleyen;
              const sonMu = s.id === sonBekleyen;
              const ucusta = ucustakiDuraklar.includes(s.id);
              return (
                <Flex
                  key={s.id}
                  data-testid={`durak-${s.id}`}
                  align="center"
                  justify="space-between"
                  gap={12}
                  wrap
                  draggable={duzenle && !baskaIslem}
                  onDragStart={duzenle ? (e) => { if (turMesgul()) { e.preventDefault(); return; } surukleKaynagi.current = s.id; e.dataTransfer.effectAllowed = "move"; } : undefined}
                  onDragOver={duzenle ? (e) => { e.preventDefault(); setSurukleHedefi(s.id); } : undefined}
                  onDragLeave={duzenle ? () => setSurukleHedefi((v) => (v === s.id ? null : v)) : undefined}
                  onDrop={duzenle ? (e) => { e.preventDefault(); birak(s.id); } : undefined}
                  onDragEnd={duzenle ? () => { surukleKaynagi.current = null; setSurukleHedefi(null); } : undefined}
                  style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}`, cursor: duzenle ? "grab" : undefined, background: surukleHedefi === s.id ? token.colorPrimaryBg : undefined }}
                >
                  <Flex align="flex-start" gap={12} style={{ minWidth: 0, flex: "1 1 260px" }}>
                    <Tag color={DURAK_RENGI[s.status] ?? "default"} style={{ marginInlineEnd: 0, fontVariantNumeric: "tabular-nums" }}>{s.sequence}</Tag>
                    <div style={{ minWidth: 0 }}>
                      <Flex align="baseline" gap={8} wrap>
                        <Typography.Text style={{ fontWeight: 500 }}>{s.recipient ?? "-"}</Typography.Text>
                        <Link to={ROUTES.adminNewOrder(s.order_id)} style={{ fontSize: 12 }}>#{s.order_id}</Link>
                        {s.lat == null ? <Tag color="warning" style={{ marginInlineEnd: 0 }}>konumsuz</Tag> : null}
                        {ekPaket > 0 ? (
                          <Tooltip title={`Aynı adrese ${ekPaket} paket daha var: birlikte teslim edilir`}>
                            <Tag color="blue" style={{ marginInlineEnd: 0 }}>+{ekPaket} paket</Tag>
                          </Tooltip>
                        ) : null}
                      </Flex>
                      <Flex align="center" gap={6} wrap style={{ marginTop: 2 }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{s.address ?? "Adres yok"}</Typography.Text>
                        <DeliveryPrefBadge pref={s.delivery_pref} note={s.delivery_pref_note} />
                      </Flex>
                      <ItemLines items={s.items} className="mt-1.5" />
                    </div>
                  </Flex>
                  <Flex align="center" gap={8} wrap>
                    {s.is_outlier && s.status === "PENDING" ? (
                      <Tooltip title="Bu durak rotaya ciddi ek yol katıyor: dış kuryeye devretmeyi düşünün">
                        <Tag color="warning" style={{ marginInlineEnd: 0 }}>rotayı bozuyor · +{s.detour_km} km</Tag>
                      </Tooltip>
                    ) : null}
                    {s.eta && s.status === "PENDING" ? <Typography.Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>~{formatEta(s.eta)}</Typography.Text> : null}
                    <Typography.Text type={s.status === "DELIVERED" ? "success" : s.status === "FAILED" ? "danger" : s.status === "RESCHEDULED" ? "warning" : "secondary"} style={{ fontSize: 12 }}>
                      {durumMetni.label}
                      {s.status === "FAILED" && s.fail_reason ? ` · ${FAIL_REASON_LABEL[s.fail_reason] ?? s.fail_reason}` : ""}
                    </Typography.Text>
                    {duzenle ? (
                      <Flex align="center" gap={4}>
                        <Tooltip title={ilkMi ? "İlk bekleyen durak: daha yukarı taşınamaz." : "Yukarı taşı"}>
                          <Button size="small" icon={<ArrowUpOutlined />} aria-label={`Durak ${s.sequence} yukarı taşı`} disabled={ilkMi || baskaIslem} title={baskaIslem && !ilkMi ? mesgulNedeni : undefined} loading={ozelYazim === "reorder"} onClick={() => tasi(s.id, -1)} />
                        </Tooltip>
                        <Tooltip title={sonMu ? "Son bekleyen durak: daha aşağı taşınamaz." : "Aşağı taşı"}>
                          <Button size="small" icon={<ArrowDownOutlined />} aria-label={`Durak ${s.sequence} aşağı taşı`} disabled={sonMu || baskaIslem} title={baskaIslem && !sonMu ? mesgulNedeni : undefined} loading={ozelYazim === "reorder"} onClick={() => tasi(s.id, 1)} />
                        </Tooltip>
                        <Tooltip title="Turdan çıkar">
                          <Button size="small" danger icon={<CloseOutlined />} aria-label={`Durak ${s.sequence} turdan çıkar`} disabled={baskaIslem && !ucusta} title={baskaIslem && !ucusta ? mesgulNedeni : undefined} loading={ucusta} onClick={() => durakCikarOnayi(s)} />
                        </Tooltip>
                      </Flex>
                    ) : null}
                  </Flex>
                </Flex>
              );
            })
          )}
        </div>
      </section>

      {planlama ? (
        <section aria-label="Dağıtıma hazır siparişler" style={kart}>
          <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
            <Typography.Text style={{ fontWeight: 500 }}>
              Dağıtıma hazır siparişler{uygunlar.data ? ` (${uygunListesi.length})` : ""}
            </Typography.Text>
            {uygunListesi.length > 1 ? (
              <Button disabled={ozelYazim !== null} title={ozelYazim !== null ? mesgulNedeni : undefined} loading={ucustakiSiparisler.length > 0} onClick={() => void siparisEkle("hepsi", uygunListesi.map((o) => o.order_id))}>Tümünü ekle</Button>
            ) : null}
          </Flex>
          <div style={{ padding: "0 24px" }}>
            {eklemeHatalari.hepsi ? <Alert type="error" showIcon message={eklemeHatalari.hepsi} style={{ marginTop: 12 }} /> : null}
            {uygunlar.isError ? (
              <div style={{ padding: "16px 0" }}>
                <HataDurumu hata={getErrorDetail(uygunlar.error, "Hazır siparişler yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void uygunlar.refetch()}>Tekrar dene</Button>} />
              </div>
            ) : uygunlar.isPending ? (
              <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Hazır siparişler yükleniyor…" /></div>
            ) : uygunListesi.length === 0 ? (
              <Typography.Text type="secondary" style={{ display: "block", padding: "16px 0" }}>
                Tura hazır sipariş yok: <Link to={ROUTES.adminNewDeliveryOrders} style={{ fontWeight: 500 }}>Siparişler</Link> ekranından paket hazırlayın.
              </Typography.Text>
            ) : (
              uygunListesi.map((o, i, dizi) => (
                <Flex key={o.order_id} data-testid={`uygun-${o.order_id}`} align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 0", borderBottom: i === dizi.length - 1 ? "none" : `1px solid ${ayrac}` }}>
                  <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                    <Flex align="baseline" gap={8} wrap>
                      <Typography.Text style={{ fontWeight: 500 }}>{o.recipient ?? "-"}</Typography.Text>
                      <Link to={ROUTES.adminNewOrder(o.order_id)} style={{ fontSize: 12 }}>#{o.order_id}</Link>
                      {o.lat == null ? <Tag color="warning" style={{ marginInlineEnd: 0 }}>konumsuz</Tag> : null}
                      <PromiseChip date={o.promised_delivery_date} />
                    </Flex>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", overflowWrap: "anywhere" }}>{o.address ?? "Adres yok"}</Typography.Text>
                  </div>
                  <Flex align="center" gap={8} wrap>
                    <Typography.Text type="secondary" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{o.item_count} parça · {formatTL(o.total)}</Typography.Text>
                    <div>
                      <Button disabled={ozelYazim !== null} title={ozelYazim !== null ? mesgulNedeni : undefined} loading={ucustakiSiparisler.includes(o.order_id)} onClick={() => void siparisEkle(`tek:${o.order_id}`, [o.order_id])}>Ekle</Button>
                      {eklemeHatalari[`tek:${o.order_id}`] ? <Typography.Text type="danger" role="alert" style={{ fontSize: 12, display: "block", marginTop: 4 }}>{eklemeHatalari[`tek:${o.order_id}`]}</Typography.Text> : null}
                    </div>
                  </Flex>
                </Flex>
              ))
            )}
          </div>
        </section>
      ) : null}

      {/* Etiket yüzeyi yalnız istek üzerine; yazdırma kullanıcı tıklamadan tetiklenmez (LabelSheet). */}
      {etiketAcik ? <LabelSheet run={run} onClose={() => setEtiketAcik(false)} /> : null}
    </Flex>
  );
}
