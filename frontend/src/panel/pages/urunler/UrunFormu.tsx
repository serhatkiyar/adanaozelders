/**
 * Sekmeli ürün formu — oluşturma ve düzenleme aynı bileşende.
 *
 * `?tip` yalnız YENİ kayıt akışında anlamlıdır (Ürün Ekle → Tip Seçimi
 * modalından gelir: "basit" | "varyantli"; eksik/tanınmayan değerde
 * "basit" varsayılır). Düzenlemede tip, ürünün kendi verisinden okunur
 * (varyant grubunda mı). Varyant sekmesinin İÇERİĞİ burada YAZILMAZ —
 * Matris/VaryantPenceresi başka bir görevde bağlanacak; burada yalnız
 * sekmenin görünüp görünmediği ve yer tutucu metin var.
 *
 * `tax_rate` sunucuda ZORUNLU ve varsayılanı YOKTUR (bkz. eski panel
 * `ProductForm.tsx`: "karar veri olarak girilir") — bu form da aynı
 * kuralı korur, sessiz bir KDV varsayımı YAZMAZ.
 *
 * ## Toplu kardeş varyant üretimi (Task 8b)
 *
 * Yalnız DÜZENLEME modunda VE ürün zaten bir varyant grubundaysa
 * (`urun.variants != null`) `VaryantAlanlari` altında "Kardeş Varyant Üret"
 * tetikleyicisi + `VaryantPenceresi` görünür (bkz. karar belgesi
 * `.superpowers/sdd/2026-09-11-panel-paket1-kurulum-kabuk-urunler/
 * task-8-karar-varyant-akisi.md`, Faz 2). Yeni kayıtta `productId` yok —
 * bu akış hiç gösterilmez.
 *
 * ## Stok gerekçesi
 *
 * `backend/services/store_service.py::update_product` stok hedefi mevcut
 * stoktan FARKLIYSA (`stok_delta != 0`) gerekçe kodu ister
 * (`stock_ledger.validate_reason`); boşsa 400. Kurallar ve gerekçe kod
 * sözlüğü `frontend/src/lib/stockMovements.ts`ta zaten var (eski panel
 * `ProductForm.tsx`nin de kullandığı TEK kaynak) — burada YENİDEN
 * YAZILMAZ, tüketilir. Strateji: stok DEĞİŞMEDİYSE `stock` alanı gövdeye
 * hiç girmez (`validateStockEdit(...).submitStock`); değiştiyse hem
 * `stock` hem `stock_reason_code` (gerekirse `stock_note`) birlikte gider.
 * Gerekçe yalnız DÜZENLEMEDE ve stok gerçekten değiştiğinde istenir —
 * oluşturmada ilk stok yazımının gerekçesi sabittir (`INITIAL`).
 */
import { useEffect, useState } from "react";
import { App, Button, Divider, Flex, Form, Input, InputNumber, Select, Typography, type FormInstance } from "antd";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FormPage, type FormBolumu } from "@/panel/components/FormPage";
import { VaryantPenceresi } from "@/panel/pages/urunler/VaryantPenceresi";
import { createProduct, updateProduct } from "@/api/store";
import { useAdminProduct, useCreateVariantGroup, useVariantConfig, useVariantGroups } from "@/hooks/useStore";
import { ROUTES } from "@/lib/routes";
import {
  ADMIN_REASON_OPTIONS,
  requiresNote,
  validateStockEdit,
  type AdminReasonCode,
  type StockEditResult,
} from "@/lib/stockMovements";
import type { ProductCreate, ProductDetailOut, ProductKind, ProductUpdate, VariantGroup } from "@/types";

type UrunFormDegerleri = {
  title: string;
  kind: ProductKind;
  price: number;
  compare_at_price?: number | null;
  /** Formda YÜZDE tutulur, istekte ORAN gider (`tax_rate = deger / 100`). */
  tax_rate_yuzde: number;
  stock?: number | null;
  barcode?: string | null;
  /** Yalnız düzenlemede ve stok değiştiğinde anlamlı; bkz. dosya başı yorumu. */
  stock_reason_code?: AdminReasonCode | null;
  stock_note?: string | null;
  /**
   * Varyant grubu üyeliği — yalnız Varyant sekmesi mount olduğunda
   * (varyantlı akışta) alan kayıtlıdır; sekme hiç açılmadıysa bu üçü
   * `validateFields()` çıktısında hiç YOKTUR (bkz. `guncelleGovdesi`
   * yorumundaki stok örneğiyle aynı AntD Form davranışı).
   */
  variant_group_id?: number | null;
  option1_value?: string | null;
  option2_value?: string | null;
};

function olusturGovdesi(d: UrunFormDegerleri): ProductCreate {
  return {
    title: d.title,
    kind: d.kind,
    price: d.price,
    compare_at_price: d.compare_at_price ?? undefined,
    tax_rate: d.tax_rate_yuzde / 100,
    stock: d.kind === "PHYSICAL" ? (d.stock ?? undefined) : undefined,
    barcode: d.barcode || undefined,
    ...varyantUyelikGovdesi(d),
  };
}

/**
 * Ürün bir varyant grubuna bağlıysa (`variant_group_id` seçiliyse) grup
 * kimliği + bu ürünün kendi eksen değerleri gövdeye eklenir.
 *
 * Bağlı DEĞİLSE (`variant_group_id` boş) iki durum ayrışır:
 *  - Alan formda HİÇ MOUNT OLMADIYSA (`"variant_group_id" in d` yanlış —
 *    Varyant sekmesi hiç açılmadı/bu ürün için hiç yok) hiçbir varyant
 *    alanı gönderilmez; BİLİNÇLİ "dokunulmadı" davranışı (stok örneğiyle
 *    aynı desen, bkz. dosya başı yorumu).
 *  - Alan MOUNT OLDU ama boşsa (kullanıcı grubu Select'ten TEMİZLEDİ)
 *    gruptan çıkış GERÇEKTİR: `variant_group_id`, `option1_value`,
 *    `option2_value` AÇIKÇA `null` gönderilir; `barcode` alanın gerçek
 *    değerini taşır (boşsa `null`, yeni yazıldıysa o değer). Aksi halde
 *    backend `exclude_unset=True` kullandığından (`store_service.py`
 *    ~satır 2070-2078) anahtar gövdede yoksa eski değer korunur, üyelik
 *    hiç yeniden değerlendirilmez ve "Ürün kaydedildi" mesajına rağmen
 *    eski grup + eski eksen değerleri + eski barkod DB'de aynen kalır
 *    (Bulgu 1). Backend option1/option2'yi kendisi temizler
 *    (`store_service.py` ~2102-2113) ama barkodu ETMEZ — CHECK
 *    `ck_products_variant_barcode` yalnız "gruplu üründe barkod NULL
 *    olamaz" yönünü zorlar, tersi serbesttir (`backend/models/store.py`
 *    satır 553-556). Barkod boşsa yine de AÇIKÇA `null` gönderilir:
 *    `VaryantAlanlari`daki grup Select'inin `onChange`'i barkodu zaten
 *    görsel olarak sıfırlıyor (grup değişince/temizlenince eski barkod
 *    artık bu ürünü tanımlamaz) — gövde ekranla TUTARLI olsun, ekran
 *    boşken DB'de sessizce eski barkod kalmasın.
 */
function varyantUyelikGovdesi(d: UrunFormDegerleri) {
  if (d.variant_group_id != null) {
    return {
      variant_group_id: d.variant_group_id,
      option1_value: d.option1_value || undefined,
      option2_value: d.option2_value || undefined,
    };
  }
  if ("variant_group_id" in d) {
    // `barcode` ALANIN GERÇEK DEĞERİNİ taşır: boşsa açıkça `null` (gruptan
    // çıkışta eski barkodun DB'de sessizce kalmaması için), kullanıcı grubu
    // temizledikten SONRA yeni bir barkod yazdıysa O DEĞER. Sabit `null`
    // döndürmek, bu satır `barcode: d.barcode || undefined`ı spread ile
    // ezdiği için kullanıcının yeni yazdığı barkodu sessizce siliyordu.
    return {
      variant_group_id: null,
      option1_value: null,
      option2_value: null,
      barcode: d.barcode || null,
    };
  }
  return {};
}

/**
 * `stokSonuc.submitStock` `false` ise (stok değişmedi) `stock` alanı gövdeye
 * HİÇ girmez — sunucuya "stoğa dokunma" sinyali budur. `true` ise
 * `stokSonuc.payload` hem `stock` hem `stock_reason_code` (gerekirse
 * `stock_note`) taşır; ikisi ayrışırsa sunucu 400 döner (bkz. dosya başı).
 */
function guncelleGovdesi(d: UrunFormDegerleri, stokSonuc: StockEditResult): ProductUpdate {
  return {
    title: d.title,
    price: d.price,
    compare_at_price: d.compare_at_price ?? undefined,
    tax_rate: d.tax_rate_yuzde / 100,
    barcode: d.barcode || undefined,
    ...varyantUyelikGovdesi(d),
    ...(stokSonuc.submitStock ? stokSonuc.payload : {}),
  };
}

/**
 * Sunucudaki gerçek uzunluk sınırı (`backend/schemas/store.py`:
 * `ProductUpdate.barcode` satır 291 ve `VariantMemberFields.barcode` /
 * `VariantMatrixRowIn.barcode` satır 527/578 — hepsi `min_length=4,
 * max_length=32`). İstemci bu sınırı BURADAN okur, uydurmaz; kısa/uzun
 * barkod sunucuya gitmeden reddedilir (Bulgu 3 — önceden yalnız boş
 * olmadığı kontrol ediliyordu, 1-3 karakterlik barkod sunucudan jenerik
 * "Ürün kaydedilemedi." ile geri dönüyordu).
 */
const BARKOD_MIN_UZUNLUK = 4;
const BARKOD_MAX_UZUNLUK = 32;

/**
 * Barkod alanı TEK yerde mount olur (Bulgu 2) — ya `VaryantAlanlari`
 * içinde (ürün varyant grubuna bağlanabiliyorsa) ya da Envanter
 * sekmesinde (bağlanamıyorsa); ikisi aynı render'da birden AKTİF olmaz
 * (`varyantliMi` oturum boyunca sabit, bkz. dosya başı yorumu). Zorunluluk
 * CANLI: `grupSecili` çağıran taraftan `Form.useWatch("variant_group_id")`
 * ile beslenir — grup seçiliyken zorunlu, temizlenince/hiç yokken
 * opsiyonel.
 */
function barkodKurallari(grupSecili: boolean) {
  return [
    { required: grupSecili, message: "Varyant grubundaki ürün için barkod zorunludur." },
    {
      validator: (_: unknown, value: string | null | undefined) => {
        if (!value) return Promise.resolve();
        if (value.length < BARKOD_MIN_UZUNLUK || value.length > BARKOD_MAX_UZUNLUK) {
          return Promise.reject(
            new Error(`Barkod ${BARKOD_MIN_UZUNLUK}-${BARKOD_MAX_UZUNLUK} karakter olmalıdır.`),
          );
        }
        return Promise.resolve();
      },
    },
  ];
}

export function UrunFormu() {
  const [form] = Form.useForm<UrunFormDegerleri>();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  const duzenlemeModu = id != null;
  const idSayi = duzenlemeModu ? Number(id) : undefined;

  const tipParam = searchParams.get("tip");
  const yeniKayitTuru: "basit" | "varyantli" = tipParam === "varyantli" ? "varyantli" : "basit";

  const {
    data: urun,
    isPending: urunYukleniyor,
    isError: urunHataVar,
    refetch: urunuTekrarCek,
  } = useAdminProduct(idSayi);

  // Düzenleme modunda mevcut ürün verisi gelince formu doldur.
  useEffect(() => {
    if (!urun) return;
    form.setFieldsValue({
      title: urun.title,
      kind: urun.kind,
      price: Number(urun.price),
      compare_at_price: urun.compare_at_price != null ? Number(urun.compare_at_price) : undefined,
      tax_rate_yuzde: urun.tax_rate != null ? Number(urun.tax_rate) * 100 : undefined,
      stock: urun.stock ?? undefined,
      barcode: urun.barcode ?? undefined,
      variant_group_id: urun.variant_group_id ?? undefined,
      option1_value: urun.option1_value ?? undefined,
      option2_value: urun.option2_value ?? undefined,
    });
  }, [urun, form]);

  const kaydetMutasyonu = useMutation({
    mutationFn: (govde: ProductCreate | ProductUpdate) =>
      duzenlemeModu
        ? updateProduct(idSayi as number, govde as ProductUpdate)
        : createProduct(govde as ProductCreate),
  });

  async function kaydet() {
    let degerler: UrunFormDegerleri;
    try {
      degerler = await form.validateFields();
    } catch {
      return; // doğrulama hatası: AntD alan altında gösterir
    }

    let stokSonuc: StockEditResult | null = null;
    if (duzenlemeModu) {
      // `degerler` (validateFields() dönüşü) yalnız O AN MOUNT OLMUŞ
      // alanları taşır — Envanter sekmesi hiç açılmadıysa `stock` orada
      // YOKTUR ve `Number(undefined ?? 0)` sahte bir "0'a değişti" algısı
      // üretir. `form.getFieldValue` ise iç depodan okur; sekme hiç
      // açılmasa da `setFieldsValue` ile yazılan gerçek değeri döndürür.
      stokSonuc = validateStockEdit({
        current: Number(urun?.stock ?? 0),
        next: Number(form.getFieldValue("stock") ?? 0),
        reason: (form.getFieldValue("stock_reason_code") ?? null) as AdminReasonCode | null,
        note: form.getFieldValue("stock_note") ?? null,
      });
      if (!stokSonuc.ok) {
        message.error(stokSonuc.error ?? "Stok düzenlemesi geçersiz.");
        return;
      }
    }

    try {
      await kaydetMutasyonu.mutateAsync(
        duzenlemeModu ? guncelleGovdesi(degerler, stokSonuc as StockEditResult) : olusturGovdesi(degerler),
      );
      message.success("Ürün kaydedildi.");
      navigate(ROUTES.adminNewProducts);
    } catch {
      message.error("Ürün kaydedilemedi.");
    }
  }

  // Varyant sekmesi: yeni kayıtta kullanıcı "Varyantlı Ürün" seçtiyse,
  // düzenlemede ürün zaten bir varyant grubundaysa görünür.
  const varyantliMi = duzenlemeModu ? urun?.variants != null : yeniKayitTuru === "varyantli";

  const kindWatch = Form.useWatch("kind", form);
  const efektifTur: ProductKind = duzenlemeModu ? (urun?.kind ?? "PHYSICAL") : (kindWatch ?? "PHYSICAL");

  const stockWatch = Form.useWatch("stock", form);
  const reasonWatch = Form.useWatch("stock_reason_code", form);
  // Yalnız düzenlemede ve stok GERÇEKTEN değiştiğinde gerekçe seçici görünür
  // (eski panelin `stokDegisti` kuralıyla aynı — bkz. `ProductForm.tsx`).
  const stokDegisti =
    duzenlemeModu &&
    efektifTur === "PHYSICAL" &&
    urun != null &&
    Number(stockWatch ?? 0) !== Number(urun.stock ?? 0);

  const bolumler: FormBolumu[] = [
    {
      anahtar: "temel",
      baslik: "Temel Bilgi",
      icerik: (
        <>
          <Form.Item label="Ürün Adı" name="title" rules={[{ required: true, message: "Ürün adı zorunludur." }]}>
            <Input />
          </Form.Item>
          {/* `kind` sunucuda değiştirilemez (DB trigger) — yalnız YENİ kayıtta seçilir. */}
          {!duzenlemeModu && (
            <Form.Item label="Ürün Türü" name="kind" rules={[{ required: true, message: "Ürün türü zorunludur." }]}>
              <Select
                options={[
                  { value: "PHYSICAL", label: "Fiziksel" },
                  { value: "DIGITAL", label: "Dijital" },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item label="Satış Fiyatı" name="price" rules={[{ required: true, message: "Fiyat zorunludur." }]}>
            <InputNumber min={0} suffix="TL" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Eski Fiyat" name="compare_at_price">
            <InputNumber min={0} suffix="TL" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="KDV Oranı (%)"
            name="tax_rate_yuzde"
            rules={[{ required: true, message: "KDV oranı zorunludur." }]}
          >
            {/* Sunucuda `tax_rate` KESİN küçüktür 1 (`ge=0, lt=1`) — yüzde 100
                tam oran 1.0 üretir ve 422 alır; üst sınır bu yüzden 100
                DEĞİL. */}
            <InputNumber min={0} max={99.99} suffix="%" style={{ width: "100%" }} />
          </Form.Item>
        </>
      ),
    },
    {
      anahtar: "envanter",
      baslik: "Envanter",
      icerik: (
        <>
          {efektifTur === "PHYSICAL" && (
            <Form.Item label="Stok" name="stock">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
          )}
          {stokDegisti && (
            <>
              <Form.Item
                label="Stok Gerekçesi"
                name="stock_reason_code"
                rules={[{ required: true, message: "Stok değiştiyse gerekçe zorunludur." }]}
              >
                <Select placeholder="Gerekçe seçin" options={ADMIN_REASON_OPTIONS} />
              </Form.Item>
              {requiresNote((reasonWatch ?? null) as AdminReasonCode | null) && (
                <Form.Item
                  label="Stok Değişikliği Açıklaması"
                  name="stock_note"
                  rules={[{ required: true, message: "“Diğer” gerekçesinde açıklama zorunludur." }]}
                >
                  <Input />
                </Form.Item>
              )}
            </>
          )}
          {/* Bu ürün bir varyant grubuna bağlanabiliyorsa (`varyantliMi`)
              barkod alanı `VaryantAlanlari` içinde, grup seçimine göre
              CANLI zorunlulukla durur (bkz. `barkodKurallari` ve Bulgu 2
              notu orada) — burada TEKRARLANMAZ; aynı `name="barcode"` iki
              yerde birden mount olursa AntD aynı alanı iki kez kaydeder.
              `varyantliMi` oturum boyunca sabittir (bkz. dosya başı) —
              bu iki dal asla aynı anda aktif olmaz. Bu dalda (`!varyantliMi`)
              grup hiç mümkün olmadığından zorunluluk hep `false`tur. */}
          {!varyantliMi && (
            <Form.Item label="Barkod" name="barcode" rules={barkodKurallari(false)}>
              <Input />
            </Form.Item>
          )}
        </>
      ),
    },
  ];

  if (varyantliMi) {
    bolumler.push({
      anahtar: "varyant",
      baslik: "Varyantlar",
      icerik: <VaryantAlanlari form={form} duzenlemeModu={duzenlemeModu} urun={urun} />,
    });
  }

  const baslik = duzenlemeModu
    ? "Ürünü Düzenle"
    : yeniKayitTuru === "varyantli"
      ? "Varyantlı Ürün Ekle"
      : "Basit Ürün Ekle";

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ kind: "PHYSICAL" }}
      disabled={duzenlemeModu && urunYukleniyor}
    >
      <FormPage
        baslik={baslik}
        geriTiklandi={() => navigate(ROUTES.adminNewProducts)}
        kaydet={kaydet}
        kaydediyor={kaydetMutasyonu.isPending}
        bolumler={bolumler}
        hata={duzenlemeModu && urunHataVar ? "Ürün yüklenemedi." : null}
        hataAksiyon={<Button onClick={() => urunuTekrarCek()}>Tekrar dene</Button>}
      />
    </Form>
  );
}

/**
 * Varyant grubu ÜYELİĞİ — var olan bir gruba katılır ya da yeni grup açar,
 * sonra bu ürünün kendi eksen DEĞERLERİ + zorunlu barkodu alınır.
 *
 * Tek istekte tek ürün + tek kombinasyon kaydedilir (bkz. karar belgesi
 * `.superpowers/sdd/2026-09-11-panel-paket1-kurulum-kabuk-urunler/
 * task-8-karar-varyant-akisi.md`). Toplu kardeş matrisi (Task 8b) burada
 * YOK; yalnız düzenleme modunda ürün zaten gruptayken açılacak.
 *
 * Eksen adları (`option1_name`/`option2_name`) `useVariantConfig().axes`
 * KAPALI SÖZLÜĞÜNDEN `Select` ile seçilir — serbest metin girilemez.
 *
 * ## Toplu kardeş üretimi (Task 8b) — KAPI
 *
 * `duzenlemeModu && urun.variants != null` olmadıkça hiç render edilmez:
 * yeni kayıtta `productId` yoktur ve `previewVariantMatrix`/
 * `createVariantMatrix` var olan bir ürün ister (bkz. karar belgesi).
 */
function VaryantAlanlari({
  form,
  duzenlemeModu,
  urun,
}: {
  form: FormInstance<UrunFormDegerleri>;
  duzenlemeModu: boolean;
  urun?: ProductDetailOut;
}) {
  const { message } = App.useApp();
  const { data: config, isPending: configYukleniyor, isError: configHataVar } = useVariantConfig();
  const { data: gruplar, isPending: gruplarYukleniyor, isError: gruplarHataVar } = useVariantGroups();
  const olusturMutasyonu = useCreateVariantGroup();
  const [matrisAcik, setMatrisAcik] = useState(false);

  const groupIdWatch = Form.useWatch("variant_group_id", form);

  const [yeniGrupAcik, setYeniGrupAcik] = useState(false);
  const [yeniBaslik, setYeniBaslik] = useState("");
  const [yeniEksen1, setYeniEksen1] = useState<string | undefined>();
  const [yeniEksen2, setYeniEksen2] = useState<string | undefined>();
  // `createVariantGroup` başarıyla dönen grup, liste yeniden çekilene kadar
  // (invalidate asenkron) `gruplar` içinde henüz YOK olabilir — seçili
  // değerin eksen adlarını hemen göstermek için ayrıca tutulur.
  const [sonOlusturulan, setSonOlusturulan] = useState<VariantGroup | null>(null);

  if (configYukleniyor || gruplarYukleniyor) {
    return <Typography.Text type="secondary">Varyant bilgileri yükleniyor…</Typography.Text>;
  }
  if (configHataVar || gruplarHataVar) {
    return <Typography.Text type="danger">Varyant bilgileri yüklenemedi.</Typography.Text>;
  }

  const tumGruplar =
    sonOlusturulan != null && !(gruplar ?? []).some((g) => g.id === sonOlusturulan.id)
      ? [...(gruplar ?? []), sonOlusturulan]
      : (gruplar ?? []);
  const secilenGrup = tumGruplar.find((g) => g.id === groupIdWatch) ?? null;
  const eksenler = config?.axes ?? [];

  function grupOlustur() {
    if (!yeniBaslik.trim() || !yeniEksen1) return;
    olusturMutasyonu.mutate(
      { title: yeniBaslik.trim(), option1_name: yeniEksen1, option2_name: yeniEksen2 || null },
      {
        onSuccess: (grup) => {
          setSonOlusturulan(grup);
          form.setFieldValue("variant_group_id", grup.id);
          setYeniGrupAcik(false);
          setYeniBaslik("");
          setYeniEksen1(undefined);
          setYeniEksen2(undefined);
          message.success("Varyant grubu oluşturuldu.");
        },
        onError: () => message.error("Varyant grubu oluşturulamadı."),
      },
    );
  }

  return (
    <>
      <Form.Item label="Varyant Grubu" name="variant_group_id">
        <Select
          allowClear
          placeholder="Grup seçin"
          onChange={() => form.setFieldsValue({ option1_value: undefined, option2_value: undefined, barcode: undefined })}
          options={tumGruplar.map((g) => ({
            value: g.id,
            label: `${g.title} (${g.option1_name}${g.option2_name ? ` × ${g.option2_name}` : ""})`,
          }))}
        />
      </Form.Item>
      <Button type="link" style={{ paddingLeft: 0, marginBottom: 12 }} onClick={() => setYeniGrupAcik((v) => !v)}>
        {yeniGrupAcik ? "Vazgeç" : "+ Yeni grup oluştur"}
      </Button>
      {yeniGrupAcik && (
        <Flex vertical gap={8} style={{ maxWidth: 420, marginBottom: 16 }}>
          <div>
            <label htmlFor="yeni-varyant-grubu-baslik">Grup adı</label>
            <Input
              id="yeni-varyant-grubu-baslik"
              placeholder="ör. Kalem Rengi"
              value={yeniBaslik}
              onChange={(e) => setYeniBaslik(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="yeni-varyant-grubu-eksen1">1. eksen</label>
            <Select
              id="yeni-varyant-grubu-eksen1"
              placeholder="1. eksen seçin"
              value={yeniEksen1}
              onChange={setYeniEksen1}
              options={eksenler.map((a) => ({ value: a, label: a }))}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label htmlFor="yeni-varyant-grubu-eksen2">2. eksen (opsiyonel)</label>
            <Select
              id="yeni-varyant-grubu-eksen2"
              allowClear
              placeholder="2. eksen (opsiyonel)"
              value={yeniEksen2}
              onChange={setYeniEksen2}
              options={eksenler.filter((a) => a !== yeniEksen1).map((a) => ({ value: a, label: a }))}
              style={{ width: "100%" }}
            />
          </div>
          <Button
            type="primary"
            loading={olusturMutasyonu.isPending}
            disabled={!yeniBaslik.trim() || !yeniEksen1}
            onClick={grupOlustur}
          >
            Grubu Oluştur
          </Button>
        </Flex>
      )}
      {secilenGrup && (
        <>
          <Form.Item
            label={secilenGrup.option1_name}
            name="option1_value"
            rules={[{ required: true, message: `${secilenGrup.option1_name} zorunludur.` }]}
          >
            <Input />
          </Form.Item>
          {secilenGrup.option2_name && (
            <Form.Item
              label={secilenGrup.option2_name}
              name="option2_value"
              rules={[{ required: true, message: `${secilenGrup.option2_name} zorunludur.` }]}
            >
              <Input />
            </Form.Item>
          )}
        </>
      )}
      {/* Barkod HER ZAMAN mount — `secilenGrup`a bağlı DEĞİL (Bulgu 2).
          Önceki sürümde bu alan yalnız `secilenGrup` doğruyken görünürdü;
          düzenlemede grup TEMİZLENDİĞİNDE (`secilenGrup` artık null) hem
          burası hem Envanter sekmesi (`!varyantliMi` hâlâ false —
          `varyantliMi` oturum başında donuyor, gruba canlı tepki vermez)
          barkodu gizliyor ve kullanıcının barkodu görüp
          düzenleyebileceği hiçbir yer kalmıyordu — sessiz veri hatasının
          kök nedeni buydu. Zorunluluk CANLI `groupIdWatch`a bağlı: grup
          seçiliyken zorunlu, temizlenince opsiyonel. */}
      <Form.Item label="Barkod" name="barcode" rules={barkodKurallari(groupIdWatch != null)}>
        <Input />
      </Form.Item>
      {duzenlemeModu && urun?.variants != null && (
        <>
          <Divider />
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            Bu ürün "{urun.variants.title}" grubunda. Aynı gruba toplu kardeş varyant üretebilirsiniz.
          </Typography.Paragraph>
          <Button onClick={() => setMatrisAcik(true)}>Kardeş Varyant Üret</Button>
          <VaryantPenceresi
            acik={matrisAcik}
            kapat={() => setMatrisAcik(false)}
            productId={urun.id}
            eksen1Adi={urun.variants.option1_name}
            eksen2Adi={urun.variants.option2_name}
          />
        </>
      )}
    </>
  );
}
