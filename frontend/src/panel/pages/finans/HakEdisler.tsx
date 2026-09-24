import { useState } from "react";
import { Button, Flex, Segmented, Table, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { usePayoutHistory, usePendingPayouts } from "@/hooks/usePayouts";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { getErrorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/datetime";
import { formatTL, parseMoney } from "@/lib/money";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { OdemePenceresi } from "@/panel/pages/finans/OdemePenceresi";
import { odemeYapilabilir, type PayeeBalance } from "@/api/payouts";

/** Elle yapılan havalelerin hak ediş defterini yeni panel kabuğunda yönetir. */
export function HakEdisler() {
  const { token } = theme.useToken();
  const { canView, canManage } = useAdminAreaAccess("payments");
  const url = useUrlDurumu({ sekme: "odenecekler" });
  const sekme = url.degerler.sekme === "gecmis" ? "gecmis" : "odenecekler";
  const bekleyenler = usePendingPayouts(true, canView && sekme === "odenecekler");
  const gecmis = usePayoutHistory(100, canView && sekme === "gecmis");
  const [hedef, setHedef] = useState<PayeeBalance | null>(null);
  const ayrac = token.colorBorderSecondary;

  if (!canView) return <AccessDenied area="Hak edişler" />;

  return (
    <Flex vertical gap={24}>
      <div>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>
          Hak Edişler
        </Typography.Title>
        <Typography.Text type="secondary">
          {canManage
            ? "Öğretmen ve kütüphanelere bankadan yapılan ödemeleri hak ediş defterine kaydedin."
            : "Salt okunur görünüm: ödeme kaydetmek için payments.manage izni gerekir."}
        </Typography.Text>
      </div>

      <Segmented
        aria-label="Hak ediş görünümü"
        block
        value={sekme}
        options={[
          { value: "odenecekler", label: "Ödenecekler" },
          { value: "gecmis", label: "Ödeme geçmişi" },
        ]}
        onChange={(value) => url.ayarla({ sekme: String(value) })}
      />

      <section style={{ background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 }}>
        <div style={{ padding: 24 }}>
          {sekme === "odenecekler" ? (
            <Bekleyenler sorgu={bekleyenler} canManage={canManage} onPay={setHedef} />
          ) : (
            <Gecmis sorgu={gecmis} />
          )}
        </div>
      </section>

      <OdemePenceresi hedef={hedef} kapat={() => setHedef(null)} />
    </Flex>
  );
}

function Bekleyenler({ sorgu, canManage, onPay }: {
  sorgu: ReturnType<typeof usePendingPayouts>;
  canManage: boolean;
  onPay: (kayit: PayeeBalance) => void;
}) {
  if (sorgu.isPending) return <YukleniyorDurumu etiket="Ödenecek hak edişler yükleniyor" />;
  if (sorgu.isError) {
    return <HataDurumu hata="Ödenecekler listesi alınamadı. Listenin boş olduğu anlamına gelmez." hataAksiyon={<Button onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />;
  }
  const liste = Array.isArray(sorgu.data) ? sorgu.data : [];
  if (liste.length === 0) return <BosDurumu baslik="Ödenmemiş hak ediş yok" aciklama="Yeni bir hak ediş oluştuğunda burada görünecek." />;
  const toplam = liste.reduce((sum, kayit) => sum + (parseMoney(kayit.balance) ?? 0), 0);

  return (
    <Flex vertical gap={12}>
      <Typography.Text type="secondary">
        Toplam ödenecek: <Typography.Text strong>{formatTL(toplam)}</Typography.Text> · {liste.length} alıcı
      </Typography.Text>
      <Table
        rowKey={(kayit) => `${kayit.payee_type}-${kayit.payee_id}`}
        dataSource={liste}
        pagination={false}
        scroll={{ x: 760 }}
        columns={[
          { title: "Alıcı", render: (_, kayit) => <Flex gap={8} align="center" wrap><Typography.Text strong>{kayit.name}</Typography.Text><Tag>{kayit.payee_type === "TUTOR" ? "Öğretmen" : "Kütüphane"}</Tag>{kayit.requested_amount != null && <Tag color="orange">Çekim talebi {formatTL(kayit.requested_amount)}</Tag>}</Flex> },
          { title: "IBAN", render: (_, kayit) => kayit.iban ? <Typography.Text style={{ fontFamily: "monospace" }}>{kayit.iban}</Typography.Text> : <Typography.Text type="warning">IBAN yok</Typography.Text> },
          { title: "Hak edilen", align: "right", render: (_, kayit) => formatTL(kayit.earned) },
          { title: "Ödenen", align: "right", render: (_, kayit) => formatTL(kayit.paid) },
          { title: "Bakiye", align: "right", render: (_, kayit) => <Typography.Text strong>{formatTL(kayit.balance)}</Typography.Text> },
          { title: "Emanette", align: "right", render: (_, kayit) => formatTL(kayit.pending) },
          ...(canManage ? [{ title: "", align: "right" as const, render: (_: unknown, kayit: PayeeBalance) => <Button onClick={() => onPay(kayit)} disabled={!odemeYapilabilir(kayit)} title={odemeYapilabilir(kayit) ? undefined : "Öğretmen henüz para çekme talebi açmadı"}>Ödedim</Button> }] : []),
        ]}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        “Emanette” henüz hak edilmemiş tutardır; borç değildir ve iade edilebilir.
      </Typography.Text>
    </Flex>
  );
}

function Gecmis({ sorgu }: { sorgu: ReturnType<typeof usePayoutHistory> }) {
  if (sorgu.isPending) return <YukleniyorDurumu etiket="Ödeme geçmişi yükleniyor" />;
  if (sorgu.isError) return <HataDurumu hata={getErrorMessage(sorgu.error, "Ödeme geçmişi yüklenemedi.")} hataAksiyon={<Button onClick={() => void sorgu.refetch()}>Tekrar dene</Button>} />;
  const liste = Array.isArray(sorgu.data) ? sorgu.data : [];
  if (liste.length === 0) return <BosDurumu baslik="Henüz ödeme kaydı yok" aciklama="Kaydedilen banka ödemeleri burada listelenecek." />;
  return (
    <Table
      rowKey="id"
      dataSource={liste}
      pagination={false}
      scroll={{ x: 680 }}
      columns={[
        { title: "Tarih", dataIndex: "paid_at", render: (deger: string) => formatDate(deger) },
        { title: "Alıcı", render: (_, kayit) => `${kayit.payee_type === "TUTOR" ? "Öğretmen" : "Kütüphane"} #${kayit.payee_id}` },
        { title: "Tutar", align: "right", render: (_, kayit) => <Typography.Text strong>{formatTL(kayit.amount)}</Typography.Text> },
        { title: "Referans", dataIndex: "reference", render: (deger?: string | null) => deger || "-" },
        { title: "IBAN (o anki)", dataIndex: "iban_snapshot", render: (deger?: string | null) => <Typography.Text style={{ fontFamily: "monospace" }}>{deger || "-"}</Typography.Text> },
      ]}
    />
  );
}
