// Ürün detay sayfasının schema.org yapılandırılmış verisi.
//
// NEDEN AYRI MODÜL: markup daha önce JSX'in içine gömülüydü ve test
// edilemiyordu. Google'ın yapılandırılmış veri politikası, markup'taki her
// değerin sayfada GÖRÜNEN değerle birebir aynı olmasını şart koşar; görünmeyen
// fiyat/puan işaretlemek manuel işlem sebebidir. Saf fonksiyon olunca bu
// tutarlılık birim testiyle kanıtlanabiliyor.
//
// Kapsam dışı bırakılan alanlar ve gerekçeleri:
//   `priceValidUntil` — gerçek bir kampanya bitiş tarihimiz yok. Uydurma bir
//   tarih yazmak hem veri uydurmaktır hem de süresi dolduğunda zengin sonucu
//   DÜŞÜRÜR. Kampanya modeli geldiğinde eklenecek.

import { absoluteUrl } from "@/lib/seo";
import { CAYMA_HAKKI_GUN } from "@/lib/storePolicy";
import { ROUTES } from "@/lib/routes";
import type { ProductCategory, ProductDetailOut } from "@/types";

type Json = Record<string, unknown>;

export interface ProductJsonLdInput {
  product: ProductDetailOut;
  /** Sayfada gösterilen galeri (kapak + ek görseller), sırasıyla. */
  gallery: string[];
  /** Kök → mevcut kategori zinciri (breadcrumb ile AYNI kaynak). */
  categoryTrail: ProductCategory[];
  /** Ürünün kanonik path'i, örn. "/magaza/urun/fosforlu-pembe". */
  canonicalPath: string;
  /** Mağaza kökü, örn. "/magaza". */
  storePath: string;
  /** Kategori linki üreteci — breadcrumb'daki linkle aynı olmalı. */
  categoryHref: (categoryId: number) => string;
  /** Künye alanı var mı — Product + Book çoklu tipini bu belirler. */
  isBook: boolean;
  /**
   * Sayfada GÖSTERİLEN kargo ücreti (TL) ve ücretsiz kargo eşiği.
   *
   * Markup'a giren tutar ekranda yazanla birebir aynı olmak zorunda: Google'ın
   * yapılandırılmış veri politikası ayrışmayı manuel işlem sebebi sayar.
   * Dijital üründe `null` geçilir — gönderi yoktur, `shippingDetails` de
   * yazılmaz.
   */
  shippingRate: number | null;
}

/** EAN-13/GTIN-13 yalnız tam 13 haneli rakam dizisidir. Barkod alanı serbest
 *  metin olabildiği için (kısa kodlar, iç kodlar) burada dar süzülür: yanlış
 *  GTIN bildirmek eksik bildirmekten kötüdür. */
function gtin13(barcode: string | null | undefined): string | undefined {
  const b = (barcode ?? "").trim();
  return /^\d{13}$/.test(b) ? b : undefined;
}

function bookProperties(p: ProductDetailOut): Json {
  return {
    ...(p.author ? { author: { "@type": "Person", name: p.author } } : {}),
    ...(p.publisher ? { publisher: p.publisher } : {}),
    ...(p.isbn ? { isbn: p.isbn } : {}),
    ...(p.page_count ? { numberOfPages: p.page_count } : {}),
    ...(p.language ? { inLanguage: p.language } : {}),
    ...(p.edition ? { bookEdition: p.edition } : {}),
    ...(p.publication_year ? { datePublished: String(p.publication_year) } : {}),
  };
}

/** Ürün düğümü — Product (künye doluysa Product + Book). */
export function buildProductNode(input: ProductJsonLdInput): Json {
  const { product: p, gallery, canonicalPath, isBook } = input;
  const url = absoluteUrl(canonicalPath);
  const gtin = gtin13(p.barcode);

  return {
    "@context": "https://schema.org",
    "@type": isBook ? ["Product", "Book"] : "Product",
    name: p.title,
    description: p.description ?? undefined,
    image: gallery,
    url,
    ...(p.sku ? { sku: p.sku } : {}),
    ...(gtin ? { gtin13: gtin } : {}),
    ...(isBook ? bookProperties(p) : {}),
    offers: {
      "@type": "Offer",
      price: Number(p.price),
      priceCurrency: p.currency,
      url,
      itemCondition: "https://schema.org/NewCondition",
      availability: p.in_stock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      // Dijital üründe gönderi YOKTUR: `shippingDetails` yazmak, olmayan bir
      // kargo ücreti bildirmek olurdu.
      ...(input.shippingRate !== null
        ? {
            shippingDetails: shippingDetails(input.shippingRate),
            hasMerchantReturnPolicy: returnPolicy(),
          }
        : {}),
    },
    ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
    ...(p.rating_count > 0 && p.rating_average
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: p.rating_average.toFixed(1),
            reviewCount: p.rating_count,
          },
        }
      : {}),
  };
}

/**
 * schema.org'un `variesBy` için TANIDIĞI eksenler.
 *
 * Liste kapalıdır: color, size, suggestedAge, suggestedGender, material,
 * pattern. Bizim sekiz eksenimizin yalnız ikisi karşılık buluyor. "Kapak
 * Tipi", "Gramaj", "Uç Kalınlığı" gibi eksenleri zorla `material`/`pattern`a
 * eşlemek YANLIŞ veri bildirmek olurdu; onlar `variesBy`a girmez, varyantın
 * `additionalProperty`si olarak markup'ta yine görünür.
 */
const VARIES_BY_ESLEMESI: Record<string, string> = {
  Renk: "https://schema.org/color",
  Ebat: "https://schema.org/size",
};

/** Kargo ayrıntısı — YALNIZ fiziksel üründe ve ekrandaki tutarla aynı. */
function shippingDetails(rate: number): Json {
  return {
    "@type": "OfferShippingDetails",
    shippingRate: {
      "@type": "MonetaryAmount",
      value: rate,
      currency: "TRY",
    },
    shippingDestination: {
      "@type": "DefinedRegion",
      addressCountry: "TR",
    },
  };
}

/** İade politikası — süre `CAYMA_HAKKI_GUN` ile AYNI sabitten. */
function returnPolicy(): Json {
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "TR",
    returnPolicyCategory:
      "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: CAYMA_HAKKI_GUN,
  };
}

/**
 * Varyant grubu düğümü — grup üyesi üründe `Product` yerine bunu bildiririz.
 *
 * Neden gerekli: her varyant ayrı bir URL olduğu için Google, aralarındaki
 * ilişkiyi kendiliğinden kuramaz ve aynı ürünün sekiz sayfasını sekiz ayrı
 * ürün sanar. `ProductGroup` + `hasVariant` bu ilişkiyi açıkça bildirir.
 *
 * Grupsuz üründe `null` döner ve çağıran düz `Product` düğümünü kullanır.
 */
export function buildProductGroupNode(input: ProductJsonLdInput): Json | null {
  const { product: p } = input;
  const grup = p.variants;
  if (!grup || grup.members.length < 2) return null;

  const variesBy = [grup.option1_name, grup.option2_name]
    .filter((ad): ad is string => !!ad)
    .map((ad) => VARIES_BY_ESLEMESI[ad])
    .filter(Boolean);

  return {
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    name: grup.title,
    productGroupID: String(grup.group_id),
    url: absoluteUrl(input.storePath),
    ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
    ...(variesBy.length ? { variesBy } : {}),
    hasVariant: grup.members.map((m) => ({
      "@type": "Product",
      name: m.title,
      ...(m.sku ? { sku: m.sku } : {}),
      ...(m.cover_url ? { image: m.cover_url } : {}),
      // Eksen değerleri: `variesBy`a giremeyenler de burada görünür.
      additionalProperty: [
        [grup.option1_name, m.option1_value] as const,
        [grup.option2_name, m.option2_value] as const,
      ]
        .filter(([ad, deger]) => !!ad && !!deger)
        .map(([ad, deger]) => ({
          "@type": "PropertyValue",
          name: ad,
          value: deger,
        })),
      offers: {
        "@type": "Offer",
        price: Number(m.price),
        priceCurrency: p.currency,
        url: absoluteUrl(ROUTES.storeProduct(m.slug)),
        itemCondition: "https://schema.org/NewCondition",
        availability: m.in_stock
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      },
    })),
  };
}

/** Kırıntı yolu düğümü — ekranda çizilen breadcrumb ile aynı zincirden.
 *  Google en az 2 öğe ister; son öğede `item` bilinçli olarak verilmez
 *  (mevcut sayfa kendine link vermez). */
export function buildBreadcrumbNode(input: ProductJsonLdInput): Json {
  const { product, categoryTrail, storePath, categoryHref } = input;
  const items: Json[] = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Mağaza",
      item: absoluteUrl(storePath),
    },
    ...categoryTrail.map((c, i) => ({
      "@type": "ListItem",
      position: i + 2,
      name: c.name,
      item: absoluteUrl(categoryHref(c.id)),
    })),
    {
      "@type": "ListItem",
      position: categoryTrail.length + 2,
      name: product.title,
    },
  ];

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

/** Sayfanın tüm yapılandırılmış verisi, tek dizide. */
export function buildProductJsonLd(input: ProductJsonLdInput): Json[] {
  const grup = buildProductGroupNode(input);
  return [
    buildProductNode(input),
    ...(grup ? [grup] : []),
    buildBreadcrumbNode(input),
  ];
}
