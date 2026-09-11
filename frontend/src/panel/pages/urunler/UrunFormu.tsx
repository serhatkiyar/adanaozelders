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
import { App, Button, Flex, Form, Input, InputNumber, Select, Typography, type FormInstance } from "antd";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FormPage, type FormBolumu } from "@/panel/components/FormPage";
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
import type { ProductCreate, ProductKind, ProductUpdate, VariantGroup } from "@/types";

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
 * kimliği + bu ürünün kendi eksen değerleri gövdeye eklenir. Bağlı
 * DEĞİLSE hiçbir varyant alanı gönderilmez — sunucu tarafında grupsuz
 * ürün için bu alanlar anlamsızdır.
 */
function varyantUyelikGovdesi(d: UrunFormDegerleri) {
  if (d.variant_group_id == null) return {};
  return {
    variant_group_id: d.variant_group_id,
    option1_value: d.option1_value || undefined,
    option2_value: d.option2_value || undefined,
  };
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
          {/* Varyant grubuna bağlı üründe barkod alanı Varyant sekmesinde,
              ZORUNLU olarak durur (bkz. `VaryantAlanlari`) — burada
              tekrarlanmaz; aynı `name="barcode"` iki sekmede birden
              mount olursa AntD aynı alanı iki kez kaydeder ve testte
              "Barkod" etiketi belirsizleşir. */}
          {!varyantliMi && (
            <Form.Item label="Barkod" name="barcode">
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
      icerik: <VaryantAlanlari form={form} />,
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
 */
function VaryantAlanlari({ form }: { form: FormInstance<UrunFormDegerleri> }) {
  const { message } = App.useApp();
  const { data: config, isPending: configYukleniyor, isError: configHataVar } = useVariantConfig();
  const { data: gruplar, isPending: gruplarYukleniyor, isError: gruplarHataVar } = useVariantGroups();
  const olusturMutasyonu = useCreateVariantGroup();

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
          <Form.Item
            label="Barkod"
            name="barcode"
            rules={[{ required: true, message: "Varyant grubundaki ürün için barkod zorunludur." }]}
          >
            <Input />
          </Form.Item>
        </>
      )}
    </>
  );
}
