// Özellik bayrağı aç/kapat gerekçesi — eski ReasonDialog kuralı: zorunlu, trim 5-255 karakter.
// Pencere durumu ve mutasyon GenelAyarlar'da yaşar; gövde ve kapatma kuralları burada.
import { useEffect, useRef, useState } from "react";
import { Alert, App, Flex, Input, Typography } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import type { FeatureFlagOut } from "@/api/featureFlags";

export const GEREKCE_ENAZ = 5;
export const GEREKCE_ENUZUN = 255;

type Props = {
  acik?: boolean;
  bayrak?: FeatureFlagOut | null;
  kapat?: () => void;
  kaydediyor?: boolean;
  /** Sunucu 422 `note` alanı ya da genel hata (GenelAyarlar dağıtır). */
  alanHatasi?: string | null;
  hata?: string | null;
  /** Senkron gönderim kilidi: true ise kapatma da gönderim de yutulur. */
  kilitliMi?: () => boolean;
  onayla?: (gerekce: string) => void;
};

export function BayrakGerekcePenceresi({ acik, bayrak, kapat, kaydediyor, alanHatasi, hata, kilitliMi, onayla }: Props) {
  const { modal } = App.useApp();
  const [metin, setMetin] = useState("");
  const [yerelHata, setYerelHata] = useState<string | null>(null);
  const alanRef = useRef<HTMLTextAreaElement>(null);
  const acikMi = Boolean(acik && bayrak);
  useEffect(() => {
    if (!acikMi) {
      setMetin("");
      setYerelHata(null);
    }
  }, [acikMi]);
  const mesgul = () => Boolean(kaydediyor || kilitliMi?.());

  // Bütün kapatma yolları (X/Vazgeç/ESC/maske) buradan: pending'de kapanmaz, kirliyse onay ister.
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!metin.trim()) return kapat?.();
    modal.confirm({
      title: "Kaydedilmemiş değişiklikler var",
      content: "Pencereyi kapatırsanız yazdığınız gerekçe silinecek.",
      okText: "Değişiklikleri sil",
      okButtonProps: { danger: true },
      cancelText: "Düzenlemeye devam et",
      onOk: () => kapat?.(),
    });
  };

  const gonder = () => {
    if (mesgul()) return;
    const temiz = metin.trim();
    if (temiz.length < GEREKCE_ENAZ || temiz.length > GEREKCE_ENUZUN) {
      setYerelHata(temiz.length < GEREKCE_ENAZ ? `Gerekçe en az ${GEREKCE_ENAZ} karakter olmalı.` : `Gerekçe en fazla ${GEREKCE_ENUZUN} karakter olabilir.`);
      alanRef.current?.focus();
      return;
    }
    setYerelHata(null);
    // Gerekçe istek anında sabitlenir; sonradan yazılanlar bu gönderimi değiştirmez.
    onayla?.(temiz);
  };

  const kapatiyor = Boolean(bayrak?.enabled);
  const gosterilenHata = yerelHata ?? alanHatasi ?? null;
  return (
    <YanPencere
      acik={acikMi}
      baslik={kapatiyor ? "Bayrağı kapat" : "Bayrağı aç"}
      kapat={kapatIstegi}
      kaydet={gonder}
      kaydediyor={Boolean(kaydediyor)}
      kaydetMetni={kapatiyor ? "Kapat" : "Aç"}
    >
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {bayrak ? `“${bayrak.label}” bayrağı ${kapatiyor ? "kapatılacak" : "açılacak"}. Gerekçe denetim kaydına yazılır.` : ""}
        </Typography.Paragraph>
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
        <label htmlFor="bayrak-gerekcesi">
          <Typography.Text type="secondary">Gerekçe</Typography.Text>
          <Input.TextArea
            ref={alanRef}
            id="bayrak-gerekcesi"
            rows={4}
            value={metin}
            maxLength={GEREKCE_ENUZUN}
            onChange={(e) => {
              setMetin(e.target.value);
              setYerelHata(null);
            }}
            placeholder="Örn. iyzico Pazaryeri sandbox doğrulaması tamamlandı"
            status={gosterilenHata ? "error" : undefined}
            style={{ marginTop: 4 }}
          />
        </label>
        {gosterilenHata ? <Typography.Text type="danger" role="alert">{gosterilenHata}</Typography.Text> : null}
      </Flex>
    </YanPencere>
  );
}
