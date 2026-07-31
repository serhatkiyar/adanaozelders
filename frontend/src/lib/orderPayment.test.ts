import { describe, expect, it } from "vitest";
import {
  ORDER_PAYMENT_LABELS,
  isRefundInProgress,
  orderPaymentLabel,
} from "./orderPayment";

describe("orderPaymentLabel", () => {
  it("bilinen durumları Türkçe gösterir", () => {
    expect(orderPaymentLabel("PENDING")).toBe("Bekliyor");
    expect(orderPaymentLabel("PAID")).toBe("Ödendi");
    expect(orderPaymentLabel("FAILED")).toBe("Başarısız");
    expect(orderPaymentLabel("REFUNDED")).toBe("İade edildi");
  });

  it("iki fazlı iadenin ara durumunu kapsar", () => {
    // Bu durum sonradan eklendi; eski ternary zincirleri ham "REFUNDING"
    // gösteriyordu.
    expect(orderPaymentLabel("REFUNDING")).toBe("İade işleniyor");
  });

  it("backend'in tüm OrderPaymentStatus değerleri karşılanmış", () => {
    const backendDurumlari = [
      "PENDING",
      "PAID",
      "FAILED",
      "REFUNDING",
      "REFUNDED",
    ];
    for (const durum of backendDurumlari) {
      expect(ORDER_PAYMENT_LABELS[durum]).toBeTruthy();
    }
  });

  it("boş değerde tire döner", () => {
    expect(orderPaymentLabel(null)).toBe("—");
    expect(orderPaymentLabel(undefined)).toBe("—");
    expect(orderPaymentLabel("")).toBe("—");
  });

  it("bilinmeyen durumu ham gösterir (sessizce kaybetmez)", () => {
    expect(orderPaymentLabel("YENI_DURUM")).toBe("YENI_DURUM");
  });
});

describe("isRefundInProgress", () => {
  it("yalnız REFUNDING için true", () => {
    expect(isRefundInProgress("REFUNDING")).toBe(true);
    expect(isRefundInProgress("REFUNDED")).toBe(false);
    expect(isRefundInProgress("PAID")).toBe(false);
    expect(isRefundInProgress(null)).toBe(false);
  });
});
