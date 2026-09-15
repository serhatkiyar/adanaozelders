import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { KutuphaneListesi } from "@/panel/pages/kutuphaneler/KutuphaneListesi";
import {
  izinBeyaniniKarsilarMi,
  PANEL_MENU,
  rotaIzniBul,
  seciliMenuDurumu,
} from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import {
  useAdminLibraries,
  useApproveLibrary,
  useDeleteLibrary,
  useRejectLibrary,
} from "@/hooks/useLibraries";
import { fetchLibraryAdmin } from "@/api/libraries";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { LibrarySearchOut } from "@/types";

vi.mock("@/hooks/useLibraries", () => ({
  useAdminLibraries: vi.fn(),
  useApproveLibrary: vi.fn(),
  useDeleteLibrary: vi.fn(),
  useRejectLibrary: vi.fn(),
}));
vi.mock("@/api/libraries", () => ({ fetchLibraryAdmin: vi.fn() }));
vi.mock("@/components/LibraryEditorModal", () => ({
  emptyEditor: () => ({ name: "" }),
  toEditorState: (deger: unknown) => deger,
  LibraryEditorModal: ({ yuzey }: { yuzey: { kayit: { id?: number } | null } }) =>
    yuzey.kayit ? (
      <div role="dialog" aria-label="Kütüphane editörü">
        {yuzey.kayit.id ? "Kütüphane düzenleme" : "Yeni kütüphane"}
      </div>
    ) : null,
}));
vi.mock("@/components/ExamSessionsManager", () => ({
  ExamSessionsManager: () => <div>Oturum yönetimi</div>,
}));
vi.mock("@/components/LibraryPayoutForm", () => ({
  LibraryPayoutForm: () => <div>Ödeme formu</div>,
}));
vi.mock("@/pages/dashboards/AdminLibraries", () => ({
  OperatorsManager: () => <div>Operatör yönetimi</div>,
}));
vi.mock("@/components/admin/ui2/duzenlemeYuzeyi", async (importOriginal) => {
  const asil = await importOriginal<typeof import("@/components/admin/ui2/duzenlemeYuzeyi")>();
  return {
    ...asil,
    DuzenlemePenceresi: ({
      yuzey,
      baslik,
      children,
    }: {
      yuzey: { kayit: unknown | null };
      baslik: string;
      children: React.ReactNode;
    }) =>
      yuzey.kayit ? (
        <div role="dialog" aria-label={baslik}>
          {children}
        </div>
      ) : null,
  };
});
vi.mock("@/components/admin/ui", () => ({
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
        <button onClick={() => onConfirm("Uygun değil")}>{confirmLabel}</button>
      </div>
    ) : null,
}));

const onayla = vi.fn();
const reddet = vi.fn();
const sil = vi.fn();

const kutuphane = (ek: Partial<LibrarySearchOut> = {}) =>
  ({
    id: 1,
    name: "Merkez Kütüphane",
    status: "PENDING",
    city: "Adana",
    district: "Seyhan",
    location_text: "Seyhan / Adana",
    rating_average: 4.5,
    cover_url: null,
    ...ek,
  }) as LibrarySearchOut;

const sonuc = (data: unknown, ek: object = {}) =>
  ({
    data,
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

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[PATHS.adminNewLibraries]}>
          <Routes>
            <Route path={PATHS.adminNewLibraries} element={<KutuphaneListesi />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  onayla.mockReset();
  reddet.mockReset();
  sil.mockReset();
  vi.mocked(fetchLibraryAdmin).mockReset().mockResolvedValue(kutuphane() as never);
  vi.mocked(useAdminLibraries).mockReset().mockReturnValue(sonuc([
    kutuphane(),
    kutuphane({ id: 2, name: "İlçe Kütüphanesi", status: "ACTIVE" }),
  ]));
  vi.mocked(useApproveLibrary).mockReturnValue({ mutate: onayla, isPending: false } as never);
  vi.mocked(useRejectLibrary).mockReturnValue({ mutate: reddet, isPending: false } as never);
  vi.mocked(useDeleteLibrary).mockReturnValue({ mutate: sil, isPending: false } as never);
  izin("libraries.view", "libraries.manage");
});

describe("KutuphaneListesi", () => {
  it("view yokken AccessDenied gösterir ve sorguyu kapatır", () => {
    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(vi.mocked(useAdminLibraries)).toHaveBeenLastCalledWith(false);
  });

  it("view-only durumda liste ve salt okunur açıklama görünür, yazma yüzeyi yoktur", () => {
    izin("libraries.view");
    kur();
    expect(vi.mocked(useAdminLibraries)).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getAllByText("Merkez Kütüphane").length).toBeGreaterThan(0);
    for (const ad of [/Kütüphane ekle/i, /Onayla/, /Reddet/, /Düzenle/, /Sil/]) {
      expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    }
  });

  it("onay kuyruğunu ve listeyi gerçek kayıtlarla; boş durumda tek ekleme aksiyonuyla gösterir", () => {
    const gorunum = kur();
    expect(screen.getByRole("region", { name: "Onay bekleyen kütüphaneler" })).toBeInTheDocument();
    expect(screen.getByText("Onay bekliyor")).toBeInTheDocument();
    expect(screen.getByTestId("kutuphane-1")).toHaveTextContent("★ 4.5");
    gorunum.unmount();

    vi.mocked(useAdminLibraries).mockReturnValue(sonuc([]));
    kur();
    expect(screen.getByText("Henüz kütüphane eklenmedi")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Kütüphane ekle" })).toHaveLength(1);
  });

  it("onay, red ve silme gerçek hedef/payload ile mutation çağırır", () => {
    kur();
    const kuyruk = within(screen.getByRole("region", { name: "Onay bekleyen kütüphaneler" }));
    fireEvent.click(kuyruk.getByRole("button", { name: "Onayla" }));
    fireEvent.click(screen.getByRole("button", { name: "Onayla ve yayınla" }));
    expect(onayla).toHaveBeenCalledWith(1, expect.any(Object));

    fireEvent.click(kuyruk.getByRole("button", { name: "Reddet" }));
    fireEvent.click(screen.getByRole("button", { name: "Başvuruyu reddet" }));
    expect(reddet).toHaveBeenCalledWith(
      { id: 1, reason: "Uygun değil" },
      expect.any(Object),
    );

    fireEvent.click(within(screen.getByTestId("kutuphane-2")).getByRole("button", { name: "Sil" }));
    fireEvent.click(screen.getByRole("button", { name: "Kütüphaneyi sil" }));
    expect(sil).toHaveBeenCalledWith(2, expect.any(Object));
  });

  it("düzenleme, oturum-operatör ve ödeme yüzeylerini açar", async () => {
    kur();
    const satir = within(screen.getByTestId("kutuphane-2"));
    fireEvent.click(satir.getByRole("button", { name: "Düzenle" }));
    await waitFor(() => expect(fetchLibraryAdmin).toHaveBeenCalledWith(2));
    expect(await screen.findByRole("dialog", { name: "Kütüphane editörü" })).toHaveTextContent("Kütüphane düzenleme");

    fireEvent.click(satir.getByRole("button", { name: "Oturumlar & Operatörler" }));
    expect(screen.getByText("Operatör yönetimi")).toBeInTheDocument();
    expect(screen.getByText("Oturum yönetimi")).toBeInTheDocument();

    fireEvent.click(satir.getByRole("button", { name: "Ödeme" }));
    expect(screen.getByText("Ödeme formu")).toBeInTheDocument();
  });

  it("rota, menü ve izin beyanı doğrudur", () => {
    expect(PATHS.adminNewLibraries).toBe("/yonetim-yeni/kutuphaneler");
    expect(ROUTES.adminNewLibraries).toBe(PATHS.adminNewLibraries);
    expect(PANEL_MENU.find((oge) => oge.key === "kutuphaneler")?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "kutuphane-listesi",
          path: PATHS.adminNewLibraries,
          requiredPermission: "libraries",
        }),
      ]),
    );
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewLibraries)).toMatchObject({
      label: "Kütüphaneler",
      requiredPermission: "libraries",
    });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewLibraries)).toEqual({
      selectedKey: "kutuphane-listesi",
      openKeys: ["kutuphaneler"],
    });
    expect(
      izinBeyaniniKarsilarMi(
        ["libraries.view"],
        rotaIzniBul(PANEL_MENU, PATHS.adminNewLibraries)!,
      ),
    ).toBe(true);
  });
});
