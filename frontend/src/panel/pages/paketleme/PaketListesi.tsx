// Paketler — eski PackagesPage panel düzeninde: durum/sipariş süzgeci URL'de, sunucu sayfalaması,
// tekli/toplu etiket ve yalnız packing.manage ile repack / "bozuldu" damgası.
// Paket kodu ve satır tıklaması yeni paket detayına (ROUTES.adminNewPackingPackage) gider.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { App, Button, Flex, InputNumber, Select, Tag, Tooltip, Typography } from "antd";
import type { TableProps } from "antd";
import { AccessDenied } from "@/components/admin/AccessState";
import { PackageLabelButton, canPrintLabel } from "@/components/admin/packing/PackageLabel";
import { PackingLabelSheet } from "@/components/admin/packing/PackingLabelSheet";
import { ListePage } from "@/panel/components/ListePage";
import { usePaketlemeErisimi } from "@/panel/pages/paketleme/usePaketlemeErisimi";
import { usePackages, useRepackPackage, useUnpackPackage } from "@/hooks/usePacking";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { formatDateTime } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { PACKAGE_STATUS_LABEL } from "@/lib/packing";
import { ROUTES } from "@/lib/routes";
import type { Package, PackageStatus } from "@/types/packing";
import { onayAc } from "@/panel/components/onayPenceresi";

/** API sınırıyla uyumlu seçenekler; başlangıç 20. */
const SAYFA_BOYUTLARI = [10, 20, 50];
const VARSAYILAN_BOYUT = 20;

/** Süzgeç seçeneklerinin kısa adları; satır rozeti `PACKAGE_STATUS_LABEL` kullanır. */
const SUZGECLER: { value: PackageStatus | ""; label: string }[] = [
  { value: "", label: "Tümü" },
  { value: "OPEN", label: "Paketleniyor" },
  { value: "PACKED", label: "Hazır" },
  { value: "HANDED_OVER", label: "Kuryede" },
  { value: "RETURN_PENDING", label: "Geri dönüş" },
  { value: "RETURNED", label: "Depoda" },
  { value: "DELIVERED", label: "Teslim" },
  { value: "VOID", label: "Vazgeçilen" },
];

const DURUM_RENGI: Record<PackageStatus, string> = {
  OPEN: "blue",
  PACKED: "success",
  HANDED_OVER: "blue",
  RETURN_PENDING: "warning",
  RETURNED: "default",
  DELIVERED: "success",
  VOID: "error",
};

// Kapalı küme: `?durum=toString|constructor|__proto__` sunucuya GİTMEZ (Set prototip taşımaz).
const GECERLI_DURUMLAR: ReadonlySet<string> = new Set<string>(Object.keys(PACKAGE_STATUS_LABEL));

/** Satır rozeti "kutuda sırada ne var": RETURN_PENDING → Geri bekleniyor; VOID → Bozuldu/Bozulacak. */
export function satirEtiketi(paket: Package): string {
  if (paket.status === "RETURN_PENDING") return "Geri bekleniyor";
  if (paket.status === "VOID") return paket.unpacked_at ? "Bozuldu" : "Bozulacak";
  return PACKAGE_STATUS_LABEL[paket.status] ?? paket.status;
}

/** Durum için anlamlı TEK zaman damgası; yoksa satırda hiçbir şey yazmaz. */
export function zamanDamgasi(paket: Package): string | null {
  const secim = ((): { at: string | null; etiket: string } => {
    switch (paket.status) {
      case "OPEN":
        return { at: paket.created_at, etiket: "açıldı" };
      case "PACKED":
        return { at: paket.packed_at, etiket: "paketlendi" };
      case "HANDED_OVER":
      case "RETURN_PENDING":
        return { at: paket.handed_over_at, etiket: "kuryeye verildi" };
      case "RETURNED":
        return { at: paket.returned_at, etiket: "depoya alındı" };
      case "DELIVERED":
        return { at: paket.delivered_at, etiket: "teslim edildi" };
      case "VOID":
        return { at: paket.unpacked_at ?? paket.void_at, etiket: paket.unpacked_at ? "bozuldu" : "vazgeçildi" };
      default:
        return { at: null, etiket: "" };
    }
  })();
  return secim.at ? `${secim.etiket} · ${formatDateTime(secim.at)}` : null;
}

const pozitifTamSayi = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

export function PaketListesi() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const { canView, canManage } = usePaketlemeErisimi();
  // Adres adları korundu (`durum`, `siparis`, `sayfa`, `boyut`); süzgeç değişince sayfa 1.
  const url = useUrlDurumu(
    { durum: "", siparis: 0, sayfa: 1, boyut: VARSAYILAN_BOYUT },
    { sayfaAnahtari: "sayfa", filtreDisi: ["sayfa", "boyut"] },
  );
  const hamDurum = String(url.degerler.durum ?? "");
  const durum = hamDurum && GECERLI_DURUMLAR.has(hamDurum) ? (hamDurum as PackageStatus) : undefined;
  const siparis = pozitifTamSayi(url.degerler.siparis);
  const sayfa = pozitifTamSayi(url.degerler.sayfa) ?? 1;
  const hamBoyut = Number(url.degerler.boyut);
  const boyut = SAYFA_BOYUTLARI.includes(hamBoyut) ? hamBoyut : VARSAYILAN_BOYUT;

  const sorgu = usePackages({ status: durum, orderId: siparis, limit: boyut, offset: (sayfa - 1) * boyut }, canView);
  const yenidenPaketle = useRepackPackage();
  const bozuldu = useUnpackPackage();
  const [filtreAcik, setFiltreAcik] = useState(false);
  const [secili, setSecili] = useState<number[]>([]);
  const [etiketAcik, setEtiketAcik] = useState(false);
  // İşlem bazlı senkron kilit + uçuştaki söz (aynı tick çift onay tek istek).
  const kilitRef = useRef(new Map<string, Promise<unknown>>());

  const paketler = useMemo(() => sorgu.data?.items ?? [], [sorgu.data]);
  const toplam = sorgu.data?.total ?? 0;
  const sonSayfa = Math.max(1, Math.ceil(toplam / boyut));

  // Veri azalınca sayfa son geçerli sayfaya çekilir; yanlış boş ekran oluşmaz.
  useEffect(() => {
    if (sorgu.data && sayfa > sonSayfa) url.ayarla({ sayfa: sonSayfa }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorgu.data, sayfa, sonSayfa]);

  // Sayfa/süzgeç/boyut değişince seçim korunmaz: görünmeyen kutuya kâğıt üretilmez.
  useEffect(() => {
    setSecili([]);
    setEtiketAcik(false);
  }, [durum, siparis, sayfa, boyut]);

  // Seçim yalnız bu sayfadaki basılabilir (PACKED · RETURNED) paketlerden oluşur.
  const basilabilirler = paketler.filter((p) => canPrintLabel(p.status));
  const seciliGorunen = secili.filter((id) => basilabilirler.some((p) => p.id === id));

  // Hedef paket ID onay açılırken sabitlenir; await modu: red → onay açık kalır.
  const onayla = (anahtar: string, calistir: () => Promise<unknown>, basari: string, hata: string) => () => {
    const uctaki = kilitRef.current.get(anahtar);
    if (uctaki) return uctaki;
    const soz = calistir()
      .then(() => {
        // message.success thenable döner; zincire sokulursa onay penceresi toast kapanana dek açık kalır.
        message.success(basari);
      })
      .catch((e: unknown) => {
        message.error(getErrorDetail(e, hata));
        throw e;
      })
      .finally(() => kilitRef.current.delete(anahtar));
    kilitRef.current.set(anahtar, soz);
    return soz;
  };
  /** `onayAc` iş sözleşmesi: meşgulde pencere sessizce açık kalır, AntD'ye söz gitmez. */
  const onayIsi = (anahtar: string, calistir: () => Promise<unknown>, basari: string, hata: string) => ({
    mesgulMu: () => kilitRef.current.has(anahtar),
    calistir: onayla(anahtar, calistir, basari, hata),
  });

  const yenidenPaketleOnayi = (paket: Package) => {
    const hedefId = paket.id;
    const anahtar = `repack:${hedefId}`;
    if (kilitRef.current.has(anahtar)) return;
    onayAc(modal, {
      title: "Yeniden dağıtıma ver",
      content: `${paket.code} yeniden dağıtıma girer. Kutunun üstündeki etiket GEÇERLİ kalır; yeni etiket basmayın.`,
      okText: "Yeniden paketle",
      cancelText: "İptal",
      ...onayIsi(anahtar, () => yenidenPaketle.mutateAsync(hedefId), "Paket yeniden dağıtıma hazır.", "Paket yeniden dağıtıma verilemedi."),
    });
  };
  const bozulduOnayi = (paket: Package) => {
    const hedefId = paket.id;
    const anahtar = `unpack:${hedefId}`;
    if (kilitRef.current.has(anahtar)) return;
    onayAc(modal, {
      title: "Kutu bozuldu mu?",
      content: `${paket.code} kutusunun fiziksel olarak açıldığını ve içeriğin rafa geri konduğunu işaretleyeceksiniz. Bu damga stok hareketi YAZMAZ; sayım envanterden yapılır.`,
      okText: "Bozuldu",
      cancelText: "İptal",
      ...onayIsi(anahtar, () => bozuldu.mutateAsync(hedefId), "Kutu bozuldu olarak işaretlendi.", "İşaretlenemedi."),
    });
  };

  const satirTiklama = (p: Package) => ({ onClick: () => navigate(ROUTES.adminNewPackingPackage(p.id)), style: { cursor: "pointer" } });
  const kolonlar: TableProps<Package>["columns"] = [
    {
      title: "Paket",
      key: "paket",
      onCell: satirTiklama,
      render: (_: unknown, p: Package) => {
        const damga = zamanDamgasi(p);
        return (
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <Link to={ROUTES.adminNewPackingPackage(p.id)} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 500 }}>
              {p.code}
            </Link>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Sipariş #{p.order_id}
              {(p.items?.length ?? 0) > 0 ? ` · ${p.items.length} kalem` : ""}
              {damga ? ` · ${damga}` : ""}
            </Typography.Text>
          </span>
        );
      },
    },
    {
      title: "Durum",
      key: "durum",
      onCell: satirTiklama,
      render: (_: unknown, p: Package) => <Tag color={DURUM_RENGI[p.status] ?? "default"} style={{ marginInlineEnd: 0 }}>{satirEtiketi(p)}</Tag>,
    },
    {
      title: "İşlem",
      key: "islem",
      // Aksiyon hücresi satırı açmaz (iç içe a/button yok; tıklama yayılmaz).
      onCell: () => ({ onClick: (e: React.MouseEvent) => e.stopPropagation() }),
      render: (_: unknown, p: Package) => (
        <Flex gap={8} wrap align="center">
          {/* Yeniden basım yan etkisizdir: durum da QR token'ı da değişmez. */}
          <PackageLabelButton packageId={p.id} code={p.code} status={p.status} label="Etiket" />
          {/* Esc onay penceresini kapatabilir; istek sürerken satır düğmesi sessiz kalmasın diye yükleniyor gösterir. */}
          {canManage && p.status === "RETURNED" ? (
            <Button loading={yenidenPaketle.isPending && yenidenPaketle.variables === p.id} onClick={() => yenidenPaketleOnayi(p)}>
              Yeniden paketle
            </Button>
          ) : null}
          {canManage && p.status === "VOID" && !p.unpacked_at ? (
            <Button loading={bozuldu.isPending && bozuldu.variables === p.id} onClick={() => bozulduOnayi(p)}>
              Bozuldu olarak işaretle
            </Button>
          ) : null}
        </Flex>
      ),
    },
  ];

  if (!canView) return <AccessDenied area="Paketleme" />;

  const filtreSayisi = (durum ? 1 : 0) + (siparis ? 1 : 0);
  const yazdirDugmesi = (
    <Button disabled={seciliGorunen.length === 0} onClick={() => setEtiketAcik(true)}>
      Seçili {seciliGorunen.length} etiketi yazdır
    </Button>
  );

  return (
    <>
      <ListePage<Package>
        baslik="Paketler"
        detayliBilgiIpucu="Açılmış bütün kutular. Durum süzgeci depodaki işi ayırır: kuryeden dönmesi beklenen kutular ve bozulup rafa geri konacaklar."
        aciklama={canManage ? undefined : "Bu alanda etiket görüntülenebilir; yeniden paketleme ve bozuldu damgası için packing.manage izni gerekir."}
        aksiyonlar={
          basilabilirler.length > 0
            ? seciliGorunen.length === 0
              ? <Tooltip title="Önce bu sayfadaki basılabilir (Hazır/Depoda) paketleri seçin.">{yazdirDugmesi}</Tooltip>
              : yazdirDugmesi
            : null
        }
        filtreSayisi={filtreSayisi}
        filtreAcik={filtreAcik}
        filtreAcikDegisti={setFiltreAcik}
        filtreIcerigi={
          <Flex gap={12} wrap>
            <Select<PackageStatus | "">
              aria-label="Durum"
              value={durum ?? ""}
              options={SUZGECLER}
              onChange={(v) => url.ayarla({ durum: v })}
              style={{ width: 200 }}
            />
            <InputNumber
              aria-label="Sipariş no"
              placeholder="Sipariş no"
              min={1}
              precision={0}
              value={siparis ?? null}
              onChange={(v) => url.ayarla({ siparis: pozitifTamSayi(v) ?? 0 }, { replace: true })}
              style={{ width: 160 }}
            />
          </Flex>
        }
        birimEtiket="Paket"
        satirSecimi={{
          selectedRowKeys: seciliGorunen,
          onChange: (anahtarlar) => setSecili(anahtarlar.map(Number).filter((id) => basilabilirler.some((p) => p.id === id))),
          getCheckboxProps: (p) => ({ disabled: !canPrintLabel(p.status), "aria-label": `${p.code} etiketini seç` }),
        }}
        kolonlar={kolonlar}
        veri={paketler}
        yukleniyor={sorgu.isPending}
        hata={sorgu.isError ? getErrorDetail(sorgu.error, "Paket listesi yüklenemedi.") : null}
        hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
        toplam={toplam}
        sayfa={Math.min(sayfa, sonSayfa)}
        sayfaBoyutu={boyut}
        sayfaBoyutuSecenekleri={SAYFA_BOYUTLARI}
        sayfaDegisti={(s, b) => (b !== boyut ? url.ayarla({ boyut: b, sayfa: 1 }) : url.ayarla({ sayfa: s }))}
        bosBaslik={url.filtreliMi ? "Bu süzgeçte paket yok" : "Henüz paket açılmadı"}
        bosAciklama={url.filtreliMi ? "Süzgeci genişletin ya da kuyruktan yeni bir paket açın." : "Paketleme kuyruğundan ilk kutuyu açtığınızda burada listelenir."}
        bosAksiyon={url.filtreliMi ? <Button onClick={() => url.temizle()}>Süzgeci temizle</Button> : undefined}
        rowKey={(p) => p.id}
      />
      {/* Etiket verisi (alıcı/adres) yalnız yazdırma istenince çekilir. */}
      {etiketAcik && seciliGorunen.length > 0 ? <PackingLabelSheet packageIds={seciliGorunen} onClose={() => setEtiketAcik(false)} /> : null}
    </>
  );
}
