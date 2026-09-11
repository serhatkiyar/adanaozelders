import { Card, Flex, Modal, Typography } from "antd";

export type TipSecenegi = { anahtar: string; baslik: string; aciklama: string };

export type TipSecimiProps = {
  acik: boolean;
  baslik: string;
  secenekler: TipSecenegi[];
  kapat: () => void;
  secildi: (anahtar: string) => void;
};

export function TipSecimi({ acik, baslik, secenekler, kapat, secildi }: TipSecimiProps) {
  return (
    <Modal open={acik} title={baslik} onCancel={kapat} footer={null} destroyOnClose>
      <Flex vertical gap={12}>
        {secenekler.map((s) => (
          <Card
            key={s.anahtar}
            hoverable
            role="button"
            tabIndex={0}
            onClick={() => secildi(s.anahtar)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                secildi(s.anahtar);
              }
            }}
          >
            <Typography.Text strong>{s.baslik}</Typography.Text>
            <br />
            <Typography.Text type="secondary">{s.aciklama}</Typography.Text>
          </Card>
        ))}
      </Flex>
    </Modal>
  );
}
