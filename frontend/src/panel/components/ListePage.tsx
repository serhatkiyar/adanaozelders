import { Card, Empty, Flex, Input, Table, Typography } from "antd";
import type { TableProps } from "antd";
import type { ReactNode } from "react";

export type ListePageProps<T> = {
  baslik: string;
  aksiyonlar?: ReactNode;
  aramaDegeri: string;
  aramaDegisti: (v: string) => void;
  kolonlar: TableProps<T>["columns"];
  veri: T[] | undefined;
  yukleniyor: boolean;
  toplam?: number;
  sayfa: number;
  sayfaBoyutu: number;
  sayfaDegisti: (sayfa: number, boyut: number) => void;
  bosBaslik: string;
  bosAciklama: string;
  bosAksiyon?: ReactNode;
  rowKey: (kayit: T) => string | number;
};

export function ListePage<T extends object>({
  baslik, aksiyonlar, aramaDegeri, aramaDegisti, kolonlar, veri, yukleniyor,
  toplam, sayfa, sayfaBoyutu, sayfaDegisti, bosBaslik, bosAciklama, bosAksiyon, rowKey,
}: ListePageProps<T>) {
  const bos = !yukleniyor && (veri?.length ?? 0) === 0;

  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {baslik}
        </Typography.Title>
        <Flex gap={8} wrap>{aksiyonlar}</Flex>
      </Flex>

      <Card>
        <Flex justify="space-between" wrap gap={12} style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="Tabloda arama yapın"
            allowClear
            value={aramaDegeri}
            onChange={(e) => aramaDegisti(e.target.value)}
            style={{ maxWidth: 320 }}
          />
        </Flex>

        {bos ? (
          <Empty
            description={
              <Flex vertical gap={4} align="center">
                <Typography.Text strong>{bosBaslik}</Typography.Text>
                <Typography.Text type="secondary">{bosAciklama}</Typography.Text>
              </Flex>
            }
          >
            {bosAksiyon}
          </Empty>
        ) : (
          <Table<T>
            columns={kolonlar}
            dataSource={veri}
            loading={yukleniyor}
            rowKey={rowKey}
            scroll={{ x: "max-content" }}
            pagination={{
              current: sayfa,
              pageSize: sayfaBoyutu,
              total: toplam,
              showSizeChanger: true,
              onChange: sayfaDegisti,
              showTotal: (t, [bas, son]) => `${bas}-${son} / ${t} kayıt`,
            }}
          />
        )}
      </Card>
    </Flex>
  );
}
