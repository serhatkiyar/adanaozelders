// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  SHIPPING_FREE_THRESHOLD,
  SHIPPING_FLAT_FEE,
  shippingFor,
  remainingForFreeShipping,
} from "@/lib/shipping";

describe("shipping pure logic", () => {
  it("eşik altı → sabit kargo", () => {
    expect(shippingFor(SHIPPING_FREE_THRESHOLD - 1)).toBe(SHIPPING_FLAT_FEE);
    expect(shippingFor(0)).toBe(SHIPPING_FLAT_FEE);
  });

  it("eşik ve üstü → ücretsiz", () => {
    expect(shippingFor(SHIPPING_FREE_THRESHOLD)).toBe(0);
    expect(shippingFor(SHIPPING_FREE_THRESHOLD + 100)).toBe(0);
  });

  it("ücretsiz kargoya kalan tutar doğru, eşik üstünde 0", () => {
    expect(remainingForFreeShipping(SHIPPING_FREE_THRESHOLD - 120)).toBe(120);
    expect(remainingForFreeShipping(SHIPPING_FREE_THRESHOLD)).toBe(0);
    expect(remainingForFreeShipping(SHIPPING_FREE_THRESHOLD + 50)).toBe(0);
  });
});
