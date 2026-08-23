import { describe, expect, it } from "vitest";

import {
  appendMediaToLandingBlock,
  composeLandingDraftPreview,
  duplicateLandingBlock,
} from "./LandingPagesManager";
import type {
  LandingPage,
  LandingPageBlockInput,
  LandingPageRevisionInput,
  ProductCategory,
  ProductSearchOut,
  ProductSet,
  StoreMediaAsset,
} from "@/types";

const media: StoreMediaAsset = {
  id: 7,
  image_url: "http://localhost:9000/avatars/store-hero/test.webp",
  alt_text: "",
  mime_type: "image/webp",
  width: 1200,
  height: 800,
  file_size: 1000,
  created_at: "2026-08-23T00:00:00Z",
};

const imageBlock: LandingPageBlockInput = {
  block_key: "images",
  block_type: "IMAGE_CARD_GRID",
  title: "Kartlar",
  description: "",
  link_label: "Keşfet",
  link_url: null,
  config: { cards: [] },
  product_set_revision_id: null,
  product_set_id: null,
  is_active: true,
  sort_order: 0,
};

describe("LandingPagesManager düzenleyici yardımcıları", () => {
  it("medya seçimini anında bloğa ekler ve aynı medyayı yanlışlıkla çoğaltmaz", () => {
    const once = appendMediaToLandingBlock(imageBlock, media);
    const cards = once.config.cards as Array<Record<string, unknown>>;

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      image_url: media.image_url,
      decorative: true,
      fit: "contain",
    });
    expect(appendMediaToLandingBlock(once, media)).toBe(once);
  });

  it("bir bloğu bağımsız config ve yeni anahtarla kopyalar", () => {
    const original = appendMediaToLandingBlock(imageBlock, media);
    const copy = duplicateLandingBlock(original, 2);

    expect(copy.block_key).not.toBe(original.block_key);
    expect(copy.title).toBe("Kartlar (kopya)");
    expect(copy.sort_order).toBe(20);
    expect(copy.config).not.toBe(original.config);
    expect(copy.config).toEqual(original.config);
  });

  it("taslağı gerçek sayfa önizleme verisine dönüştürür", () => {
    const product = { id: 41, title: "TYT Matematik" } as ProductSearchOut;
    const category = { id: 9, name: "Romanlar" } as ProductCategory;
    const productSet = {
      id: 3,
      name: "Yeni gelenler",
      revision: { id: 33 },
      preview_products: [product],
      warnings: [],
    } as ProductSet;
    const page = {
      id: 1,
      state: "LIVE",
      revision: { id: 5, blocks: [] },
    } as unknown as LandingPage;
    const draft = {
      title: "Anlık başlık",
      seo_title: "SEO",
      seo_description: "",
      blocks: [
        {
          ...imageBlock,
          block_key: "products",
          block_type: "PRODUCT_RAIL",
          product_set_id: 3,
          product_set_revision_id: null,
          config: {},
        },
        {
          ...imageBlock,
          block_key: "categories",
          block_type: "CATEGORY_GRID",
          config: { category_ids: [9] },
        },
        { ...imageBlock, block_key: "hidden", is_active: false },
      ],
    } as LandingPageRevisionInput;

    const preview = composeLandingDraftPreview(
      page,
      draft,
      [productSet],
      [category],
    );

    expect(preview.state).toBe("DRAFT");
    expect(preview.revision.title).toBe("Anlık başlık");
    expect(preview.revision.blocks).toHaveLength(2);
    expect(preview.revision.blocks[0].products).toEqual([product]);
    expect(preview.revision.blocks[1].categories).toEqual([category]);
  });
});
