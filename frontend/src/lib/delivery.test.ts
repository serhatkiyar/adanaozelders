// @vitest-environment node
import { describe, expect, it } from "vitest";
import { estimateDelivery } from "@/lib/delivery";

describe("estimateDelivery", () => {
  it("dijital ürün anında teslimat", () => {
    expect(estimateDelivery("DIGITAL")).toBe("Anında teslimat");
  });

  it("fiziksel ürün +1…+3 gün aralığı verir", () => {
    const base = new Date("2026-06-26T10:00:00");
    // +1 gün = 27 Haz, +3 gün = 29 Haz
    expect(estimateDelivery("PHYSICAL", base)).toBe("27 Haz – 29 Haz");
  });

  it("ay sınırını aşan aralığı doğru biçimler", () => {
    const base = new Date("2026-06-29T10:00:00");
    // +1 = 30 Haz, +3 = 2 Tem
    expect(estimateDelivery("PHYSICAL", base)).toBe("30 Haz – 2 Tem");
  });
});
