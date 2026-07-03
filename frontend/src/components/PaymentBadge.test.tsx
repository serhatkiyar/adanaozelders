import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentBadge } from "@/components/PaymentBadge";
import { PaymentStatus, type Payment } from "@/types";

function makePayment(status: PaymentStatus): Payment {
  return {
    id: 1,
    booking_id: 1,
    amount: "250.00",
    commission_amount: "25.00",
    tutor_earning: "225.00",
    commission_rate: "0.10",
    currency: "TRY",
    status,
    provider: "fake",
    created_at: new Date().toISOString(),
  };
}

describe("PaymentBadge", () => {
  it("PENDING -> 'Ödeme bekliyor'", () => {
    render(<PaymentBadge payment={makePayment(PaymentStatus.PENDING)} />);
    expect(screen.getByText(/Ödeme bekliyor/)).toBeTruthy();
  });
  it("HELD -> 'emanette'", () => {
    render(<PaymentBadge payment={makePayment(PaymentStatus.HELD)} />);
    expect(screen.getByText(/emanette/)).toBeTruthy();
  });
  it("RELEASED -> 'Ödeme tamamlandı'", () => {
    render(<PaymentBadge payment={makePayment(PaymentStatus.RELEASED)} />);
    expect(screen.getByText(/Ödeme tamamlandı/)).toBeTruthy();
  });
  it("REFUNDING -> 'İade ediliyor'", () => {
    render(<PaymentBadge payment={makePayment(PaymentStatus.REFUNDING)} />);
    expect(screen.getByText(/İade ediliyor/)).toBeTruthy();
  });
  it("REFUNDED -> 'İade edildi'", () => {
    render(<PaymentBadge payment={makePayment(PaymentStatus.REFUNDED)} />);
    expect(screen.getByText(/İade edildi/)).toBeTruthy();
  });
});
