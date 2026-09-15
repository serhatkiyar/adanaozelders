import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAdminReportList, useResolveReport } from "@/hooks/useReports";
import { PATHS, ROUTES } from "@/lib/routes";
import { PanelProvider } from "@/panel/PanelProvider";
import {
  PANEL_MENU,
  izinBeyaniniKarsilarMi,
  rotaIzniBul,
  seciliMenuDurumu,
} from "@/panel/layout/menu";
import { SikayetListesi } from "@/panel/pages/moderasyon/SikayetListesi";
import { useAuthStore } from "@/store/authStore";
import { ReportReason, ReportStatus, type ReportOut } from "@/types";

vi.mock("@/hooks/useReports", () => ({
  useAdminReportList: vi.fn(),
  useResolveReport: vi.fn(),
}));
vi.mock("@/panel/components/YanPencere", () => ({
  YanPencere: ({
    acik,
    baslik,
    kapat,
    kaydet,
    kaydetMetni,
    children,
  }: {
    acik: boolean;
    baslik: string;
    kapat: () => void;
    kaydet: () => void;
    kaydetMetni?: string;
    children: React.ReactNode;
  }) =>
    acik ? (
      <div role="dialog" aria-label={baslik}>
        {children}
        <button onClick={kapat}>Vazgeç</button>
        <button onClick={kaydet}>{kaydetMetni}</button>
      </div>
    ) : null,
}));

const cozumle = vi.fn();

const rapor = (ek: Partial<ReportOut> = {}) =>
  ({
    id: 91,
    reporter_role: 2,
    reporter_id: 17,
    target_type: "REVIEW",
    target_id: 44,
    reason: ReportReason.HARASSMENT,
    description: "Hakaret içeriyor.",
    status: ReportStatus.OPEN,
    resolution: null,
    resolved_at: null,
    created_at: "2026-09-14T09:00:00+03:00",
    ...ek,
  }) as ReportOut;

const sonuc = (items: ReportOut[], total = items.length) =>
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

function kur(yol = PATHS.adminNewReports) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewReports} element={<SikayetListesi />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cozumle.mockReset();
  vi.mocked(useAdminReportList).mockReset().mockReturnValue(sonuc([rapor()]));
  vi.mocked(useResolveReport).mockReturnValue({ mutate: cozumle, isPending: false } as never);
  izin("reports.view", "reports.manage");
});

describe("SikayetListesi", () => {
  it("view yokken sorguyu kapatır ve AccessDenied gösterir", () => {
    izin();
    kur();
    expect(vi.mocked(useAdminReportList).mock.calls.at(-1)?.[1]).toBe(false);
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
  });

  it("view-only görünümde şikayet bilgileri var, karar aksiyonları yoktur", () => {
    izin("reports.view");
    kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getByText("REVIEW #44")).toBeInTheDocument();
    expect(screen.getByText("Taciz / hakaret")).toBeInTheDocument();
    expect(screen.getByText("Hakaret içeriyor.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Çöz" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reddet" })).not.toBeInTheDocument();
  });

  it("dolu, boş ve karar verilmiş liste durumları doğru görünür", () => {
    const gorunum = kur();
    expect(screen.getAllByText("Açık").length).toBeGreaterThan(0);
    gorunum.unmount();

    vi.mocked(useAdminReportList).mockReturnValue(sonuc([rapor({ status: ReportStatus.RESOLVED })]));
    const kararlı = kur();
    expect(screen.getByText("Çözüldü")).toBeInTheDocument();
    expect(screen.getByText("Karar verildi")).toBeInTheDocument();
    kararlı.unmount();

    vi.mocked(useAdminReportList).mockReturnValue(sonuc([]));
    kur();
    expect(screen.getByText("Bu kuyrukta şikayet yok")).toBeInTheDocument();
  });

  it("adres filtresi ve sunucu sayfalaması sorgu payloadına gider", () => {
    kur(`${PATHS.adminNewReports}?status=DISMISSED&target=MESSAGE&page=2&limit=10`);
    expect(vi.mocked(useAdminReportList).mock.calls.at(-1)).toEqual([
      {
        status: ReportStatus.DISMISSED,
        target_type: "MESSAGE",
        limit: 10,
        offset: 10,
      },
      true,
    ]);
  });

  it("çözme ve reddetme kararlarında doğru payloadı gönderir", () => {
    const gorunum = kur();
    fireEvent.click(screen.getByRole("button", { name: "Çöz" }));
    expect(screen.getByRole("checkbox", { name: /Yorumu yayından kaldır/ })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Moderasyon notu (isteğe bağlı)"), {
      target: { value: "  İçerik incelendi.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kararı kaydet" }));
    expect(cozumle).toHaveBeenCalledWith(
      {
        id: 91,
        status: ReportStatus.RESOLVED,
        resolution: "İçerik incelendi.",
        hideTarget: true,
      },
      expect.any(Object),
    );
    gorunum.unmount();

    vi.mocked(useAdminReportList).mockReturnValue(sonuc([rapor({ target_type: "MESSAGE" })]));
    kur();
    fireEvent.click(screen.getByRole("button", { name: "Reddet" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kararı kaydet" }));
    expect(cozumle).toHaveBeenLastCalledWith(
      {
        id: 91,
        status: ReportStatus.DISMISSED,
        resolution: undefined,
        hideTarget: false,
      },
      expect.any(Object),
    );
  });

  it("rota, Moderasyon menüsü ve reports izin beyanı doğrudur", () => {
    expect(PATHS.adminNewReports).toBe("/yonetim-yeni/moderasyon/sikayetler");
    expect(ROUTES.adminNewReports).toBe(PATHS.adminNewReports);
    expect(PANEL_MENU.find((oge) => oge.key === "moderasyon")?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "sikayetler",
          path: PATHS.adminNewReports,
          requiredPermission: "reports",
        }),
      ]),
    );
    const beyan = rotaIzniBul(PANEL_MENU, PATHS.adminNewReports)!;
    expect(izinBeyaniniKarsilarMi(["reports.view"], beyan)).toBe(true);
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewReports)).toEqual({
      selectedKey: "sikayetler",
      openKeys: ["moderasyon"],
    });
  });
});
