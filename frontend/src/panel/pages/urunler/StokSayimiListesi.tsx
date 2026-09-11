// Stok sayımı oturumları listesi — eski CountSessionsPage'in verisi ve davranışı,
// ListePage (ikas liste anatomisi) üzerinde. Detay henüz taşınmadı: satır eski detay rotasına gider.
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button, Flex, Select, Tag, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { PlusOutlined, WarningOutlined } from "@ant-design/icons";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ListePage } from "@/panel/components/ListePage";
import { YeniSayimCekmecesi } from "@/panel/pages/urunler/YeniSayimCekmecesi";
import { useCountSessions } from "@/hooks/useInventory";
import { useInventoryAccess } from "@/hooks/useInventoryAccess";
import { formatDateTime } from "@/lib/datetime";
import {
  inventoryErrorMessage,
  lineCountLabel,
  needsRecount,
  sessionStatusBadge,
  type CountScope,
  type CountSessionStatus,
} from "@/lib/inventory";
import { ROUTES } from "@/lib/routes";
import type { CountSessionOut } from "@/api/inventory";

const DURUMLAR: { value: CountSessionStatus; label: string }[] = [
  { value: "DRAFT", label: "Taslak" },
  { value: "IN_PROGRESS", label: "Sayım sürüyor" },
  { value: "REVIEW", label: "İncelemede" },
  { value: "APPLIED", label: "Uygulandı" },
  { value: "CANCELLED", label: "İptal edildi" },
];

const KAPSAM: Record<CountScope, string> = { ALL: "Tüm ürünler", CATEGORY: "Kategori", MANUAL: "Seçili ürünler" };

const TON_RENK: Record<ReturnType<typeof sessionStatusBadge>["tone"], string> = {
  neutral: "default",
  info: "processing",
  success: "success",
  warning: "warning",
  danger: "error",
};

export function StokSayimiListesi() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Durum süzgeci URL'de (paylaşılabilir); beyaz liste dışı değer düşer.
  const hamDurum = params.get("durum") ?? "";
  const durum = DURUMLAR.some((d) => d.value === hamDurum) ? (hamDurum as CountSessionStatus) : "";
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);
  const [filtreAcik, setFiltreAcik] = useState(false);
  const [yeniAcik, setYeniAcik] = useState(false);
  const { canCount } = useInventoryAccess();

  const sorgu = useCountSessions({ status: durum, limit: boyut, offset: (sayfa - 1) * boyut });
  const satirlar = sorgu.data?.items ?? [];

  const durumSec = (v: CountSessionStatus | undefined) => {
    setParams(v ? { durum: v } : {});
    setSayfa(1);
    setFiltreAcik(false);
  };

  const kolonlar: TableProps<CountSessionOut>["columns"] = useMemo(() => {
    const satirTiklama = (o: CountSessionOut) => ({
      onClick: () => navigate(ROUTES.adminInventoryCount(o.id)),
      style: { cursor: "pointer" },
    });
    return [
      {
        title: "Oturum",
        key: "code",
        render: (_: unknown, o: CountSessionOut) => (
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <Link to={ROUTES.adminInventoryCount(o.id)} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 500 }}>
              {o.code}
            </Link>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {KAPSAM[o.scope] ?? o.scope} · Açan: #{o.created_by_admin_id}
            </Typography.Text>
          </span>
        ),
        onCell: satirTiklama,
      },
      { title: "Satır", key: "lines", render: (_: unknown, o: CountSessionOut) => lineCountLabel(o), onCell: satirTiklama },
      {
        title: "Uyarı",
        key: "stale",
        render: (_: unknown, o: CountSessionOut) =>
          needsRecount(o) ? (
            <Tag color="error" icon={<WarningOutlined aria-hidden="true" />}>
              Yeniden sayım gerekiyor
            </Tag>
          ) : (
            "—"
          ),
        onCell: satirTiklama,
      },
      {
        title: "Açılış",
        key: "created_at",
        render: (_: unknown, o: CountSessionOut) => <span style={{ whiteSpace: "nowrap" }}>{formatDateTime(o.created_at)}</span>,
        onCell: satirTiklama,
      },
      {
        title: "Durum",
        key: "status",
        render: (_: unknown, o: CountSessionOut) => {
          const r = sessionStatusBadge(o.status);
          return <Tag color={TON_RENK[r.tone]}>{r.label}</Tag>;
        },
        onCell: satirTiklama,
      },
    ];
  }, [navigate]);

  const yeniDugmesi = (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setYeniAcik(true)}>
      Stok Sayımı Ekle
    </Button>
  );

  // Canlı ikas: hiç sayım yokken başlık/aksiyon/filtre/tablo çizilmez, yalnız
  // ortalanmış boş durum ve tek düğme.
  if (sorgu.isSuccess && satirlar.length === 0 && !durum) {
    return (
      <>
        <IkasBosDurumu aksiyon={canCount ? yeniDugmesi : undefined} />
        <YeniSayimCekmecesi acik={yeniAcik} kapat={() => setYeniAcik(false)} />
      </>
    );
  }

  return (
    <>
      <ListePage<CountSessionOut>
        baslik="Stok Sayımı"
        detayliBilgiIpucu="Detay için satıra tıklayın. Fark yalnız inceleme sonrası uygulanır."
        aksiyonlar={canCount ? yeniDugmesi : null}
        filtreSayisi={durum ? 1 : 0}
        filtreIcerigi={
          <Select<CountSessionStatus>
            aria-label="Durum"
            allowClear
            placeholder="Tüm durumlar"
            value={durum || undefined}
            options={DURUMLAR}
            style={{ width: 240 }}
            onChange={durumSec}
          />
        }
        filtreAcik={filtreAcik}
        filtreAcikDegisti={setFiltreAcik}
        birimEtiket="Oturum"
        kolonlar={kolonlar}
        veri={satirlar}
        yukleniyor={sorgu.isPending}
        hata={sorgu.isError ? inventoryErrorMessage(sorgu.error, "Sayım oturumları yüklenemedi.") : null}
        hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
        toplam={sorgu.data?.total}
        sayfa={sayfa}
        sayfaBoyutu={boyut}
        sayfaDegisti={(s, b) => {
          setSayfa(s);
          setBoyut(b);
        }}
        bosBaslik={durum ? "Bu durumda oturum yok" : "Henüz sayım oturumu açılmadı"}
        bosAciklama={
          durum
            ? "Farklı bir durum seçin ya da süzgeci kaldırın."
            : "Sayım, rafta gerçekten ne olduğunu kayda geçirir. Kapsamı seçip bir oturum açın."
        }
        bosAksiyon={durum ? <Button onClick={() => durumSec(undefined)}>Süzgeci temizle</Button> : canCount ? yeniDugmesi : undefined}
        rowKey={(o) => o.id}
      />
      <YeniSayimCekmecesi acik={yeniAcik} kapat={() => setYeniAcik(false)} />
    </>
  );
}

// ikas boş durumu (ölçüm): blok 596px, 72px üst boşluk, başlık 20/500, açıklama 16px ikincil, 40px düğme.
function IkasBosDurumu({ aksiyon }: { aksiyon?: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flex vertical align="center" gap={32} role="status" style={{ maxWidth: 596, margin: "72px auto 0", padding: 24, textAlign: "center" }}>
      <Flex vertical gap={6}>
        <Typography.Text style={{ fontSize: 20, fontWeight: 500, lineHeight: "30px", color: token.colorText }}>
          Stok Sayımınızı Yönetin
        </Typography.Text>
        <Typography.Text style={{ fontSize: 16, lineHeight: "24px", color: token.colorTextSecondary }}>
          Rafınızdaki ürünlerin envanterini sayım oturumlarıyla takip edebilir ve yönetebilirsiniz.
        </Typography.Text>
      </Flex>
      {aksiyon}
    </Flex>
  );
}
