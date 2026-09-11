import { Card, Flex, Input, Table, Typography } from "antd";
import type { TableProps } from "antd";
import type { ReactNode } from "react";
import { BosDurumu, HataDurumu } from "@/panel/components/Durum";

export type ListePageProps<T> = {
  baslik: string;
  aksiyonlar?: ReactNode;
  aramaDegeri: string;
  aramaDegisti: (v: string) => void;
  kolonlar: TableProps<T>["columns"];
  veri: T[] | undefined;
  yukleniyor: boolean;
  /**
   * `hata` doluyken bunun anlamı "liste VERİSİ hiç gelmedi" (ör. sorgu
   * başarısız oldu) — bir SATIR AKSİYONUNUN (silme, durum değiştirme,
   * dışa aktarma vb.) başarısız olması DEĞİLDİR. `hata` doluyken tablo
   * ve boş durum hiç render edilmez (aşağıdaki `bos` hesaplamasına bkz.),
   * yalnız `HataDurumu` durur; `hataAksiyon` genelde "Tekrar dene"
   * düğmesidir. Satır aksiyonu hataları kendi geri bildirimini
   * (bildirim/toast) modülün kendisi gösterir — bu prop'a KONMAZ (aynı
   * ayrım `FormPage.hata`'da da var: "kaydetme hatası buraya konmaz").
   */
  hata?: string | null;
  hataAksiyon?: ReactNode;
  toplam?: number;
  sayfa: number;
  sayfaBoyutu: number;
  sayfaDegisti: (sayfa: number, boyut: number) => void;
  bosBaslik: string;
  bosAciklama: string;
  bosAksiyon?: ReactNode;
  rowKey: (kayit: T) => string | number;
  /**
   * AntD `Table.onChange` kanalının HAM geçişi (sayfalama hariç — o zaten
   * `sayfaDegisti` ile taşınıyor). `ListePage` sıralama/filtre semantiğine
   * karar vermez: hangi kolonun sıralanabilir/filtrelenebilir olduğu
   * tüketicinin `kolonlar` tanımından (`sorter`/`filters`) gelir, burada
   * yalnız olay dışarı aktarılır. Opsiyonel — verilmezse davranış hiç
   * değişmez (geriye dönük uyum): AntD `onChange` prop'u `undefined`
   * geçtiğinde no-op'tur.
   *
   * Tek prop'ta (ayrı `siralamaDegisti`/`filtreDegisti` yerine) tutulmasının
   * nedeni: AntD zaten sorter+filters+extra'yı TEK olayda birlikte veriyor;
   * burada onu yeniden modelleyip iki prop'a bölmek yüzeyi büyütür ve
   * `ListePage`'e (kullanmadığı) bir normalize sözleşmesi yükler. Tüketici
   * kendi normalize ettiği alanları kendi sorgusuna çevirir (bkz.
   * `UrunListesi`).
   */
  tabloDegisti?: TableProps<T>["onChange"];
};

export function ListePage<T extends object>({
  baslik, aksiyonlar, aramaDegeri, aramaDegisti, kolonlar, veri, yukleniyor,
  hata, hataAksiyon, toplam, sayfa, sayfaBoyutu, sayfaDegisti, bosBaslik, bosAciklama, bosAksiyon, rowKey,
  tabloDegisti,
}: ListePageProps<T>) {
  const bos = !hata && !yukleniyor && (veri?.length ?? 0) === 0;

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

        {hata ? (
          <HataDurumu hata={hata} hataAksiyon={hataAksiyon} />
        ) : bos ? (
          <BosDurumu baslik={bosBaslik} aciklama={bosAciklama} aksiyon={bosAksiyon} />
        ) : (
          <Table<T>
            columns={kolonlar}
            dataSource={veri}
            loading={yukleniyor}
            rowKey={rowKey}
            scroll={{ x: "max-content" }}
            onChange={tabloDegisti}
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
