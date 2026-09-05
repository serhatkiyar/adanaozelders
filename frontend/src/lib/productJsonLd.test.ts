import { describe, expect, it } from "vitest";

import {
  buildBreadcrumbNode,
  buildProductGroupNode,
  buildProductJsonLd,
  buildProductNode,
  type ProductJsonLdInput,
} from "./productJsonLd";
import { CAYMA_HAKKI_GUN } from "./storePolicy";
import type { ProductCategory, ProductDetailOut, ProductVariants } from "@/types";

// `absoluteUrl` VITE_SITE_URL yoksa `window.location.origin` kullanır; jsdom'da
// bu "http://localhost:3000"dur. Testler tam URL'e değil, sonundaki path'e
// bakar — böylece ortam değişkeni testleri kırmaz.

function urun(over: Partial<ProductDetailOut> = {}): ProductDetailOut {
  return {
    id: 7,
    slug: "fosforlu-pembe",
    title: "Fosforlu Kalem, Pembe",
    kind: "PHYSICAL",
    seller_type: "PLATFORM",
    price: "34.90",
    currency: "TRY",
    in_stock: true,
    rating_count: 0,
    images: [],
    ...over,
  } as ProductDetailOut;
}

const kategoriler: ProductCategory[] = [
  { id: 1, slug: "kirtasiye", name: "Kırtasiye", sort_order: 0 } as ProductCategory,
  { id: 4, slug: "kalemler", name: "Kalemler", sort_order: 0 } as ProductCategory,
];

function girdi(over: Partial<ProductJsonLdInput> = {}): ProductJsonLdInput {
  return {
    product: urun(),
    gallery: ["/a.webp", "/b.webp"],
    categoryTrail: kategoriler,
    canonicalPath: "/magaza/urun/fosforlu-pembe",
    storePath: "/magaza",
    categoryHref: (id) => `/magaza?category=${id}`,
    isBook: false,
    shippingRate: 49.9,
    ...over,
  };
}

describe("buildProductNode", () => {
  it("çekirdek Offer alanlarını sayfadaki değerlerden üretir", () => {
    const node = buildProductNode(girdi()) as Record<string, any>;

    expect(node["@type"]).toBe("Product");
    expect(node.name).toBe("Fosforlu Kalem, Pembe");
    expect(node.image).toEqual(["/a.webp", "/b.webp"]);
    expect(node.offers.price).toBe(34.9);
    expect(node.offers.priceCurrency).toBe("TRY");
    expect(node.offers.availability).toBe("https://schema.org/InStock");
    expect(node.offers.itemCondition).toBe("https://schema.org/NewCondition");
    expect(node.offers.url).toMatch(/\/magaza\/urun\/fosforlu-pembe$/);
  });

  it("stokta olmayan üründe OutOfStock bildirir", () => {
    const node = buildProductNode(
      girdi({ product: urun({ in_stock: false }) })
    ) as Record<string, any>;
    expect(node.offers.availability).toBe("https://schema.org/OutOfStock");
  });

  it("uydurma priceValidUntil YAZMAZ", () => {
    // Gerçek kampanya bitiş tarihimiz yok; süresi dolmuş bir tarih zengin
    // sonucu düşürür. Bu yüzden alan bilinçli olarak hiç üretilmez.
    const node = buildProductNode(girdi()) as Record<string, any>;
    expect(node.offers).not.toHaveProperty("priceValidUntil");
  });

  it("sku'yu geçirir, barkodu yalnız 13 hane ise gtin13 sayar", () => {
    const on3 = buildProductNode(
      girdi({ product: urun({ sku: "FZK-000042", barcode: "8691234567890" }) })
    ) as Record<string, any>;
    expect(on3.sku).toBe("FZK-000042");
    expect(on3.gtin13).toBe("8691234567890");

    const kisa = buildProductNode(
      girdi({ product: urun({ barcode: "12345" }) })
    ) as Record<string, any>;
    expect(kisa).not.toHaveProperty("gtin13");

    const harfli = buildProductNode(
      girdi({ product: urun({ barcode: "ABC1234567890" }) })
    ) as Record<string, any>;
    expect(harfli).not.toHaveProperty("gtin13");
  });

  it("künye doluyken Product + Book çoklu tipi ve kitap alanlarını verir", () => {
    const node = buildProductNode(
      girdi({
        isBook: true,
        product: urun({
          author: "Ahmet Yılmaz",
          publisher: "Palme",
          isbn: "9786051234567",
          page_count: 512,
          language: "Türkçe",
        }),
      })
    ) as Record<string, any>;

    expect(node["@type"]).toEqual(["Product", "Book"]);
    expect(node.author).toEqual({ "@type": "Person", name: "Ahmet Yılmaz" });
    expect(node.isbn).toBe("9786051234567");
    expect(node.numberOfPages).toBe(512);
  });

  it("kitap alanlarını isBook false iken SIZDIRMAZ", () => {
    const node = buildProductNode(
      girdi({ isBook: false, product: urun({ author: "Ahmet Yılmaz" }) })
    ) as Record<string, any>;
    expect(node).not.toHaveProperty("author");
  });

  it("aggregateRating yalnız gerçek değerlendirme varken çizilir", () => {
    const yok = buildProductNode(girdi()) as Record<string, any>;
    expect(yok).not.toHaveProperty("aggregateRating");

    const var_ = buildProductNode(
      girdi({ product: urun({ rating_count: 12, rating_average: 4.58 }) })
    ) as Record<string, any>;
    expect(var_.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: "4.6",
      reviewCount: 12,
    });
  });
});

describe("buildBreadcrumbNode", () => {
  it("Mağaza → kategori zinciri → ürün sırasını 1'den numaralar", () => {
    const node = buildBreadcrumbNode(girdi()) as Record<string, any>;
    const ogeler = node.itemListElement as Record<string, any>[];

    expect(ogeler.map((o) => o.name)).toEqual([
      "Mağaza",
      "Kırtasiye",
      "Kalemler",
      "Fosforlu Kalem, Pembe",
    ]);
    expect(ogeler.map((o) => o.position)).toEqual([1, 2, 3, 4]);
  });

  it("son öğeye link vermez (mevcut sayfa kendine link olmaz)", () => {
    const node = buildBreadcrumbNode(girdi()) as Record<string, any>;
    const ogeler = node.itemListElement as Record<string, any>[];
    expect(ogeler.at(-1)).not.toHaveProperty("item");
    expect(ogeler[1].item).toMatch(/\/magaza\?category=1$/);
  });

  it("kategorisiz üründe bile Google'ın istediği en az iki öğeyi verir", () => {
    const node = buildBreadcrumbNode(girdi({ categoryTrail: [] })) as Record<string, any>;
    expect((node.itemListElement as unknown[]).length).toBe(2);
  });
});

describe("kargo ve iade politikası", () => {
  it("fiziksel üründe EKRANDAKİ kargo tutarını bildirir", () => {
    const node = buildProductNode(girdi({ shippingRate: 49.9 })) as Record<string, any>;
    expect(node.offers.shippingDetails.shippingRate).toEqual({
      "@type": "MonetaryAmount",
      value: 49.9,
      currency: "TRY",
    });
  });

  it("ücretsiz kargoda 0 bildirir (alan hiç yazılmamış gibi davranmaz)", () => {
    const node = buildProductNode(girdi({ shippingRate: 0 })) as Record<string, any>;
    expect(node.offers.shippingDetails.shippingRate.value).toBe(0);
  });

  it("dijital üründe kargo ve iade politikası YAZILMAZ", () => {
    // Gönderi yok; olmayan bir kargo ücreti bildirmek yanlış veri olurdu.
    const node = buildProductNode(girdi({ shippingRate: null })) as Record<string, any>;
    expect(node.offers).not.toHaveProperty("shippingDetails");
    expect(node.offers).not.toHaveProperty("hasMerchantReturnPolicy");
  });

  it("iade süresi ekrandakiyle AYNI sabitten gelir", () => {
    const node = buildProductNode(girdi()) as Record<string, any>;
    expect(node.offers.hasMerchantReturnPolicy.merchantReturnDays).toBe(
      CAYMA_HAKKI_GUN
    );
  });
});

describe("buildProductGroupNode", () => {
  function varyantli(over: Partial<ProductVariants> = {}): ProductDetailOut {
    return urun({
      brand: "Faber-Castell",
      variants: {
        group_id: 5,
        title: "Fosforlu Kalem",
        option1_name: "Renk",
        option2_name: "Kapak Tipi",
        members: [
          {
            id: 7,
            slug: "fosforlu-pembe",
            title: "Fosforlu Kalem - Pembe",
            option1_value: "Pembe",
            option2_value: "Mat",
            variant_sort: 0,
            in_stock: true,
            price: "34.90",
            sku: "FZK-000007",
            cover_url: "/pembe.webp",
          },
          {
            id: 8,
            slug: "fosforlu-sari",
            title: "Fosforlu Kalem - Sarı",
            option1_value: "Sarı",
            option2_value: "Mat",
            variant_sort: 1,
            in_stock: false,
            price: "34.90",
          },
        ],
        ...over,
      },
    });
  }

  it("grupsuz üründe düğüm ÜRETİLMEZ", () => {
    expect(buildProductGroupNode(girdi())).toBeNull();
  });

  it("tek üyeli grupta düğüm üretilmez (grup değil, tekil ürün)", () => {
    const p = varyantli();
    p.variants!.members = [p.variants!.members[0]];
    expect(buildProductGroupNode(girdi({ product: p }))).toBeNull();
  });

  it("her kardeşi kendi URL'i, fiyatı ve stok durumuyla bildirir", () => {
    const node = buildProductGroupNode(girdi({ product: varyantli() })) as Record<string, any>;
    expect(node["@type"]).toBe("ProductGroup");
    expect(node.productGroupID).toBe("5");
    expect(node.hasVariant).toHaveLength(2);
    expect(node.hasVariant[0].offers.url).toMatch(/\/magaza\/urun\/fosforlu-pembe$/);
    expect(node.hasVariant[0].sku).toBe("FZK-000007");
    expect(node.hasVariant[1].offers.availability).toBe(
      "https://schema.org/OutOfStock"
    );
  });

  it("variesBy'a YALNIZ schema.org'un tanıdığı eksenler girer", () => {
    const node = buildProductGroupNode(girdi({ product: varyantli() })) as Record<string, any>;
    // "Renk" → color tanınır; "Kapak Tipi" schema.org'da karşılıksızdır ve
    // zorla material/pattern'a eşlemek YANLIŞ veri bildirmek olurdu.
    expect(node.variesBy).toEqual(["https://schema.org/color"]);
  });

  it("variesBy'a giremeyen eksen additionalProperty olarak yine görünür", () => {
    const node = buildProductGroupNode(girdi({ product: varyantli() })) as Record<string, any>;
    const ozellikler = node.hasVariant[0].additionalProperty as Record<string, any>[];
    expect(ozellikler).toEqual([
      { "@type": "PropertyValue", name: "Renk", value: "Pembe" },
      { "@type": "PropertyValue", name: "Kapak Tipi", value: "Mat" },
    ]);
  });

  it("hiç tanınan eksen yoksa variesBy hiç yazılmaz", () => {
    const p = varyantli();
    p.variants!.option1_name = "Gramaj";
    p.variants!.option2_name = null;
    const node = buildProductGroupNode(girdi({ product: p })) as Record<string, any>;
    expect(node).not.toHaveProperty("variesBy");
  });
});

describe("marka", () => {
  it("marka doluysa Brand olarak bildirilir", () => {
    const node = buildProductNode(
      girdi({ product: urun({ brand: "Faber-Castell" }) })
    ) as Record<string, any>;
    expect(node.brand).toEqual({ "@type": "Brand", name: "Faber-Castell" });
  });

  it("marka boşsa alan hiç yazılmaz", () => {
    expect(buildProductNode(girdi())).not.toHaveProperty("brand");
  });
});

describe("buildProductJsonLd", () => {
  it("grupsuz üründe iki düğüm döner: Product ve BreadcrumbList", () => {
    const [urunDugumu, kirinti] = buildProductJsonLd(girdi()) as Record<string, any>[];
    expect(urunDugumu["@type"]).toBe("Product");
    expect(kirinti["@type"]).toBe("BreadcrumbList");
  });

  it("gruplu üründe ProductGroup da eklenir", () => {
    const p = urun({
      variants: {
        group_id: 5,
        title: "Kalem",
        option1_name: "Renk",
        option2_name: null,
        members: [
          {
            id: 7, slug: "a", title: "A", option1_value: "Pembe",
            option2_value: null, variant_sort: 0, in_stock: true, price: "1.00",
          },
          {
            id: 8, slug: "b", title: "B", option1_value: "Sarı",
            option2_value: null, variant_sort: 1, in_stock: true, price: "1.00",
          },
        ],
      },
    });
    const tipler = (buildProductJsonLd(girdi({ product: p })) as Record<string, any>[]).map(
      (n) => n["@type"]
    );
    expect(tipler).toEqual(["Product", "ProductGroup", "BreadcrumbList"]);
  });
});
