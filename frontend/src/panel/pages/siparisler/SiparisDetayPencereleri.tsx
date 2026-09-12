// Sipariş detayının pencereleri: kargoya verme (takip no) ve iade gerekçesi.
// Pencere açık/kapalı durumu ve mutasyonlar detay sayfasında yaşar; gövde ve kapatma kuralları burada.
import { useEffect, useRef, useState } from "react";
import { Alert, App, Flex, Input, Typography } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";

type OrtakProps = {
  acik?: boolean;
  kapat?: () => void;
  kaydediyor?: boolean;
  hata?: string | null;
  /** Detay sayfasındaki senkron gönderim kilidi: true ise kapatma da gönderim de yutulur. */
  kilitliMi?: () => boolean;
};

const kirliOnayi = (modal: ReturnType<typeof App.useApp>["modal"], onOk: () => void) =>
  modal.confirm({
    title: "Kaydedilmemiş değişiklikler var",
    content: "Pencereyi kapatırsanız yazdıklarınız silinecek.",
    okText: "Değişiklikleri sil",
    okButtonProps: { danger: true },
    cancelText: "Düzenlemeye devam et",
    onOk,
  });

// Takip no eski ekranda olduğu gibi isteğe bağlı; boşsa null gönderilir.
export function KargoPenceresi({ acik, kapat, kaydediyor, hata, kilitliMi, onayla }: OrtakProps & { onayla?: (takipNo: string | null) => void }) {
  const { modal } = App.useApp();
  const [takipNo, setTakipNo] = useState("");
  useEffect(() => {
    if (!acik) setTakipNo("");
  }, [acik]);
  const mesgul = () => Boolean(kaydediyor || kilitliMi?.());
  // Bütün kapatma yolları (X/Vazgeç/ESC/maske) buradan geçer.
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!takipNo.trim()) return kapat?.();
    kirliOnayi(modal, () => kapat?.());
  };
  const gonder = () => {
    if (mesgul()) return;
    const temiz = takipNo.trim();
    onayla?.(temiz || null);
  };
  return (
    <YanPencere acik={Boolean(acik)} baslik="Kargoya ver" kapat={kapatIstegi} kaydet={gonder} kaydediyor={Boolean(kaydediyor)} kaydetMetni="Kargola">
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Sipariş "Kargoda" durumuna geçer. Takip numarası varsa yazın; müşteri takip sayfasında görür.
        </Typography.Paragraph>
        <label htmlFor="kargo-takip-no">
          <Typography.Text type="secondary">Takip no (isteğe bağlı)</Typography.Text>
          <Input id="kargo-takip-no" value={takipNo} onChange={(e) => setTakipNo(e.target.value)} maxLength={100} style={{ marginTop: 4 }} />
        </label>
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}

// Gerekçe zorunlu, trim edilmiş 3-500 karakter (eski ReasonDialog kuralı).
export function IadePenceresi({ acik, kapat, kaydediyor, hata, kilitliMi, onayla }: OrtakProps & { onayla?: (gerekce: string) => void }) {
  const { modal } = App.useApp();
  const [metin, setMetin] = useState("");
  const [alanHatasi, setAlanHatasi] = useState<string | null>(null);
  const alanRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!acik) {
      setMetin("");
      setAlanHatasi(null);
    }
  }, [acik]);
  const mesgul = () => Boolean(kaydediyor || kilitliMi?.());
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!metin.trim()) return kapat?.();
    kirliOnayi(modal, () => kapat?.());
  };
  const gonder = () => {
    if (mesgul()) return;
    const temiz = metin.trim();
    if (temiz.length < 3 || temiz.length > 500) {
      setAlanHatasi(temiz.length < 3 ? "En az 3 karakter yazın." : "En fazla 500 karakter yazılabilir.");
      alanRef.current?.focus();
      return;
    }
    setAlanHatasi(null);
    // Gerekçe istek anında sabitlenir: sonradan yazılanlar bu gönderimi değiştirmez.
    onayla?.(temiz);
  };
  return (
    <YanPencere acik={Boolean(acik)} baslik="Siparişi iade et" kapat={kapatIstegi} kaydet={gonder} kaydediyor={Boolean(kaydediyor)} kaydetMetni="İade et">
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Tam iade başlatılır; gerekçe sipariş geçmişine ve denetim izine yazılır. İşlem geri alınamaz.
        </Typography.Paragraph>
        <label htmlFor="iade-gerekcesi">
          <Typography.Text type="secondary">İade gerekçesi</Typography.Text>
          <Input.TextArea ref={alanRef} id="iade-gerekcesi" rows={4} value={metin} onChange={(e) => setMetin(e.target.value)} maxLength={500} style={{ marginTop: 4 }} />
        </label>
        {alanHatasi ? <Typography.Text type="danger" role="alert">{alanHatasi}</Typography.Text> : null}
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}
