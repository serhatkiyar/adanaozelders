// Müşteri detayının pencereleri: hesabı anonimleştirip kapatma (gerekçe zorunlu).
import { useEffect, useState } from "react";
import { Alert, App, Flex, Input, Typography } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";

type HesapSilmePenceresiProps = {
  acik: boolean;
  kapat: () => void;
  fullName: string;
  kaydediyor: boolean;
  hata: string | null;
  onayla: (gerekce: string) => void;
};

// Eski ekranın kuralı: gerekçe en az 3 karakter; düğme kilitlenmez, hata alanda gösterilir.
export function HesapSilmePenceresi({ acik, kapat, fullName, kaydediyor, hata, onayla }: HesapSilmePenceresiProps) {
  const { modal } = App.useApp();
  const [gerekce, setGerekce] = useState("");
  const [alanHatasi, setAlanHatasi] = useState<string | null>(null);

  useEffect(() => {
    if (!acik) {
      setGerekce("");
      setAlanHatasi(null);
    }
  }, [acik]);

  // Kirli koruma tek yoldan: X/Vazgeç/ESC/maske hepsi buraya gelir; sürerken kapanmaz.
  const kapatIstegi = () => {
    if (kaydediyor) return;
    if (!gerekce.trim()) return kapat();
    modal.confirm({
      title: "Yazdıklarınız kaybolacak",
      content: "Pencereyi kapatırsanız girdiğiniz gerekçe silinecek.",
      okText: "Değişiklikleri sil",
      okButtonProps: { danger: true },
      cancelText: "Düzenlemeye devam et",
      onOk: kapat,
    });
  };

  const gonder = () => {
    if (kaydediyor) return;
    if (gerekce.trim().length < 3) {
      setAlanHatasi("Gerekçe en az 3 karakter olmalı (denetim kaydına yazılır).");
      return;
    }
    setAlanHatasi(null);
    onayla(gerekce.trim());
  };

  return (
    <YanPencere acik={acik} baslik="Hesabı sil" kapat={kapatIstegi} kaydet={gonder} kaydediyor={kaydediyor} kaydetMetni="Kalıcı olarak sil">
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          <strong>{fullName}</strong> hesabının kimlik ve iletişim verisi geri döndürülemez biçimde anonimleştirilir, hesap kapatılır.
          Mali kayıtlar mevzuat gereği durur; açık siparişi, dersi veya bekleyen ödemesi olan hesap silinemez.
        </Typography.Paragraph>
        <label htmlFor="hesap-silme-gerekce">
          <Typography.Text type="secondary">Gerekçe (denetim kaydına yazılır)</Typography.Text>
          <Input.TextArea
            id="hesap-silme-gerekce"
            rows={3}
            value={gerekce}
            onChange={(e) => setGerekce(e.target.value)}
            placeholder="Örn. kullanıcının KVKK silme talebi (destek kaydı #123)"
            style={{ marginTop: 4 }}
          />
        </label>
        {alanHatasi ? <Typography.Text type="danger" role="alert">{alanHatasi}</Typography.Text> : null}
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}
