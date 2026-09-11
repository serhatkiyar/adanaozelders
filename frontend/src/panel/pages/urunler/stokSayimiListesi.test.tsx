import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { StokSayimiListesi } from "@/panel/pages/urunler/StokSayimiListesi";
import { useCountSessions, useCreateCountSession } from "@/hooks/useInventory";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import type { CountSessionOut } from "@/api/inventory";

vi.mock("@/hooks/useInventory", () => ({ useCountSessions: vi.fn(), useCreateCountSession: vi.fn() }));
vi.mock("@/hooks/useStore", () => ({
  useAdminProducts: () => ({ data: { items: [], total: 0 }, isFetching: false }),
  useCategories: () => ({ data: [], isPending: false }),
}));
const navigateMock = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

const mockListe = vi.mocked(useCountSessions);
const mutate = vi.fn();

const OTURUM = {
  id: 7, code: "SAY-000007", status: "IN_PROGRESS", scope: "MANUAL", created_by_admin_id: 3,
  created_at: "2026-09-10T10:00:00Z", line_count: 12, uncounted_line_count: 4, has_stale: true,
} as CountSessionOut;

function Konum() {
  return <output data-testid="konum">{useLocation().search}</output>;
}

function kur(baslangic = "/yonetim-yeni/urunler/stok-sayimi") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[baslangic]}>
          <Routes>
            <Route path="/yonetim-yeni/urunler/stok-sayimi" element={<><StokSayimiListesi /><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigateMock.mockClear();
  mutate.mockClear();
  mockListe.mockReturnValue({ data: { items: [OTURUM], total: 1 }, isPending: false, isSuccess: true, isError: false, refetch: vi.fn() } as never);
  vi.mocked(useCreateCountSession).mockReturnValue({ mutate, isPending: false } as never);
  useAuthStore.setState({
    token: "t", isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: ["inventory.view", "inventory.count"] } as never,
  });
});

describe("StokSayimiListesi", () => {
  it("satır kod/kapsam/satır/uyarı/açılış/durum basar; kod eski detay rotasına bağlantıdır, satır tıklaması da oraya gider", async () => {
    kur();
    expect(screen.getByRole("link", { name: "SAY-000007" })).toHaveAttribute("href", ROUTES.adminInventoryCount(7));
    expect(screen.getByText("Seçili ürünler · Açan: #3")).toBeInTheDocument();
    expect(screen.getByText("12 satır, 4 sayılmadı")).toBeInTheDocument();
    expect(screen.getByText("Yeniden sayım gerekiyor")).toBeInTheDocument();
    expect(screen.getByText("Sayım sürüyor")).toBeInTheDocument();
    await userEvent.click(screen.getByText("12 satır, 4 sayılmadı"));
    expect(navigateMock).toHaveBeenCalledWith(ROUTES.adminInventoryCount(7));
  });

  it("durum süzgeci URL'de yaşar ve hook'a gider; uydurma değer elenir", async () => {
    kur("/yonetim-yeni/urunler/stok-sayimi?durum=UYDURMA");
    expect(mockListe).toHaveBeenLastCalledWith(expect.objectContaining({ status: "" }));

    await userEvent.click(screen.getByRole("button", { name: "Filtre" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Durum" }));
    await userEvent.click(await screen.findByTitle("İncelemede"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("?durum=REVIEW"));
    expect(mockListe).toHaveBeenLastCalledWith(expect.objectContaining({ status: "REVIEW", offset: 0 }));
  });

  it("dolu liste: tablo ve üstte tek 'Stok Sayımı Ekle' var", () => {
    kur();
    expect(screen.getByRole("heading", { name: "Stok Sayımı" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtre" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Stok Sayımı Ekle/ })).toHaveLength(1);
  });

  it("filtresiz boş: ikas boş durumu ve TEK düğme; başlık şeridi/Filtre/tablo/sayfalama yok", () => {
    mockListe.mockReturnValue({ data: { items: [], total: 0 }, isPending: false, isSuccess: true, isError: false } as never);
    kur();
    expect(screen.getByText("Stok Sayımınızı Yönetin")).toBeInTheDocument();
    expect(screen.getByText(/sayım oturumlarıyla takip edebilir/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Stok Sayımı Ekle/ })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Stok Sayımı" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filtre" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("Satır Adedi:")).not.toBeInTheDocument();
  });

  it("filtreli boş: liste kabuğu, Filtre ve 'Süzgeci temizle' kalır", async () => {
    mockListe.mockReturnValue({ data: { items: [], total: 0 }, isPending: false, isSuccess: true, isError: false } as never);
    kur("/yonetim-yeni/urunler/stok-sayimi?durum=APPLIED");
    expect(screen.getByRole("button", { name: "Filtre" })).toBeInTheDocument();
    expect(screen.getByText("Bu durumda oturum yok")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Süzgeci temizle" }));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent(""));
    expect(screen.getByText("Stok Sayımınızı Yönetin")).toBeInTheDocument();
  });

  it("inventory.count yoksa Stok Sayımı Ekle görünmez", () => {
    useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: ["inventory.view"] } as never });
    kur();
    expect(screen.queryByRole("button", { name: /Stok Sayımı Ekle/ })).not.toBeInTheDocument();
  });

  it("yeni sayım: MANUAL kapsamda ürünsüz gönderim istek atmaz ve hata alanda çıkar; ALL kapsamı gönderilir", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: /Stok Sayımı Ekle/ }));
    const cekmece = await screen.findByRole("dialog");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Oturumu aç" }));
    expect(await within(cekmece).findByText("En az bir ürün seçin.")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.click(within(cekmece).getByRole("combobox", { name: "Kapsam" }));
    await userEvent.click(await screen.findByTitle("Tüm ürünler"));
    await userEvent.click(within(cekmece).getByRole("button", { name: "Oturumu aç" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ scope: "ALL", product_ids: undefined, category_id: undefined, note: null }, expect.anything()));
  });
});
