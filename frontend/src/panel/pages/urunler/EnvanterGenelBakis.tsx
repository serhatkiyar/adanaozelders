// Envanter genel bakışı — eski InventoryOverviewPage verisi, ikas kart düzeninde.
// Özet ucu yok: sayılar durum filtreli liste isteklerinin `total` alanından gelir (limit=1).
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Flex, Typography, theme } from "antd";
import { AccessDenied } from "@/components/admin/AccessState";
import { HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { useCountSessions, useDamageEvents } from "@/hooks/useInventory";
import { useInventoryAccess } from "@/hooks/useInventoryAccess";
import { formatDateTime } from "@/lib/datetime";
import { damageKindPastLabel, damageReasonLabel, inventoryErrorMessage } from "@/lib/inventory";
import { ROUTES } from "@/lib/routes";

function Kart({ baslik, aciklama, ekstra, children }: { baslik: string; aciklama?: string; ekstra?: ReactNode; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <section
      aria-label={baslik}
      style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4, padding: 24 }}
    >
      <Flex justify="space-between" align="center" gap={12} wrap style={{ paddingBottom: 16, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Flex vertical gap={2}>
          <Typography.Text style={{ fontSize: 16 }}>{baslik}</Typography.Text>
          {aciklama ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{aciklama}</Typography.Text> : null}
        </Flex>
        {ekstra}
      </Flex>
      {children}
    </section>
  );
}

type Sayac = { etiket: string; sayi: number | undefined; aciklama: string; hedef: string; yukleniyor: boolean };

function SayacSeridi({ kalemler }: { kalemler: Sayac[] }) {
  const { token } = theme.useToken();
  return (
    <div role="list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", rowGap: 24, paddingTop: 24 }}>
      {kalemler.map((k, i) => (
        <div role="listitem" key={k.etiket} style={{ padding: "0 16px", borderLeft: i ? `1px solid ${token.colorBorderSecondary}` : undefined }}>
          <Typography.Text style={{ fontWeight: 500, color: token.colorTextTertiary }}>{k.etiket}</Typography.Text>
          <div aria-busy={k.yukleniyor || undefined} style={{ fontSize: 20, fontWeight: 500, lineHeight: "30px", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
            {k.yukleniyor ? "…" : (k.sayi ?? "-")}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>{k.aciklama}</Typography.Text>
          <Link to={k.hedef} style={{ fontSize: 12, fontWeight: 500 }}>Oturumları aç →</Link>
        </div>
      ))}
    </div>
  );
}

export function EnvanterGenelBakis() {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  // AntD Button `href` ile tek bir <a> basar; SPA gezinmesi için tıklama Router'a devredilir.
  const dugmeBaglanti = (yol: string) => ({
    href: yol,
    onClick: (e: React.MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(yol);
    },
  });
  const { canView, canCount, canApply } = useInventoryAccess();
  const suren = useCountSessions({ status: "IN_PROGRESS", limit: 1, offset: 0 }, canView);
  const inceleme = useCountSessions({ status: "REVIEW", limit: 1, offset: 0 }, canView);
  const hasar = useDamageEvents({ limit: 5, offset: 0 }, canView);

  if (!canView) return <AccessDenied area="Envanter" />;

  const olaylar = hasar.data?.items ?? [];

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>
          Envanter
        </Typography.Title>
        {!canCount && !canApply ? (
          <Typography.Text type="secondary">Salt okunur görünüm: rolünüzde sayım ve hasar işlemi izni tanımlı değil.</Typography.Text>
        ) : null}
      </Flex>

      <Kart baslik="Sayım durumu" aciklama="Açık sayım oturumlarının anlık dağılımı.">
        <SayacSeridi
          kalemler={[
            {
              etiket: "Sayım sürüyor",
              sayi: suren.data?.total,
              aciklama: "Miktar girişi devam eden oturumlar.",
              hedef: `${ROUTES.adminNewStockCounts}?durum=IN_PROGRESS`,
              yukleniyor: suren.isLoading,
            },
            {
              etiket: "İnceleme bekliyor",
              sayi: inceleme.data?.total,
              aciklama: "Gönderilmiş, farkı uygulanmayı bekleyen oturumlar.",
              hedef: `${ROUTES.adminNewStockCounts}?durum=REVIEW`,
              yukleniyor: inceleme.isLoading,
            },
          ]}
        />
      </Kart>

      <Kart
        baslik="Son hasar olayları"
        aciklama="Hasara ayırma, kurtarma, imha ve tedarikçi iadesi kayıtları."
        ekstra={<Link to={ROUTES.adminNewDamageEvents} style={{ fontWeight: 500 }}>Tümü</Link>}
      >
        {hasar.isError ? (
          <div style={{ paddingTop: 16 }}>
            <HataDurumu
              hata={inventoryErrorMessage(hasar.error, "Hasar olayları yüklenemedi.")}
              hataAksiyon={<Button size="small" onClick={() => void hasar.refetch()}>Tekrar dene</Button>}
            />
          </div>
        ) : hasar.isPending ? (
          <div style={{ paddingTop: 16 }}><YukleniyorDurumu etiket="Hasar olayları yükleniyor…" /></div>
        ) : olaylar.length === 0 ? (
          <Typography.Text type="secondary" role="status" style={{ display: "block", padding: "32px 0", textAlign: "center" }}>
            Henüz hasar olayı kaydedilmedi.
          </Typography.Text>
        ) : (
          <div role="list">
            {olaylar.map((olay, i) => (
              <Flex role="listitem" key={olay.id} align="center" gap={12} wrap style={{ padding: "16px 0", borderBottom: i < olaylar.length - 1 ? `1px solid ${token.colorBorderSecondary}` : undefined }}>
                <span style={{ fontWeight: 500 }}>{damageKindPastLabel(olay.kind)}</span>
                <Typography.Text type="secondary">Ürün #{olay.product_id} · {olay.qty} adet</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{damageReasonLabel(olay.reason_code)}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12, marginInlineStart: "auto", whiteSpace: "nowrap" }}>
                  {formatDateTime(olay.created_at)}
                </Typography.Text>
              </Flex>
            ))}
          </div>
        )}
      </Kart>

      <Kart baslik="İlgili ekranlar" aciklama="Sayım ve hasar işlemleri hareket kaydı üretir; kayıtların kendisi salt okunurdur.">
        <Flex gap={8} wrap style={{ paddingTop: 16 }}>
          <Button {...dugmeBaglanti(ROUTES.adminNewStockMovements)}>Stok hareketleri</Button>
          <Button {...dugmeBaglanti(ROUTES.adminNewAuditLogs)}>Denetim kayıtları</Button>
        </Flex>
      </Kart>
    </Flex>
  );
}
