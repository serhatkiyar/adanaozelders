// Tedarikçiler — eski SupplierPanel'in durum şeridi, ayarları, senkronu ve
// katalog listesi (eşleşmemiş/bağlı) ListePage üzerinde. Veri hook'lardan, karar sunucuda.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, App, Button, Flex, Segmented, Select, Tag, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { SettingOutlined, SyncOutlined } from "@ant-design/icons";
import { ListePage } from "@/panel/components/ListePage";
import { HataDurumu } from "@/panel/components/Durum";
import { AyarlarCekmecesi, BagCozmeCekmecesi, BaglamaCekmecesi } from "@/panel/pages/urunler/TedarikciCekmecesi";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { useSupplierProducts, useSuppliers, useSyncSupplier } from "@/hooks/useSuppliers";
import { useDebounce } from "@/hooks/useDebounce";
import { formatDateTime } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import { karantinaEtiketi, type SupplierOut, type SupplierProductOut } from "@/types/supplier";

const DAKIKA = 60_000;
const GUN = 86_400_000;
type Gorunum = "eslesmemis" | "bagli";
// Eski ekranla aynı beyaz liste.
const SAYFA_BOYUTLARI = [10, 25, 50];
const VARSAYILAN_BOYUT = 25;

function kalanDakika(iso?: string | null): number | null {
  if (!iso) return null;
  const fark = new Date(iso).getTime() - Date.now();
  return Number.isFinite(fark) && fark > 0 ? Math.ceil(fark / DAKIKA) : null;
}

// Yakın geçmiş göreli ("4 dk önce"), bir günden eskisi mutlak.
function goreliZaman(iso?: string | null): string {
  if (!iso) return "Henüz yapılmadı";
  const damga = new Date(iso).getTime();
  if (!Number.isFinite(damga)) return "—";
  const fark = Date.now() - damga;
  if (fark < 0) return formatDateTime(iso);
  if (fark < DAKIKA) return "az önce";
  if (fark < 60 * DAKIKA) return `${Math.floor(fark / DAKIKA)} dk önce`;
  if (fark < 24 * 60 * DAKIKA) return `${Math.floor(fark / (60 * DAKIKA))} saat önce`;
  return formatDateTime(iso);
}

function stokBicimle(deger?: string | null): string {
  if (deger == null || deger === "") return "—";
  const sayi = Number(deger);
  return Number.isFinite(sayi) ? new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(sayi) : deger;
}

// Token'ın değeri değil, varlığı ve vadesi. "Doldu mu" kararı ham farktan verilir.
function tokenDurumu(t: SupplierOut): { metin: string; uyari: boolean } {
  if (!t.has_token) return { metin: "API token girilmemiş: senkron çalışamaz.", uyari: true };
  const kalan = t.token_expires_at ? new Date(t.token_expires_at).getTime() - Date.now() : NaN;
  if (!Number.isFinite(kalan)) return { metin: "API token girili; vade bilgisi yok.", uyari: false };
  if (kalan <= 0) return { metin: "API token süresi doldu: yenisini yapıştırın.", uyari: true };
  if (kalan < GUN) return { metin: "API token BUGÜN doluyor: yenisini yapıştırın.", uyari: true };
  const gun = Math.round(kalan / GUN);
  return { metin: `API token ${gun} gün sonra dolar.`, uyari: gun < 7 };
}

function Bayraklar({ kodlar }: { kodlar?: string[] | null }) {
  if (!kodlar || kodlar.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Flex gap={4} wrap>
      {kodlar.map((kod, i) => <Tag key={`${kod}-${i}`} color="warning" style={{ marginInlineEnd: 0 }}>{karantinaEtiketi(kod)}</Tag>)}
    </Flex>
  );
}

const maliyet = (s: SupplierProductOut) =>
  s.cost_gross ? <span style={{ whiteSpace: "nowrap" }}>{formatTL(s.cost_gross)}</span> : <Typography.Text type="secondary">—</Typography.Text>;

/** Satır + seçildiği sağlayıcı bağlamı: pencere gönderiminde ikisi de doğrulanır. */
type SatirBaglami = { satir: SupplierProductOut; supplierId: number };

export function TedarikciListesi() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("suppliers");
  const [params, setParams] = useSearchParams();
  const tedarikciler = useSuppliers(canView);

  // Bütün sorgu durumu URL'de: saglayici, gorunum, ara, sayfa, limit (deep-link + geri/ileri).
  const liste = tedarikciler.data ?? [];
  const hamSaglayici = params.get("saglayici") ?? "";
  const seciliId = /^\d+$/.test(hamSaglayici) ? Number(hamSaglayici) : NaN;
  const tedarikci = liste.find((t) => t.id === seciliId) ?? liste[0];
  const gorunum: Gorunum = params.get("gorunum") === "bagli" ? "bagli" : "eslesmemis";
  const aramaUrl = (params.get("ara") ?? "").slice(0, 200);
  const hamSayfa = params.get("sayfa") ?? "";
  const sayfa = /^\d+$/.test(hamSayfa) && Number.isSafeInteger(Number(hamSayfa)) && Number(hamSayfa) > 0 ? Number(hamSayfa) : 1;
  const hamBoyut = Number(params.get("limit"));
  const boyut = SAYFA_BOYUTLARI.includes(hamBoyut) ? hamBoyut : VARSAYILAN_BOYUT;
  // Yalnız API'ye giden metin gecikir; alan URL'ye anında yazar.
  const gecikmisArama = useDebounce(aramaUrl);

  const [ayarlarAcik, setAyarlarAcik] = useState(false);
  const [baglanacak, setBaglanacak] = useState<SatirBaglami | null>(null);
  const [cozulecek, setCozulecek] = useState<SatirBaglami | null>(null);
  // Senkron kilidi: stok ve fiyat aynı kilidi paylaşır, aynı tick'te ikinci istek çıkmaz.
  const senkronRef = useRef(false);

  // Functional güncelleme: ilgisiz parametreler korunur; sayfa yalnız istenince kalır.
  // Arama ve kanonikleştirme geçmişi ezer (replace); görünüm/sağlayıcı/sayfa geçmişe girer.
  const paramYaz = (yama: Record<string, string | null>, secenek: { sayfayiKoru?: boolean; replace?: boolean } = {}) => {
    setParams(
      (onceki) => {
        const sonraki = new URLSearchParams(onceki);
        for (const [k, v] of Object.entries(yama)) {
          if (v) sonraki.set(k, v);
          else sonraki.delete(k);
        }
        if (!secenek.sayfayiKoru) sonraki.delete("sayfa");
        return sonraki;
      },
      { replace: Boolean(secenek.replace) },
    );
  };

  // Geçersiz/eksik sağlayıcı ilk sağlayıcıya düşerse URL de kanonik hâle gelir.
  useEffect(() => {
    if (tedarikci && tedarikci.id !== seciliId) paramYaz({ saglayici: String(tedarikci.id) }, { sayfayiKoru: true, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tedarikci?.id, seciliId]);

  // Sağlayıcı ya da görünüm değişince açık pencereler kapanır; eski satır yeni bağlama sızmaz.
  useEffect(() => {
    setAyarlarAcik(false);
    setBaglanacak(null);
    setCozulecek(null);
  }, [tedarikci?.id, gorunum]);

  const sorguAktif = canView && tedarikci !== undefined;
  const urunler = useSupplierProducts(
    tedarikci?.id,
    {
      linked: gorunum === "bagli",
      ...(gecikmisArama ? { q: gecikmisArama } : {}),
      limit: boyut,
      offset: (sayfa - 1) * boyut,
    },
    sorguAktif,
  );
  const senkron = useSyncSupplier(tedarikci?.id);
  const bekleyenDakika = kalanDakika(tedarikci?.cooldown_until);
  const senkronKilitli = senkron.isPending || bekleyenDakika !== null;

  const calistir = (scope: "stock" | "price") => {
    if (senkronRef.current || senkronKilitli || !tedarikci) return;
    senkronRef.current = true;
    senkron.mutate(scope, {
      onSuccess: (r) => message.success(scope === "stock" ? `Stok senkronu bitti: ${r.updated} satır güncellendi.` : `Fiyat senkronu bitti: ${r.priced} satır fiyatlandı.`),
      onError: (e) => message.error(getErrorDetail(e, "Senkron başlatılamadı.")),
      onSettled: () => {
        senkronRef.current = false;
      },
    });
  };

  const kolonlar = useMemo<TableProps<SupplierProductOut>["columns"]>(() => {
    const secId = tedarikci?.id;
    const ortak = [
      { title: "Maliyet (KDV dahil)", key: "maliyet", render: (_: unknown, s: SupplierProductOut) => maliyet(s) },
      { title: "Uyarılar", key: "bayraklar", render: (_: unknown, s: SupplierProductOut) => <Bayraklar kodlar={s.quarantine_flags} /> },
    ];
    if (gorunum === "eslesmemis") {
      return [
        { title: "Kod", key: "kod", render: (_: unknown, s: SupplierProductOut) => <Typography.Text type="secondary" style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{s.external_code}</Typography.Text> },
        { title: "Ad", key: "ad", render: (_: unknown, s: SupplierProductOut) => <span style={{ fontWeight: 500 }}>{s.name}</span> },
        { title: "Marka", key: "marka", render: (_: unknown, s: SupplierProductOut) => s.brand || "—" },
        {
          title: "Barkod",
          key: "barkod",
          render: (_: unknown, s: SupplierProductOut) => (
            <span style={{ whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 12 }}>
              {s.barcode || "—"}
              {s.barcode && !s.barcode_valid ? <Tag color="warning" style={{ marginInlineStart: 8 }}>Geçersiz</Tag> : null}
            </span>
          ),
        },
        { title: "Birim", key: "birim", render: (_: unknown, s: SupplierProductOut) => s.unit_name || "—" },
        { title: "Stok", key: "stok", align: "right" as const, render: (_: unknown, s: SupplierProductOut) => stokBicimle(s.stock_qty) },
        ...ortak,
        ...(canManage && secId !== undefined
          ? [{ title: "", key: "eylem", render: (_: unknown, s: SupplierProductOut) => <Button type="link" style={{ padding: 0 }} onClick={() => setBaglanacak({ satir: s, supplierId: secId })}>Bağla</Button> }]
          : []),
      ];
    }
    return [
      {
        title: "Ürün",
        key: "urun",
        render: (_: unknown, s: SupplierProductOut) => (
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontWeight: 500 }}>{s.product?.title ?? s.name}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{[s.product?.sku, s.external_code].filter(Boolean).join(" · ")}</Typography.Text>
          </span>
        ),
      },
      { title: "Kaynak", key: "kaynak", render: (_: unknown, s: SupplierProductOut) => (s.link_source ? <Tag>{s.link_source === "AUTO" ? "Otomatik" : "Elle"}</Tag> : "—") },
      {
        title: "Tedarikçi stoğu",
        key: "stok",
        align: "right" as const,
        render: (_: unknown, s: SupplierProductOut) => (
          <span style={{ whiteSpace: "nowrap" }}>
            {stokBicimle(s.stock_qty)}
            {s.unit_name ? <Typography.Text type="secondary" style={{ fontSize: 12, marginInlineStart: 4 }}>{s.unit_name}</Typography.Text> : null}
          </span>
        ),
      },
      ...ortak,
      ...(canManage && secId !== undefined
        ? [{ title: "", key: "eylem", render: (_: unknown, s: SupplierProductOut) => <Button type="link" style={{ padding: 0 }} onClick={() => setCozulecek({ satir: s, supplierId: secId })}>Çöz</Button> }]
        : []),
    ];
  }, [gorunum, canManage, tedarikci?.id]);

  if (!canView) return <AccessDenied area="Tedarikçiler" />;
  if (tedarikciler.isError) {
    return (
      <HataDurumu
        hata={getErrorDetail(tedarikciler.error, "Tedarikçi bilgisi yüklenemedi.")}
        hataAksiyon={<Button size="small" onClick={() => void tedarikciler.refetch()}>Tekrar dene</Button>}
      />
    );
  }

  const tokenBilgi = tedarikci ? tokenDurumu(tedarikci) : null;
  const ozet: [string, string][] = tedarikci
    ? [
        ["Son stok senkronu", goreliZaman(tedarikci.last_stock_sync_ok_at)],
        ["Son fiyat senkronu", goreliZaman(tedarikci.last_price_sync_ok_at)],
        ["Bağlı ürün", String(tedarikci.linked_count)],
        ["Eşleşmemiş", String(tedarikci.unmatched_count)],
      ]
    : [];

  const durumSeridi = tedarikci ? (
    <Flex vertical gap={12} data-testid="tedarikci-durum">
      <Flex align="center" gap={12} wrap>
        <Typography.Text style={{ fontSize: 16, fontWeight: 500 }}>{tedarikci.name}</Typography.Text>
        <Tag color={tedarikci.is_enabled ? "success" : "default"}>{tedarikci.is_enabled ? "Açık" : "Kapalı"}</Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tedarikci.base_url}</Typography.Text>
      </Flex>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, padding: "12px 0", borderTop: `1px solid ${token.colorBorderSecondary}`, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        {ozet.map(([k, v]) => (
          <div key={k}>
            <Typography.Text style={{ fontSize: 12, color: token.colorTextTertiary, display: "block" }}>{k}</Typography.Text>
            <Typography.Text style={{ fontWeight: 500 }}>{v}</Typography.Text>
          </div>
        ))}
      </div>
      {tokenBilgi?.uyari ? (
        <Alert type="warning" showIcon role="status" message={tokenBilgi.metin} data-testid="token-durumu" />
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }} data-testid="token-durumu">{tokenBilgi?.metin}</Typography.Text>
      )}
      {/* Son hata birebir gösterilir: özet, 502 ile challenge'ı ayırt ettirmez. */}
      {tedarikci.last_error ? (
        <Alert type="error" showIcon message={<><strong>Son hata:</strong> {tedarikci.last_error}{tedarikci.last_error_at ? ` · ${goreliZaman(tedarikci.last_error_at)}` : ""}</>} />
      ) : null}
      {bekleyenDakika !== null ? (
        <Alert
          type="warning"
          showIcon
          role="status"
          data-testid="devre-kesici"
          message={`Devre kesici açık: ${bekleyenDakika} dk beklemede (${tedarikci.consecutive_failures} ardışık hata). Bu süre dolmadan yeni istek gönderilmez.`}
        />
      ) : null}
      <Segmented<Gorunum>
        aria-label="Ürün görünümü"
        value={gorunum}
        options={[
          { value: "eslesmemis", label: `Eşleşmemiş favoriler (${tedarikci.unmatched_count})` },
          { value: "bagli", label: `Bağlı ürünler (${tedarikci.linked_count})` },
        ]}
        onChange={(v) => paramYaz({ gorunum: v === "eslesmemis" ? null : v, ara: null })}
        style={{ alignSelf: "flex-start" }}
      />
    </Flex>
  ) : null;

  const aksiyonlar = tedarikci ? (
    <>
      {liste.length > 1 ? (
        <Select<number>
          aria-label="Tedarikçi"
          value={tedarikci.id}
          options={liste.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(v) => paramYaz({ saglayici: String(v), ara: null })}
          style={{ width: 200 }}
        />
      ) : null}
      {canManage ? (
        <>
          {/* Devre kesici açıkken kapalı: sebebi durum şeridindeki uyarıda okunur. */}
          <Button icon={<SyncOutlined />} disabled={bekleyenDakika !== null} loading={senkron.isPending && senkron.variables === "stock"} onClick={() => calistir("stock")}>Stoğu senkronla</Button>
          <Button icon={<SyncOutlined />} disabled={bekleyenDakika !== null} loading={senkron.isPending && senkron.variables === "price"} onClick={() => calistir("price")}>Fiyatı senkronla</Button>
          <Button type="primary" icon={<SettingOutlined />} onClick={() => setAyarlarAcik(true)}>Ayarlar</Button>
        </>
      ) : null}
    </>
  ) : null;

  const bosBaslik = !tedarikci ? "Tanımlı tedarikçi yok" : aramaUrl ? "Sonuç bulunamadı" : gorunum === "eslesmemis" ? "Eşleşmemiş favori yok" : "Bağlı ürün yok";
  const bosAciklama = !tedarikci
    ? "Yıldırım B2B bağlantısı sunucuda kurulduğunda burada görünür."
    : aramaUrl
      ? "Arama metnini değiştirmeyi deneyin."
      : gorunum === "eslesmemis"
        ? "Tedarikçideki bütün favori satırlar bir ürüne bağlı."
        : "Barkodu geçerli favoriler senkronda kendiliğinden bağlanır.";

  return (
    <>
      <ListePage<SupplierProductOut>
        baslik="Tedarikçiler"
        detayliBilgiIpucu="Tedarikçi kataloğu senkronla gelir; eşleşmemiş satırlar elle bir ürüne bağlanır."
        aciklama={canManage ? undefined : "Bu alanda salt okunur yetkiniz var; ayar, senkron ve bağlama işlemleri kapalı."}
        aksiyonlar={aksiyonlar}
        aramaDegeri={tedarikci ? aramaUrl : undefined}
        aramaDegisti={tedarikci ? (v) => paramYaz({ ara: v.slice(0, 200) || null }, { replace: true }) : undefined}
        ustIcerik={durumSeridi}
        birimEtiket="Satır"
        kolonlar={kolonlar}
        veri={tedarikci ? (urunler.data?.items ?? []) : []}
        yukleniyor={tedarikciler.isPending || (sorguAktif && urunler.isPending)}
        hata={tedarikci && urunler.isError ? getErrorDetail(urunler.error, "Tedarikçi ürünleri yüklenemedi.") : null}
        hataAksiyon={<Button size="small" onClick={() => void urunler.refetch()}>Tekrar dene</Button>}
        toplam={!tedarikci || !urunler.data ? 0 : urunler.data.total >= 0 ? urunler.data.total : urunler.data.items.length}
        sayfa={sayfa}
        sayfaBoyutu={boyut}
        sayfaDegisti={(s, b) => {
          if (b !== boyut) paramYaz({ limit: b === VARSAYILAN_BOYUT ? null : String(b) });
          else paramYaz({ sayfa: s > 1 ? String(s) : null }, { sayfayiKoru: true });
        }}
        bosBaslik={bosBaslik}
        bosAciklama={bosAciklama}
        rowKey={(s) => s.id}
      />
      <AyarlarCekmecesi acik={ayarlarAcik} kapat={() => setAyarlarAcik(false)} tedarikci={tedarikci} />
      <BaglamaCekmecesi
        acik={baglanacak !== null}
        kapat={() => setBaglanacak(null)}
        supplierId={tedarikci?.id}
        satir={baglanacak?.satir ?? null}
        satirSupplierId={baglanacak?.supplierId}
      />
      <BagCozmeCekmecesi
        acik={cozulecek !== null}
        kapat={() => setCozulecek(null)}
        supplierId={tedarikci?.id}
        satir={cozulecek?.satir ?? null}
        satirSupplierId={cozulecek?.supplierId}
      />
    </>
  );
}
