// Paketleme detayının pencereleri: gerekçeli satır/paket işlemleri (elle doğrula, geri al,
// vazgeç) ve kısmi teslimat bölmesi. Açık/kapalı durumu, kilit ve mutasyonlar detay ekranında;
// gövde, doğrulama ve kapatma kuralları burada. Hata gelince pencere ve girdi AÇIK kalır.
import { useEffect, useRef, useState } from "react";
import { Alert, App, Flex, Input, InputNumber, Typography } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { splitSemasi } from "@/components/admin/packing/SplitDialog";
import type { PackageItem, PackageSplitLine } from "@/types/packing";

/** `schemas.packing.REASON_MAX` — gerekçe alanlarının gerçek tavanı. */
export const GEREKCE_MAX = 200;

type OrtakProps = {
  acik?: boolean;
  kapat?: () => void;
  kaydediyor?: boolean;
  /** Sunucudan dönen gerçek hata; pencere kapanmaz, yeniden deneme aynı anahtarla gider. */
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

export type GerekcePenceresiProps = OrtakProps & {
  /** Alan kimliği (label/for); aynı ekranda birden çok gerekçe penceresi var. */
  kimlik: string;
  baslik: string;
  aciklama: string;
  yerTutucu?: string;
  kaydetMetni: string;
  onayla?: (gerekce: string) => void;
};

/** Gerekçe zorunlu, trim edilmiş 1–200 karakter (`REASON_MAX`). */
export function GerekcePenceresi({ acik, kapat, kaydediyor, hata, kilitliMi, kimlik, baslik, aciklama, yerTutucu, kaydetMetni, onayla }: GerekcePenceresiProps) {
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
  // Bütün kapatma yolları (X/Vazgeç/ESC/maske) buradan geçer; pending'de kapanmaz.
  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!metin.trim()) return kapat?.();
    kirliOnayi(modal, () => kapat?.());
  };
  const gonder = () => {
    if (mesgul()) return;
    const temiz = metin.trim();
    if (!temiz || temiz.length > GEREKCE_MAX) {
      setAlanHatasi(!temiz ? "Gerekçe zorunludur." : `En fazla ${GEREKCE_MAX} karakter yazılabilir.`);
      alanRef.current?.focus();
      return;
    }
    setAlanHatasi(null);
    // Gerekçe istek anında sabitlenir: sonradan yazılanlar bu gönderimi değiştirmez.
    onayla?.(temiz);
  };
  return (
    <YanPencere acik={Boolean(acik)} baslik={baslik} kapat={kapatIstegi} kaydet={gonder} kaydediyor={Boolean(kaydediyor)} kaydetMetni={kaydetMetni}>
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{aciklama}</Typography.Paragraph>
        <label htmlFor={kimlik}>
          <Typography.Text type="secondary">Gerekçe</Typography.Text>
          <Input.TextArea
            ref={alanRef}
            id={kimlik}
            rows={4}
            value={metin}
            onChange={(e) => setMetin(e.target.value)}
            placeholder={yerTutucu}
            maxLength={GEREKCE_MAX}
            style={{ marginTop: 4 }}
          />
        </label>
        {alanHatasi ? <Typography.Text type="danger" role="alert">{alanHatasi}</Typography.Text> : null}
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}

export type BolmePenceresiProps = OrtakProps & {
  code?: string;
  items?: PackageItem[];
  onayla?: (lines: PackageSplitLine[], promisedDate: string | null) => void;
};

/**
 * Kısmi teslimat: seçilen kalemler ikinci pakete taşınır. Doğrulama eski SplitDialog'un
 * zod şemasıyla BİREBİR (`splitSemasi`): satır tavanı `expected_qty`, en az bir kalem,
 * kutu tamamen boşalmaz; tarih isteğe bağlı (boş → null). Adet tavanı/okutulmuş adet/durum
 * kuralları sunucudadır (409) ve hata gelince seçim açık kalır.
 */
export function BolmePenceresi({ acik, kapat, kaydediyor, hata, kilitliMi, code = "", items = [], onayla }: BolmePenceresiProps) {
  const { modal } = App.useApp();
  const [adetler, setAdetler] = useState<Record<string, number>>({});
  const [tarih, setTarih] = useState("");
  const [satirHatalari, setSatirHatalari] = useState<Record<string, string>>({});
  const [kokHatasi, setKokHatasi] = useState<string | null>(null);
  useEffect(() => {
    if (!acik) {
      setAdetler({});
      setTarih("");
      setSatirHatalari({});
      setKokHatasi(null);
    }
  }, [acik]);
  const mesgul = () => Boolean(kaydediyor || kilitliMi?.());
  const adet = (id: number) => Number(adetler[String(id)] ?? 0);
  const ayrilan = items.reduce((t, s) => t + adet(s.order_item_id), 0);
  const kutudaki = items.reduce((t, s) => t + s.expected_qty, 0);
  const kalan = kutudaki - ayrilan;
  const kirli = ayrilan > 0 || tarih.trim() !== "";

  const kapatIstegi = () => {
    if (mesgul()) return;
    if (!kirli) return kapat?.();
    kirliOnayi(modal, () => kapat?.());
  };
  const gonder = () => {
    if (mesgul()) return;
    const tam: Record<string, number> = Object.fromEntries(items.map((s) => [String(s.order_item_id), adet(s.order_item_id)]));
    const sonuc = splitSemasi(items).safeParse({ adetler: tam, tarih });
    if (!sonuc.success) {
      const satir: Record<string, string> = {};
      let kok: string | null = null;
      for (const sorun of sonuc.error.issues) {
        if (sorun.path[0] === "adetler" && sorun.path.length === 2) satir[String(sorun.path[1])] = sorun.message;
        else if (sorun.path[0] === "adetler") kok = kok ?? sorun.message;
      }
      setSatirHatalari(satir);
      setKokHatasi(kok);
      return;
    }
    setSatirHatalari({});
    setKokHatasi(null);
    const lines = items
      .map((s) => ({ order_item_id: s.order_item_id, quantity: adet(s.order_item_id) }))
      .filter((s) => s.quantity > 0);
    onayla?.(lines, tarih.trim() === "" ? null : tarih.trim());
  };

  return (
    <YanPencere acik={Boolean(acik)} baslik="Kalanı sonraki teslimata ayır" kapat={kapatIstegi} kaydet={gonder} kaydediyor={Boolean(kaydediyor)} kaydetMetni="Sonraki teslimata ayır">
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {code} kutusundan bugün gönderilemeyecek kalemleri seçin. Seçtikleriniz ikinci bir teslimata taşınır; kalanlar bu kutuda gider.
        </Typography.Paragraph>
        <Flex vertical>
          {items.map((s, i) => {
            const id = String(s.order_item_id);
            const alanHatasi = satirHatalari[id];
            return (
              <Flex key={id} align="center" justify="space-between" gap={12} wrap style={{ padding: "12px 0", borderTop: i === 0 ? undefined : "1px solid rgba(5, 5, 5, 0.06)" }}>
                <div style={{ minWidth: 0, flex: "1 1 160px" }}>
                  <Typography.Text style={{ fontWeight: 500, display: "block" }}>{s.title}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Kutuda {s.expected_qty} adet{s.scanned_qty > 0 ? ` · ${s.scanned_qty} okutuldu` : ""}
                  </Typography.Text>
                  {alanHatasi ? <Typography.Text type="danger" role="alert" style={{ display: "block", fontSize: 12 }}>{alanHatasi}</Typography.Text> : null}
                </div>
                <Flex align="center" gap={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>Sonraya</Typography.Text>
                  <InputNumber
                    aria-label={`${s.title} sonraya adet`}
                    min={0}
                    max={s.expected_qty}
                    precision={0}
                    disabled={Boolean(kaydediyor)}
                    value={adet(s.order_item_id)}
                    onChange={(v) => setAdetler((o) => ({ ...o, [id]: Number(v ?? 0) }))}
                    style={{ width: 88 }}
                  />
                </Flex>
              </Flex>
            );
          })}
        </Flex>
        <Typography.Text>
          {kalan <= 0 ? "Kutuda hiç kalem kalmıyor." : `Bu kutuda ${kalan} adet gidecek, ${ayrilan} adet sonraki teslimata kalacak.`}
        </Typography.Text>
        {kokHatasi ? <Typography.Text type="danger" role="alert">{kokHatasi}</Typography.Text> : null}
        <label htmlFor="bolme-tarih">
          <Typography.Text type="secondary">İkinci teslimat için tahmini tarih (isteğe bağlı)</Typography.Text>
          <Input id="bolme-tarih" type="date" value={tarih} disabled={Boolean(kaydediyor)} onChange={(e) => setTarih(e.target.value)} style={{ marginTop: 4 }} />
          {/* Tutturulamayan tarih şikâyet üretir; bilinmiyorsa boş bırakmak müşteriye "temin ediliyor" demektir. */}
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
            Tedarik tarihini bilmiyorsanız boş bırakın: müşteri "temin ediliyor" görür.
          </Typography.Text>
        </label>
        {hata ? <Alert type="error" showIcon message={hata} /> : null}
      </Flex>
    </YanPencere>
  );
}
