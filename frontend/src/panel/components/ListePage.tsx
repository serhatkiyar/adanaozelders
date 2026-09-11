import { Alert, Card, Flex, Input, Table, Typography } from "antd";
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
  /**
   * `hata`dan FARKLI bir kanal — karıştırılmasın: `hata` doluyken gövdenin
   * YERİNE geçer (tablo hiç render edilmez, yukarıdaki `hata` yorumuna
   * bkz.); `uyari` ise gövdeyle BİRLİKTE görünür — liste yine render
   * edilir, üstüne bir bilgi şeridi eklenir. Örnek: tüketici sunucudan
   * `q`/`offset` desteği olmadan elinde tuttuğu bir PARTİ gösteriyor ve o
   * parti sunucu tavanını doldurduysa (bkz. `SiparisListesi`) — bu bir HATA
   * değildir, liste yine doğru ve kullanılabilir, yalnız TAM olmayabilir.
   * Yalnız veri render edilirken gösterilir (hata/yükleniyor/boş dallarında
   * DEĞİL) — "uyarı, gösterilen bir şeyin yanına eklenir" sözleşmesi bunu
   * gerektirir. Opsiyonel — verilmezse davranış hiç değişmez (geriye dönük
   * uyum, 15 modülün 13'ü bunu vermez).
   *
   * Gösterim `Durum.tsx`'e DEĞİL burada AntD `Alert type="warning"
   * showIcon`e konur: bu dosyayı yazan ajanın kapsamı `Durum.tsx`'i
   * kapsamıyordu (eşzamanlı başka bir ajan orada çalışıyordu) — üçüncü bir
   * tüketici çıkarsa oraya (bir `UyariDurumu` olarak) taşınabilir.
   *
   * Duyuru rolü `role="status"`tur (`role="alert"` DEĞİL) — bir hata değil,
   * ekran okuyucunun assertive değil polite duyurması gereken bir bilgi
   * notudur (bkz. aşağıdaki render'daki kaynak yorumu).
   */
  uyari?: ReactNode;
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
  hata, hataAksiyon, uyari, toplam, sayfa, sayfaBoyutu, sayfaDegisti, bosBaslik, bosAciklama, bosAksiyon, rowKey,
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
          {/* `Input.Search` DEĞİL: onSearch verilmediği için tıklanabilir ama
              hiçbir şey yapmayan bir büyüteç düğmesi basıyordu. Etkisi olmayan
              kontrol kullanıcıyı yanıltır (aynı gerekçeyle VaryantPenceresi'nden
              "Seçim Stili" söküldü). Arama zaten her tuşta tüketiciye gidiyor.
              Erişilebilir ad başlıktan türetilir: 15 modülün her biri "Ürünler
              içinde ara" gibi anlamlı bir ad alır; placeholder tek başına
              güvenilir bir erişilebilir ad değildir. */}
          <Input
            aria-label={`${baslik} içinde ara`}
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
          <>
            {/* `Alert` (5.29.3) kök `div`'e VARSAYILAN `role="alert"` bağlar
                (bkz. `Durum.tsx`'teki aynı doğrulama) — ama `uyari` bir hata
                değil, veriyle BİRLİKTE duran bir bilgi notu; `role="alert"`
                örtük `aria-live="assertive"` demektir ve her veri çekiminde
                agresif bir duyuru yapar. `AlertProps.role` (`antd/es/alert/
                Alert.d.ts`) AÇIKÇA `string` tipli ve `rc-util` `pickAttrs`
                `role` anahtarını `aria: true` altında topluyor — yani
                `role="status"` buraya verildiğinde AntD'nin sabit değerinin
                ÜZERİNE yazar (kaynaktan doğrulandı). `aria-live` ayrıca
                verilmez: `AlertProps` onu tipe almıyor (verilse `tsc`
                kırılır) ve zaten GEREKMEZ — WAI-ARIA'da `status` rolünün
                varsayılanı `aria-live="polite"`tir, `Durum.tsx`teki
                `BosDurumu`nun çıplak `div`e elle eklediği açık
                `aria-live="polite"` orada rolün kendisi native olmadığı
                içindi, burada rolün kendisi zaten polite. İkinci bir rol
                sarmalayıcı EKLENMEZ, çakışır. */}
            {uyari ? (
              <Alert
                type="warning"
                showIcon
                role="status"
                message={uyari}
                style={{ marginBottom: 16 }}
              />
            ) : null}
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
          </>
        )}
      </Card>
    </Flex>
  );
}
