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
  /**
   * Kaydet düğmesinin etiketi — opsiyonel, varsayılanı `"Kaydet"`.
   *
   * İkinci tüketici (Ürün Oluştur çekmecesi, ikas referansı §4) kendi eylem
   * adını istedi: `"Kaydet ve Satışa Aç"`. Bu, tek çekmece kabuğunu paylaşan
   * 15 modülün her birinin kendi eylem adını taşıyacağı GERÇEK bir ortak
   * ihtiyaç — `ListePage`in `uyari?` slotuyla aynı gerekçe. `VaryantPenceresi`
   * (bugünkü tek tüketici) bu propu HİÇ geçmiyor ve varsayılanla değişmeden
   * çalışmaya devam eder — bkz. `varyant.test.tsx`teki mevcut "Kaydet"
   * iddiaları (yedi çağrı yeri).
   */
  kaydetMetni?: string;
  children: ReactNode;
};

export function YanPencere({ acik, baslik, kapat, kaydet, kaydediyor, kaydetMetni, children }: YanPencereProps) {
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
            {kaydetMetni ?? "Kaydet"}
          </Button>
        </Flex>
      }
    >
      {children}
    </Drawer>
  );
}
