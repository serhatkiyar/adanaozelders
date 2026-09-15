import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { MusteriDetayi } from "@/panel/pages/musteriler/MusteriDetayi";
import * as hooks from "@/hooks/useAdmin";
import * as api from "@/api/admin";
import { useAuthStore } from "@/store/authStore";
import type { AdminUserDetailOut } from "@/types";
import { PATHS, ROUTES } from "@/lib/routes";
import { PANEL_MENU, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";

vi.mock("@/hooks/useAdmin", () => ({ useAdminUser: vi.fn() }));
vi.mock("@/api/admin", () => ({ deleteAdminUser: vi.fn() }));

function kullanici(ek: Partial<AdminUserDetailOut> = {}): AdminUserDetailOut {
  return {
    id: 42, first_name: "Ayşe", last_name: "Yılmaz", full_name: "Ayşe Yılmaz", email: "ayse@example.com", role: "CLIENT",
    is_active: true, created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-05T10:00:00Z", last_seen_at: null,
    email_verified: true, tutor_status: null, booking_count: 3, review_count: 1, demand_count: 2, order_count: 5, ...ek,
  };
}

function veri(u: AdminUserDetailOut | undefined, ek: object = {}) {
  vi.mocked(hooks.useAdminUser).mockReturnValue({ data: u, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek } as never);
}

function izin(...perms: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: perms } as never });
}

function kur(yol = ROUTES.adminNewCustomer("client", 42)) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewCustomer} element={<MusteriDetayi />} />
            <Route path={PATHS.adminNewCustomers} element={<div>Müşteri listesi</div>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.deleteAdminUser).mockReset();
  izin("users.view", "users.manage");
});

describe("MusteriDetayi", () => {
  it("rota yardımcıları ve menü: Müşteriler kök grup, gerçek yaprak users izniyle; liste ve detayda musteri-listesi seçili", () => {
    expect(ROUTES.adminNewCustomer("client", 42)).toBe("/yonetim-yeni/musteriler/client/42");
    expect(PATHS.adminNewCustomer).toBe("/yonetim-yeni/musteriler/:role/:id");
    const grup = PANEL_MENU.find((m) => m.key === "musteriler");
    expect(grup?.path).toBeUndefined();
    expect(grup?.requiredPermission).toBeUndefined();
    expect(grup?.icon).toBe("team");
    expect(grup?.children?.map((c) => [c.label, c.path ?? null, c.requiredPermission ?? null])).toEqual([
      ["Müşteriler", PATHS.adminNewCustomers, "users"],
      ["Müşteri Grupları", null, null],
      ["Etiketler", null, null],
    ]);
    expect(rotaIzniBul(PANEL_MENU, ROUTES.adminNewCustomer("client", 42))).toEqual({ label: "Müşteriler", requiredPermission: "users" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewCustomers)).toEqual({ selectedKey: "musteri-listesi", openKeys: ["musteriler"] });
    expect(seciliMenuDurumu(PANEL_MENU, ROUTES.adminNewCustomer("client", 42))).toEqual({ selectedKey: "musteri-listesi", openKeys: ["musteriler"] });
  });

  it("users.view yoksa AccessDenied basılır ve detay sorgusu kapalıdır", () => {
    izin("orders.view");
    veri(undefined);
    kur();
    expect(screen.getByText("Bu alan için yetkiniz yok")).toBeInTheDocument();
    expect(hooks.useAdminUser).toHaveBeenLastCalledWith("client", 42, false);
    expect(screen.queryByRole("heading", { name: "Ayşe Yılmaz" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hesabı sil" })).not.toBeInTheDocument();
  });

  it("müşteri profili, hesap durumu ve etkinlik sayıları basılır", () => {
    veri(kullanici());
    kur();
    expect(screen.getByRole("heading", { name: "Ayşe Yılmaz" })).toBeInTheDocument();
    expect(screen.getByText("Aktif")).toBeInTheDocument();
    expect(screen.getByText("ayse@example.com")).toBeInTheDocument();
    expect(screen.getByText("Doğrulandı")).toBeInTheDocument();
    expect(screen.getByText("Henüz yok")).toBeInTheDocument();
    const etkinlik = within(screen.getByRole("region", { name: "Etkinlik özeti" }));
    for (const ad of ["Rezervasyon", "Değerlendirme", "Talep", "Sipariş"]) expect(etkinlik.getByText(ad)).toBeInTheDocument();
    expect(etkinlik.getByText("5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hesabı sil" })).toBeInTheDocument();
  });

  it("eğitmende ilan durumu görünür, müşteriye özel sayılar yok; pasif hesap etiketi", () => {
    veri(kullanici({ role: "TUTOR", is_active: false, email_verified: false, tutor_status: "APPROVED", last_seen_at: "2026-09-06T08:00:00Z" }));
    kur("/yonetim-yeni/musteriler/tutor/42");
    expect(screen.getByText("Pasif")).toBeInTheDocument();
    expect(screen.getByText("Doğrulanmadı")).toBeInTheDocument();
    expect(screen.getByText("İlan durumu")).toBeInTheDocument();
    expect(screen.getByText("APPROVED")).toBeInTheDocument();
    expect(screen.queryByText("Talep")).not.toBeInTheDocument();
    expect(screen.queryByText("Sipariş")).not.toBeInTheDocument();
  });

  it("hesap silme: boş gerekçe alanda hata verir, geçerli gerekçe gerçek API'ye gider ve listeye döner", async () => {
    vi.mocked(api.deleteAdminUser).mockResolvedValue(undefined);
    veri(kullanici());
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Hesabı sil" }));
    const pencere = await screen.findByRole("dialog");
    await userEvent.click(within(pencere).getByRole("button", { name: "Kalıcı olarak sil" }));
    expect(within(pencere).getByRole("alert")).toHaveTextContent("en az 3 karakter");
    expect(api.deleteAdminUser).not.toHaveBeenCalled();

    await userEvent.type(within(pencere).getByLabelText(/Gerekçe/), "  KVKK talebi #123  ");
    await userEvent.click(within(pencere).getByRole("button", { name: "Kalıcı olarak sil" }));
    await waitFor(() => expect(api.deleteAdminUser).toHaveBeenCalledWith({ role: "client", user_id: 42, reason: "KVKK talebi #123" }));
    expect(await screen.findByText("Müşteri listesi")).toBeInTheDocument();
    expect(api.deleteAdminUser).toHaveBeenCalledTimes(1);
  });

  it("eğitmen silme payload'ı tutor rolüyle gider; başarıda users cache'i geçersiz kılınır", async () => {
    vi.mocked(api.deleteAdminUser).mockResolvedValue(undefined);
    veri(kullanici({ role: "TUTOR", tutor_status: "APPROVED" }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const gecersizKil = vi.spyOn(qc, "invalidateQueries");
    const kaldir = vi.spyOn(qc, "removeQueries");
    render(
      <QueryClientProvider client={qc}>
        <PanelProvider>
          <MemoryRouter initialEntries={[ROUTES.adminNewCustomer("tutor", 42)]}>
            <Routes>
              <Route path={PATHS.adminNewCustomer} element={<MusteriDetayi />} />
              <Route path={PATHS.adminNewCustomers} element={<div>Müşteri listesi</div>} />
            </Routes>
          </MemoryRouter>
        </PanelProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Hesabı sil" }));
    const pencere = await screen.findByRole("dialog");
    await userEvent.type(within(pencere).getByLabelText(/Gerekçe/), "Talep üzerine");
    await userEvent.click(within(pencere).getByRole("button", { name: "Kalıcı olarak sil" }));
    await waitFor(() => expect(api.deleteAdminUser).toHaveBeenCalledWith({ role: "tutor", user_id: 42, reason: "Talep üzerine" }));
    await waitFor(() => expect(gecersizKil).toHaveBeenCalledWith({ queryKey: ["admin", "users"] }));
    expect(kaldir).toHaveBeenCalledWith({ queryKey: ["admin", "users", "detail", "tutor", 42] });
    expect(await screen.findByText("Müşteri listesi")).toBeInTheDocument();
  });

  it("işlem sürerken ikinci gönderim ve X/Vazgeç/ESC/maske kapatması engellenir; hata sonrası gerekçe ve pencere korunur", async () => {
    let cozumle: (v: unknown) => void = () => {};
    let reddet: (e: unknown) => void = () => {};
    vi.mocked(api.deleteAdminUser).mockImplementation(() => new Promise((res, rej) => { cozumle = res; reddet = rej; }));
    veri(kullanici());
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Hesabı sil" }));
    const pencere = await screen.findByRole("dialog");
    await userEvent.type(within(pencere).getByLabelText(/Gerekçe/), "KVKK talebi");
    // Pending render'ını beklemeden iki hızlı gönderim: senkron kilit ikinciyi düşürür.
    const gonderDugmesi = within(pencere).getByRole("button", { name: "Kalıcı olarak sil" });
    await act(async () => {
      gonderDugmesi.click();
      gonderDugmesi.click();
    });
    await waitFor(() => expect(api.deleteAdminUser).toHaveBeenCalledTimes(1));

    await userEvent.click(within(pencere).getByRole("button", { name: /Kalıcı olarak sil/ }));
    await userEvent.click(within(pencere).getByRole("button", { name: /Vazgeç/ }));
    await userEvent.keyboard("{Escape}");
    expect(api.deleteAdminUser).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    expect(screen.queryByText("Yazdıklarınız kaybolacak")).not.toBeInTheDocument();

    await act(async () => {
      reddet({ response: { status: 409, data: { detail: "Açık siparişi olan hesap silinemez." } } });
      await Promise.resolve();
    });
    expect(await within(pencere).findByText("Açık siparişi olan hesap silinemez.")).toBeInTheDocument();
    expect(within(pencere).getByLabelText(/Gerekçe/)).toHaveValue("KVKK talebi");
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    expect(cozumle).toBeDefined();

    // Hata çözümlendikten sonra kilit açılır: yeniden gönderim mümkün.
    const tekrar = within(pencere).getByRole("button", { name: /Kalıcı olarak sil/ });
    await waitFor(() => expect(tekrar).not.toHaveClass("ant-btn-loading"));
    await userEvent.click(tekrar);
    await waitFor(() => expect(api.deleteAdminUser).toHaveBeenCalledTimes(2));
  });

  it("hesap silme hatası sunucu gerekçesiyle pencerede gösterilir", async () => {
    vi.mocked(api.deleteAdminUser).mockRejectedValue({ response: { status: 409, data: { detail: "Açık siparişi olan hesap silinemez." } } });
    veri(kullanici());
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Hesabı sil" }));
    const pencere = await screen.findByRole("dialog");
    await userEvent.type(within(pencere).getByLabelText(/Gerekçe/), "KVKK talebi");
    await userEvent.click(within(pencere).getByRole("button", { name: "Kalıcı olarak sil" }));
    expect(await within(pencere).findByText("Açık siparişi olan hesap silinemez.")).toBeInTheDocument();
    expect(screen.queryByText("Müşteri listesi")).not.toBeInTheDocument();
  });

  it("boş form Vazgeç ile doğrudan kapanır; gerekçe yazılmışken Vazgeç onay ister, devam et açık bırakır, sil kapatır", async () => {
    veri(kullanici());
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Hesabı sil" }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Hesabı sil" }));
    const alan = await screen.findByLabelText(/Gerekçe/);
    await userEvent.type(alan, "Yanlış");
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect((await screen.findAllByText("Yazdıklarınız kaybolacak")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole("button", { name: "Düzenlemeye devam et" }).at(-1) as HTMLElement);
    expect(screen.getByLabelText(/Gerekçe/)).toHaveValue("Yanlış");
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await userEvent.click((await screen.findAllByRole("button", { name: "Değişiklikleri sil" })).at(-1) as HTMLElement);
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    expect(api.deleteAdminUser).not.toHaveBeenCalled();
  });

  it("izin kapısı: users.manage yoksa veya rol admin ise Hesabı sil yok", () => {
    izin("users.view");
    veri(kullanici());
    const ilk = kur();
    expect(screen.getByRole("heading", { name: "Ayşe Yılmaz" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hesabı sil" })).not.toBeInTheDocument();
    ilk.unmount();

    izin("users.view", "users.manage");
    veri(kullanici({ role: "ADMIN" }));
    kur("/yonetim-yeni/musteriler/admin/42");
    expect(screen.queryByRole("button", { name: "Hesabı sil" })).not.toBeInTheDocument();
  });

  it("geçersiz bağlantı ve 404 dostane hata verir; hook'a geçersiz rol gitmez", () => {
    veri(undefined);
    const ilk = kur("/yonetim-yeni/musteriler/kurye/42");
    expect(screen.getByText("Kullanıcı bağlantısı geçerli bir rol ve kimlik içermiyor.")).toBeInTheDocument();
    expect(hooks.useAdminUser).toHaveBeenLastCalledWith(undefined, 42, false);
    ilk.unmount();

    for (const ham of ["-4", "1e3", "0x10", "42.0", "abc", String(Number.MAX_SAFE_INTEGER + 2)]) {
      const gecersizId = kur(`/yonetim-yeni/musteriler/client/${ham}`);
      expect(screen.getByText("Kullanıcı bağlantısı geçerli bir rol ve kimlik içermiyor.")).toBeInTheDocument();
      expect(vi.mocked(hooks.useAdminUser).mock.calls.at(-1)?.[2]).toBe(false);
      gecersizId.unmount();
    }

    veri(undefined, { isError: true, error: { response: { status: 404 } } });
    kur();
    expect(screen.getByText("Kullanıcı bulunamadı.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tekrar dene" })).not.toBeInTheDocument();
  });

  it("yüklenme ve hata: Tekrar dene refetch çağırır", async () => {
    veri(undefined, { isPending: true });
    const ilk = kur();
    expect(screen.getByText("Kullanıcı yükleniyor…")).toBeInTheDocument();
    ilk.unmount();

    const refetch = vi.fn();
    veri(undefined, { isError: true, error: new Error("x"), refetch });
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});
