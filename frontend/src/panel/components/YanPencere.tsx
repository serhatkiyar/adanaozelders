import { Button, Drawer, Flex } from "antd";
import type { ReactNode } from "react";
import { useMobil } from "@/hooks/useMedyaSorgusu";

export type YanPencereProps = {
  acik: boolean;
  baslik: string;
  kapat: () => void;
  kaydet: () => void;
  /** Kaydet düğmesinde yükleme göstergesi — bkz. `FormPage`'in `kaydediyor`u. */
  kaydediyor?: boolean;
  children: ReactNode;
};

export function YanPencere({ acik, baslik, kapat, kaydet, kaydediyor, children }: YanPencereProps) {
  // AntD'nin `Grid.useBreakpoint()` yerine deponun kendi hook'u kullanılıyor:
  // useBreakpoint ilk senkron render'da `{}` döner (md === undefined), bu da
  // dar ekranda ilk render'ın yanlışlıkla masaüstü (480px) dalını seçmesine
  // yol açar — panel kabuğunda (`PanelShell`) zaten kapatılmış aynı hata
  // (bkz. `useMedyaSorgusu.ts`). `useMobil`, değeri `useState`
  // başlatıcısında `matchMedia` ile senkron okur, aynı 768px eşiğini korur.
  const mobil = useMobil();
  return (
    <Drawer
      open={acik}
      title={baslik}
      onClose={kapat}
      placement="right"
      width={mobil ? "100%" : 480}
      footer={
        <Flex justify="flex-end" gap={8}>
          <Button onClick={kapat}>Vazgeç</Button>
          <Button type="primary" loading={kaydediyor} onClick={kaydet}>
            Kaydet
          </Button>
        </Flex>
      }
    >
      {children}
    </Drawer>
  );
}
