// Eğitmen Yönetimi → Öne Çıkarmalar — eski `AdminPromotionsPage` panel düzeninde.
//
// Bu kayıtlar eğitmenlerin satın aldığı REKLAM paketleridir; organik sıralamayı değiştirmezler
// (`docs/one-cikarma-sozlesmesi.md` S-1). Ekran para akışına dokunur: iptal, PAID kayıtta iade sürecini
// başlatır, PENDING/FAILED kayıtta yalnız kaydı kapatır.
//
// İki eksen ayrı gösterilir: PARA DURUMU (ödendi/iade…) ile GÖRÜNÜRLÜK (yürürlükte/sırada/süresi doldu).
// "Ödendi" bir kaydın şu anda öne çıktığı anlamına gelmez.
//
// Uç `limit`/`offset` alır ve TOPLAM döndürmez: sayfalama gerçek, "N kayıt" uydurulmaz.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { App, Button, Flex, Segmented, Table, Tag, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { basligaOlcumStiliEkle } from "@/panel/components/ListePage";
import { VarlikDugmesi, useVarlikKilidi } from "@/panel/components/varlikKilidi";
import { sunucuHatasiniDagit, type Hatalar } from "@/panel/components/pencereAlanlari";
import { useAdminPromotions, useCancelPromotion } from "@/hooks/useAdmin";
import { getErrorDetail } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { AyrintiPenceresi, IptalPenceresi } from "./OneCikarmaPenceresi";
import type { AdminPromotion } from "@/api/admin";

/** URL beyaz listesi. Liste tabanlı arama prototip anahtarlarını (`__proto__`, `constructor`) eşleştirmez. */
export const DURUM_DEGERLERI = ["hepsi", "active", "PAID", "PENDING"] as const;
export type DurumSecimi = (typeof DURUM_DEGERLERI)[number];
export const VARSAYILAN_DURUM: DurumSecimi = "hepsi";
export const SAYFA_BOYUTU = 25;
export const EN_BUYUK_SAYFA = 10_000;

export const FILTRELER: { value: DurumSecimi; label: string }[] = [
  { value: "hepsi", label: "Tümü" },
  { value: "active", label: "Yürürlükte" },
  { value: "PAID", label: "Ödenmiş" },
  { value: "PENDING", label: "Ödeme bekliyor" },
];

/** Beyaz listede olmayan değer VARSAYILANA düşer; sunucuya hiç gitmez. */
export function durumCoz(ham: string | null): DurumSecimi {
  return (DURUM_DEGERLERI as readonly string[]).includes(ham ?? "") ? (ham as DurumSecimi) : VARSAYILAN_DURUM;
}
/** "hepsi" seçiliyken API'ye `status` GÖNDERİLMEZ. */
export function apiDurumu(secim: DurumSecimi): string | undefined {
  return secim === "hepsi" ? undefined : secim;
}
/** `?sayfa=` yalnız düz pozitif güvenli tam sayı; aksi hâlde 1. Üst sınır derin `offset` taramasını keser. */
export function sayfaCoz(ham: string | null): number {
  if (ham == null || !/^\d+$/.test(ham)) return 1;
  const n = Number(ham);
  return Number.isSafeInteger(n) && n > 0 && n <= EN_BUYUK_SAYFA ? n : 1;
}
export function sayfaOfseti(sayfa: number): number {
  return (sayfa - 1) * SAYFA_BOYUTU;
}

/** Para durumu sözlüğü; bilinmeyen ham değer NÖTR biçimde olduğu gibi gösterilir (uydurma çeviri yok). */
export const PARA_DURUMU_ETIKETI: Record<string, string> = {
  PENDING: "Ödeme bekliyor",
  PAID: "Ödendi",
  FAILED: "Ödeme başarısız",
  REFUNDING: "İade sürüyor",
  REFUNDED: "İade edildi",
  MANUAL_REVIEW: "Elle inceleme",
};
export function paraDurumuMetni(durum: string): string {
  return PARA_DURUMU_ETIKETI[durum] ?? durum;
}

const TARIH = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric" });
/** Geçersiz/boş tarih çökertmez; "-" döner. */
export function tarihMetni(iso: string | null): string {
  if (!iso) return "-";
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? TARIH.format(t) : "-";
}

/**
 * Tutar kaydın KENDİ para birimiyle biçimlenir: her şeyi TRY göstermek yanlış tutar okumasına yol açar.
 * Geçersiz para birimi kodunda `Intl` atar — sayı + ham kod ile güvenli yedeğe düşülür.
 */
export function tutarMetni(deger: string | number | null | undefined, currency: string | null): string {
  const n = typeof deger === "number" ? deger : Number(deger);
  if (deger === null || deger === undefined || deger === "" || !Number.isFinite(n)) return "-";
  const kod = (currency ?? "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(kod)) {
    try {
      return new Intl.NumberFormat("tr-TR", { style: "currency", currency: kod }).format(n);
    } catch {
      // Geçerli biçimde ama tanınmayan kod: sayıyı kaybetmeden ham kodla göster.
    }
  }
  const sayi = n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return kod ? `${sayi} ${kod}` : sayi;
}

export type Gorunurluk = { etiket: string; renk?: string };
/**
 * Görünürlük ekseni (sözleşme S-2): aktiflik bir YÜKLEMDİR.
 * `simdi` dışarıdan verilir ki sınır anları test edilebilsin.
 */
export function gorunurlukDurumu(p: AdminPromotion, simdi: number): Gorunurluk {
  if (p.cancelled_at) return { etiket: "İptal edildi", renk: "error" };
  if (p.payment_status !== "PAID") return { etiket: "Yürürlükte değil" };
  const bas = p.starts_at ? new Date(p.starts_at).getTime() : NaN;
  const bit = p.ends_at ? new Date(p.ends_at).getTime() : NaN;
  // PAID ama tarih yok/bozuk: "süresi doldu" demek yanlış olurdu — eksiklik olduğu gibi söylenir.
  if (!Number.isFinite(bas) || !Number.isFinite(bit)) return { etiket: "Zaman aralığı eksik", renk: "warning" };
  if (bas > simdi) return { etiket: "Sırada" };
  if (simdi < bit) return { etiket: "Yürürlükte", renk: "success" };
  return { etiket: "Süresi doldu" };
}

/** Backend `cancel_by_admin` kapısı birebir: iptal edilmemiş ve para durumu PAID/PENDING/FAILED. */
export function iptalEdilebilir(p: AdminPromotion): boolean {
  return !p.cancelled_at && ["PAID", "PENDING", "FAILED"].includes(p.payment_status);
}

const SAYI: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
/** Uzun ad kolonu şişirip tabloyu gereksiz yatay kaydırmaya zorlamasın. */
const AD_KUTUSU: React.CSSProperties = { display: "inline-block", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" };
const IPTAL_ALANLARI = ["reason"] as const;

export function EgitmenOneCikarmalar() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("promotions");
  // Ad bağlantısının hedefi `MusteriDetayi`dir ve o ekran `users.view` ister: izin yoksa ölü bağlantı yerine düz metin.
  const { canView: kullaniciGorebilir } = useAdminAreaAccess("users");
  const [params, setParams] = useSearchParams();
  const secim = durumCoz(params.get("durum"));
  const sayfa = sayfaCoz(params.get("sayfa"));

  const sorgu = useAdminPromotions(apiDurumu(secim), canView, SAYFA_BOYUTU, sayfaOfseti(sayfa));
  const iptal = useCancelPromotion();

  const [ayrintiId, setAyrintiId] = useState<number | null>(null);
  // Kayıt listeden düşerse (başka yönetici iptal etti, filtreden çıktı) açık ayrıntı ani kaybolmasın.
  const ayrintiAnligiRef = useRef<AdminPromotion | null>(null);
  // Hedef KİMLİK tıklama anında donar; gövde metni (para durumu → iade açıklaması) canlı listeden okunur.
  // Kayıt listeden düşerse açılış anlık görüntüsü pencereyi ani kaybolmaktan korur.
  const [iptalId, setIptalId] = useState<number | null>(null);
  const iptalAnligiRef = useRef<AdminPromotion | null>(null);
  const [iptalHatasi, setIptalHatasi] = useState<{ alan: Hatalar; genel: string | null }>({ alan: {}, genel: null });
  const { kilitle, kilitli, surenIslem } = useVarlikKilidi(message);

  const liste = useMemo(() => (Array.isArray(sorgu.data) ? sorgu.data : []), [sorgu.data]);
  const veriHazir = Array.isArray(sorgu.data);
  const tazelemeHatasi = sorgu.isError && veriHazir;
  const ayrinti = ayrintiId == null ? undefined : liste.find((p) => p.id === ayrintiId) ?? ayrintiAnligiRef.current ?? undefined;
  const iptalHedefi = iptalId == null ? null : liste.find((p) => p.id === iptalId) ?? iptalAnligiRef.current;
  // "Şimdi" render başına bir kez okunur: aynı listedeki satırlar farklı anlara göre değerlendirilmesin.
  const simdi = Date.now();

  /** Varsayılanlar URL'den silinir; ilgisiz parametreler korunur. Filtre replace, sayfa gezinmesi push. */
  const urlYaz = (yeniSecim: DurumSecimi, yeniSayfa: number, replace: boolean) => {
    const sonraki = new URLSearchParams(params);
    if (yeniSecim === VARSAYILAN_DURUM) sonraki.delete("durum");
    else sonraki.set("durum", yeniSecim);
    if (yeniSayfa <= 1) sonraki.delete("sayfa");
    else sonraki.set("sayfa", String(yeniSayfa));
    setParams(sonraki, { replace });
  };
  const iptaliKapat = () => {
    setIptalId(null);
    iptalAnligiRef.current = null;
    setIptalHatasi({ alan: {}, genel: null });
  };
  const ayrintiyiKapat = () => {
    setAyrintiId(null);
    ayrintiAnligiRef.current = null;
  };
  const yereliSifirla = () => {
    ayrintiyiKapat();
    iptaliKapat();
  };
  const secimiAyarla = (yeni: DurumSecimi) => {
    // Filtre değişince sayfa 1'e döner (2. sayfada dururken filtre değiştirmek boş liste gösterirdi).
    urlYaz(yeni, 1, true);
    yereliSifirla();
  };
  const sayfayaGit = (hedef: number) => {
    urlYaz(secim, hedef, false);
    yereliSifirla();
  };

  // Sunucu toplam vermez: "daha eski" yalnız sayfa TAM doluyken vardır.
  const dahaEskiVar = veriHazir && liste.length === SAYFA_BOYUTU;
  const dahaYeniVar = sayfa > 1;
  const sayfaDolduRef = useRef(false);
  useEffect(() => {
    sayfaDolduRef.current = false;
    yereliSifirla();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sayfa, secim]);
  useEffect(() => {
    if (!veriHazir) return;
    if (liste.length > 0) {
      sayfaDolduRef.current = true;
      return;
    }
    // Dolu sayfa boşaldıysa (iptal sonrası aktif filtreden düşme) son geçerli sayfaya REPLACE ile çekil.
    if (sayfa > 1 && sayfaDolduRef.current) {
      urlYaz(secim, sayfa - 1, true);
      yereliSifirla();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [veriHazir, liste.length, sayfa, secim]);

  const iptalEt = (hedef: AdminPromotion, gerekce: string) => {
    // Hedef kimlik ve gerekçe ÇAĞRI anında sabitlenir; sonraki tazelemeler hedefi kaydırmaz.
    const hedefId = hedef.id;
    const reason = gerekce;
    void kilitle(`promotion:${hedefId}`, "cancel", () => {
      setIptalHatasi({ alan: {}, genel: null });
      return iptal
        .mutateAsync({ id: hedefId, reason })
        // `message.success` AntD'de thenable döner: zincirin DÖNÜŞ değeri yapılırsa kilit mesaj kapanana kadar tutulurdu.
        .then(() => {
          message.success("Öne çıkarma iptal edildi.");
          iptaliKapat();
        })
        .catch((e: unknown) => {
          // 422 yalnız `reason` alanına; 409/500/ağ hataları pencere içinde Alert'te kalır.
          // Sağlayıcı referansı hata bağlamına EKLENMEZ.
          setIptalHatasi(sunucuHatasiniDagit(e, "İptal başarısız.", IPTAL_ALANLARI));
          // 409 "zaten iptal edilmiş": satır bayat demektir — liste tazelenmezse kullanıcı aynı hatayı döner durur.
          const durum = (e as { response?: { status?: number } })?.response?.status;
          if (durum === 409) void sorgu.refetch();
        });
    });
  };

  if (!canView) return <AccessDenied area="Öne çıkarma satışları" />;
  const ayrac = token.colorBorderSecondary;
  const kart = { background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 };

  const kolonlar: TableProps<AdminPromotion>["columns"] = [
    {
      title: "Öğretmen",
      key: "egitmen",
      render: (_: unknown, p: AdminPromotion) => {
        const ad = p.tutor_name ?? `Öğretmen #${p.tutor_id}`;
        return kullaniciGorebilir ? (
          <Link id={`one-cikarma-ad-${p.id}`} to={ROUTES.adminNewCustomer("tutor", p.tutor_id)} style={{ fontWeight: 500, ...AD_KUTUSU }}>
            {ad}
          </Link>
        ) : (
          <Typography.Text id={`one-cikarma-ad-${p.id}`} style={{ fontWeight: 500, ...AD_KUTUSU }}>
            {ad}
          </Typography.Text>
        );
      },
    },
    { title: "Paket", key: "paket", render: (_: unknown, p: AdminPromotion) => <span style={SAYI}>{p.package_days} gün</span> },
    { title: "Tutar", key: "tutar", align: "right", render: (_: unknown, p: AdminPromotion) => <span style={SAYI}>{tutarMetni(p.price, p.currency)}</span> },
    // Para ekseni DÜZ METİN, görünürlük ekseni ROZET: iki eksen yan yana aynı kılıkta görünmesin.
    { title: "Para durumu", key: "para", render: (_: unknown, p: AdminPromotion) => <Typography.Text>{paraDurumuMetni(p.payment_status)}</Typography.Text> },
    {
      title: "Yürürlük",
      key: "yururluk",
      render: (_: unknown, p: AdminPromotion) => (
        <Typography.Text type="secondary" style={{ fontSize: 12, ...SAYI }}>
          {`${tarihMetni(p.starts_at)} – ${tarihMetni(p.ends_at)}`}
        </Typography.Text>
      ),
    },
    {
      title: "Görünürlük",
      key: "gorunurluk",
      render: (_: unknown, p: AdminPromotion) => {
        const g = gorunurlukDurumu(p, simdi);
        return (
          <Tag color={g.renk} style={{ marginInlineEnd: 0 }}>
            {g.etiket}
          </Tag>
        );
      },
    },
    {
      title: "İşlemler",
      key: "islem",
      align: "right",
      render: (_: unknown, p: AdminPromotion) => (
        <Flex gap={8} justify="flex-end" wrap>
          <Button id={`one-cikarma-incele-${p.id}`} aria-labelledby={`one-cikarma-ad-${p.id} one-cikarma-incele-${p.id}`} onClick={() => {
              ayrintiAnligiRef.current = p;
              setAyrintiId(p.id);
            }}>
            İncele
          </Button>
          {canManage && iptalEdilebilir(p) ? (
            <VarlikDugmesi
              danger
              islem="cancel"
              mesgulIslem={surenIslem(`promotion:${p.id}`)}
              id={`one-cikarma-iptal-${p.id}`}
              aria-labelledby={`one-cikarma-ad-${p.id} one-cikarma-iptal-${p.id}`}
              onClick={() => {
                setIptalHatasi({ alan: {}, genel: null });
                iptalAnligiRef.current = p;
                setIptalId(p.id);
              }}
            >
              İptal et
            </VarlikDugmesi>
          ) : null}
        </Flex>
      ),
    },
  ];

  const bosDurum = sayfa > 1
    ? <BosDurumu baslik="Satış arşivinin sonu" aciklama="Bu sayfada kayıt yok; daha yeni satışlara dönebilirsiniz." aksiyon={<Button onClick={() => sayfayaGit(sayfa - 1)}>← Daha yeni</Button>} />
    : secim === VARSAYILAN_DURUM
      ? <BosDurumu baslik="Öne çıkarma satışı yok" aciklama="Bir öğretmen reklam paketi satın aldığında kayıt burada listelenir." />
      : <BosDurumu baslik="Bu filtreye uyan satış yok" aciklama="Başka bir durumu seçebilir ya da tüm satışlara dönebilirsiniz." aksiyon={<Button onClick={() => secimiAyarla(VARSAYILAN_DURUM)}>Tümünü göster</Button>} />;

  const doluListe = veriHazir && liste.length > 0;
  const govde = sorgu.isError && !veriHazir ? (
    <HataDurumu
      hata={getErrorDetail(sorgu.error, "Öne çıkarma satışları alınamadı.")}
      hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
    />
  ) : !veriHazir ? (
    <YukleniyorDurumu etiket="Öne çıkarma satışları yükleniyor…" />
  ) : liste.length === 0 ? (
    bosDurum
  ) : (
    <Table<AdminPromotion>
      columns={basligaOlcumStiliEkle<AdminPromotion>(kolonlar)}
      dataSource={liste}
      rowKey={(p) => p.id}
      pagination={false}
      scroll={{ x: "max-content" }}
      onRow={(p) => ({ "data-testid": `one-cikarma-${p.id}` }) as React.HTMLAttributes<HTMLElement>}
    />
  );

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>
          Öne Çıkarmalar
        </Typography.Title>
        <div role="group" aria-label="Durum filtresi" style={{ maxWidth: "100%", overflowX: "auto" }}>
          <Segmented<DurumSecimi> value={secim} onChange={(v) => secimiAyarla(v)} options={FILTRELER.map((f) => ({ value: f.value, label: f.label }))} />
        </div>
      </Flex>
      {!canManage ? (
        <Typography.Text type="secondary">Salt okunur görünüm: satışı iptal etmek için promotions.manage izni gerekir.</Typography.Text>
      ) : null}
      <section aria-label="Öne çıkarma satışları" style={kart}>
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
          <Typography.Text style={{ fontSize: 18, fontWeight: 500, display: "block" }}>Satın alınan reklam paketleri</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Öğretmenlerin satın aldığı reklam paketleri. Arama sonuçlarının organik sıralamasını değiştirmez; öne çıkan ilan ayrı bir blokta gösterilir.
          </Typography.Text>
        </div>
        {tazelemeHatasi ? (
          <div style={{ padding: "12px 24px 0" }}>
            <HataDurumu
              hata={getErrorDetail(sorgu.error, "Liste güncellenemedi; gösterilen kayıtlar önceki yüklemeden.")}
              hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
            />
          </div>
        ) : null}
        <div style={{ padding: doluListe ? "0 12px" : "16px 24px" }}>{govde}</div>
        {/* Sunucu toplam vermiyor: sayfa numarası ve yön düğmeleri var, uydurma "N kayıt" yok. */}
        {doluListe && (dahaYeniVar || dahaEskiVar) ? (
          <Flex align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 24px", borderTop: `1px solid ${ayrac}` }}>
            {dahaYeniVar ? <Button onClick={() => sayfayaGit(sayfa - 1)}>← Daha yeni</Button> : <span />}
            <Typography.Text type="secondary" style={{ fontSize: 12, ...SAYI }}>{sayfa}. sayfa</Typography.Text>
            {dahaEskiVar ? <Button onClick={() => sayfayaGit(sayfa + 1)}>Daha eski →</Button> : <span />}
          </Flex>
        ) : null}
      </section>
      <AyrintiPenceresi
        acik={Boolean(ayrinti)}
        kayit={ayrinti}
        kapat={ayrintiyiKapat}
        tarih={tarihMetni}
        tutar={(deger, currency) => tutarMetni(deger, currency)}
        paraDurumu={paraDurumuMetni}
        gorunurluk={(k) => gorunurlukDurumu(k, Date.now()).etiket}
      />
      <IptalPenceresi
        acik={Boolean(iptalHedefi)}
        kayit={iptalHedefi ?? undefined}
        kapat={iptaliKapat}
        kaydediyor={Boolean(iptalHedefi && surenIslem(`promotion:${iptalHedefi.id}`))}
        kilitliMi={() => (iptalHedefi ? kilitli(`promotion:${iptalHedefi.id}`) : false)}
        alanHatalari={iptalHatasi.alan}
        hata={iptalHatasi.genel}
        onayla={(gerekce) => iptalHedefi && iptalEt(iptalHedefi, gerekce)}
      />
    </Flex>
  );
}
