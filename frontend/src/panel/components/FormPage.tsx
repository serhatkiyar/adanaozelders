import { Button, Card, Flex, Tabs, Typography } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import { HataDurumu } from "@/panel/components/Durum";

export type FormBolumu = { anahtar: string; baslik: string; icerik: ReactNode };

export type FormPageProps = {
  baslik: string;
  geriTiklandi: () => void;
  bolumler: FormBolumu[];
  kaydet: () => void;
  kaydediyor?: boolean;
  ikincilAksiyon?: ReactNode;
  /**
   * `hata` doluyken bunun anlamı "form GÖVDESİ gösterilemiyor" (ör. kayıt
   * yüklenemedi) — "kaydetme başarısız oldu" DEĞİLDİR. Hiçbir `Form.Item`
   * mount olmadığı bir durumda `Kaydet` (ve `ikincilAksiyon`) tıklanabilir
   * kalırsa `validateFields()` boş sonuç döner ve modül farkında olmadan
   * eksik/boş bir gövde gönderebilir (ör. `tax_rate: null`) — bu yüzden
   * `hata` varken ikisi de HİÇ render edilmez. `hataAksiyon` ("Tekrar
   * dene") zaten `Alert` içinde ayrı durur ve etkilenmez.
   *
   * Kaydetme (mutasyon) hatası bu prop'a KONMAZ — modül kendi geri
   * bildirimini (bildirim/toast) kendi gösterir; `hata` yalnız "gövde hiç
   * kurulamadı" anlamına gelir.
   */
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
        <Flex align="center" gap={12} wrap>
          <Button
            aria-label="Geri"
            icon={<ArrowLeftOutlined />}
            size="large"
            onClick={geriTiklandi}
          />
          <Typography.Title level={4} style={{ margin: 0 }} ellipsis>
            {baslik}
          </Typography.Title>
        </Flex>
        {!hata && (
          <Flex gap={8} wrap>
            {ikincilAksiyon}
            <Button type="primary" loading={kaydediyor} onClick={kaydet}>
              Kaydet
            </Button>
          </Flex>
        )}
      </Flex>

      {hata ? (
        <HataDurumu hata={hata} hataAksiyon={hataAksiyon} />
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
