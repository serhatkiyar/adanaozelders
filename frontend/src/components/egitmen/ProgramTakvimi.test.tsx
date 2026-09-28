/**
 * Hafta/süre değişirken önceki hafta yer tutucu olarak kalır; bu sırada
 * eski haftanın saatleri seçtirilmez (yanlış güne ders penceresi açılmasın).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SlotsOut } from "@/types";

let yerTutucu = false;

const veri: SlotsOut = {
  days: [
    {
      date: "2026-10-03",
      has_available: true,
      slots: [
        { start_at: "2026-10-03T07:00:00Z", end_at: "2026-10-03T08:00:00Z", status: "available", part_of_day: "morning" },
      ],
    },
  ],
  has_availability: true,
  window_end: "2026-10-15T00:00:00+03:00",
  policy: { min_notice_hours: 24, window_days: 14, late_cancel_hours: 12 },
  price: { amount: "500.00", currency: "TRY" },
};

vi.mock("@/hooks/useTutorSlots", () => ({
  useTutorSlots: () => ({
    data: veri,
    isLoading: false,
    isError: false,
    isPlaceholderData: yerTutucu,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/datetime", async (orijinal) => ({
  ...(await orijinal<typeof import("@/lib/datetime")>()),
  istanbulNow: () => ({ dateStr: "2026-10-01", hour: 9, minute: 0 }),
}));

import { ProgramTakvimi } from "./ProgramTakvimi";

function saatDugmeleri() {
  return screen.getAllByRole("button", { name: /10:00 — 1 saatlik ders seç/ });
}

describe("ProgramTakvimi · yer tutucu veri", () => {
  it("yeni hafta beklenirken saatler kilitli ve seçim yapılmaz", () => {
    yerTutucu = true;
    const onSaatSec = vi.fn();
    render(<ProgramTakvimi tutorId={7} onSaatSec={onSaatSec} />);
    const dugmeler = saatDugmeleri();
    expect(dugmeler.length).toBeGreaterThan(0);
    // `disabled` değil `aria-disabled`: odak düğmeden düşmesin (klavye).
    for (const d of dugmeler) {
      expect(d).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(d);
    }
    expect(onSaatSec).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sonraki hafta" })).toHaveAttribute("aria-disabled", "true");
  });

  it("taze veride saat seçilebilir", () => {
    yerTutucu = false;
    const onSaatSec = vi.fn();
    render(<ProgramTakvimi tutorId={7} onSaatSec={onSaatSec} />);
    fireEvent.click(saatDugmeleri()[0]);
    expect(onSaatSec).toHaveBeenCalledWith({
      date: "2026-10-03",
      start_at: "2026-10-03T07:00:00Z",
      duration: 60,
    });
  });

  it("sınır haftaya geçince odak kilitlenen düğmeden karşı yöne taşınır", () => {
    yerTutucu = false;
    render(<ProgramTakvimi tutorId={7} onSaatSec={vi.fn()} />);
    const onceki = screen.getByRole("button", { name: "Önceki hafta" });
    const sonraki = screen.getByRole("button", { name: "Sonraki hafta" });
    sonraki.focus();
    fireEvent.click(sonraki);
    expect(sonraki).toBeDisabled();
    expect(document.activeElement).toBe(onceki);
    fireEvent.click(onceki);
    expect(onceki).toBeDisabled();
    expect(document.activeElement).toBe(sonraki);
  });

  it("salt okunur açıklama bakan kişiye göre değişir", () => {
    yerTutucu = false;
    const { unmount } = render(<ProgramTakvimi tutorId={7} kendiProfili />);
    expect(screen.getByText(/Öğrencilerin gördüğü boş saatler/)).toBeInTheDocument();
    unmount();
    render(<ProgramTakvimi tutorId={7} />);
    expect(screen.getByText(/Ders talebi üye hesabıyla yapılır/)).toBeInTheDocument();
  });
});
