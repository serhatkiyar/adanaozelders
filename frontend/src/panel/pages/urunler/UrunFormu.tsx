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
import { App, Button, Checkbox, Divider, Flex, Form, Input, InputNumber, Select, Typography, type FormInstance } from "antd";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FormPage, type FormBolumu } from "@/panel/components/FormPage";
import { HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { MedyaSekmesi } from "@/panel/components/MedyaSekmesi";
import { BlogBodyEditor } from "@/components/admin/content/BlogBodyEditor";
import { ProductManagedAttributes } from "@/components/admin/store/ProductForm";
import { BARKOD_MIN_UZUNLUK, BARKOD_MAX_UZUNLUK } from "@/panel/components/Matris";
import { VaryantPenceresi } from "@/panel/pages/urunler/VaryantPenceresi";
import { createProduct, updateProduct } from "@/api/store";
import {
  useAdminProduct,
  useCategories,
  useCreateVariantGroup,
  useVariantConfig,
  useVariantGroups,
} from "@/hooks/useStore";
import { ROUTES } from "@/lib/routes";
import { getErrorDetail } from "@/lib/errors";
import {
  ADMIN_REASON_OPTIONS,
  requiresNote,
  validateStockEdit,
  type AdminReasonCode,
  type StockEditResult,
} from "@/lib/stockMovements";
import { orandanYuzde, yuzdedenOran } from "@/lib/tax";
import { aciklamaEditorBicimi } from "@/lib/storeProductForm";
import type {
  ProductCreate,
  ProductDetailOut,
  ProductKind,
  ProductStatus,
  ProductUpdate,
  VariantGroup,
} from "@/types";

/**
 * Durum seçenekleri — `ProductStatus`ün GERÇEK değerlerinden (uydurma yok).
 * `ProductCreate.status` yalnız ACTIVE/HIDDEN/DRAFT kabul eder
 * (`backend/schemas/store.py:328`); `PENDING` (eğitmen dijital ürününün admin
 * onayı beklediği durum) yalnız `ProductUpdate.status`ta var — admin yeni bir
 * ürünü PENDING olarak YARATAMAZ, bu yüzden iki liste ayrı.
 */
const DURUM_SECENEKLERI: { value: ProductStatus; label: string }[] = [
  { value: "ACTIVE", label: "Yayında" },
  { value: "HIDDEN", label: "Gizli" },
  { value: "DRAFT", label: "Taslak" },
];
const DURUM_SECENEKLERI_DUZENLEME: { value: ProductStatus; label: string }[] = [
  ...DURUM_SECENEKLERI,
  { value: "PENDING", label: "Onay Bekliyor" },
];

type UrunFormDegerleri = {
  title: string;
  description?: string | null;
  brand?: string | null;
  kind: ProductKind;
  price: number;
  compare_at_price?: number | null;
  /** Formda YÜZDE tutulur, istekte ORAN gider (bkz. `lib/tax.ts`). */
  tax_rate_yuzde: number;
  status: ProductStatus;
  category_id?: number | null;
  stock?: number | null;
  barcode?: string | null;
  supplier_backed?: boolean;
  author?: string | null;
  publisher?: string | null;
  isbn?: string | null;
  page_count?: number | null;
  dimensions?: string | null;
  publication_year?: number | null;
  edition?: string | null;
  language?: string | null;
  cover_type?: string | null;
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
  variant_sort?: number | null;
};

const bosNull = (deger: string | null | undefined) => {
  const temiz = deger?.trim();
  return temiz ? temiz : null;
};

function kunyeGovdesi(d: UrunFormDegerleri) {
  return {
    description: bosNull(d.description),
    brand: bosNull(d.brand),
    author: bosNull(d.author),
    publisher: bosNull(d.publisher),
    isbn: bosNull(d.isbn),
    page_count: d.page_count ?? null,
    dimensions: bosNull(d.dimensions),
    publication_year: d.publication_year ?? null,
    edition: bosNull(d.edition),
    language: bosNull(d.language),
    cover_type: bosNull(d.cover_type),
    ...(d.kind === "PHYSICAL" ? { supplier_backed: d.supplier_backed === true } : {}),
  };
}

function AciklamaEditorAlani({
  value,
  onChange,
  id,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  disabled,
}: {
  value?: string;
  onChange?: (html: string) => void;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
}) {
  return (
    <BlogBodyEditor
      value={value ?? ""}
      onChange={(html) => onChange?.(html)}
      id={id}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      disabled={disabled}
    />
  );
}

function olusturGovdesi(d: UrunFormDegerleri): ProductCreate {
  return {
    title: d.title,
    kind: d.kind,
    price: d.price,
    compare_at_price: compareAtPriceGovdesi(d),
    tax_rate: yuzdedenOran(String(d.tax_rate_yuzde)).oran,
    stock: d.kind === "PHYSICAL" ? (d.stock ?? undefined) : undefined,
    barcode: d.barcode || undefined,
    // `status` burada YENİ kayıt formunun kendi alanı — Select seçenekleri
    // yalnız DURUM_SECENEKLERI'nden gelir (PENDING orada YOK, bkz. dosya
    // başı), bu yüzden değer her zaman `ProductCreate.status`ün kabul ettiği
    // üç değerden biridir; tip daraltması burada güvenlidir.
    status: d.status as ProductCreate["status"],
    category_id: d.category_id ?? null,
    ...kunyeGovdesi(d),
    ...varyantUyelikGovdesi(d),
  };
}

/**
 * `compare_at_price` — Madde 2 (dördüncü sessiz veri kaybı): bu alan
 * `title`/`price` gibi HER ZAMAN gövdededir, "dokunulmadı" durumu (stok/
 * varyant alanlarının aksine) yoktur. Ama boşsa `undefined` DEĞİL açıkça
 * `null` gider: `undefined` JSON.stringify'da anahtarı düşürür, backend
 * `exclude_unset=True` kullandığından (güncellemede) eski indirim fiyatı
 * sessizce DB'de kalırdı. `null` ise "bu alanı temizle" niyetini AÇIKÇA
 * taşır — sunucu `Decimal | None` kabul ediyor (`schemas/store.py:347`).
 */
function compareAtPriceGovdesi(d: UrunFormDegerleri): number | null {
  return d.compare_at_price ?? null;
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
      variant_sort: d.variant_sort ?? 0,
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
      variant_sort: 0,
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
    compare_at_price: compareAtPriceGovdesi(d),
    tax_rate: yuzdedenOran(String(d.tax_rate_yuzde)).oran,
    barcode: d.barcode || undefined,
    status: d.status,
    category_id: d.category_id ?? null,
    ...kunyeGovdesi(d),
    ...varyantUyelikGovdesi(d),
    ...(stokSonuc.submitStock ? stokSonuc.payload : {}),
  };
}

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
      description: aciklamaEditorBicimi(urun.description),
      brand: urun.brand ?? undefined,
      kind: urun.kind,
      price: Number(urun.price),
      compare_at_price: urun.compare_at_price != null ? Number(urun.compare_at_price) : undefined,
      // `orandanYuzde` kayan nokta artığını kapatır (bkz. `lib/tax.ts`) —
      // eski `Number(urun.tax_rate) * 100` "%7" ürününü "7.000000000000001"
      // olarak gösteriyordu (Madde 3).
      tax_rate_yuzde: urun.tax_rate != null ? Number(orandanYuzde(urun.tax_rate)) : undefined,
      status: (urun.status as ProductStatus | undefined) ?? "DRAFT",
      category_id: urun.category_id ?? undefined,
      stock: urun.stock ?? undefined,
      barcode: urun.barcode ?? undefined,
      supplier_backed: urun.supplier_backed === true,
      author: urun.author ?? undefined,
      publisher: urun.publisher ?? undefined,
      isbn: urun.isbn ?? undefined,
      page_count: urun.page_count ?? undefined,
      dimensions: urun.dimensions ?? undefined,
      publication_year: urun.publication_year ?? undefined,
      edition: urun.edition ?? undefined,
      language: urun.language ?? undefined,
      cover_type: urun.cover_type ?? undefined,
      variant_group_id: urun.variant_group_id ?? undefined,
      option1_value: urun.option1_value ?? undefined,
      option2_value: urun.option2_value ?? undefined,
      variant_sort: urun.variant_sort ?? 0,
    });
  }, [urun, form]);

  const { data: kategoriler, isPending: kategorilerYukleniyor } = useCategories();
  // Eski panelin deseni (`components/admin/store/ProductForm.tsx`): yalnız
  // YAPRAK kategoriler seçilebilir — ürün, alt kategorisi olan bir üst
  // kategoriye doğrudan bağlanmaz. İki panel aynı iş kuralını göstersin diye
  // aynı filtre.
  const secilebilirKategoriler = (kategoriler ?? []).filter(
    (k) =>
      k.is_active !== false &&
      !(kategoriler ?? []).some((cocuk) => cocuk.parent_id === k.id && cocuk.is_active !== false),
  );

  const kaydetMutasyonu = useMutation({
    mutationFn: (govde: ProductCreate | ProductUpdate) =>
      duzenlemeModu
        ? updateProduct(idSayi as number, govde as ProductUpdate)
        : createProduct(govde as ProductCreate),
  });

  async function kaydet() {
    let degerler: UrunFormDegerleri;
    try {
      const dogrulanan = await form.validateFields();
      // AntD Tabs yalnız etkin bölümü mount eder. `validateFields()` bu yüzden
      // henüz açılmamış, fakat ürün yüklenirken `setFieldsValue()` ile iç
      // depoya yazılmış künye/tedarik değerlerini döndürmez. Yalnız bu yeni,
      // opsiyonel alanları iç depodan tamamla; varyant üyeliği için mevcut
      // "sekme açılmadıysa gövdeye dokunma" sözleşmesini değiştirme.
      degerler = {
        ...dogrulanan,
        kind: form.getFieldValue("kind"),
        description: form.getFieldValue("description"),
        brand: form.getFieldValue("brand"),
        supplier_backed: form.getFieldValue("supplier_backed"),
        author: form.getFieldValue("author"),
        publisher: form.getFieldValue("publisher"),
        isbn: form.getFieldValue("isbn"),
        page_count: form.getFieldValue("page_count"),
        dimensions: form.getFieldValue("dimensions"),
        publication_year: form.getFieldValue("publication_year"),
        edition: form.getFieldValue("edition"),
        language: form.getFieldValue("language"),
        cover_type: form.getFieldValue("cover_type"),
      };
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
    } catch (hata) {
      // Madde 4: sunucunun ALANI OLMAYAN 409/422 mesajları ("indirimli fiyat
      // eski fiyattan küçük olmalı" vb.) burada jenerik metne eziliyordu —
      // `getErrorDetail` sunucu `detail`ini KORUYARAK gösterir, yoksa yedek
      // Türkçe metne düşer.
      message.error(getErrorDetail(hata, "Ürün kaydedilemedi."));
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
          <Form.Item label="Marka" name="brand">
            <Input placeholder="ör. Faber-Castell" />
          </Form.Item>
          <Form.Item label="Açıklama" name="description" style={{ gridColumn: "1 / -1" }}>
            <AciklamaEditorAlani />
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
          {/* Madde 1 (kritik): panelde yaratılan ürün `status`/`category_id`
              hiç gitmediği için sunucuda `status` DRAFT varsayılana düşüyor
              ve yönetici ürünü asla yayına alamıyordu (bkz. `schemas/store.py`
              satır 328/339). Etiketler `ProductStatus`ün gerçek değerleri. */}
          <Form.Item label="Durum" name="status" rules={[{ required: true, message: "Durum zorunludur." }]}>
            <Select options={duzenlemeModu ? DURUM_SECENEKLERI_DUZENLEME : DURUM_SECENEKLERI} />
          </Form.Item>
          <Form.Item
            label="Kategori"
            name="category_id"
            dependencies={["status"]}
            rules={[
              {
                validator: (_rule, value: number | undefined) => {
                  // Sunucu kuralının aynısı (`schemas/store.py:339`): yalnız
                  // ACTIVE'te kategori zorunlu — HIDDEN/DRAFT/PENDING'te
                  // kategori boş kalabilir.
                  if (form.getFieldValue("status") === "ACTIVE" && value == null) {
                    return Promise.reject(new Error("Aktif ürün için kategori zorunludur."));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Select
              allowClear
              placeholder="Kategori seçin"
              loading={kategorilerYukleniyor}
              options={secilebilirKategoriler.map((k) => ({ value: k.id, label: k.name }))}
            />
          </Form.Item>
          <Form.Item label="Satış Fiyatı" name="price" rules={[{ required: true, message: "Fiyat zorunludur." }]}>
            <InputNumber min={0} suffix="TL" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="Eski Fiyat"
            name="compare_at_price"
            dependencies={["price"]}
            rules={[
              {
                // Sunucu kuralının aynısı (`schemas/store.py:336`): eski
                // fiyat satış fiyatından büyük olmalı (indirim iddiası).
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
            <InputNumber min={0} suffix="TL" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="KDV Oranı (%)"
            name="tax_rate_yuzde"
            rules={[
              { required: true, message: "KDV oranı zorunludur." },
              {
                // `lib/tax.ts::yuzdedenOran` TEK kaynak — kendi dönüşümü
                // yazılmaz (Madde 3). Aynı fonksiyon `oran`ı 4 ondalığa
                // yuvarlar, `decimal_places=4` sınırını aşan 422'yi de önler.
                validator: (_rule, value: number | undefined) => {
                  if (value == null) return Promise.resolve();
                  const sonuc = yuzdedenOran(String(value));
                  return sonuc.ok ? Promise.resolve() : Promise.reject(new Error(sonuc.hata ?? "Geçersiz KDV oranı."));
                },
              },
            ]}
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
            <>
              <Form.Item label="Stok" name="stock">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                name="supplier_backed"
                valuePropName="checked"
                style={{ gridColumn: "1 / -1" }}
              >
                <Checkbox>Kendi stoğum bittiğinde bağlı tedarikçinin stoğunu vitrinde kullan</Checkbox>
              </Form.Item>
            </>
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
    {
      anahtar: "kunye",
      baslik: "Ürün Bilgileri",
      icerik: (
        <>
          <Form.Item label="Yazar" name="author"><Input /></Form.Item>
          <Form.Item label="Yayınevi" name="publisher"><Input /></Form.Item>
          <Form.Item label="ISBN / Barkod" name="isbn"><Input /></Form.Item>
          <Form.Item
            label="Sayfa Sayısı"
            name="page_count"
            rules={[{ type: "number", min: 1, message: "Sayfa sayısı sıfırdan büyük olmalı." }]}
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Ebat" name="dimensions"><Input placeholder="ör. 13,5 × 21 cm" /></Form.Item>
          <Form.Item
            label="Basım Yılı"
            name="publication_year"
            rules={[{ type: "number", min: 1, message: "Basım yılı sıfırdan büyük olmalı." }]}
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Baskı" name="edition"><Input placeholder="ör. 3. baskı" /></Form.Item>
          <Form.Item label="Dil" name="language"><Input /></Form.Item>
          <Form.Item label="Kapak Tipi" name="cover_type"><Input /></Form.Item>
        </>
      ),
    },
    ...(duzenlemeModu && idSayi != null
      ? [{
          anahtar: "ozellikler",
          baslik: "Yönetilen Özellikler",
          icerik: <ProductManagedAttributes productId={idSayi} />,
        } satisfies FormBolumu]
      : []),
    {
      // Paket 2'nin ilk işi (bkz. dosya başı yorumu) — yeni kayıtta henüz
      // `productId` yoktur (`idSayi` yalnız düzenlemede tanımlı, bkz.
      // `duzenlemeModu`), `MedyaSekmesi` bu durumda kendi kapısını gösterir
      // (aynı desen varyant sekmesindeki `productId` kapısıyla tutarlı).
      anahtar: "medya",
      baslik: "Medya",
      icerik: <MedyaSekmesi productId={idSayi} urun={urun} />,
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
      initialValues={{ kind: "PHYSICAL", status: "DRAFT", supplier_backed: false, variant_sort: 0 }}
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
  const {
    data: config,
    isPending: configYukleniyor,
    isError: configHataVar,
    refetch: configTekrarCek,
  } = useVariantConfig();
  const {
    data: gruplar,
    isPending: gruplarYukleniyor,
    isError: gruplarHataVar,
    refetch: gruplarTekrarCek,
  } = useVariantGroups();
  const olusturMutasyonu = useCreateVariantGroup();
  const [matrisAcik, setMatrisAcik] = useState(false);

  const groupIdWatch = Form.useWatch("variant_group_id", form);

  const [yeniGrupAcik, setYeniGrupAcik] = useState(false);
  const [yeniBaslik, setYeniBaslik] = useState("");
  const [yeniEksen1, setYeniEksen1] = useState<string | undefined>();
  const [yeniEksen2, setYeniEksen2] = useState<string | undefined>();
  // Yeni grup formunun gönderim hatası (kilitli karar: gönder düğmesi
  // geçerlilikle kapanmaz — bkz. `grupOlustur` ve İP-A8 gönder düğmesi
  // nöbetçisi `gecerlilik-borc` kaydı).
  const [yeniGrupHatasi, setYeniGrupHatasi] = useState<string | null>(null);
  // `createVariantGroup` başarıyla dönen grup, liste yeniden çekilene kadar
  // (invalidate asenkron) `gruplar` içinde henüz YOK olabilir — seçili
  // değerin eksen adlarını hemen göstermek için ayrıca tutulur.
  const [sonOlusturulan, setSonOlusturulan] = useState<VariantGroup | null>(null);

  // Panelin geri kalanıyla AYNI dil (bkz. `panel/components/Durum.tsx`) —
  // önceden bu iki durum düz `Typography.Text` ile yazılıyordu ve hata
  // durumunda "Tekrar dene" aksiyonu hiç yoktu (denetim bulgusu).
  if (configYukleniyor || gruplarYukleniyor) {
    return <YukleniyorDurumu etiket="Varyant bilgileri yükleniyor…" />;
  }
  if (configHataVar || gruplarHataVar) {
    return (
      <HataDurumu
        hata="Varyant bilgileri yüklenemedi."
        hataAksiyon={
          <Button
            onClick={() => {
              configTekrarCek();
              gruplarTekrarCek();
            }}
          >
            Tekrar dene
          </Button>
        }
      />
    );
  }

  const tumGruplar =
    sonOlusturulan != null && !(gruplar ?? []).some((g) => g.id === sonOlusturulan.id)
      ? [...(gruplar ?? []), sonOlusturulan]
      : (gruplar ?? []);
  const secilenGrup = tumGruplar.find((g) => g.id === groupIdWatch) ?? null;
  const eksenler = config?.axes ?? [];

  function grupOlustur() {
    // ── KİLİTLİ KARAR: gönder düğmesi geçerlilikle KAPANMAZ ──
    //
    // Ölü bir düğme "neden çalışmıyor" sorusunun cevabını hiçbir yere
    // yazmaz. Düğme basılır, gönderim yapılmaz, sebep alanda görünür ve
    // odak ilk eksik alana taşınır (`VariantMatrixPanel::uret()` /
    // `KargolaSatiri` ile aynı desen).
    if (!yeniBaslik.trim()) {
      setYeniGrupHatasi("Grup adı zorunludur.");
      document.getElementById("yeni-varyant-grubu-baslik")?.focus();
      return;
    }
    if (!yeniEksen1) {
      setYeniGrupHatasi("1. eksen zorunludur.");
      document.getElementById("yeni-varyant-grubu-eksen1")?.focus();
      return;
    }
    setYeniGrupHatasi(null);
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
        onError: (hata) => message.error(getErrorDetail(hata, "Varyant grubu oluşturulamadı.")),
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
              onChange={(e) => {
                setYeniBaslik(e.target.value);
                setYeniGrupHatasi(null);
              }}
            />
          </div>
          <div>
            <label htmlFor="yeni-varyant-grubu-eksen1">1. eksen</label>
            <Select
              id="yeni-varyant-grubu-eksen1"
              placeholder="1. eksen seçin"
              value={yeniEksen1}
              onChange={(v) => {
                setYeniEksen1(v);
                setYeniGrupHatasi(null);
              }}
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
          <Button type="primary" loading={olusturMutasyonu.isPending} onClick={grupOlustur}>
            Grubu Oluştur
          </Button>
          {yeniGrupHatasi && <HataDurumu hata={yeniGrupHatasi} />}
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
          <Form.Item label="Varyant Sırası" name="variant_sort">
            <InputNumber min={0} precision={0} style={{ width: "100%" }} />
          </Form.Item>
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
