/**
 * blokToPuck — tek yönlü göç dönüştürücüsünün alan-eşdeğerlik testleri.
 *
 * Sözleşme: eski form neslinin blokları KAYIPSIZ Puck'a taşınır (yedi tip),
 * pasif bloklar içe alınmaz, eşlenemeyen tip `atlanan`da isimle raporlanır.
 */
import { describe, expect, it } from "vitest";

import type { LandingPageBlock } from "@/types";

import { blokToPuck } from "./blokToPuck";

let sira = 0;
function blok(kismi: Partial<LandingPageBlock>): LandingPageBlock {
  sira += 1;
  return {
    id: sira,
    block_key: `k${sira}`,
    block_type: "RICH_TEXT",
    title: "",
    description: "",
    link_label: "",
    link_url: null,
    config: {},
    product_set_id: null,
    product_set_revision_id: null,
    is_active: true,
    sort_order: sira * 10,
    products: [],
    categories: [],
    warnings: [],
    ...kismi,
  } as LandingPageBlock;
}

describe("blokToPuck", () => {
  it("hero slaytlarını fit/focal/mobile dahil kayıpsız taşır", () => {
    const { data } = blokToPuck([
      blok({
        block_type: "HERO_CAROUSEL",
        config: {
          slides: [{
            image_url: "https://cdn/a.webp", mobile_image_url: "https://cdn/m.webp",
            alt_text: "a", decorative: false, link_url: "/magaza",
            fit: "contain", focal_x: 40, focal_y: 60,
          }],
          autoplay_ms: 5000,
        },
      }),
    ]);
    const props = data.content[0].props as Record<string, unknown>;
    expect(data.content[0].type).toBe("HeroCarousel");
    expect(props.autoplay_ms).toBe(5000);
    expect(props.slides).toEqual([{
      image_url: "https://cdn/a.webp", mobile_image_url: "https://cdn/m.webp",
      alt_text: "a", decorative: false, link_url: "/magaza",
      fit: "contain", focal_x: 40, focal_y: 60,
    }]);
  });

  it("block_key açık prop olarak taşınır (metrik tarihçesi kesintisiz)", () => {
    const { data } = blokToPuck([blok({ block_key: "sabit-anahtar", config: { content: "x" } })]);
    expect(data.content[0].props.block_key).toBe("sabit-anahtar");
  });

  it("pasif blok içe ALINMAZ", () => {
    const { data } = blokToPuck([
      blok({ is_active: false, config: { content: "gizli" } }),
      blok({ config: { content: "görünür" } }),
    ]);
    expect(data.content).toHaveLength(1);
    expect((data.content[0].props as Record<string, unknown>).content).toBe("görünür");
  });

  it("kart ızgarası label + overlay taşır, banner config MediaItem olarak sarılır", () => {
    const { data } = blokToPuck([
      blok({
        block_type: "IMAGE_CARD_GRID",
        config: { cards: [{ image_url: "https://cdn/k.webp", label: "Etiket" }], overlay: true },
      }),
      blok({
        block_type: "BANNER",
        config: { image_url: "https://cdn/b.webp", alt_text: "b", fit: "cover" },
      }),
    ]);
    const kart = data.content[0].props as Record<string, unknown>;
    expect((kart.cards as Array<Record<string, unknown>>)[0].label).toBe("Etiket");
    expect(kart.overlay).toBe(true);
    const banner = data.content[1].props as Record<string, unknown>;
    expect(banner.image).toMatchObject({ image_url: "https://cdn/b.webp", alt_text: "b", fit: "cover" });
  });

  it("ürün rayı koleksiyon seçimine, kategori ızgarası id listesine çevrilir", () => {
    const { data } = blokToPuck([
      blok({ block_type: "PRODUCT_RAIL", title: "Öne çıkan", product_set_id: 7 }),
      blok({ block_type: "CATEGORY_GRID", config: { category_ids: [1, 2] } }),
      blok({ block_type: "RECENTLY_VIEWED", title: "Son bakılan" }),
    ]);
    expect((data.content[0].props as Record<string, unknown>).product_set).toMatchObject({ id: 7 });
    expect((data.content[1].props as Record<string, unknown>).category_ids).toEqual([1, 2]);
    expect(data.content[2].type).toBe("RecentlyViewed");
  });

  it("bilinmeyen tip atlanır ve İSİMLE raporlanır", () => {
    const { data, atlanan } = blokToPuck([
      blok({ block_type: "GELECEK_TIP" as never }),
      blok({ config: { content: "x" } }),
    ]);
    expect(data.content).toHaveLength(1);
    expect(atlanan).toEqual(["GELECEK_TIP"]);
  });
});
