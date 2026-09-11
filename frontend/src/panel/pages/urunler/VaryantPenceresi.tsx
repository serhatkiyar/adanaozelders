import { useState } from "react";
import { Alert, App, Button, Divider, Form, Input, Typography } from "antd";
import { YanPencere } from "@/panel/components/YanPencere";
import { Matris, type MatrisSatiri } from "@/panel/components/Matris";
import { useVariantMatrix } from "@/hooks/useStore";
import type { VariantMatrixRow } from "@/types";

export type VaryantPenceresiProps = {
  acik: boolean;
  kapat: () => void;
  /** Var olan bir ürün şart — `previewVariantMatrix`/`createVariantMatrix`
   * ikisi de üzerine türetecekleri bir `productId` ister. */
  productId: number;
  /** Eksen ADLARI grubun kendisinden gelir — burada seçilmez/yazılmaz. */
  eksen1Adi: string;
  eksen2Adi?: string | null;
};

type SatirDegerleri = { price?: number; barcode: string; stock?: number };

function degerAyir(metin: string): string[] {
  return metin
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

/** Bir kombinasyonun tekil anahtarı — `Matris`in `rowKey`i ve satır state'i bunu kullanır. */
function hucreAnahtari(a: string, b?: string | null): string {
  return `${a}::${b ?? ""}`;
}

/**
 * Düzenleme modunda, ürün zaten bir varyant grubundayken kardeş varyantları
 * TOPLU üretir (bkz. karar belgesi
 * `.superpowers/sdd/2026-09-11-panel-paket1-kurulum-kabuk-urunler/
 * task-8-karar-varyant-akisi.md`, Faz 2).
 *
 * Akış: eksen DEĞERLERİ girilir → `previewVariantMatrix` ile KURU
 * çalıştırma → sunucunun döndürdüğü yeni kombinasyonlar `Matris`e satır
 * olarak beslenir (fiyat/stok/barkod düzenlenir) → `createVariantMatrix`
 * ile hepsi-ya-da-hiçbiri (tek transaction) yazım.
 *
 * Kartezyen çarpım İSTEMCİDE hesaplanmaz: hangi kombinasyonun zaten var
 * olduğu ve hangisinin yeni doğacağı yalnız sunucudan (`preview.cells`)
 * gelir — plan'ın iptal edilen adımının tam tersi.
 */
export function VaryantPenceresi({
  acik,
  kapat,
  productId,
  eksen1Adi,
  eksen2Adi,
}: VaryantPenceresiProps) {
  const { message } = App.useApp();
  const { preview, create } = useVariantMatrix(productId);
  const [eksen1Metin, setEksen1Metin] = useState("");
  const [eksen2Metin, setEksen2Metin] = useState("");
  const [satirlar, setSatirlar] = useState<Record<string, SatirDegerleri>>({});
  const [gonderimHatasi, setGonderimHatasi] = useState<string | null>(null);
  const ikiEksenli = !!eksen2Adi;

  function sifirla() {
    setEksen1Metin("");
    setEksen2Metin("");
    setSatirlar({});
    setGonderimHatasi(null);
    preview.reset();
  }

  function kapatVeSifirla() {
    sifirla();
    kapat();
  }

  function onizle() {
    const eksen1Degerler = degerAyir(eksen1Metin);
    const eksen2Degerler = ikiEksenli ? degerAyir(eksen2Metin) : [];
    if (eksen1Degerler.length === 0 || (ikiEksenli && eksen2Degerler.length === 0)) return;
    setGonderimHatasi(null);
    setSatirlar({});
    preview.mutate(
      {
        option1_values: eksen1Degerler,
        option2_values: ikiEksenli ? eksen2Degerler : null,
      },
      {
        onSuccess: (onizleme) => {
          // Yeni hücreler boş barkodla ön-doldurulur; zaten var olanlar
          // (`existing_product_id` doluysa) matrise hiç girmez — o satırlar
          // yazılmayacak, düzenlenebilir alan gerekmiyor.
          const baslangic: Record<string, SatirDegerleri> = {};
          for (const h of onizleme.cells) {
            if (h.existing_product_id != null) continue;
            baslangic[hucreAnahtari(h.option1_value, h.option2_value)] = { barcode: "" };
          }
          setSatirlar(baslangic);
        },
        // Toast YOK: aşağıdaki `preview.isError` kalıcı satırı zaten hatayı
        // görünür kılıyor — aynı metni iki kez (toast + satır) göstermek
        // testte ve ekranda gereksiz tekrar üretir.
      },
    );
  }

  const yeniHucreler = (preview.data?.cells ?? []).filter((h) => h.existing_product_id == null);

  const matrisSatirlari: MatrisSatiri[] = yeniHucreler.map((h) => {
    const anahtar = hucreAnahtari(h.option1_value, h.option2_value);
    const d = satirlar[anahtar];
    return {
      anahtar,
      kombinasyon: [h.option1_value, h.option2_value].filter(Boolean).join(" / "),
      price: d?.price,
      barcode: d?.barcode ?? "",
      stock: d?.stock,
    };
  });

  function satirDegisti(anahtar: string, alan: keyof MatrisSatiri, deger: string | number) {
    setSatirlar((onceki) => ({
      ...onceki,
      [anahtar]: { ...onceki[anahtar], barcode: onceki[anahtar]?.barcode ?? "", [alan]: deger },
    }));
  }

  function kaydet() {
    if (!preview.data || yeniHucreler.length === 0) {
      message.warning("Önce eksen değerlerini girip önizleyin.");
      return;
    }

    // ── Hepsi-ya-da-hiçbiri: gönderimden ÖNCE, istemcide engellenir ──
    const anahtarlar = yeniHucreler.map((h) => hucreAnahtari(h.option1_value, h.option2_value));
    const ilkEksikIndex = anahtarlar.findIndex((k) => !(satirlar[k]?.barcode ?? "").trim());
    if (ilkEksikIndex !== -1) {
      setGonderimHatasi("Her satır için barkod girin: gruplu ürün barkodsuz olamaz.");
      return;
    }
    const barkodlar = anahtarlar.map((k) => satirlar[k]!.barcode.trim());
    const ilkTekrarIndex = barkodlar.findIndex((b, i) => barkodlar.indexOf(b) !== i);
    if (ilkTekrarIndex !== -1) {
      setGonderimHatasi("Aynı barkod iki satırda kullanılamaz.");
      return;
    }
    setGonderimHatasi(null);

    const rows: VariantMatrixRow[] = yeniHucreler.map((h, i) => {
      const d = satirlar[anahtarlar[i]]!;
      return {
        option1_value: h.option1_value,
        option2_value: h.option2_value ?? null,
        barcode: barkodlar[i],
        price: d.price != null ? String(d.price) : undefined,
        stock: d.stock != null ? d.stock : undefined,
      };
    });

    create.mutate(rows, {
      onSuccess: (sonuc) => {
        message.success(`${sonuc.created} varyant oluşturuldu.`);
        kapatVeSifirla();
      },
      onError: () => message.error("Varyantlar oluşturulamadı."),
    });
  }

  const onizleDisabled = degerAyir(eksen1Metin).length === 0 || (ikiEksenli && degerAyir(eksen2Metin).length === 0);

  return (
    <YanPencere
      acik={acik}
      baslik="Kardeş Varyant Üret"
      kapat={kapatVeSifirla}
      kaydet={kaydet}
      kaydediyor={create.isPending}
    >
      <Form layout="vertical">
        <Form.Item label={`${eksen1Adi} değerleri`} required help="Virgülle ayırın: ör. Kırmızı,Mavi">
          <Input
            aria-label={`${eksen1Adi} değerleri`}
            value={eksen1Metin}
            onChange={(e) => setEksen1Metin(e.target.value)}
            placeholder="Kırmızı,Mavi"
          />
        </Form.Item>
        {ikiEksenli && (
          <Form.Item label={`${eksen2Adi} değerleri`} required help="Virgülle ayırın: ör. S,M,L">
            <Input
              aria-label={`${eksen2Adi} değerleri`}
              value={eksen2Metin}
              onChange={(e) => setEksen2Metin(e.target.value)}
              placeholder="S,M,L"
            />
          </Form.Item>
        )}
        <Button onClick={onizle} loading={preview.isPending} disabled={onizleDisabled}>
          Önizle
        </Button>
      </Form>

      {preview.isError && <Alert type="error" showIcon message="Önizleme alınamadı." style={{ marginTop: 16 }} />}

      {preview.data && (
        <div style={{ marginTop: 16 }}>
          <Divider />
          <Typography.Text type="secondary">
            {preview.data.new_count} yeni kombinasyon
            {preview.data.existing_count > 0 ? `, ${preview.data.existing_count} zaten var (atlanacak)` : ""}.
          </Typography.Text>

          {matrisSatirlari.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <Matris satirlar={matrisSatirlari} degisti={satirDegisti} />
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
                Tüm satırlar tek işlemde yazılır: biri geçersizse hiçbiri kaydedilmez.
              </Typography.Paragraph>
            </div>
          ) : (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
              Üretilecek yeni kombinasyon yok.
            </Typography.Paragraph>
          )}
        </div>
      )}

      {gonderimHatasi && <Alert type="error" showIcon message={gonderimHatasi} style={{ marginTop: 16 }} />}
    </YanPencere>
  );
}
