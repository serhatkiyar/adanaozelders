import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useCreatePayout, usePayoutHistory, usePendingPayouts } from "@/hooks/usePayouts";
import { PATHS } from "@/lib/routes";
import { PanelProvider } from "@/panel/PanelProvider";
import { PANEL_MENU, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { HakEdisler } from "@/panel/pages/finans/HakEdisler";
import { useAuthStore } from "@/store/authStore";

vi.mock("@/hooks/usePayouts", () => ({
  usePendingPayouts: vi.fn(),
  usePayoutHistory: vi.fn(),
  useCreatePayout: vi.fn(),
}));

const gonder = vi.fn();
const bakiye = {
  payee_type: "TUTOR" as const,
  payee_id: 7,
  name: "Ayşe Öğretmen",
  iban: "TR120006200000000000000001",
  earned: "1500.00",
  paid: "250.00",
  balance: "1250.00",
  pending: "300.00",
};

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}

function kur(yol = PATHS.adminNewPayouts) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes><Route path={PATHS.adminNewPayouts} element={<HakEdisler />} /></Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  gonder.mockReset().mockResolvedValue({ id: 1 });
  vi.mocked(usePendingPayouts).mockReset().mockReturnValue({ data: [bakiye], isPending: false, isError: false, refetch: vi.fn() } as never);
  vi.mocked(usePayoutHistory).mockReset().mockReturnValue({ data: [], isPending: false, isError: false, refetch: vi.fn() } as never);
  vi.mocked(useCreatePayout).mockReturnValue({ mutateAsync: gonder, isPending: false } as never);
  izin("payments.view", "payments.manage");
});

describe("HakEdisler", () => {
  it("view yokken iki sorguyu da kapatır ve AccessDenied gösterir", () => {
    izin();
    kur();
    expect(vi.mocked(usePendingPayouts).mock.calls.at(-1)).toEqual([true, false]);
    expect(vi.mocked(usePayoutHistory).mock.calls.at(-1)).toEqual([100, false]);
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
  });

  it("view-only görünümde para alanları var, ödeme aksiyonu yoktur", () => {
    izin("payments.view");
    kur();
    expect(screen.getByText("Ayşe Öğretmen")).toBeInTheDocument();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ödedim" })).not.toBeInTheDocument();
  });

  it("dolu ve boş ödenecekler ile boş geçmişi dürüst gösterir", () => {
    const gorunum = kur();
    expect(screen.getByText(/Toplam ödenecek:/)).toBeInTheDocument();
    gorunum.unmount();
    vi.mocked(usePendingPayouts).mockReturnValue({ data: [], isPending: false, isError: false, refetch: vi.fn() } as never);
    kur();
    expect(screen.getByText("Ödenmemiş hak ediş yok")).toBeInTheDocument();
  });

  it("ödeme penceresi eski alanları açar ve gerçek payloadı gönderir", async () => {
    kur();
    fireEvent.click(screen.getByRole("button", { name: "Ödedim" }));
    expect(screen.getByRole("dialog", { name: "Ödeme kaydı: Ayşe Öğretmen" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tutar (TL)"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Havale referansı"), { target: { value: "  EFT-42  " } });
    fireEvent.change(screen.getByLabelText("Not"), { target: { value: "  Eylül ödemesi  " } });
    fireEvent.click(screen.getByRole("button", { name: "Ödemeyi kaydet" }));
    await waitFor(() => expect(gonder).toHaveBeenCalledWith({ payee_type: "TUTOR", payee_id: 7, amount: "500", reference: "EFT-42", note: "Eylül ödemesi" }));
  });

  it("geçmiş sekmesi yalnız geçmiş sorgusunu açar", () => {
    vi.mocked(usePayoutHistory).mockReturnValue({ data: [{ id: 9, payee_type: "LIBRARY", payee_id: 3, amount: "400.00", currency: "TRY", paid_at: "2026-09-14T09:00:00+03:00", reference: "R-9", iban_snapshot: "TR42" }], isPending: false, isError: false, refetch: vi.fn() } as never);
    kur(`${PATHS.adminNewPayouts}?sekme=gecmis`);
    expect(vi.mocked(usePendingPayouts).mock.calls.at(-1)).toEqual([true, false]);
    expect(vi.mocked(usePayoutHistory).mock.calls.at(-1)).toEqual([100, true]);
    expect(screen.getByText("R-9")).toBeInTheDocument();
  });

  it("rota ve Finans menü seçimi doğrudur", () => {
    expect(PATHS.adminNewPayouts).toBe("/yonetim-yeni/finans/hakedisler");
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewPayouts)).toMatchObject({ requiredPermission: "payments" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewPayouts)).toEqual({ selectedKey: "hakedisler", openKeys: ["finans"] });
  });
});
