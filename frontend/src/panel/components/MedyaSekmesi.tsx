/**
 * Ürün Medya sekmesi — kapak + galeri yönetimi.
 *
 * Yalnız var olan bir ürün için anlamlıdır (`productId`); yeni kayıt
 * akışında ürün henüz yaratılmadığından yükleme/silme/sıralama UI'ı hiç
 * MOUNT olmaz, bunun yerine kapalı bir kapı gösterilir. Aynı desen
 * `UrunFormu`daki toplu kardeş varyant üretimi kapısıyla TUTARLI
 * (`duzenlemeModu && urun?.variants != null` — bkz. `UrunFormu.tsx`
 * `VaryantAlanlari`): orada da `productId` olmayan bir üründe var
 * olmayan bir ürüne bağlı işlem hiç render edilmez.
 *
 * Kapak (`cover_url`) ve galeri (`images`) ayrı sunucu kavramlarıdır
 * (bkz. `backend/services/store_service.py::set_cover`/`add_images` —
 * kapak tek alan üstüne yazılır, galeri ayrı bir tablodur); ekran da bu
 * ayrımı korur, ikisini TEK bir "görseller" listesinde BİRLEŞTİRMEZ —
 * eski panelin `ProductsPanel.tsx`teki `UrunAksiyonlari` bileşeni de
 * yalnız kapak yüklemeyi bilir, galeriyi hiç yönetmez (bu ekran galeriyi
 * İLK KEZ bağlıyor).
 *
 * Kabul edilen tip/boyut sınırı sunucudan okunur (`backend/api/routers/
 * store.py::_read_image` — yalnız `image/*`, 12MB, `_MAX_IMAGE_BYTES`);
 * istemci aynı sınırı ÖNDEN uygular ki geçersiz dosya ağa hiç gitmesin.
 * Hata metinleri sunucuyla BİREBİR aynı ("Yalnızca görsel yüklenebilir.",
 * "Görsel 12MB sınırını aşıyor.") — uydurma yok.
 *
 * Dosya seçici deseni eski panelden alınır (`ProductsPanel.tsx`
 * `UrunAksiyonlari`): görünmez `<input type="file" hidden>` + `ref` +
 * düğmeyle tetikleme — AntD `Upload`ın kendi dosya listesi/otomatik
 * gönderim state'i burada gereksiz karmaşıklık (YAGNI); ağ isteği zaten
 * `useProductMedia` mutasyonlarıyla elle yürütülüyor.
 *
 * Sürükle-bırak sıralama YOK (YAGNI, dokunmatik erişilebilirliği ayrı bir
 * iştir) — yukarı/aşağı düğmeleri klavyeyle de çalışır, her tıklama
 * `reorderProductImages`e TÜM galerinin güncel id dizisini gönderir.
 *
 * `useProductMedia` beş mutasyonun hepsinde `onSuccess`te hem bu ürünün
 * admin önbelleğini (`setQueryData`) hem vitrin anahtarlarını geçersiz
 * kılıyor (bkz. `hooks/useStore.ts`) — bu bileşen kendi `queryClient`
 * çağrısını YAPMAZ, hook zaten yapıyor.
 *
 * `urun` VERİSİ burada AYRICA `useAdminProduct` ile ÇEKİLMEZ — `UrunFormu`
 * zaten tek bir `useAdminProduct(idSayi)` çağırıyor ve sonucu prop olarak
 * geçiriyor (`VaryantAlanlari`nin aldığı `urun` propuyla AYNI desen). İkinci
 * bir gözlemci aynı sorgu anahtarına (`["store","admin","product",id]`)
 * bağlanırsa `staleTime` varsayılanı (0) yüzünden mount'ta sessiz bir arka
 * plan yeniden-çekimi tetiklenir — gereksiz ağ trafiği ve (test ortamında
 * ikinci çağrının ayrı bir mock dönüşü olmaması yüzünden) sahte hata riski.
 */
import { useRef, type ChangeEvent } from "react";
import { App, Button, Card, Flex, Popconfirm, Typography } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { BosDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { useProductMedia } from "@/hooks/useStore";
import { getErrorDetail } from "@/lib/errors";
import type { ProductDetailOut } from "@/types";

const KABUL_EDILEN_TIP = "image/*";
/** Sunucu sınırıyla birebir aynı — `backend/api/routers/store.py::_MAX_IMAGE_BYTES`. */
const MAKS_GORSEL_BAYT = 12 * 1024 * 1024;

/**
 * Sunucunun `_read_image` doğrulamasının istemci aynası — mesajlar da
 * BİREBİR aynı (`backend/api/routers/store.py` satır 145-151).
 */
function dosyaGecersizlikNedeni(file: File): string | null {
  if (file.type && !file.type.startsWith("image/")) return "Yalnızca görsel yüklenebilir.";
  if (file.size > MAKS_GORSEL_BAYT) return "Görsel 12MB sınırını aşıyor.";
  return null;
}

export function MedyaSekmesi({ productId, urun }: { productId?: number; urun?: ProductDetailOut }) {
  const { message } = App.useApp();
  const kapakInputRef = useRef<HTMLInputElement>(null);
  const gorselInputRef = useRef<HTMLInputElement>(null);

  const { uploadCover, uploadImages, removeImage, reorder } = useProductMedia(productId);

  if (productId == null) {
    return (
      <BosDurumu
        baslik="Önce ürünü kaydedin"
        aciklama="Görsel yükleyebilmek için ürünün önce kaydedilmiş olması gerekir."
      />
    );
  }

  // `UrunFormu` yükleme hatasını (`urunHataVar`) `FormPage`in `hata` propuna
  // taşıyor — o durumda Tabs'ın kendisi hiç render edilmez, bu bileşene
  // hiç ulaşılmaz. Burada kalan tek olasılık henüz YÜKLENİYOR olması.
  if (!urun) {
    return <YukleniyorDurumu etiket="Görseller yükleniyor…" />;
  }

  const gorseller = [...urun.images].sort((a, b) => a.sort_order - b.sort_order);

  function kapakSecildi(e: ChangeEvent<HTMLInputElement>) {
    const dosya = e.target.files?.[0];
    e.target.value = "";
    if (!dosya) return;
    const nedeni = dosyaGecersizlikNedeni(dosya);
    if (nedeni) {
      message.error(nedeni);
      return;
    }
    uploadCover.mutate(dosya, {
      onError: (hata) => message.error(getErrorDetail(hata, "Kapak yüklenemedi.")),
    });
  }

  function gorselSecildi(e: ChangeEvent<HTMLInputElement>) {
    const dosyalar = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (dosyalar.length === 0) return;
    for (const dosya of dosyalar) {
      const nedeni = dosyaGecersizlikNedeni(dosya);
      if (nedeni) {
        message.error(nedeni);
        return;
      }
    }
    uploadImages.mutate(dosyalar, {
      onError: (hata) => message.error(getErrorDetail(hata, "Görsel yüklenemedi.")),
    });
  }

  function tasi(index: number, yon: -1 | 1) {
    const hedefIndex = index + yon;
    if (hedefIndex < 0 || hedefIndex >= gorseller.length) return;
    const yeniSira = [...gorseller];
    [yeniSira[index], yeniSira[hedefIndex]] = [yeniSira[hedefIndex], yeniSira[index]];
    reorder.mutate(
      yeniSira.map((g) => g.id),
      { onError: (hata) => message.error(getErrorDetail(hata, "Sıralama güncellenemedi.")) },
    );
  }

  function sil(imageId: number) {
    removeImage.mutate(imageId, {
      onError: (hata) => message.error(getErrorDetail(hata, "Görsel silinemedi.")),
    });
  }

  return (
    <Flex vertical gap={24}>
      <div>
        <Typography.Title level={5}>Kapak Görseli</Typography.Title>
        <Flex align="center" gap={16} wrap>
          {urun.cover_url ? (
            <img
              src={urun.cover_url}
              alt="Kapak"
              style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8 }}
            />
          ) : (
            <Typography.Text type="secondary">Kapak görseli yok.</Typography.Text>
          )}
          <input
            ref={kapakInputRef}
            type="file"
            accept={KABUL_EDILEN_TIP}
            hidden
            onChange={kapakSecildi}
            aria-label="Kapak görseli seç"
          />
          <Button
            icon={<UploadOutlined />}
            loading={uploadCover.isPending}
            onClick={() => kapakInputRef.current?.click()}
          >
            {urun.cover_url ? "Kapağı Değiştir" : "Kapak Yükle"}
          </Button>
        </Flex>
      </div>

      <div>
        <Flex align="center" justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Görseller
          </Typography.Title>
          <input
            ref={gorselInputRef}
            type="file"
            accept={KABUL_EDILEN_TIP}
            multiple
            hidden
            onChange={gorselSecildi}
            aria-label="Görsel seç"
          />
          <Button
            icon={<UploadOutlined />}
            loading={uploadImages.isPending}
            onClick={() => gorselInputRef.current?.click()}
          >
            Görsel Ekle
          </Button>
        </Flex>
        {gorseller.length === 0 ? (
          <BosDurumu baslik="Henüz görsel eklenmedi" aciklama="Yukarıdaki düğmeden görsel ekleyebilirsiniz." />
        ) : (
          <Flex wrap gap={16}>
            {gorseller.map((gorsel, index) => (
              <Card key={gorsel.id} size="small" style={{ width: 140 }}>
                <Flex vertical align="center" gap={8}>
                  <img
                    src={gorsel.url}
                    alt={gorsel.alt_text || `Görsel ${index + 1}`}
                    style={{ width: 116, height: 116, objectFit: "cover", borderRadius: 4 }}
                  />
                  <Flex gap={4}>
                    <Button
                      aria-label={`${index + 1}. görseli yukarı taşı`}
                      icon={<ArrowUpOutlined />}
                      size="small"
                      disabled={index === 0 || reorder.isPending}
                      onClick={() => tasi(index, -1)}
                    />
                    <Button
                      aria-label={`${index + 1}. görseli aşağı taşı`}
                      icon={<ArrowDownOutlined />}
                      size="small"
                      disabled={index === gorseller.length - 1 || reorder.isPending}
                      onClick={() => tasi(index, 1)}
                    />
                    <Popconfirm
                      title="Görseli sil"
                      description="Bu görsel kalıcı olarak silinecek."
                      okText="Sil"
                      cancelText="Vazgeç"
                      onConfirm={() => sil(gorsel.id)}
                    >
                      <Button
                        aria-label={`${index + 1}. görseli sil`}
                        icon={<DeleteOutlined />}
                        size="small"
                        danger
                        loading={removeImage.isPending}
                      />
                    </Popconfirm>
                  </Flex>
                </Flex>
              </Card>
            ))}
          </Flex>
        )}
      </div>
    </Flex>
  );
}
