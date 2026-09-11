import { Input, InputNumber, Table } from "antd";

/**
 * Kardeş varyant matrisi satırı — backend `VariantMatrixRow` ile aynı
 * alanları taşır (bkz. `frontend/src/types/index.ts`). `sku` alanı YOK:
 * backend'de karşılığı yok. `barcode` ZORUNLU (gruplu ürün barkodsuz
 * yazılamaz, `ck_products_variant_barcode`) — boşken sütun görsel olarak
 * uyarır; asıl engelleme (istek atılmaması) tüketici (`VaryantPenceresi`)
 * tarafında yapılır.
 */
export type MatrisSatiri = {
  anahtar: string;
  kombinasyon: string;
  price?: number;
  barcode?: string;
  stock?: number;
};

export function Matris({
  satirlar,
  degisti,
}: {
  satirlar: MatrisSatiri[];
  /**
   * `deger` temizlenen bir alan için `undefined` taşır — `0` DEĞİL. Boş ile
   * `0` aynı şey değildir: boş "ana üründen devral" demek (backend
   * `VariantMatrixRowIn.price`/`stock` `default=None`), `0` ise gerçek bir
   * değer ("bedava"/"stok yok"). Çağıran bu ayrımı gövdeye taşımalı —
   * `undefined` alanları JSON'da hiç görünmez, `0` görünür.
   */
  degisti: (anahtar: string, alan: keyof MatrisSatiri, deger: string | number | undefined) => void;
}) {
  return (
    <Table<MatrisSatiri>
      rowKey="anahtar"
      dataSource={satirlar}
      pagination={false}
      scroll={{ x: "max-content" }}
      columns={[
        { title: "Varyantlar", dataIndex: "kombinasyon", key: "kombinasyon" },
        {
          title: "Satış Fiyatı",
          key: "price",
          render: (_, k) => (
            <InputNumber
              aria-label={`Fiyat ${k.kombinasyon}`}
              value={k.price}
              // Backend `price: Decimal | None = Field(default=None, gt=0, ...)`
              // (backend/schemas/store.py:579) — 0 GEÇERSİZ, en küçük geçerli
              // değer kuruş hassasiyetiyle 0.01. Alan temizlenince `v` `null`
              // olur; bunu `0`a değil `undefined`a çeviriyoruz ki "devral"
              // davranışı bozulmasın.
              min={0.01}
              addonAfter="TL"
              onChange={(v) => degisti(k.anahtar, "price", v ?? undefined)}
            />
          ),
        },
        {
          title: "Barkod *",
          key: "barcode",
          render: (_, k) => (
            <Input
              aria-label={`Barkod ${k.kombinasyon}`}
              value={k.barcode}
              status={k.barcode ? undefined : "error"}
              onChange={(e) => degisti(k.anahtar, "barcode", e.target.value)}
            />
          ),
        },
        {
          title: "Stok",
          key: "stock",
          render: (_, k) => (
            <InputNumber
              aria-label={`Stok ${k.kombinasyon}`}
              value={k.stock}
              // Backend `stock: int | None = Field(default=None, ge=0)`
              // (backend/schemas/store.py:580) — 0 burada GEÇERLİDİR ("stok
              // yok" demektir), boş olmaktan farklıdır ("devral"). `null` →
              // `undefined`, yazılan `0` → `0` olarak kalır.
              min={0}
              onChange={(v) => degisti(k.anahtar, "stock", v ?? undefined)}
            />
          ),
        },
      ]}
    />
  );
}
