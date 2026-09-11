import { Button, Drawer, Flex, Grid } from "antd";
import type { ReactNode } from "react";

export type YanPencereProps = {
  acik: boolean;
  baslik: string;
  kapat: () => void;
  kaydet: () => void;
  children: ReactNode;
};

export function YanPencere({ acik, baslik, kapat, kaydet, children }: YanPencereProps) {
  const { md } = Grid.useBreakpoint();
  return (
    <Drawer
      open={acik}
      title={baslik}
      onClose={kapat}
      placement="right"
      width={md === false ? "100%" : 480}
      footer={
        <Flex justify="flex-end" gap={8}>
          <Button onClick={kapat}>Vazgeç</Button>
          <Button type="primary" onClick={kaydet}>
            Kaydet
          </Button>
        </Flex>
      }
    >
      {children}
    </Drawer>
  );
}
