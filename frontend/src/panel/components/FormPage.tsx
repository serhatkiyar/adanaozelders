import { Alert, Button, Card, Flex, Tabs, Typography } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

export type FormBolumu = { anahtar: string; baslik: string; icerik: ReactNode };

export type FormPageProps = {
  baslik: string;
  geriTiklandi: () => void;
  bolumler: FormBolumu[];
  kaydet: () => void;
  kaydediyor?: boolean;
  ikincilAksiyon?: ReactNode;
  hata?: string | null;
  hataAksiyon?: ReactNode;
};

export function FormPage({
  baslik,
  geriTiklandi,
  bolumler,
  kaydet,
  kaydediyor,
  ikincilAksiyon,
  hata,
  hataAksiyon,
}: FormPageProps) {
  return (
    <Flex vertical gap={16}>
      <Flex align="center" justify="space-between" wrap gap={12}>
        <Flex align="center" gap={12}>
          <Button aria-label="Geri" icon={<ArrowLeftOutlined />} onClick={geriTiklandi} />
          <Typography.Title level={4} style={{ margin: 0 }}>
            {baslik}
          </Typography.Title>
        </Flex>
        <Flex gap={8} wrap>
          {ikincilAksiyon}
          <Button type="primary" loading={kaydediyor} onClick={kaydet}>
            Kaydet
          </Button>
        </Flex>
      </Flex>

      {hata ? (
        <Alert type="error" showIcon message={hata} action={hataAksiyon} />
      ) : (
        <Tabs
          items={bolumler.map((b) => ({
            key: b.anahtar,
            label: b.baslik,
            children: <Card>{b.icerik}</Card>,
          }))}
        />
      )}
    </Flex>
  );
}
