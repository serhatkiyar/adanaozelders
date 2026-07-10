import { describe, expect, it } from "vitest";

import {
  TIMELINE_LABELS,
  formatEtaWindow,
  formatEventTime,
  proofLabel,
} from "./deliveryTimeline";

describe("TIMELINE_LABELS", () => {
  it("backend whitelist kodlarının tamamını kapsar", () => {
    for (const code of [
      "ORDER_RECEIVED",
      "PAYMENT_CONFIRMED",
      "PLANNED_FOR_DELIVERY",
      "OUT_FOR_DELIVERY",
      "DELIVERY_FAILED",
      "POSTPONED",
      "DELIVERED",
      "CANCELLED",
      "REFUNDED",
    ]) {
      expect(TIMELINE_LABELS[code], code).toBeTruthy();
    }
  });
});

describe("formatEventTime", () => {
  it("aynı gün yalnız saat", () => {
    const now = new Date(2026, 6, 10, 15, 0);
    expect(formatEventTime("2026-07-10T11:05:00", now)).toBe("11:05");
  });
  it("farklı gün tarih + saat", () => {
    const now = new Date(2026, 6, 10, 15, 0);
    expect(formatEventTime("2026-07-08T11:05:00", now)).toContain("8 Tem");
  });
});

describe("formatEtaWindow", () => {
  it("pencere metni", () => {
    expect(
      formatEtaWindow("2026-07-10T18:00:00", "2026-07-10T19:00:00"),
    ).toBe("18:00 – 19:00 arası");
  });
  it("eksik uçta null", () => {
    expect(formatEtaWindow("2026-07-10T18:00:00", null)).toBeNull();
    expect(formatEtaWindow(null, null)).toBeNull();
  });
});

describe("proofLabel", () => {
  it("bilinen kanıt türleri", () => {
    expect(proofLabel("OTP")).toContain("SMS");
    expect(proofLabel("ADMIN")).toContain("Görevli");
    expect(proofLabel("PHOTO")).toContain("Fotoğraf");
  });
  it("bilinmeyen → null", () => {
    expect(proofLabel("X")).toBeNull();
    expect(proofLabel(null)).toBeNull();
  });
});
