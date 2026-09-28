/**
 * Profildeki Program takviminden gelen saat pencerede ÖNSEÇİLİ gelir; artık
 * boş değilse kullanıcıya söylenir ve normal seçime düşülür. Talep asla
 * kendiliğinden gönderilmez (ÜK-10).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlotsOut, TutorSearchOut } from "@/types";

const mutate = vi.fn();
let slotVerisi: SlotsOut;
let tazeleniyor = false;
const slotCagrilari: [number, string, number][] = [];

vi.mock("@/hooks/useTutorSlots", () => ({
  useTutorSlots: (id: number, from: string, sure: number) => {
    slotCagrilari.push([id, from, sure]);
    return { data: slotVerisi, isLoading: false, isError: false, isFetching: tazeleniyor, refetch: vi.fn() };
  },
}));
vi.mock("@/hooks/useBookings", () => ({
  useCreateBooking: () => ({ mutate, isPending: false }),
  isSlotConflictError: () => false,
}));
vi.mock("@/hooks/useAddresses", () => ({
  useMyAddresses: () => ({ data: [] }),
  useAddAddress: () => ({ mutate: vi.fn() }),
  useUpdateAddress: () => ({ mutate: vi.fn() }),
  useDeleteAddress: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/useFeatureFlags", () => ({ usePaymentAvailability: () => ({ data: undefined }) }));
vi.mock("@/lib/datetime", async (orijinal) => ({
  ...(await orijinal<typeof import("@/lib/datetime")>()),
  istanbulNow: () => ({ dateStr: "2026-10-01", hour: 9, minute: 0 }),
}));

import { BookingModal } from "./BookingModal";

const GUN = "2026-10-03";
const BASLANGIC = "2026-10-03T07:00:00Z"; // 10:00 İstanbul

function veri(durum: "available" | "busy"): SlotsOut {
  return {
    days: [
      {
        date: GUN,
        has_available: true,
        slots: [
          { start_at: BASLANGIC, end_at: "2026-10-03T08:00:00Z", status: durum, part_of_day: "morning" },
          { start_at: "2026-10-03T08:00:00Z", end_at: "2026-10-03T09:00:00Z", status: "available", part_of_day: "morning" },
        ],
      },
    ],
    has_availability: true,
    window_end: "2026-10-15T00:00:00+03:00",
    policy: { min_notice_hours: 24, window_days: 14, late_cancel_hours: 12 },
    price: { amount: "500.00", currency: "TRY" },
  };
}

const tutor = { id: 7, display_name: "Ayşe", teaching_mode: "ONLINE" } as unknown as TutorSearchOut;

function ac() {
  return render(
    <MemoryRouter>
      <BookingModal
        tutor={tutor}
        onClose={() => {}}
        initialSlot={{ date: GUN, start_at: BASLANGIC, duration: 60 }}
      />
    </MemoryRouter>,
  );
}

function devam() {
  fireEvent.click(screen.getByRole("button", { name: "Devam Et" }));
}

describe("BookingModal · Program takviminden önseçili saat", () => {
  beforeEach(() => {
    mutate.mockReset();
    slotCagrilari.length = 0;
    tazeleniyor = false;
  });

  it("boş saat taze veride eşlenir ve seçili gelir; gönderim olmaz", () => {
    slotVerisi = veri("available");
    ac();
    // İlk adımda (Ders Modu) seçim görünür kalır.
    expect(screen.getByText(/Seçtiğin saat: .*10:00 · 1 saat/)).toBeInTheDocument();
    devam();
    expect(screen.getByRole("button", { name: "10:00" })).toHaveAttribute("aria-pressed", "true");
    expect(slotCagrilari.at(-1)).toEqual([7, "2026-10-01", 60]);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("saat artık boş değilse söylenir ve hiçbir saat seçili gelmez", () => {
    slotVerisi = veri("busy");
    ac();
    expect(screen.queryByText(/Seçtiğin saat:/)).toBeNull();
    devam();
    expect(screen.getByText(/Profilde seçtiğin saat artık boş değil/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "11:00" })).toHaveAttribute("aria-pressed", "false");
  });

  it("bayat önbellekte 'boş' görünen saat taze yanıtta doluysa seçilmez", () => {
    slotVerisi = veri("available");
    tazeleniyor = true;
    const { rerender } = ac();
    expect(screen.queryByText(/Seçtiğin saat:/)).toBeNull();

    slotVerisi = veri("busy");
    tazeleniyor = false;
    rerender(
      <MemoryRouter>
        <BookingModal tutor={tutor} onClose={() => {}} initialSlot={{ date: GUN, start_at: BASLANGIC, duration: 60 }} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Seçtiğin saat:/)).toBeNull();
    devam();
    expect(screen.getByText(/Profilde seçtiğin saat artık boş değil/)).toBeInTheDocument();
    devam();
    // Seçim yok: ikinci adımda kalınır.
    expect(screen.getByText(/Profilde seçtiğin saat artık boş değil/)).toBeInTheDocument();
  });

  it("eşlenmiş saat sonradan dolarsa seçim düşer", () => {
    slotVerisi = veri("available");
    const { rerender } = ac();
    expect(screen.getByText(/Seçtiğin saat:/)).toBeInTheDocument();

    slotVerisi = veri("busy");
    rerender(
      <MemoryRouter>
        <BookingModal tutor={tutor} onClose={() => {}} initialSlot={{ date: GUN, start_at: BASLANGIC, duration: 60 }} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Seçtiğin saat:/)).toBeNull();
    devam();
    expect(screen.getByText(/Profilde seçtiğin saat artık boş değil/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "11:00" })).toHaveAttribute("aria-pressed", "false");
  });
});
