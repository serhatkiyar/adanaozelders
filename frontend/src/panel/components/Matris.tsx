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
  degisti: (anahtar: string, alan: keyof MatrisSatiri, deger: string | number) => void;
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
              min={0}
              addonAfter="TL"
              onChange={(v) => degisti(k.anahtar, "price", Number(v ?? 0))}
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
              min={0}
              onChange={(v) => degisti(k.anahtar, "stock", Number(v ?? 0))}
            />
          ),
        },
      ]}
    />
  );
}
