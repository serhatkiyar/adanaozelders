import { Alert, Empty, Flex, Spin, Typography } from "antd";
import type { ReactNode } from "react";

/**
 * Panel genelinde durum gösteriminin TEK dili — bkz. denetim bulgusu:
 * hata/yükleniyor/boş üç ayrı biçimde yazılmıştı (`ListePage`+`FormPage`nin
 * `Alert` çifti, `YanPencere`nin tüketicisinin elle kurduğu `Alert`ler,
 * `UrunFormu`nun varyant alanlarındaki düz `Typography.Text`). 15 modül bu
 * dosyadaki üç bileşeni kopyalayacak; biçim burada tek yerde sabitlenir.
 *
 * `HataDurumu` `ListePage`/`FormPage`'in mevcut `hata`/`hataAksiyon` adlarıyla
 * BİLEREK simetriktir — o iki bileşenin sözleşmesi zaten tüketiliyor ve
 * denetimden geçti, yeni bir isimlendirme icat edilmedi.
 */

export type HataDurumuProps = {
  /**
   * Gösterilecek hata metni. Anlamı TÜKETİCİYE göre değişir — bu bileşen
   * yalnız biçimi (Alert type="error" showIcon) sabitler:
   *  - `ListePage`de "liste VERİSİ hiç gelmedi" (bkz. o dosyadaki yorum).
   *  - `FormPage`de "form GÖVDESİ gösterilemiyor" (bkz. o dosyadaki yorum).
   *  - `VaryantPenceresi`/`UrunFormu`da "önizleme/varyant verisi
   *    alınamadı" — kalıcı gösterim, toast DEĞİL.
   * Kaydetme/gönderme (mutasyon) hataları bu bileşene KONMAZ; modül kendi
   * geri bildirimini (bildirim/toast) kendi gösterir.
   */
  hata: string;
  /** Genelde "Tekrar dene" düğmesi; `Alert`in `action` sahnesinde durur. */
  hataAksiyon?: ReactNode;
};

/**
 * AntD `Alert` (5.29.3) kök `div`'e KOŞULSUZ `role="alert"` bağlar (kaynaktan
 * doğrulandı) — bu yüzden burada ikinci bir `role="alert"` sarmalayıcı
 * EKLENMEZ, çakışır.
 */
export function HataDurumu({ hata, hataAksiyon }: HataDurumuProps) {
  return <Alert type="error" showIcon message={hata} action={hataAksiyon} />;
}

export type YukleniyorDurumuProps = {
  /** Varsayılan "Yükleniyor…"; modül kendi bağlamına göre değiştirebilir. */
  etiket?: string;
};

/** İskelet/skeleton YOK (YAGNI, bkz. spec §10) — tutarlı gösterim `Spin` + metindir. */
export function YukleniyorDurumu({ etiket = "Yükleniyor…" }: YukleniyorDurumuProps) {
  return (
    <Flex align="center" gap={8}>
      <Spin size="small" />
      <Typography.Text type="secondary">{etiket}</Typography.Text>
    </Flex>
  );
}

export type BosDurumuProps = {
  baslik: string;
  aciklama: string;
  aksiyon?: ReactNode;
};

/**
 * AntD `Empty` kendiliğinden bir duyuru rolü taşımıyor — `role="status"
 * aria-live="polite"` elle eklenir (bkz. `ListePage`'in eski satır içi
 * sürümü, ölçülmüş davranış).
 */
export function BosDurumu({ baslik, aciklama, aksiyon }: BosDurumuProps) {
  return (
    <div role="status" aria-live="polite">
      <Empty
        description={
          <Flex vertical gap={4} align="center">
            <Typography.Text strong>{baslik}</Typography.Text>
            <Typography.Text type="secondary">{aciklama}</Typography.Text>
          </Flex>
        }
      >
        {aksiyon}
      </Empty>
    </div>
  );
}
