import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import {
  useAdminNameChangeRequests,
  useApproveNameChange,
  useRejectNameChange,
} from "@/hooks/useNameChanges";
import { PATHS } from "@/lib/routes";
import { PanelProvider } from "@/panel/PanelProvider";
import { PANEL_MENU, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { AdDegisiklikleri } from "@/panel/pages/moderasyon/AdDegisiklikleri";
import { useAuthStore } from "@/store/authStore";
import type { NameChangeRequest } from "@/types";

vi.mock("@/hooks/useNameChanges", () => ({
  useAdminNameChangeRequests: vi.fn(),
  useApproveNameChange: vi.fn(),
  useRejectNameChange: vi.fn(),
}));
vi.mock("@/components/admin/ui", () => ({
  ReasonDialog: ({ open, title, confirmLabel, onConfirm }: { open: boolean; title: string; confirmLabel: string; onConfirm: (note: string) => void }) =>
    open ? <div role="dialog" aria-label={title}><button onClick={() => onConfirm("  Uygun değil.  ")}>{confirmLabel}</button></div> : null,
}));

const onayla = vi.fn();
const reddet = vi.fn();
const kayit = (ek: Partial<NameChangeRequest> = {}): NameChangeRequest => ({
  id: 31,
  user_id: 44,
  role_id: 3,
  kind: "NAME",
  new_first_name: "Yeni",
  new_last_name: "İsim",
  reason: "Resmî adım değişti.",
  status: "PENDING",
  review_note: null,
  reviewed_at: null,
  created_at: "2026-09-14T09:00:00+03:00",
  ...ek,
});

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}

function kur(yol = PATHS.adminNewNameChanges) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes><Route path={PATHS.adminNewNameChanges} element={<AdDegisiklikleri />} /></Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  onayla.mockReset();
  reddet.mockReset();
  vi.mocked(useAdminNameChangeRequests).mockReset().mockReturnValue({ data: [kayit()], isPending: false, isError: false, error: null, refetch: vi.fn() } as never);
  vi.mocked(useApproveNameChange).mockReturnValue({ mutate: onayla, isPending: false } as never);
  vi.mocked(useRejectNameChange).mockReturnValue({ mutate: reddet, isPending: false } as never);
  izin("users.view", "users.manage");
});

describe("AdDegisiklikleri", () => {
  it("view yokken sorguyu kapatır ve AccessDenied gösterir", () => {
    izin();
    kur();
    expect(vi.mocked(useAdminNameChangeRequests).mock.calls.at(-1)).toEqual(["PENDING", false]);
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
  });

  it("view-only görünümde kayıt alanları var, karar aksiyonları yoktur", () => {
    izin("users.view");
    kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getByText("→ Yeni İsim")).toBeInTheDocument();
    expect(screen.getByText("Gerekçe: Resmî adım değişti.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Onayla" })).not.toBeInTheDocument();
  });

  it("URL filtresi sorguya gider; boş ve sonuçlanmış durumlar görünür", () => {
    const gorunum = kur(`${PATHS.adminNewNameChanges}?talep=APPROVED`);
    expect(vi.mocked(useAdminNameChangeRequests).mock.calls.at(-1)).toEqual(["APPROVED", true]);
    gorunum.unmount();
    vi.mocked(useAdminNameChangeRequests).mockReturnValue({ data: [], isPending: false, isError: false, error: null, refetch: vi.fn() } as never);
    kur();
    expect(screen.getByText("Bu durumda talep yok")).toBeInTheDocument();
  });

  it("onay ve isteğe bağlı notla red gerçek payloadları gönderir", () => {
    const gorunum = kur();
    fireEvent.click(screen.getByRole("button", { name: "Onayla" }));
    expect(onayla).toHaveBeenCalledWith(31, expect.any(Object));
    gorunum.unmount();
    kur();
    fireEvent.click(screen.getByRole("button", { name: "Reddet" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Ad değişikliğini reddet" })).getByRole("button", { name: "Reddet" }));
    expect(reddet).toHaveBeenCalledWith({ id: 31, note: "Uygun değil." }, expect.any(Object));
  });

  it("rota ve Moderasyon menü seçimi doğrudur", () => {
    expect(PATHS.adminNewNameChanges).toBe("/yonetim-yeni/moderasyon/ad-degisiklikleri");
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewNameChanges)).toMatchObject({ requiredPermission: "users" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewNameChanges)).toEqual({ selectedKey: "ad-degisiklikleri", openKeys: ["moderasyon"] });
  });
});
