// Eğitmen İlanları ekranının pencereleri: başvuru reddi (gerekçe zorunlu). Pencere açık/kapalı durumu, hedef
// kimlik ve mutasyon ekranda; gövde, doğrulama ve kirli/pending kapatma kuralları burada.
// Gerekçe sözleşmesi eski `ReasonDialog` çağrısıyla birebir: trim ≥ 3, ham uzunluk ≤ 500; payload `{ id, reason }`.
import { useEffect, useRef, useState } from "react";
import { Alert, App, Flex, Input, Typography } from "antd";
import type { InputRef } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { kirliOnayi, useAlanHatalari, type Hatalar } from "@/panel/components/pencereAlanlari";

export const GEREKCE_MIN = 3;
export const GEREKCE_MAX = 500;
const RED_SIRA = ["reason"] as const;

/** Eski `gerekceSemasi` ile aynı kurallar ve aynı metinler. */
export function gerekceHatasi(ham: string): string | undefined {
  if (ham.trim().length < GEREKCE_MIN) return `Gerekçe en az ${GEREKCE_MIN} karakter olmalı.`;
  if (ham.length > GEREKCE_MAX) return `En fazla ${GEREKCE_MAX} karakter yazılabilir.`;
  return undefined;
}

export type RedPenceresiProps = {
  acik?: boolean;
  /** Hedef eğitmenin görünen adı — pencere açıldığı anda sabitlenir (ekran tarafından). */
  adSoyad?: string;
  kapat?: () => void;
  kaydediyor?: boolean;
  /** Sunucu 422 alan hataları (ekran dağıtır) ve kalan genel hata. */
  alanHatalari?: Hatalar;
  hata?: string | null;
  /** Ekrandaki senkron kilit: true ise kapatma da gönderim de yutulur. */
  kilitliMi?: () => boolean;
  onayla?: (gerekce: string) => void;
};

export function RedPenceresi({ acik, adSoyad = "", kapat, kaydediyor, alanHatalari, hata, kilitliMi, onayla }: RedPenceresiProps) {
  const { modal } = App.useApp();
  const [gerekce, setGerekce] = useState("");
  const refler = useRef<Record<string, InputRef | null>>({});
  const { gosterilen, temizle, yerelHatalariUygula } = useAlanHatalari(acik, alanHatalari, RED_SIRA, refler);
  useEffect(() => {
    // Yalnız açılışta sıfırlanır: hata sonrası pencere açık kalır ve yazılan gerekçe korunur.
    if (acik) setGerekce("");
  }, [acik]);
  const mesgul = () => Boolean(kaydediyor || kilitliMi?.());
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!gerekce) return kapat?.();
    kirliOnayi(modal, () => kapat?.());
  };
  const gonder = () => {
    if (mesgul()) return;
    const sorun = gerekceHatasi(gerekce);
    // Gönder düğmesi geçerlilikle KAPANMAZ: basınca hata alanda çıkar ve odak oraya gider.
    if (yerelHatalariUygula({ reason: sorun })) return;
    onayla?.(gerekce.trim());
  };
  return (
    <YanPencere acik={Boolean(acik)} baslik="Başvuruyu reddet" kapat={kapatIstegi} kaydet={gonder} kaydediyor={Boolean(kaydediyor)} kaydetMetni="Başvuruyu reddet">
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {adSoyad} başvurusu reddedilecek. Gerekçe denetim izine yazılır.
        </Typography.Paragraph>
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
        <label htmlFor="red-gerekce">
          <Typography.Text type="secondary">Red gerekçesi</Typography.Text>
          <Input.TextArea
            ref={(r) => { refler.current.reason = r as unknown as InputRef | null; }}
            id="red-gerekce"
            value={gerekce}
            onChange={(e) => { setGerekce(e.target.value); temizle("reason"); }}
            rows={4}
            // Üst sınır girişte de uygulanır; alt sınır gönderimde alanda bildirilir (gönder düğmesi kapanmaz).
            maxLength={GEREKCE_MAX}
            placeholder="Örn. Diploma barkodu e-Devlet'te doğrulanamadı."
            status={gosterilen("reason") ? "error" : undefined}
            aria-describedby={gosterilen("reason") ? "red-gerekce-hata" : "red-gerekce-yardim"}
            style={{ marginTop: 4 }}
          />
        </label>
        <Typography.Text id="red-gerekce-yardim" type="secondary" style={{ fontSize: 12 }}>{`En az ${GEREKCE_MIN}, en fazla ${GEREKCE_MAX} karakter (${gerekce.length}/${GEREKCE_MAX}).`}</Typography.Text>
        {gosterilen("reason") ? <Typography.Text id="red-gerekce-hata" type="danger" role="alert">{gosterilen("reason")}</Typography.Text> : null}
      </Flex>
    </YanPencere>
  );
}
