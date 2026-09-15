import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PanelProvider } from "@/panel/PanelProvider";
import { DenemeKataloglari } from "@/panel/pages/kutuphaneler/DenemeKataloglari";
import {
  useCatalogs,
  useDeleteCatalog,
  useUploadCatalogAnswerKey,
} from "@/hooks/useExamCatalogs";
import { PATHS, ROUTES } from "@/lib/routes";
import {
  PANEL_MENU,
  izinBeyaniniKarsilarMi,
  rotaIzniBul,
  seciliMenuDurumu,
} from "@/panel/layout/menu";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { CatalogOut } from "@/types";

vi.mock("@/hooks/useExamCatalogs", () => ({
  useCatalogs: vi.fn(),
  useDeleteCatalog: vi.fn(),
  useUploadCatalogAnswerKey: vi.fn(),
}));
vi.mock("@/pages/dashboards/AdminExamCatalogs", () => ({
  emptyForm: () => ({ exam_name: "" }),
  toForm: (katalog: CatalogOut) => ({ ...katalog }),
  CatalogEditorPenceresi: ({ yuzey }: { yuzey: { kayit: CatalogOut | null } }) =>
    yuzey.kayit ? (
      <div role="dialog" aria-label="Katalog editörü">
        {yuzey.kayit.id ? "Katalog düzenleme" : "Yeni katalog"}
      </div>
    ) : null,
}));
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
}));

const sil = vi.fn();
const yukle = vi.fn();

const katalog = (ek: Partial<CatalogOut> = {}) =>
  ({
    id: 7,
    exam_name: "Türkiye Geneli TYT",
    exam_type: "TYT",
    publisher_name: "Örnek Yayınları",
    description: "Ortak deneme",
    question_count: 120,
    duration_minutes: 165,
    is_public: true,
    is_nationwide: true,
    answer_key_url: "https://example.test/cevap.pdf",
    session_count: 3,
    ...ek,
  }) as CatalogOut;

const sonuc = (data: unknown, ek: object = {}) =>
  ({
    data,
    isPending: false,
    isError: false,
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
        <MemoryRouter initialEntries={[PATHS.adminNewExamCatalogs]}>
          <Routes>
            <Route path={PATHS.adminNewExamCatalogs} element={<DenemeKataloglari />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sil.mockReset();
  yukle.mockReset();
  vi.mocked(useCatalogs).mockReset().mockReturnValue(sonuc([katalog()]));
  vi.mocked(useDeleteCatalog).mockReturnValue({ mutate: sil, isPending: false } as never);
  vi.mocked(useUploadCatalogAnswerKey).mockReturnValue({
    mutate: yukle,
    isPending: false,
  } as never);
  izin("catalogs.view", "catalogs.manage");
});

describe("DenemeKataloglari", () => {
  it("view yokken sorguyu kapatır ve AccessDenied gösterir", () => {
    izin("libraries.view");
    kur();
    expect(vi.mocked(useCatalogs)).toHaveBeenLastCalledWith(false);
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
  });

  it("view-only görünümde katalog ve cevap anahtarı görünür, yazma aksiyonu yoktur", () => {
    izin("catalogs.view");
    kur();
    expect(vi.mocked(useCatalogs)).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cevap anahtarını görüntüle" })).toHaveAttribute(
      "href",
      "https://example.test/cevap.pdf",
    );
    for (const ad of [/Katalog ekle/i, /Cevap Anahtarı|Değiştir/, /Düzenle/, /Sil/]) {
      expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    }
  });

  it("dolu liste tüm katalog özetini; boş liste tek ekleme aksiyonunu gösterir", () => {
    const gorunum = kur();
    const satir = screen.getByTestId("katalog-7");
    expect(satir).toHaveTextContent("Türkiye Geneli TYT");
    expect(satir).toHaveTextContent("120 soru · 165 dk · 3 oturum");
    expect(within(satir).getByRole("link", { name: "Cevap anahtarı ✓" })).toHaveAttribute(
      "href",
      "https://example.test/cevap.pdf",
    );
    gorunum.unmount();

    vi.mocked(useCatalogs).mockReturnValue(sonuc([]));
    kur();
    expect(screen.getByText("Henüz katalog eklenmedi")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Katalog ekle" })).toHaveLength(1);
  });

  it("ekleme ve düzenleme aynı mevcut katalog editörünü açar", () => {
    const gorunum = kur();
    fireEvent.click(screen.getByRole("button", { name: "Katalog ekle" }));
    expect(screen.getByRole("dialog", { name: "Katalog editörü" })).toHaveTextContent(
      "Yeni katalog",
    );
    gorunum.unmount();

    kur();
    fireEvent.click(within(screen.getByTestId("katalog-7")).getByRole("button", { name: "Düzenle" }));
    expect(screen.getByRole("dialog", { name: "Katalog editörü" })).toHaveTextContent(
      "Katalog düzenleme",
    );
  });

  it("cevap anahtarı ve silme gerçek hedef/payload ile mutation çağırır", () => {
    const { container } = kur();
    const dosya = new File(["cevap"], "cevap.pdf", { type: "application/pdf" });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [dosya] } });
    expect(yukle).toHaveBeenCalledWith({ id: 7, file: dosya }, expect.any(Object));

    fireEvent.click(within(screen.getByTestId("katalog-7")).getByRole("button", { name: "Sil" }));
    fireEvent.click(screen.getByRole("button", { name: "Kataloğu sil" }));
    expect(sil).toHaveBeenCalledWith(7, expect.any(Object));
  });

  it("rota, menü grubu ve catalogs izin beyanı doğrudur", () => {
    expect(PATHS.adminNewExamCatalogs).toBe(
      "/yonetim-yeni/kutuphaneler/deneme-kataloglari",
    );
    expect(ROUTES.adminNewExamCatalogs).toBe(PATHS.adminNewExamCatalogs);
    expect(PANEL_MENU.find((oge) => oge.key === "kutuphaneler")?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "deneme-kataloglari",
          path: PATHS.adminNewExamCatalogs,
          requiredPermission: "catalogs",
        }),
      ]),
    );
    const beyan = rotaIzniBul(PANEL_MENU, PATHS.adminNewExamCatalogs)!;
    expect(beyan).toMatchObject({
      label: "Deneme Katalogları",
      requiredPermission: "catalogs",
    });
    expect(izinBeyaniniKarsilarMi(["catalogs.view"], beyan)).toBe(true);
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewExamCatalogs)).toEqual({
      selectedKey: "deneme-kataloglari",
      openKeys: ["kutuphaneler"],
    });
  });
});
