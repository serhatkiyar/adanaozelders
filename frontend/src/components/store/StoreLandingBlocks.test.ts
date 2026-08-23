import { describe, expect, it } from "vitest";

import { groupLandingBlocksForRender } from "@/components/store/StoreLandingBlocks";
import type { LandingPageBlock, LandingPageBlockType } from "@/types";

function block(
  key: string,
  type: LandingPageBlockType,
  config: Record<string, unknown>,
): LandingPageBlock {
  return {
    id: 1,
    block_key: key,
    block_type: type,
    title: key,
    description: "",
    link_label: "Keşfet",
    link_url: null,
    config,
    product_set_revision_id: null,
    product_set_id: null,
    is_active: true,
    sort_order: 0,
    products: [],
    categories: [],
    warnings: [],
  };
}

describe("mağaza vitrin blok gruplama", () => {
  it("ardışık tek görselli kartları kompakt bir satırda toplar", () => {
    const blocks = ["çanta", "matara", "resim", "beslenme"].map((key) =>
      block(key, "IMAGE_CARD_GRID", {
        cards: [{ image_url: `/${key}.webp` }],
      }),
    );

    const entries = groupLandingBlocksForRender(blocks);

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("compact-image-row");
    if (entries[0].kind === "compact-image-row") {
      expect(entries[0].blocks.map((item) => item.block_key)).toEqual([
        "çanta",
        "matara",
        "resim",
        "beslenme",
      ]);
    }
  });

  it("hero üzerine bindirilen tek görselli kartları da aynı satırda tutar", () => {
    const blocks = ["çanta", "matara", "resim", "beslenme"].map((key) =>
      block(key, "IMAGE_CARD_GRID", {
        overlay: true,
        cards: [{ image_url: `/${key}.webp` }],
      }),
    );

    expect(groupLandingBlocksForRender(blocks)).toHaveLength(1);
    expect(groupLandingBlocksForRender(blocks)[0].kind).toBe("compact-image-row");
  });

  it("geniş görsel veya çoklu kart sınırında grubu sonlandırır", () => {
    const entries = groupLandingBlocksForRender([
      block("bir", "IMAGE_CARD_GRID", {
        cards: [{ image_url: "/1.webp" }],
      }),
      block("banner", "BANNER", { image_url: "/banner.webp" }),
      block("iki", "IMAGE_CARD_GRID", {
        cards: [{ image_url: "/2.webp" }, { image_url: "/3.webp" }],
      }),
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual([
      "block",
      "block",
      "block",
    ]);
  });
});
