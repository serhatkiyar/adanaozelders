import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { GostergePaneli } from "@/panel/pages/gosterge/GostergePaneli";
import { useAdminDashboard, useAdminRevenue } from "@/hooks/useAdmin";
import { useStoreConfig } from "@/hooks/useStore";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { TAM_ADMIN_IZINLERI } from "@/test-utils/adminIzinleri";
import type { AdminDashboardOut, AdminRevenueOut } from "@/types";

vi.mock("@/hooks/useAdmin", () => ({ useAdminDashboard: vi.fn(), useAdminRevenue: vi.fn() }));
vi.mock("@/hooks/useStore", () => ({ useStoreConfig: vi.fn() }));

const mockOzet = vi.mocked(useAdminDashboard);
const mockPara = vi.mocked(useAdminRevenue);

const OZET = {
  new_clients: 12, previous_new_clients: 9, new_tutors: 3, previous_new_tutors: 5,
  new_orders: 40, previous_new_orders: 40, pending_tutors: 4, pending_diplomas: 2,
  active_bookings: 17, open_demands: 6, disputed_bookings: 1, open_reports: 0,
  paid_orders: 8, pending_returns: 2, low_stock_products: 5, pending_libraries: 1,
  active_delivery_runs: 3, period_audit_logs: 25,
} as AdminDashboardOut;

const PARA = {
  gmv: "12000", previous_gmv: "10000", revenue: "1500", previous_revenue: "0",
  held: "300", previous_held: "300", aov: "300", previous_aov: "320", orders: 40,
  refunded: "120", previous_refunded: "100", refund_rate: 0.01,
  lesson_gmv: "8000", previous_lesson_gmv: "7000", library_gmv: "1000", previous_library_gmv: "900",
  store_gmv: "3000", previous_store_gmv: "2100", commission_revenue: "900", previous_commission_revenue: "800",
} as AdminRevenueOut;

function Konum() {
  return <output data-testid="konum">{useLocation().search}</output>;
}

function kur(baslangic = "/yonetim-yeni") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[baslangic]}>
          <Routes>
            <Route path="/yonetim-yeni" element={<><GostergePaneli /><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

const sonuc = (data: unknown, ek: object = {}) =>
  ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;

beforeEach(() => {
  vi.mocked(useStoreConfig).mockReturnValue({ data: { low_stock_threshold: 5 } } as never);
  mockOzet.mockReturnValue(sonuc(OZET));
  mockPara.mockReturnValue(sonuc(PARA));
  useAuthStore.setState({
    token: "t", isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: [...TAM_ADMIN_IZINLERI] } as never,
  });
});

describe("GostergePaneli", () => {
  it("KPI şeridi, para sütunu ve kuyruklar eski panel verisiyle basılır", () => {
    kur();
    const kpi = screen.getByRole("region", { name: "Dönem hareketi" });
    expect(within(kpi).getByText("+3 dönem farkı")).toBeInTheDocument();
    expect(within(kpi).getByText("-2 dönem farkı")).toBeInTheDocument();
    expect(within(kpi).getByText("+%20")).toBeInTheDocument();
    expect(within(kpi).getByText("yeni")).toBeInTheDocument();

    const para = screen.getByRole("region", { name: "Para" });
    expect(within(para).getByText("%0")).toBeInTheDocument();
    expect(within(para).getByText("İade (hacmin %1'i)")).toBeInTheDocument();

    const kuyruk = screen.getByRole("region", { name: "Operasyon kuyrukları" });
    expect(within(kuyruk).getAllByRole("listitem")).toHaveLength(10);
    const dusukStok = within(kuyruk).getByText("Düşük stok").closest("[role=listitem]") as HTMLElement;
    expect(within(dusukStok).getByRole("link")).toHaveAttribute("href", `${ROUTES.adminNewProducts}?stok=kritik`);
    expect(within(dusukStok).getByText(/stok 5 veya altında/)).toBeInTheDocument();
  });

  it("dönem seçimi URL'ye yazılır ve hook'lara gider; hafta varsayılanı URL'de tutulmaz", async () => {
    kur("/yonetim-yeni?range=day");
    expect(mockOzet).toHaveBeenLastCalledWith("day");
    await userEvent.click(screen.getByRole("combobox", { name: "Dönem" }));
    await userEvent.click(await screen.findByTitle("Son 30 Gün"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("?range=month"));
    expect(mockPara).toHaveBeenLastCalledWith("month");
    await userEvent.click(screen.getByRole("combobox", { name: "Dönem" }));
    await userEvent.click(await screen.findByTitle("Son 7 Gün"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent(""));
  });

  it("özet hatası Tekrar dene sunar; para hatası yalnız para kartında kalır", async () => {
    const refetch = vi.fn();
    mockOzet.mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch }));
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();

    mockOzet.mockReturnValue(sonuc(OZET));
    mockPara.mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x") }));
    kur();
    expect(screen.getByText("Para özeti yüklenemedi.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Operasyon kuyrukları" })).toBeInTheDocument();
  });

  it("dashboard.view izni yoksa 403 kutusu", () => {
    useAuthStore.setState({
      token: "t", isAuthenticated: true,
      user: { id: 1, role_id: 1, admin_permissions: TAM_ADMIN_IZINLERI.filter((i) => !i.startsWith("dashboard")) } as never,
    });
    kur();
    expect(screen.getByText("Bu alan için yetkiniz yok")).toBeInTheDocument();
  });
});
