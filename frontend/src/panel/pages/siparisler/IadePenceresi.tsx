// İade ekranının pencereleri: ayrıntı çekmecesi ve red gerekçesi.
// Açık/kapalı durumu listede yaşar, gövde burada (bkz. StokSayimiPencereleri).
import { useEffect, useState } from "react";
import { App, Button, Descriptions, Drawer, Flex, Input, Tag, Typography } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { formatDateTime } from "@/lib/datetime";
import { formatTL } from "@/lib/money";
import type { OrderReturn, ReturnStatus, ReturnType } from "@/types";

export const IADE_DURUMLARI: Record<ReturnStatus, { label: string; renk: string }> = {
  PENDING: { label: "Bekliyor", renk: "warning" },
  APPROVED: { label: "Onaylandı", renk: "success" },
  REJECTED: { label: "Reddedildi", renk: "error" },
};

export const IADE_TURLERI: Record<ReturnType, string> = {
  CAYMA: "Cayma hakkı",
  AYIPLI: "Ayıplı ürün",
  DIGER: "Diğer",
};

export function IadeDurumEtiketi({ durum }: { durum: string }) {
  const d = IADE_DURUMLARI[durum as ReturnStatus];
  return <Tag color={d?.renk ?? "default"}>{d?.label ?? durum}</Tag>;
}

type DetayProps = {
  acik: boolean;
  kapat: () => void;
  iade: OrderReturn | null;
  yonetebilir: boolean;
  kaydediyor: boolean;
  onayla: (iade: OrderReturn) => void;
  reddet: (iade: OrderReturn) => void;
};

export function IadeDetayPenceresi({ acik, kapat, iade, yonetebilir, kaydediyor, onayla, reddet }: DetayProps) {
  const mobil = useMobil();
  const kararVerilebilir = Boolean(iade && yonetebilir && iade.status === "PENDING");
  return (
    <Drawer
      open={acik}
      onClose={kapat}
      placement="right"
      width={mobil ? "100%" : 480}
      title={iade ? `İade talebi · Sipariş #${iade.order_id}` : "İade talebi"}
      footer={
        <Flex justify="flex-end" gap={8}>
          <Button onClick={kapat}>Kapat</Button>
          {kararVerilebilir && iade ? (
            <>
              <Button danger loading={kaydediyor} onClick={() => reddet(iade)}>
                Reddet
              </Button>
              <Button type="primary" loading={kaydediyor} onClick={() => onayla(iade)}>
                Onayla & iade et
              </Button>
            </>
          ) : null}
        </Flex>
      }
    >
      {iade ? (
        <Flex vertical gap={16}>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Durum">
              <IadeDurumEtiketi durum={iade.status} />
            </Descriptions.Item>
            <Descriptions.Item label="Sipariş">
              #{iade.order_id}
              {iade.order ? ` · ${formatTL(iade.order.total)}` : ""}
            </Descriptions.Item>
            <Descriptions.Item label="Tür">{IADE_TURLERI[iade.type] ?? iade.type}</Descriptions.Item>
            <Descriptions.Item label="Talep tarihi">{formatDateTime(iade.created_at)}</Descriptions.Item>
            {iade.resolved_at ? (
              <Descriptions.Item label="Karar tarihi">{formatDateTime(iade.resolved_at)}</Descriptions.Item>
            ) : null}
            {iade.order?.ship_recipient ? (
              <Descriptions.Item label="Alıcı">
                {iade.order.ship_recipient}
                {iade.order.ship_address ? `: ${iade.order.ship_address}` : ""}
              </Descriptions.Item>
            ) : null}
          </Descriptions>
          <div>
            <Typography.Text type="secondary">Müşteri gerekçesi</Typography.Text>
            <Typography.Paragraph style={{ whiteSpace: "pre-line", marginBottom: 0 }}>{iade.reason}</Typography.Paragraph>
          </div>
          {iade.admin_note ? (
            <div>
              <Typography.Text type="secondary">Yönetici notu</Typography.Text>
              <Typography.Paragraph style={{ whiteSpace: "pre-line", marginBottom: 0 }}>{iade.admin_note}</Typography.Paragraph>
            </div>
          ) : null}
        </Flex>
      ) : null}
    </Drawer>
  );
}

const NOT_UST_SINIR = 2000;

type RedProps = {
  acik: boolean;
  kapat: () => void;
  kaydediyor: boolean;
  onayla: (not: string | null) => void;
};

// Red notu isteğe bağlıdır (eski ReasonDialog kullanımı); üst sınır aşılırsa hata alanda çıkar.
export function RedGerekcesiPenceresi({ acik, kapat, kaydediyor, onayla }: RedProps) {
  const { modal } = App.useApp();
  const [metin, setMetin] = useState("");
  const [hata, setHata] = useState<string | null>(null);
  useEffect(() => {
    if (!acik) {
      setMetin("");
      setHata(null);
    }
  }, [acik]);
  const kapatIstegi = () => {
    if (kaydediyor) return;
    if (!metin.trim()) return kapat();
    modal.confirm({
      title: "Yazdıklarınız kaybolacak",
      content: "Pencereyi kapatırsanız girdiğiniz metin silinecek.",
      okText: "Değişiklikleri sil",
      okButtonProps: { danger: true },
      cancelText: "Düzenlemeye devam et",
      onOk: kapat,
    });
  };
  const gonder = () => {
    if (kaydediyor) return;
    const temiz = metin.trim();
    if (temiz.length > NOT_UST_SINIR) {
      setHata(`En fazla ${NOT_UST_SINIR} karakter yazın.`);
      return;
    }
    setHata(null);
    onayla(temiz || null);
  };
  return (
    <YanPencere acik={acik} baslik="İade talebini reddet" kapat={kapatIstegi} kaydet={gonder} kaydediyor={kaydediyor} kaydetMetni="Talebi reddet">
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Moderasyon notu müşteriye iletilecek.
        </Typography.Paragraph>
        <label htmlFor="iade-red-gerekcesi">
          <Typography.Text type="secondary">Red gerekçesi</Typography.Text>
          <Input.TextArea id="iade-red-gerekcesi" rows={4} value={metin} onChange={(e) => setMetin(e.target.value)} style={{ marginTop: 4 }} />
        </label>
        {hata ? (
          <Typography.Text type="danger" role="alert">
            {hata}
          </Typography.Text>
        ) : null}
      </Flex>
    </YanPencere>
  );
}
