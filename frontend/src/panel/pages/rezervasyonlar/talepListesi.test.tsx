import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AccessDenied, ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAdminDemands, useCancelAdminDemand } from "@/hooks/useAdmin";
import { PATHS, ROUTES } from "@/lib/routes";
import { PanelProvider } from "@/panel/PanelProvider";
import {
  PANEL_MENU,
  izinBeyaniniKarsilarMi,
  rotaIzniBul,
  seciliMenuDurumu,
} from "@/panel/layout/menu";
import { TalepListesi } from "@/panel/pages/rezervasyonlar/TalepListesi";
import { useAuthStore } from "@/store/authStore";
import { DemandStatus, type AdminDemandOut } from "@/types";

vi.mock("@/hooks/useAdmin", () => ({
  useAdminDemands: vi.fn(),
  useCancelAdminDemand: vi.fn(),
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
}));

const iptal = vi.fn();

const talep = (ek: Partial<AdminDemandOut> = {}) =>
  ({
    id: 71,
    client_id: 13,
    client_name: "Mert Öğrenci",
    client_email: "mert@example.com",
    title: "TYT matematik desteği",
    description: "Hafta sonu ders arıyorum.",
    subject: "Matematik",
    level: "TYT",
    budget_min: "400",
    budget_max: "600",
    response_count: 3,
    status: DemandStatus.OPEN,
    created_at: "2026-09-14T09:00:00+03:00",
    ...ek,
  }) as AdminDemandOut;

const sonuc = (items: AdminDemandOut[], total = items.length) =>
  ({
    data: { items, total },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }) as never;

function izin(...izinler: string[]) {
  useAuthStore.setState({
    token: "t",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: izinler } as never,
  });
}

function kur(yol = PATHS.adminNewDemands) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewDemands} element={<TalepListesi />} />
            <Route path="*" element={<AccessDenied area="test" />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  iptal.mockReset();
  vi.mocked(useAdminDemands).mockReset().mockReturnValue(sonuc([talep()]));
  vi.mocked(useCancelAdminDemand).mockReturnValue({ mutate: iptal, isPending: false } as never);
  izin("demands.view", "demands.manage", "users.view");
});

describe("TalepListesi", () => {
  it("view yokken sorguyu kapatır ve AccessDenied gösterir", () => {
    izin("users.view");
    kur();
    expect(vi.mocked(useAdminDemands).mock.calls.at(-1)?.[1]).toBe(false);
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
  });

  it("view-only görünümde alanlar korunur, yazma aksiyonu ve yetkisiz üye bağlantısı yoktur", () => {
    izin("demands.view");
    kur();
    expect(vi.mocked(useAdminDemands).mock.calls.at(-1)?.[1]).toBe(true);
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getByText("TYT matematik desteği")).toBeInTheDocument();
    expect(screen.getByText("Hafta sonu ders arıyorum.")).toBeInTheDocument();
    expect(screen.getByText("Matematik · TYT")).toBeInTheDocument();
    expect(screen.getByText("400 TL – 600 TL")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mert Öğrenci" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İptal et" })).not.toBeInTheDocument();
  });

  it("dolu ve boş listeler ile tüm durumlar doğru görünür", () => {
    const gorunum = kur();
    expect(screen.getByRole("link", { name: "Mert Öğrenci" })).toHaveAttribute(
      "href",
      ROUTES.adminNewCustomer("client", 13),
    );
    expect(screen.getByText("Açık")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    gorunum.unmount();

    vi.mocked(useAdminDemands).mockReturnValue(sonuc([]));
    kur();
    expect(screen.getByText("Ders talebi bulunamadı")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filtreleri temizle" })).not.toBeInTheDocument();
  });

  it("adres filtresi ve gerçek sunucu sayfalaması sorgu payloadına gider", () => {
    kur(`${PATHS.adminNewDemands}?q=matematik&status=CLOSED&page=2&limit=10&sort=title&order=asc`);
    expect(vi.mocked(useAdminDemands).mock.calls.at(-1)).toEqual([
      {
        limit: 10,
        offset: 10,
        q: "matematik",
        status: DemandStatus.CLOSED,
        sort: "title",
        order: "asc",
      },
      true,
    ]);
  });

  it("açık talebi gerçek kimlik ve gerekçe payloadıyla iptal eder", () => {
    kur();
    fireEvent.click(screen.getByRole("button", { name: "İptal et" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Ders talebini iptal et" })).getByRole(
        "button",
        { name: "Talebi iptal et" },
      ),
    );
    expect(iptal).toHaveBeenCalledWith(
      { id: 71, reason: "Geçerli gerekçe" },
      expect.any(Object),
    );
  });

  it("rota, Dersler menü grubu ve demands izin beyanı doğrudur", () => {
    expect(PATHS.adminNewDemands).toBe("/yonetim-yeni/talepler");
    expect(ROUTES.adminNewDemands).toBe(PATHS.adminNewDemands);
    expect(PANEL_MENU.find((oge) => oge.key === "dersler")?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "talepler",
          path: PATHS.adminNewDemands,
          requiredPermission: "demands",
        }),
      ]),
    );
    const beyan = rotaIzniBul(PANEL_MENU, PATHS.adminNewDemands)!;
    expect(beyan).toMatchObject({ label: "Talepler", requiredPermission: "demands" });
    expect(izinBeyaniniKarsilarMi(["demands.view"], beyan)).toBe(true);
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewDemands)).toEqual({
      selectedKey: "talepler",
      openKeys: ["dersler"],
    });
  });
});
