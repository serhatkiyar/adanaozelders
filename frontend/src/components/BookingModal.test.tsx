/**
 * Ders talebi penceresi — erişilebilirlik ve akış regresyonları (28 Eyl 2026).
 *
 * - "Adresi Kaydet/Güncelle" talebi GÖNDERMEZ (iç içe form, submit kabarcığı).
 * - Telefonu doğrulanmamış öğrenci son adımda doğrulama yolunu görür; talep
 *   düğmesi o zamana dek kapalıdır (eskiden sonda yalnız "yetkin yok" toast'ı).
 * - Sunucu hatası pencerenin içinde `role="alert"` ile kalır.
 * - Başlık düğmelerinin adı var; adım değişince odak yeni adım başlığına geçer.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BookingModal } from "@/components/BookingModal";
import { istanbulNow } from "@/lib/datetime";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS, TeachingMode } from "@/types";
import type { SavedAddress, SlotsOut, TutorSearchOut, UserOut } from "@/types";

const talepGonder = vi.fn();
const adresGuncelle = vi.fn();

vi.mock("@/hooks/useBookings", () => ({
  useCreateBooking: () => ({ mutate: talepGonder, isPending: false }),
  isSlotConflictError: () => false,
}));

const bugun = istanbulNow().dateStr;
const slotlar: SlotsOut = {
  days: [
    {
      date: bugun,
      has_available: true,
      slots: [
        {
          start_at: `${bugun}T15:00:00Z`,
          end_at: `${bugun}T16:00:00Z`,
          status: "available",
          part_of_day: "evening",
        },
      ],
    },
  ],
  has_availability: true,
  window_end: `${bugun}T23:59:59Z`,
  policy: { min_notice_hours: 0, window_days: 14, late_cancel_hours: 12 },
  price: { amount: "450.00", currency: "TRY" },
};

vi.mock("@/hooks/useTutorSlots", () => ({
  useTutorSlots: () => ({ data: slotlar, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  usePaymentAvailability: () => ({ data: undefined }),
}));

const kayitliAdres: SavedAddress = {
  id: 7,
  title: "Ev",
  address_line: "Çukurova, Adana",
  city: "Adana",
  district: "Çukurova",
  location_lat: 37.0,
  location_lng: 35.3,
  is_default: true,
};

vi.mock("@/hooks/useAddresses", () => ({
  useMyAddresses: () => ({ data: [kayitliAdres] }),
  useAddAddress: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAddress: () => ({ mutate: adresGuncelle, isPending: false }),
  useDeleteAddress: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

vi.mock("@/hooks/useProfile", () => ({
  useRequestPhoneOtp: () => ({ mutate: vi.fn(), isPending: false }),
  useVerifyPhone: () => ({ mutate: vi.fn(), isPending: false }),
}));

const egitmen = {
  id: 1,
  display_name: "Elif",
  teaching_mode: TeachingMode.BOTH,
} as unknown as TutorSearchOut;

function ogrenci(phone_verified: boolean): UserOut {
  return {
    id: 5,
    email: "o@example.com",
    first_name: "Ayşe",
    last_name: "Demir",
    full_name: "Ayşe Demir",
    is_active: true,
    email_verified: true,
    phone: phone_verified ? "05321234567" : null,
    phone_verified,
    role_id: ROLE_IDS.CLIENT,
    created_at: "2026-09-01T00:00:00Z",
  } as UserOut;
}

function ciz() {
  return render(
    <MemoryRouter>
      <BookingModal tutor={egitmen} onClose={() => {}} />
    </MemoryRouter>
  );
}

const devam = () => fireEvent.click(screen.getByRole("button", { name: "Devam Et" }));

beforeEach(() => {
  talepGonder.mockReset();
  adresGuncelle.mockReset();
  useAuthStore.setState({ user: ogrenci(true) });
});

describe("BookingModal", () => {
  it("başlık düğmeleri adlandırılmış ve seçili ders modu bildiriliyor", () => {
    ciz();
    expect(screen.getByRole("button", { name: "Kapat" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: /Uzaktan/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Yüzyüze/ })).toHaveAttribute("aria-pressed", "false");
    devam();
    expect(screen.getByRole("button", { name: "Önceki adım" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 saat" })).toHaveAttribute("aria-pressed", "true");
  });

  it("adım değişince odak yeni adımın başlığına geçer", () => {
    ciz();
    devam();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Tarih ve Saat" }));
    expect(screen.getByText("Adım 2 / 3: Tarih ve Saat")).toBeInTheDocument();
  });

  it("buluşma adresini güncellemek ders talebini GÖNDERMEZ", () => {
    ciz();
    fireEvent.click(screen.getByRole("button", { name: /Yüzyüze/ }));
    devam();
    fireEvent.click(screen.getByRole("button", { name: /^\d\d:\d\d$/ }));
    devam();
    // Kayıtlı adresi seç (buluşma yeri dolar), sonra düzenleyip kaydet.
    fireEvent.click(screen.getByRole("button", { name: /Ev/ }));
    fireEvent.click(screen.getByTitle("Adresi düzenle"));
    fireEvent.click(screen.getByRole("button", { name: "Adresi Güncelle" }));

    expect(adresGuncelle).toHaveBeenCalledTimes(1);
    expect(talepGonder).not.toHaveBeenCalled();
  });

  it("telefonu doğrulanmamış öğrenci son adımda doğrulama yolunu görür", () => {
    useAuthStore.setState({ user: ogrenci(false) });
    ciz();
    devam();
    fireEvent.click(screen.getByRole("button", { name: /^\d\d:\d\d$/ }));
    devam();

    const gonder = screen.getByRole("button", { name: "Ders Talep Et" });
    expect(gonder).toBeDisabled();
    expect(screen.getByText("Talebi göndermeden önce telefonunu doğrula")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Telefonu doğrula" }));
    expect(screen.getByLabelText("Cep telefonu")).toBeInTheDocument();
    expect(talepGonder).not.toHaveBeenCalled();
  });

  it("sunucu hatası pencerede role=alert ile kalır", () => {
    talepGonder.mockImplementation((_payload, { onError }) =>
      onError({ response: { status: 409, data: { detail: "Ücretsiz ders hakkın kullanılmış." } } })
    );
    ciz();
    devam();
    fireEvent.click(screen.getByRole("button", { name: /^\d\d:\d\d$/ }));
    devam();
    fireEvent.click(screen.getByRole("button", { name: "Ders Talep Et" }));

    expect(talepGonder).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Ücretsiz ders hakkın kullanılmış.");
  });
});
