/**
 * "Ürün Oluştur" — sağdan çekmece (ikas referansı, `docs/ikas-panel-referans.md` §4).
 *
 * `Ürün Ekle` artık bir TİP SEÇİMİ modalı AÇMAZ (o bizim uydurmamızdı, ikas'ta
 * hiç yok) — doğrudan bu hızlı-ekleme çekmecesini açar. Tam sekmeli forma
 * (`UrunFormu`) geçiş yalnız "Gelişmiş Ürün Eklemeye Geç" bağlantısıyla olur.
 *
 * ## Neden AYRI bir DOSYA (UrunListesi.tsx'in içine GÖMÜLMEDİ)
 *
 * Bir ara sürüm bu bileşeni `UrunListesi.tsx`nin içine taşımıştı — gerekçe
 * `calismaZamaniKapisi.test.tsx`nin (bkz. aşağıdaki not) yeni dosyayı kendi
 * kilitli kayıtlarına isimle eklenmiş bulmayı bekleyip kırılmasıydı. Ama o
 * taşıma BAŞKA bir kilitli nöbetçiyi (`uiBaseline.test.ts::modalDurumu`,
 * eşik `toBe(0)`) kırdı: o sayaç BİLEREK yalnız AYNI DOSYADA tanımlı yerel
 * bileşenlerin pencere durumunu izliyor, "başka DOSYADAN import edilen bir
 * bileşene inen durum GÖRÜNMEZ" (bkz. `scripts/ui-baseline-sayim.mjs`daki
 * yorum). Panelin kendi öncül deseni de zaten bunu doğruluyor:
 * `VaryantPenceresi` (`UrunFormu.tsx`nin `matrisAcik` durumunu tüketir) ve
 * eski `TipSecimi` (bu dosyanın kendisi) hep AYRI dosyalardaydı — ikisi de
 * `modalDurumu`yu hiç tetiklemedi. Bu yüzden AYRI DOSYA hem köklü desenle
 * tutarlı hem de `modalDurumu` regresyonunu TAMAMEN önlüyor; geriye tek,
 * gerçekten kaçınılmaz bir kayıt kalıyor — bkz. rapordaki NEEDS_CONTEXT notu.
 *
 * ## Bilinen, ÇÖZÜLEMEYEN kayıt boşluğu (bu paketin izin sınırı içinde)
 *
 * `calismaZamaniKapisi.test.tsx` `src/panel/**`i DİZİN KURALIYLA tarıyor ve
 * bu dosyayı kendi `KAPI_KAPSAMI`/`CALISMA_ZAMANI_ADSIZ` kayıtlarına isimle
 * eklenmiş BULMUYOR (kayıt orada yok) — üç iddiası bu yüzden kırmızı kalıyor.
 * Kayıt `src/__guards__/calismaZamaniKapisi.test.tsx` içinde ve bu paketin
 * izin sınırı `__guards__/**`i KAPSAMIYOR. Elle doğrulandı: ekranın
 * kendisinde adsız/etiketsiz bir kontrol YOK (bu dosyadaki her alan ya
 * `Form.Item label=` ile ya da AntD'nin kendi erişilebilir adıyla anılıyor);
 * eksik olan yalnız kayıt satırı. Bkz. rapor.
 *
 * ## Neden `YanPencere` + yeni `kaydetMetni` propu
 *
 * Çekmece kabuğu panelin ortak `YanPencere`sini tüketir. Referans düğme adı
 * "Kaydet ve Satışa Aç" ister; `YanPencere`nin footer'ı önceden sabit
 * "Kaydet" basıyordu. Koordinatörün onayıyla `YanPencere`ye opsiyonel
 * `kaydetMetni?: string` propu eklendi (bkz. o dosyanın başı) — tek tüketicisi
 * olan `VaryantPenceresi` bu propu HİÇ geçmiyor ve değişmeden çalışıyor.
 *
 * ## Referanstan BİLİNÇLİ sapmalar (birebir değil, gerekçeli)
 *
 * 1. **KDV Oranı (%) alanı EKLENDİ.** ikas çekmecesinde yok ama
 *    `ProductCreate.tax_rate` sunucuda ZORUNLU ve varsayılanı YOKTUR
 *    (`lib/tax.ts` başı, `schemas/store.py`). Sessiz bir oran yazmak
 *    (`tax_rate: "0.20"` gibi uydurma) CLAUDE.md'nin yasakladığı mock/
 *    placeholder üretim verisi olurdu — bu yüzden alan sorulmadan
 *    atlanmadı, forma eklendi. Aynı `lib/tax.ts::yuzdedenOran` (tek
 *    dönüşüm kaynağı) kullanılır, `UrunFormu` ile birebir aynı kural.
 * 2. **"Stoksuz satmaya izin ver" onay kutusu GÖRSEL OLARAK durur ama
 *    GÖVDEYE HİÇ GİRMEZ.** Backend'de bu kavramın (stok sıfırken satışa
 *    izin veren bir "oversell" bayrağı) karşılığı YOK —
 *    `backend/schemas/store.py`/`store_service.py::create_product`
 *    böyle bir alan okumuyor, `stock` PHYSICAL üründe her zaman 0 ile
 *    kurulup deftere `INITIAL` hareketiyle yazılıyor. Kutuya sahte bir
 *    `stock` değeri (ör. `1`) yazmak UYDURMA VERİ olurdu. Bu yüzden kutu
 *    etkileşimlidir (referansla birebir görünür/işlenir) ama isteğe hiçbir
 *    alan eklemez — gerçek bir "sınırsız satış" sunucu kavramı doğana
 *    kadar bilinçli bir boşluk (rapora yazıldı).
 * 3. **Açıklama düz `Input.TextArea`.** Depoda TipTap tabanlı bir editör
 *    VAR (`components/admin/content/BlogBodyEditor.tsx`) ama Tailwind +
 *    eski admin tasarım diline (`@/components/admin/ui`) bağlı — saf AntD
 *    paneline (bağlayıcı kısıt: "AntD v5 yalnız `panel/`") ithal etmek
 *    iki tasarım dilini karıştırırdı ve `components/admin/**`e dokunma
 *    izni yok ki AntD'ye uyarlansın. Yeni bir TipTap örneği kurmak YENİ
 *    BAĞIMLILIK KULLANIMI demek (paket zaten var ama bu, ikinci, panele
 *    özel bir editör inşası — YAGNI). Sade `TextArea` seçildi.
 * 4. **Kategori boşken "Kaydet ve Satışa Aç" sessizce DRAFT'a düşmez.**
 *    Bu çekmece HER ZAMAN `status: "ACTIVE"` gönderir (ikas'ın "Kaydet ve
 *    Satışa Aç" adı zaten bunu vaat ediyor) — sunucu kuralı ACTIVE için
 *    kategori zorunlu kılıyor (`schemas/store.py`, `UrunFormu`daki aynı
 *    kural). Kategori listesi BOŞSA (Select hiç render edilmez, referans
 *    da boş durumda seçici göstermiyor) gönderim `validateFields()`
 *    SONRASI elle engellenir, kullanıcı alanda görür, sessizce DRAFT'a
 *    düşmez.
 * 5. **"Kategori Ekle"** panelin kendi kategori ekranı henüz yok
 *    (`src/panel/pages/kategoriler` diye bir şey yok) — eski admin'in
 *    çalışan kategori ekranına (`ROUTES.adminStoreCategories`) köprü
 *    kurulur. Yeni bir kategori yönetim ekranı inşa etmek bu paketin
 *    kapsamı DIŞI (CLAUDE.md: yakın özellikleri kendiliğinden yeniden
 *    tasarlama).
 * 6. **Gelişmişe geçerken tip:** referansta tip sorusu YOK. `?tip=basit`
 *    geçilir — varyant eklemek zaten yalnız DÜZENLEME modunda mümkün
 *    (`UrunFormu`daki `varyantliMi` kuralı), yeni kayıtta "varyantlı"
 *    seçmenin quick-create'te bir karşılığı yok.
 *
 * ## Görsel yükleme sırası
 *
 * Uçlar (`uploadProductCover`) `productId` ister — ürün bu ekranda henüz
 * YOK. Bu yüzden seçilen dosya `Kaydet ve Satışa Aç` tıklanana kadar yalnız
 * yerel state'te durur; sıra: `createProduct` başarıyla döner →
 * `message.success` + liste önbelleği geçersiz kılınır → SONRA (varsa)
 * `uploadProductCover(yeniUrun.id, ...)` denenir. Yükleme başarısız olursa
 * ürün YİNE DE kayıtlıdır — kullanıcı bunu ayrı bir uyarıyla görür, akış
 * sessizce yutmaz (bkz. `kaydet()` altındaki ikinci `try/catch`).
 */
import { useState, type ReactNode } from "react";
import {
  App,
  Button,
  Checkbox,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Typography,
  Upload,
  theme,
  type UploadFile,
} from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { YanPencere } from "@/panel/components/YanPencere";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { createProduct, uploadProductCover } from "@/api/store";
import { useCategories } from "@/hooks/useStore";
import { ROUTES } from "@/lib/routes";
import { getErrorDetail } from "@/lib/errors";
import { yuzdedenOran } from "@/lib/tax";
import { compressImage } from "@/lib/compressImage";
import type { ProductCreate } from "@/types";

/**
 * Sunucunun `_read_image` doğrulamasının istemci aynası
 * (`backend/api/routers/store.py::_read_image`) — `MedyaSekmesi.tsx`teki
 * AYNI kontrolün ikinci, bağımsız bir çağrı yerindeki kopyası. O dosyaya
 * dokunma izni yok (helper export edilmiyor), bu yüzden burada TEKRAR
 * yazıldı; sunucu sınırıyla mesajlar BİREBİR aynı.
 */
const MAKS_GORSEL_BAYT = 12 * 1024 * 1024;
function gorselGecersizlikNedeni(file: File): string | null {
  if (file.type && !file.type.startsWith("image/")) return "Yalnızca görsel yüklenebilir.";
  if (file.size > MAKS_GORSEL_BAYT) return "Görsel 12MB sınırını aşıyor.";
  return null;
}

type CekmeceDegerleri = {
  title: string;
  description?: string;
  price: number;
  tax_rate_yuzde: number;
  indirimli_fiyat_isteniyor: boolean;
  compare_at_price?: number | null;
  /** Referansla birebir görünür ama gövdeye girmez — bkz. dosya başı Madde 2. */
  stoksuz_satis: boolean;
  category_id?: number;
};

/** Gri şeritli bölüm başlığı + açıklama satırı — referans §4'ün ortak kalıbı. */
function Bolum({ baslik, aciklama, children }: { baslik: string; aciklama: string; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          background: token.colorFillAlter,
          padding: "8px 12px",
          borderRadius: token.borderRadiusLG,
        }}
      >
        <Typography.Text strong>{baslik}</Typography.Text>
      </div>
      <Typography.Paragraph type="secondary" style={{ margin: "8px 0 16px" }}>
        {aciklama}
      </Typography.Paragraph>
      {children}
    </div>
  );
}

export function UrunOlusturCekmecesi({ acik, kapat }: { acik: boolean; kapat: () => void }) {
  const [form] = Form.useForm<CekmeceDegerleri>();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [secilenDosya, setSecilenDosya] = useState<File | null>(null);
  const [kategoriHatasi, setKategoriHatasi] = useState<string | null>(null);
  const [gorselYukleniyor, setGorselYukleniyor] = useState(false);

  const { data: kategoriler, isPending: kategorilerYukleniyor } = useCategories();
  // Aynı filtre `UrunFormu.tsx`te de var — yalnız yaprak kategoriler
  // seçilebilir (bkz. o dosyadaki aynı yorum). `hooks/**`e dokunma izni
  // olmadığı için paylaşılan bir hook'a çıkarılmadı, iki panel aynı iş
  // kuralını küçük bir tekrarla gösteriyor.
  const secilebilirKategoriler = (kategoriler ?? []).filter(
    (k) =>
      k.is_active !== false &&
      !(kategoriler ?? []).some((cocuk) => cocuk.parent_id === k.id && cocuk.is_active !== false),
  );

  const olusturMutasyonu = useMutation({
    mutationFn: (govde: ProductCreate) => createProduct(govde),
  });

  const indirimliIsteniyor = Form.useWatch("indirimli_fiyat_isteniyor", form);

  function sifirlaVeKapat() {
    form.resetFields();
    setSecilenDosya(null);
    setKategoriHatasi(null);
    kapat();
  }

  async function kaydet() {
    let degerler: CekmeceDegerleri;
    try {
      degerler = await form.validateFields();
    } catch {
      return; // AntD ilk eksik alanı otomatik odaklar/kaydırır.
    }

    // Kategori Select'i hiç mount olmadıysa (liste boş — referansın boş
    // durumu) `validateFields()` bunu YAKALAYAMAZ, çünkü alan formda hiç
    // yok. `status: "ACTIVE"` her zaman gönderildiği için sunucu kuralı
    // (ACTIVE'te kategori zorunlu) burada TAKLİT edilir — sessiz DRAFT'a
    // düşmek yerine gönderim engellenir ve sebep alanda yazılır.
    if (!kategorilerYukleniyor && secilebilirKategoriler.length === 0) {
      setKategoriHatasi("Aktif ürün için kategori zorunludur. Önce bir kategori oluşturun.");
      document.getElementById("urun-olustur-kategori-ekle")?.focus();
      return;
    }
    setKategoriHatasi(null);

    const govde: ProductCreate = {
      title: degerler.title,
      description: degerler.description || undefined,
      kind: "PHYSICAL",
      price: degerler.price,
      compare_at_price: degerler.indirimli_fiyat_isteniyor ? (degerler.compare_at_price ?? null) : null,
      tax_rate: yuzdedenOran(String(degerler.tax_rate_yuzde)).oran,
      status: "ACTIVE",
      category_id: degerler.category_id ?? null,
    };

    let yeniUrun;
    try {
      yeniUrun = await olusturMutasyonu.mutateAsync(govde);
    } catch (hata) {
      message.error(getErrorDetail(hata, "Ürün kaydedilemedi."));
      return;
    }

    message.success("Ürün kaydedildi.");
    qc.invalidateQueries({ queryKey: ["store", "admin", "products"] });

    if (secilenDosya) {
      setGorselYukleniyor(true);
      try {
        await uploadProductCover(yeniUrun.id, await compressImage(secilenDosya));
        qc.invalidateQueries({ queryKey: ["store", "admin", "product", yeniUrun.id] });
      } catch (hata) {
        // Ürün ZATEN kaydedildi — bu ayrı, sessiz KALMAYAN bir uyarı.
        message.warning(
          getErrorDetail(
            hata,
            "Ürün kaydedildi ama görsel yüklenemedi. Düzenleme ekranından tekrar deneyebilirsiniz.",
          ),
        );
      } finally {
        setGorselYukleniyor(false);
      }
    }

    sifirlaVeKapat();
  }

  function gelismiseGec() {
    sifirlaVeKapat();
    navigate(`${ROUTES.adminNewProductNew}?tip=basit`);
  }

  const gorselListesi: UploadFile[] = secilenDosya
    ? [{ uid: "urun-olustur-secilen-gorsel", name: secilenDosya.name, status: "done" }]
    : [];

  return (
    <YanPencere
      acik={acik}
      baslik="Ürün Oluştur"
      kapat={sifirlaVeKapat}
      kaydet={kaydet}
      kaydediyor={olusturMutasyonu.isPending || gorselYukleniyor}
      kaydetMetni="Kaydet ve Satışa Aç"
    >
      <Form form={form} layout="vertical" initialValues={{ indirimli_fiyat_isteniyor: false, stoksuz_satis: false }}>
        <Bolum baslik="Ürün Detayları" aciklama="Ürünün özelliklerini ve önemli bilgilerini buradan yönetin.">
          <Form.Item label="Ürün Görseli">
            <Upload.Dragger
              accept="image/*"
              maxCount={1}
              fileList={gorselListesi}
              beforeUpload={(file) => {
                const nedeni = gorselGecersizlikNedeni(file);
                if (nedeni) {
                  message.error(nedeni);
                  return Upload.LIST_IGNORE;
                }
                setSecilenDosya(file);
                return false;
              }}
              onRemove={() => {
                setSecilenDosya(null);
                return true;
              }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Ürün görselini bu alana sürükleyin veya yüklemek için tıklayın.</p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item label="Ürün Adı" name="title" rules={[{ required: true, message: "Ürün adı zorunludur." }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Açıklama" name="description">
            <Input.TextArea rows={4} />
          </Form.Item>
        </Bolum>

        <Bolum baslik="Satış Ayarları" aciklama="Satışa başlamak için gerekli temel bilgileri girin.">
          <Form.Item label="Satış Fiyatı" name="price" rules={[{ required: true, message: "Fiyat zorunludur." }]}>
            <InputNumber min={0} suffix="₺" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="indirimli_fiyat_isteniyor" valuePropName="checked">
            <Checkbox>İndirimli fiyat girmek istiyorum</Checkbox>
          </Form.Item>
          {indirimliIsteniyor && (
            <Form.Item
              label="Eski Fiyat"
              name="compare_at_price"
              dependencies={["price"]}
              rules={[
                { required: true, message: "İndirimli fiyat için eski fiyat zorunludur." },
                {
                  // Sunucu kuralının aynısı (`schemas/store.py`), `UrunFormu`daki
                  // aynı doğrulama — eski fiyat satış fiyatından büyük olmalı.
                  validator: (_rule, value: number | undefined | null) => {
                    if (value == null) return Promise.resolve();
                    const fiyat = form.getFieldValue("price");
                    if (fiyat != null && Number(value) <= Number(fiyat)) {
                      return Promise.reject(new Error("Eski fiyat satış fiyatından büyük olmalı."));
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <InputNumber min={0} suffix="₺" style={{ width: "100%" }} />
            </Form.Item>
          )}
          <Form.Item
            label="KDV Oranı (%)"
            name="tax_rate_yuzde"
            rules={[
              { required: true, message: "KDV oranı zorunludur." },
              {
                // Tek dönüşüm kaynağı `lib/tax.ts::yuzdedenOran` — `UrunFormu`
                // ile aynı kural (bkz. dosya başı Madde 1).
                validator: (_rule, value: number | undefined) => {
                  if (value == null) return Promise.resolve();
                  const sonuc = yuzdedenOran(String(value));
                  return sonuc.ok ? Promise.resolve() : Promise.reject(new Error(sonuc.hata ?? "Geçersiz KDV oranı."));
                },
              },
            ]}
          >
            <InputNumber min={0} max={99.99} suffix="%" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="stoksuz_satis" valuePropName="checked">
            <Checkbox>Stoksuz satmaya izin ver</Checkbox>
          </Form.Item>
        </Bolum>

        <Bolum baslik="Kategori Seçimi" aciklama="Ürünün ait olduğu kategoriyi belirleyin.">
          {kategorilerYukleniyor ? (
            <YukleniyorDurumu etiket="Kategoriler yükleniyor…" />
          ) : secilebilirKategoriler.length > 0 ? (
            <Form.Item
              label="Kategori"
              name="category_id"
              rules={[{ required: true, message: "Aktif ürün için kategori zorunludur." }]}
            >
              <Select
                placeholder="Kategori seçin"
                options={secilebilirKategoriler.map((k) => ({ value: k.id, label: k.name }))}
              />
            </Form.Item>
          ) : (
            <BosDurumu
              baslik="Henüz kategori oluşturmadınız."
              aciklama="Ürünleri düzenlemek için ilk kategorinizi ekleyin."
              aksiyon={
                <Button id="urun-olustur-kategori-ekle" onClick={() => navigate(ROUTES.adminStoreCategories)}>
                  Kategori Ekle
                </Button>
              }
            />
          )}
          {kategoriHatasi && (
            <div style={{ marginTop: 12 }}>
              <HataDurumu hata={kategoriHatasi} />
            </div>
          )}
        </Bolum>

        <Flex justify="center">
          <Button type="link" onClick={gelismiseGec}>
            Gelişmiş Ürün Eklemeye Geç →
          </Button>
        </Flex>
      </Form>
    </YanPencere>
  );
}
