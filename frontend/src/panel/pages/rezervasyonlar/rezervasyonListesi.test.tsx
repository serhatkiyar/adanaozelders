import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PanelProvider } from "@/panel/PanelProvider";
import { RezervasyonListesi } from "@/panel/pages/rezervasyonlar/RezervasyonListesi";
import {
  useAdminBookingList,
  useAdminCancelBooking,
  useAdminResolveDisputeBooking,
  useAdminToggleDisputeBooking,
} from "@/hooks/useAdmin";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { PATHS, ROUTES } from "@/lib/routes";
import {
  PANEL_MENU,
  izinBeyaniniKarsilarMi,
  rotaIzniBul,
  seciliMenuDurumu,
} from "@/panel/layout/menu";
import { useAuthStore } from "@/store/authStore";
import { BookingStatus, type AdminBookingOut } from "@/types";

vi.mock("@/hooks/useAdmin", () => ({
  useAdminBookingList: vi.fn(),
  useAdminCancelBooking: vi.fn(),
  useAdminToggleDisputeBooking: vi.fn(),
  useAdminResolveDisputeBooking: vi.fn(),
}));
vi.mock("@/components/admin/ui", () => ({
  ReasonDialog: ({
    open,
    title,
    confirmLabel,
    onConfirm,
  }: {
    open: boolean;
    title: string;
    confirmLabel: string;
    onConfirm: (reason: string) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button onClick={() => onConfirm("Geçerli gerekçe")}>{confirmLabel}</button>
      </div>
    ) : null,
  ConfirmDialog: ({
    open,
    title,
    confirmLabel,
    onConfirm,
  }: {
    open: boolean;
    title: string;
    confirmLabel: string;
    onConfirm: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>{confirmLabel}</button>
      </div>
    ) : null,
}));

const iptal = vi.fn();
const ihtilaf = vi.fn();
const cozum = vi.fn();

const rezervasyon = (ek: Partial<AdminBookingOut> = {}) =>
  ({
    id: 41,
    tutor_id: 12,
    client_id: 13,
    tutor_name: "Ayşe Eğitmen",
    client_name: "Mert Öğrenci",
    start_at: "2026-09-15T10:00:00+03:00",
    end_at: "2026-09-15T11:00:00+03:00",
    price: 450,
    status: BookingStatus.ACCEPTED,
    is_disputed: false,
    admin_notes: "İncelenecek",
    cancel_reason: null,
    created_at: "2026-09-14T09:00:00+03:00",
    ...ek,
  }) as AdminBookingOut;

const sonuc = (items: AdminBookingOut[], total = items.length, ek: object = {}) =>
  ({
    data: { items, total },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...ek,
  }) as never;

function izin(...izinler: string[]) {
  useAuthStore.setState({
    token: "t",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: izinler } as never,
  });
}

function kur(yol = PATHS.adminNewBookings) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewBookings} element={<RezervasyonListesi />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  iptal.mockReset();
  ihtilaf.mockReset();
  vi.mocked(useAdminBookingList).mockReset().mockReturnValue(sonuc([rezervasyon()]));
  vi.mocked(useAdminCancelBooking).mockReturnValue({ mutate: iptal, isPending: false } as never);
  vi.mocked(useAdminToggleDisputeBooking).mockReturnValue({
    mutate: ihtilaf,
    isPending: false,
  } as never);
  vi.mocked(useAdminResolveDisputeBooking).mockReturnValue({
    mutate: cozum,
    isPending: false,
  } as never);
  izin("bookings.view", "bookings.manage", "users.view");
});

describe("RezervasyonListesi", () => {
  it("view yokken sorguyu kapatır ve AccessDenied gösterir", () => {
    izin("users.view");
    kur();
    expect(vi.mocked(useAdminBookingList).mock.calls.at(-1)?.[1]).toBe(false);
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
  });

  it("view-only görünümde tüm alanlar görünür, yazma aksiyonları yoktur", () => {
    izin("bookings.view");
    kur();
    expect(vi.mocked(useAdminBookingList).mock.calls.at(-1)?.[1]).toBe(true);
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getByText("Ayşe Eğitmen")).toBeInTheDocument();
    expect(screen.getByText("Mert Öğrenci")).toBeInTheDocument();
    expect(screen.getByText("Admin notu: İncelenecek")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ayşe Eğitmen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İptal / iade" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İhtilaf işaretle" })).not.toBeInTheDocument();
  });

  it("dolu liste taraf, zaman, tutar, durum ve notları; boş liste doğru durumu gösterir", () => {
    const gorunum = kur();
    expect(screen.getByRole("link", { name: "Ayşe Eğitmen" })).toHaveAttribute(
      "href",
      ROUTES.adminNewCustomer("tutor", 12),
    );
    expect(screen.getByText("450 TL")).toBeInTheDocument();
    expect(screen.getByText("Onaylandı")).toBeInTheDocument();
    gorunum.unmount();

    vi.mocked(useAdminBookingList).mockReturnValue(sonuc([]));
    kur();
    expect(screen.getByText("Rezervasyon yok")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filtreleri temizle" })).not.toBeInTheDocument();
  });

  it("adres filtresi ve gerçek sunucu sayfalaması sorgu payloadına gider", () => {
    kur(`${PATHS.adminNewBookings}?q=ayse&status=COMPLETED&disputed=true&page=2&limit=10`);
    expect(vi.mocked(useAdminBookingList).mock.calls.at(-1)).toEqual([
      {
        limit: 10,
        offset: 10,
        q: "ayse",
        status: BookingStatus.COMPLETED,
        is_disputed: true,
        sort: "created_at",
        order: "desc",
      },
      true,
    ]);
  });

  it("iptal, ihtilaf işaretleme ve ihtilaf kaldırma gerçek payloadları gönderir", () => {
    const gorunum = kur();
    fireEvent.click(screen.getByRole("button", { name: "İptal / iade" }));
    fireEvent.click(screen.getByRole("button", { name: "İptal et" }));
    expect(iptal).toHaveBeenCalledWith(
      { id: 41, reason: "Geçerli gerekçe" },
      expect.any(Object),
    );
    gorunum.unmount();

    kur();
    fireEvent.click(screen.getByRole("button", { name: "İhtilaf işaretle" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "İhtilaf işaretle" })).getByRole("button", {
        name: "İhtilaf işaretle",
      }),
    );
    expect(ihtilaf).toHaveBeenCalledWith(
      { id: 41, is_disputed: true, admin_notes: "Geçerli gerekçe" },
      expect.any(Object),
    );
    gorunum.unmount();

    vi.mocked(useAdminBookingList).mockReturnValue(
      sonuc([rezervasyon({ is_disputed: true })]),
    );
    kur();
    fireEvent.click(screen.getByRole("button", { name: "İhtilafı kaldır" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "İhtilafı kaldır" })).getByRole("button", {
        name: "İhtilafı kaldır",
      }),
    );
    expect(ihtilaf).toHaveBeenCalledWith(
      { id: 41, is_disputed: false },
      expect.any(Object),
    );
  });

  it("ihtilaflı derste iade / eğitmene ödeme kararı ve öğrencinin bildirdiği sorun görünür", () => {
    vi.mocked(useAdminBookingList).mockReturnValue(
      sonuc([
        rezervasyon({
          status: BookingStatus.COMPLETED,
          is_disputed: true,
          issue_reported_at: "2026-09-15T12:00:00+03:00",
          issue_reason: "TUTOR_ABSENT",
          issue_note: "Kapıya gelmedi",
        }),
      ]),
    );
    const gorunum = kur();
    expect(screen.getByText(/Eğitmen derse gelmedi — Kapıya gelmedi/)).toBeTruthy();
    // Tamamlanmış derste "İptal / iade" yok; para kararı ihtilaf düğmeleriyle verilir.
    expect(screen.queryByRole("button", { name: "İptal / iade" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Öğrenciye iade et" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Öğrenciye iade et" })).getByRole("button", {
        name: "İade et",
      }),
    );
    expect(cozum).toHaveBeenCalledWith(
      { id: 41, decision: "refund", note: "Geçerli gerekçe" },
      expect.any(Object),
    );
    gorunum.unmount();

    kur();
    fireEvent.click(screen.getByRole("button", { name: "Eğitmene öde" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Eğitmene öde" })).getByRole("button", {
        name: "Eğitmene öde",
      }),
    );
    expect(cozum).toHaveBeenCalledWith(
      { id: 41, decision: "release", note: "Geçerli gerekçe" },
      expect.any(Object),
    );
  });

  it("rota, Dersler menü grubu ve bookings izin beyanı doğrudur", () => {
    expect(PATHS.adminNewBookings).toBe("/yonetim-yeni/rezervasyonlar");
    expect(ROUTES.adminNewBookings).toBe(PATHS.adminNewBookings);
    expect(PANEL_MENU.find((oge) => oge.key === "dersler")?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "rezervasyonlar",
          path: PATHS.adminNewBookings,
          requiredPermission: "bookings",
        }),
      ]),
    );
    const beyan = rotaIzniBul(PANEL_MENU, PATHS.adminNewBookings)!;
    expect(beyan).toMatchObject({ label: "Rezervasyonlar", requiredPermission: "bookings" });
    expect(izinBeyaniniKarsilarMi(["bookings.view"], beyan)).toBe(true);
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewBookings)).toEqual({
      selectedKey: "rezervasyonlar",
      openKeys: ["dersler"],
    });
  });
});
