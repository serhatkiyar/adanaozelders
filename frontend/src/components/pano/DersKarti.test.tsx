/**
 * Öğretmen panosu ders satırı + iptal penceresi regresyonları (28 Eyl 2026).
 *
 * - "Reddet" tek dokunuşta talebi silmez; satır içi onay ister.
 * - "Tamamla" ders başlamadan görünmez (sunucu 409 veriyordu).
 * - İptal nedeni alanının adı var; eksik neden pencerede `role="alert"` ile
 *   söylenir; öğretmen öğrenciye yazılmış iade cümlesini görmez.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DersKarti } from "@/components/pano/DersKarti";
import { BookingStatus, type BookingOut } from "@/types";

const eylemler: Record<string, ReturnType<typeof vi.fn>> = {
  accept: vi.fn(),
  reject: vi.fn(),
  complete: vi.fn(),
};
const iptal = vi.fn();

vi.mock("@/hooks/useBookings", () => ({
  useBookingAction: (tur: string) => ({ mutate: eylemler[tur], isPending: false }),
  useCancelBooking: () => ({ mutate: iptal, isPending: false }),
}));

const saatSonra = (saat: number) => new Date(Date.now() + saat * 3_600_000).toISOString();

function ders(ek: Partial<BookingOut>): BookingOut {
  return {
    id: 11,
    client_id: 3,
    client_name: "Ayşe",
    tutor_id: 1,
    status: BookingStatus.PENDING,
    mode: "ONLINE",
    start_at: saatSonra(48),
    end_at: saatSonra(49),
    price: "450.00",
    offered_by_tutor: false,
    late_for_changes: false,
    payment: null,
    ...ek,
  } as unknown as BookingOut;
}

const ciz = (b: BookingOut) =>
  render(
    <MemoryRouter>
      <DersKarti booking={b} onJoinMeeting={() => {}} />
    </MemoryRouter>
  );

beforeEach(() => {
  Object.values(eylemler).forEach((f) => f.mockReset());
  iptal.mockReset();
});

describe("DersKarti", () => {
  it("Reddet önce onay ister; Vazgeç talebi korur", () => {
    ciz(ders({}));
    fireEvent.click(screen.getByRole("button", { name: "Reddet" }));
    expect(eylemler.reject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(screen.getByRole("button", { name: "Kabul et" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reddet" }));
    fireEvent.click(screen.getByRole("button", { name: "Evet, reddet" }));
    expect(eylemler.reject).toHaveBeenCalledTimes(1);
  });

  it("başlamamış kabul edilmiş derste Tamamla YOK, başlamışta VAR", () => {
    const { unmount } = ciz(ders({ status: BookingStatus.ACCEPTED }));
    expect(screen.queryByRole("button", { name: "Tamamla" })).toBeNull();
    unmount();

    ciz(ders({ status: BookingStatus.ACCEPTED, start_at: saatSonra(-1), end_at: saatSonra(0.5) }));
    expect(screen.getByRole("button", { name: "Tamamla" })).toBeInTheDocument();
  });
});

describe("CancelModal (öğretmen)", () => {
  const acKabulEdilmis = () => {
    ciz(
      ders({
        status: BookingStatus.ACCEPTED,
        payment: { status: "HELD" } as BookingOut["payment"],
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "İptal" }));
  };

  it("neden alanı adlandırılmış; eksik neden pencerede duyurulur", () => {
    acKabulEdilmis();
    const alan = screen.getByRole("textbox", { name: "İptal nedeni" });
    fireEvent.click(screen.getByRole("button", { name: "İptal Et" }));

    expect(iptal).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("iptal nedeni");
    expect(alan).toHaveAttribute("aria-invalid", "true");
  });

  it("öğretmen öğrencinin iade cümlesini görmez", () => {
    acKabulEdilmis();
    expect(screen.queryByText(/ödediğin tutar/)).toBeNull();
    expect(screen.getByText(/öğrencinin ödediği tutar kendisine iade edilir/)).toBeInTheDocument();
  });
});
