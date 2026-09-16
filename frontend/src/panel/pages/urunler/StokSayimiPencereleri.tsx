// Stok sayımı detayının pencereleri: iptal gerekçesi, belirsizlik açıklaması, farkları uygula.
// Ayrı dosya: pencere durumu detay sayfasında yaşar, gövde burada (uiBaseline::modalDurumu).
import { useEffect, useState } from "react";
import { Alert, App, Flex, Input, List, Typography } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { bucketLabel, expectedPhysical, formatDifference, lineDifference, productDisplayName } from "@/lib/inventory";
import type { CountLineOut } from "@/api/inventory";

type GerekcePenceresiProps = {
  acik: boolean;
  kapat: () => void;
  baslik: string;
  aciklama: string;
  etiket: string;
  onayMetni: string;
  kaydediyor?: boolean;
  onayla: (metin: string) => void;
};

// Zorunlu, en az 3 karakterlik serbest metin ister (eski ReasonDialog kuralı).
export function GerekcePenceresi({ acik, kapat, baslik, aciklama, etiket, onayMetni, kaydediyor, onayla }: GerekcePenceresiProps) {
  const { modal } = App.useApp();
  const [metin, setMetin] = useState("");
  const [hata, setHata] = useState<string | null>(null);
  // Kirli koruma (eski ReasonDialog): yazı varken Vazgeç/X/ESC/maske kapatması önce sorar.
  const kapatIstegi = () => {
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
  useEffect(() => {
    if (!acik) {
      setMetin("");
      setHata(null);
    }
  }, [acik]);
  const gonder = () => {
    if (metin.trim().length < 3) {
      setHata("En az 3 karakter yazın.");
      return;
    }
    setHata(null);
    onayla(metin.trim());
  };
  return (
    <YanPencere acik={acik} baslik={baslik} kapat={kapatIstegi} kaydet={gonder} kaydediyor={kaydediyor} kaydetMetni={onayMetni}>
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{aciklama}</Typography.Paragraph>
        <label htmlFor="gerekce-metni">
          <Typography.Text type="secondary">{etiket}</Typography.Text>
          <Input.TextArea id="gerekce-metni" rows={4} value={metin} onChange={(e) => setMetin(e.target.value)} style={{ marginTop: 4 }} />
        </label>
        {hata ? <Typography.Text type="danger" role="alert">{hata}</Typography.Text> : null}
      </Flex>
    </YanPencere>
  );
}

export function UygulaPenceresi({
  acik,
  kapat,
  satirlar,
  kaydediyor,
  hata,
  onayla,
}: {
  acik: boolean;
  kapat: () => void;
  satirlar: CountLineOut[];
  kaydediyor: boolean;
  hata: string | null;
  onayla: () => void;
}) {
  const etkiler = satirlar.map((s) => ({ satir: s, fark: lineDifference(s) })).filter((e) => e.fark !== null && e.fark !== 0);
  return (
    <YanPencere acik={acik} baslik="Farkları uygula" kapat={kapat} kaydet={onayla} kaydediyor={kaydediyor} kaydetMetni="Farkları uygula">
      <Flex vertical gap={16}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Aşağıdaki düzeltmeler stok defterine yazılacak. İşlem geri alınamaz; yanlışsa yeni bir sayım açmak gerekir.
        </Typography.Paragraph>
        {etkiler.length === 0 ? (
          <Typography.Text>Fark yok: hiçbir stok hareketi yazılmayacak, oturum yalnız kapanacak.</Typography.Text>
        ) : (
          <List
            size="small"
            bordered
            dataSource={etkiler}
            rowKey={(e) => e.satir.id}
            renderItem={({ satir }) => (
              <List.Item>
                <Typography.Text>
                  {productDisplayName(satir)} · {bucketLabel(satir.bucket)}{" "}
                  <strong>{formatDifference(satir)}</strong>{" "}
                  <Typography.Text type="secondary">({expectedPhysical(satir)} → {satir.counted_qty})</Typography.Text>
                </Typography.Text>
              </List.Item>
            )}
          />
        )}
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}
