import { Input, InputNumber, Table } from "antd";

export type MatrisSatiri = {
  anahtar: string;
  kombinasyon: string;
  price?: number;
  sku?: string;
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
          title: "SKU",
          key: "sku",
          render: (_, k) => (
            <Input
              aria-label={`SKU ${k.kombinasyon}`}
              value={k.sku}
              onChange={(e) => degisti(k.anahtar, "sku", e.target.value)}
            />
          ),
        },
        {
          title: "Barkod",
          key: "barcode",
          render: (_, k) => (
            <Input
              aria-label={`Barkod ${k.kombinasyon}`}
              value={k.barcode}
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
