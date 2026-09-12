// Geri dönüş kuyruğunun "Depoya al" penceresi: kuryeden dönen kutunun fiziksel kabulü.
// Not isteğe bağlı (trim, en fazla 500 = `schemas.packing.NOTE_MAX`); boş not payload'a girmez.
// Hedef paket ve kilit kuyruk ekranında yaşar; gövde, doğrulama ve kapatma kuralları burada.
import { useEffect, useRef, useState } from "react";
import { Alert, App, Flex, Input, Typography } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import type { PackageReturnInPayload } from "@/types/packing";

/** `schemas.packing.NOTE_MAX` — depoya kabul notunun gerçek tavanı. */
export const NOT_MAX = 500;

export type DepoyaAlPenceresiProps = {
  acik?: boolean;
  /** Pencere açılırken sabitlenen hedefin kodu; yalnız gösterim. */
  paketKodu?: string;
  kapat?: () => void;
  kaydediyor?: boolean;
  /** Sunucu 422 `note` alan hatası; alanda gösterilir, not korunur. */
  alanHatasi?: string | null;
  /** 403/409/500/ağ: pencere içinde görünür, not korunur. */
  hata?: string | null;
  /** Kuyruk ekranındaki senkron gönderim kilidi: true ise kapatma da gönderim de yutulur. */
  kilitliMi?: () => boolean;
  onayla?: (payload: PackageReturnInPayload) => void;
};

export function DepoyaAlPenceresi({ acik, paketKodu, kapat, kaydediyor, alanHatasi, hata, kilitliMi, onayla }: DepoyaAlPenceresiProps) {
  const { modal } = App.useApp();
  const [not, setNot] = useState("");
  const [yerelHata, setYerelHata] = useState<string | null>(null);
  // Sunucu alan hatası not düzenlenince gizlenir; bir sonraki gönderimde yeniden değerlendirilir.
  const [alanHatasiGizli, setAlanHatasiGizli] = useState(false);
  const alanRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!acik) {
      setNot("");
      setYerelHata(null);
      setAlanHatasiGizli(false);
    }
  }, [acik]);
  const mesgul = () => Boolean(kaydediyor || kilitliMi?.());
  // Bütün kapatma yolları (X/Vazgeç/ESC/maske) buradan geçer; pending'de kapanmaz.
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!not.trim()) return kapat?.();
    modal.confirm({
      title: "Kaydedilmemiş değişiklikler var",
      content: "Pencereyi kapatırsanız yazdıklarınız silinecek.",
      okText: "Değişiklikleri sil",
      okButtonProps: { danger: true },
      cancelText: "Düzenlemeye devam et",
      onOk: () => {
        if (!mesgul()) kapat?.();
      },
    });
  };
  const gonder = () => {
    if (mesgul()) return;
    const temiz = not.trim();
    if (temiz.length > NOT_MAX) {
      setYerelHata(`En fazla ${NOT_MAX} karakter yazılabilir.`);
      alanRef.current?.focus();
      return;
    }
    setYerelHata(null);
    setAlanHatasiGizli(false);
    // Boş not GÖNDERİLMEZ ({}); dolu not yalnız { note } — mevcut sözleşme.
    onayla?.(temiz ? { note: temiz } : {});
  };
  const gosterilenAlanHatasi = yerelHata ?? (alanHatasiGizli ? null : alanHatasi) ?? null;
  return (
    <YanPencere acik={Boolean(acik)} baslik="Kutuyu depoya al" kapat={kapatIstegi} kaydet={gonder} kaydediyor={Boolean(kaydediyor)} kaydetMetni="Depoya alındı">
      <Flex vertical gap={12}>
        <Typography.Paragraph style={{ margin: 0 }}>
          {paketKodu ?? "Bu"} kutusunun depoya döndüğünü onaylıyorsunuz. Kutuyu fiziksel olarak görmeden onaylamayın.
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Kabul, paketi "Depoya döndü" yapar; yeniden dağıtıma verme ayrı bir karardır ve otomatik yapılmaz.
        </Typography.Paragraph>
        <label htmlFor="depoya-al-not">
          <Typography.Text type="secondary">Not (isteğe bağlı)</Typography.Text>
          <Input.TextArea
            ref={alanRef}
            id="depoya-al-not"
            rows={4}
            value={not}
            onChange={(e) => {
              setNot(e.target.value);
              setYerelHata(null);
              setAlanHatasiGizli(true);
            }}
            placeholder="Örn. kutu ıslanmış, içerik kontrol edildi"
            maxLength={NOT_MAX}
            status={gosterilenAlanHatasi ? "error" : undefined}
            style={{ marginTop: 4 }}
          />
        </label>
        {gosterilenAlanHatasi ? <Typography.Text type="danger" role="alert">{gosterilenAlanHatasi}</Typography.Text> : null}
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}
