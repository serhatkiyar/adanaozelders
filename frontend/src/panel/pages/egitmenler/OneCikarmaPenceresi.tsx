// Öne Çıkarmalar ekranının pencereleri: işlem AYRINTISI (salt okunur) ve İPTAL/İADE kararı.
//
// Neden ayrı pencere: `provider`, `provider_ref`, `paid_at`, `refunded_amount`, `cancelled_at` gibi işlem
// alanları satıra sıkıştırılırsa tablo okunmaz olur ve sağlayıcı referansı listede sürekli açıkta kalır.
// Sağlayıcı referansı yalnız açık ayrıntı penceresinde GÖRÜNÜR METİN olarak durur: `aria-label`, `title`,
// `data-testid`, URL, toast ve log'a kopyalanmaz. Pencere kapanınca gövde unmount edilir.
import { useEffect, useRef, useState } from "react";
import { Alert, App, Descriptions, Drawer, Flex, Input, Typography } from "antd";
import type { InputRef } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { kirliOnayi, useAlanHatalari, type Hatalar } from "@/panel/components/pencereAlanlari";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import type { AdminPromotion } from "@/api/admin";

/** Backend `PromotionCancelIn`: gerekçe zorunlu, trimlenmiş uzunluk 3–500. */
export const GEREKCE_MIN = 3;
export const GEREKCE_MAX = 500;
const IPTAL_SIRA = ["reason"] as const;
const SAR: React.CSSProperties = { overflowWrap: "anywhere" };

export function gerekceHatasi(ham: string): string | undefined {
  if (ham.trim().length < GEREKCE_MIN) return `Gerekçe en az ${GEREKCE_MIN} karakter olmalı.`;
  if (ham.trim().length > GEREKCE_MAX) return `En fazla ${GEREKCE_MAX} karakter yazılabilir.`;
  return undefined;
}

/**
 * İptalin PARA sonucu kaydın para durumuna bağlıdır: yalnız PAID kayıtta tahsil edilmiş tutar vardır ve
 * iade süreci başlar (`cancel_by_admin` → `refund_escrow`). PENDING/FAILED kayıtta tahsilat olmadığı için
 * "iade başlatılıyor" demek yanlış olurdu; kayıt yalnız iptal edilir.
 */
export function iptalAciklamasi(paymentStatus: string): string {
  return paymentStatus === "PAID"
    ? "Kayıt anında yayından düşer ve ödenmiş tutar iade sürecine girer."
    : "Kayıt iptal edilir. Tahsil edilmiş ödeme olmadığı için para iadesi başlatılmaz.";
}
/** Onay düğmesinin metni de para sonucunu söyler. */
export function iptalDugmeMetni(paymentStatus: string): string {
  return paymentStatus === "PAID" ? "İptal et ve iade başlat" : "Kaydı iptal et";
}

export type AyrintiPenceresiProps = {
  acik?: boolean;
  kayit?: AdminPromotion;
  kapat?: () => void;
  /** Ayrıntı satırlarını üreten biçimleyiciler ekrandan gelir (tek kaynak). */
  tarih?: (iso: string | null) => string;
  tutar?: (deger: string | null, currency: string | null) => string;
  paraDurumu?: (durum: string) => string;
  /** Görünürlük ekseni — listedeki ikinci eksen ayrıntıda da bulunsun. */
  gorunurluk?: (kayit: AdminPromotion) => string;
};

/** Tek boş-değer dili: dolu değerle boş değer aynı ağırlıkta görünmesin. */
function bosDeger() {
  return <Typography.Text type="secondary">Belirtilmemiş</Typography.Text>;
}

export function AyrintiPenceresi({ acik, kayit, kapat, tarih, tutar, paraDurumu, gorunurluk }: AyrintiPenceresiProps) {
  const mobil = useMobil();
  const bicimTarih = (iso: string | null) => {
    if (!iso) return bosDeger();
    const metin = tarih ? tarih(iso) : iso;
    return metin === "-" ? bosDeger() : metin;
  };
  return (
    <Drawer open={Boolean(acik)} title="Satış ayrıntısı" onClose={() => kapat?.()} placement="right" width={mobil ? "100%" : 480}>
      {/* Gövde YALNIZ açıkken mount edilir: sağlayıcı referansı kapanınca DOM'da kalmaz. */}
      {acik && kayit ? (
        <Descriptions column={1} size="small" bordered items={[
          { key: "egitmen", label: "Eğitmen", children: kayit.tutor_name ?? `Eğitmen #${kayit.tutor_id}` },
          { key: "paket", label: "Paket", children: `${kayit.package_days} gün` },
          { key: "tutar", label: "Tutar", children: tutar ? tutar(kayit.price, kayit.currency) : kayit.price },
          { key: "para", label: "Para durumu", children: paraDurumu ? paraDurumu(kayit.payment_status) : kayit.payment_status },
          { key: "gorunurluk", label: "Görünürlük", children: gorunurluk ? gorunurluk(kayit) : bosDeger() },
          { key: "saglayici", label: "Sağlayıcı", children: kayit.provider ?? bosDeger() },
          {
            key: "ref",
            label: "Sağlayıcı referansı",
            children: kayit.provider_ref ? (
              // Görünür metin; seçilebilir. Öznitelik ya da adres olarak hiçbir yere kopyalanmaz.
              <Typography.Text style={{ fontFamily: "monospace", fontSize: 12, userSelect: "all", ...SAR }}>{kayit.provider_ref}</Typography.Text>
            ) : (
              bosDeger()
            ),
          },
          { key: "odendi", label: "Ödeme tarihi", children: bicimTarih(kayit.paid_at) },
          {
            key: "iade",
            label: "İade edilen",
            children: kayit.refunded_amount ? (tutar ? tutar(kayit.refunded_amount, kayit.currency) : kayit.refunded_amount) : bosDeger(),
          },
          { key: "yururluk", label: "Yürürlük", children: `${bicimTarih(kayit.starts_at)} – ${bicimTarih(kayit.ends_at)}` },
          { key: "iptal", label: "İptal tarihi", children: bicimTarih(kayit.cancelled_at) },
          { key: "olusturma", label: "Oluşturma tarihi", children: bicimTarih(kayit.created_at) },
        ]} />
      ) : null}
    </Drawer>
  );
}

export type IptalPenceresiProps = {
  acik?: boolean;
  /** Hedef kayıt pencere AÇILIRKEN sabitlenir (ekran tarafından). */
  kayit?: AdminPromotion;
  kapat?: () => void;
  kaydediyor?: boolean;
  /** Sunucu 422 alan hataları ve kalan genel hata. */
  alanHatalari?: Hatalar;
  hata?: string | null;
  /** Ekrandaki senkron kilit: true ise kapatma da gönderim de yutulur. */
  kilitliMi?: () => boolean;
  onayla?: (gerekce: string) => void;
};

export function IptalPenceresi({ acik, kayit, kapat, kaydediyor, alanHatalari, hata, kilitliMi, onayla }: IptalPenceresiProps) {
  const { modal } = App.useApp();
  const [gerekce, setGerekce] = useState("");
  const refler = useRef<Record<string, InputRef | null>>({});
  const { gosterilen, temizle, yerelHatalariUygula } = useAlanHatalari(acik, alanHatalari, IPTAL_SIRA, refler);
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
    // Gönder düğmesi geçerlilikle KAPANMAZ: basınca hata alanda çıkar ve odak oraya gider.
    if (yerelHatalariUygula({ reason: gerekceHatasi(gerekce) })) return;
    onayla?.(gerekce.trim());
  };

  const ad = kayit ? (kayit.tutor_name ?? `Eğitmen #${kayit.tutor_id}`) : "";
  // Başlık önce EYLEMİ söyler: geri dönüşü olmayan bir karar penceresi olduğu ekran okuyucuda da duyulsun.
  const baslik = kayit ? `Öne çıkarmayı iptal et · ${ad} · ${kayit.package_days} günlük paket` : "Öne çıkarmayı iptal et";
  return (
    <YanPencere
      acik={Boolean(acik)}
      baslik={baslik}
      kapat={kapatIstegi}
      kaydet={gonder}
      kaydediyor={Boolean(kaydediyor)}
      kaydetMetni={kayit ? iptalDugmeMetni(kayit.payment_status) : "İptal et"}
    >
      {acik && kayit ? (
        <Flex vertical gap={12}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {iptalAciklamasi(kayit.payment_status)} Gerekçe denetim kaydına yazılır.
          </Typography.Paragraph>
          {hata ? <Alert type="error" showIcon message={hata} /> : null}
          <label htmlFor="one-cikarma-gerekce">
            <Typography.Text type="secondary">İptal gerekçesi</Typography.Text>
            <Input.TextArea
              ref={(r) => {
                refler.current.reason = r as unknown as InputRef | null;
              }}
              id="one-cikarma-gerekce"
              value={gerekce}
              onChange={(e) => {
                setGerekce(e.target.value);
                temizle("reason");
              }}
              rows={4}
              maxLength={GEREKCE_MAX}
              placeholder="Örn. yanlış satın alma, eğitmen talebi…"
              status={gosterilen("reason") ? "error" : undefined}
              aria-describedby={gosterilen("reason") ? "one-cikarma-gerekce-hata one-cikarma-gerekce-yardim" : "one-cikarma-gerekce-yardim"}
              style={{ marginTop: 4 }}
            />
          </label>
          <Typography.Text id="one-cikarma-gerekce-yardim" type="secondary" style={{ fontSize: 12 }}>
            {`En az ${GEREKCE_MIN}, en fazla ${GEREKCE_MAX} karakter (${gerekce.length}/${GEREKCE_MAX}).`}
          </Typography.Text>
          {gosterilen("reason") ? (
            <Typography.Text id="one-cikarma-gerekce-hata" type="danger" role="alert">
              {gosterilen("reason")}
            </Typography.Text>
          ) : null}
        </Flex>
      ) : null}
    </YanPencere>
  );
}
