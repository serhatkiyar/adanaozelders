import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { PersonelYetkiler } from "@/panel/pages/ayarlar/PersonelYetkiler";
import { kodTemizle } from "@/panel/pages/ayarlar/RolCekmecesi";
import { PANEL_MENU, izinBeyaniniKarsilarMi, menuyuIzneGoreSuz, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import {
  useAdminPermissions,
  useAdminRoleAssignments,
  useAdminRoles,
  useAssignAdminRole,
  useCreateAdminRole,
  useUpdateAdminRole,
} from "@/hooks/useAdmin";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { AdminPermissionOut, AdminRoleAssignmentOut, AdminRoleOut } from "@/types";

vi.mock("@/hooks/useAdmin", () => ({
  useAdminPermissions: vi.fn(),
  useAdminRoles: vi.fn(),
  useAdminRoleAssignments: vi.fn(),
  useAssignAdminRole: vi.fn(),
  useCreateAdminRole: vi.fn(),
  useUpdateAdminRole: vi.fn(),
}));

const olustur = vi.fn();
const guncelle = vi.fn();
const ata = vi.fn();
// Her atama çağrısı kendi ertelenmiş sözünü alır (satır bazlı eşzamanlılık).
const sozler: { res: (v?: unknown) => void; rej: (e: unknown) => void }[] = [];

const IZINLER: AdminPermissionOut[] = [
  { id: 1, code: "products.view", name: "Ürünleri görüntüle", group: "Ürünler" },
  { id: 2, code: "products.manage", name: "Ürünleri yönet", group: "Ürünler" },
  { id: 3, code: "orders.view", name: "Siparişleri görüntüle", group: "Siparişler" },
  { id: 4, code: "admin_roles.manage", name: "Yetkileri yönet", group: "Sistem" },
];
const SUPER: AdminRoleOut = { id: 1, code: "SUPER_ADMIN", name: "Süper Yönetici", description: "Tüm yetkiler.", is_system: true, permission_codes: IZINLER.map((i) => i.code), assignment_count: 1 };
const EDITOR: AdminRoleOut = { id: 2, code: "ICERIK_EDITORU", name: "İçerik Editörü", description: "Katalog düzenler.", is_system: false, permission_codes: ["products.view", "products.manage"], assignment_count: 2 };
const ATAMALAR: AdminRoleAssignmentOut[] = [
  { admin_id: 10, admin_name: "Ayşe Yönetici", admin_email: "ayse@example.com", role_id: 1, role_code: "SUPER_ADMIN", role_name: "Süper Yönetici" },
  { admin_id: 11, admin_name: "Mehmet Editör", admin_email: "mehmet@example.com", role_id: 2, role_code: "ICERIK_EDITORU", role_name: "İçerik Editörü" },
  { admin_id: 12, admin_name: "Rolsüz Kişi", admin_email: "rolsuz@example.com", role_id: null, role_code: null, role_name: null },
];

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const sonEnabled = (m: unknown) => (m as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
const yanit422 = (alan: string, msg: string) => ({ response: { status: 422, data: { detail: [{ loc: ["body", alan], msg }] } } });

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[PATHS.adminNewStaffPermissions]}>
          <PersonelYetkiler />
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

const altbilgi = (pencere: HTMLElement, ad: RegExp) => within(pencere.querySelector(".ant-drawer-footer") as HTMLElement).getByRole("button", { name: ad });
// Açık dropdown içinden seçenek: seçili değer etiketi de aynı title'ı taşır, dropdown ile sınırlanır.
const acikSecenek = async (ad: string) => {
  // Kapanış animasyonundaki eski dropdown da görünür sayılabilir; en son açılan (DOM'da sonuncu) alınır.
  await waitFor(() => expect(document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").length).toBeGreaterThan(0));
  const acik = [...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")].at(-1) as HTMLElement;
  return within(acik).getByTitle(ad);
};
const onay = async () => {
  const d = (await screen.findAllByRole("dialog")).at(-1)!;
  await within(d).findAllByText("Kaydedilmemiş değişiklikler var");
  return d;
};

beforeEach(() => {
  olustur.mockReset();
  guncelle.mockReset();
  ata.mockReset();
  sozler.length = 0;
  ata.mockImplementation(() => new Promise((res, rej) => { sozler.push({ res, rej }); }));
  vi.mocked(useAdminPermissions).mockReset().mockReturnValue(sonuc(IZINLER));
  vi.mocked(useAdminRoles).mockReset().mockReturnValue(sonuc([SUPER, EDITOR]));
  vi.mocked(useAdminRoleAssignments).mockReset().mockReturnValue(sonuc(ATAMALAR));
  vi.mocked(useAssignAdminRole).mockReturnValue({ mutateAsync: ata, isPending: false } as never);
  vi.mocked(useCreateAdminRole).mockReturnValue({ mutate: olustur, isPending: false } as never);
  vi.mocked(useUpdateAdminRole).mockReturnValue({ mutate: guncelle, isPending: false } as never);
  izin("admin_roles.view", "admin_roles.manage");
});

describe("PersonelYetkiler", () => {
  it("roller, adetler, sistem rozeti, atamalar basılır; SUPER_ADMIN için Düzenle yok", () => {
    kur();
    expect(screen.getByRole("heading", { name: "Personel & Yetkiler" })).toBeInTheDocument();
    for (const m of [useAdminPermissions, useAdminRoles, useAdminRoleAssignments]) expect(sonEnabled(m)).toBe(true);
    const roller = screen.getByRole("region", { name: "Yönetici rolleri" });
    expect(within(roller).getByText("Süper Yönetici")).toBeInTheDocument();
    expect(within(roller).getByText("SUPER_ADMIN")).toBeInTheDocument();
    expect(within(roller).getByText("Sistem")).toBeInTheDocument();
    expect(within(roller).getByText("Katalog düzenler.")).toBeInTheDocument();
    expect(within(roller).getByText("4 izin")).toBeInTheDocument();
    expect(within(roller).getByText("2 yönetici")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "İçerik Editörü rolünü düzenle" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Süper Yönetici rolünü düzenle" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Yeni rol/ })).toBeInTheDocument();

    const atamalar = screen.getByRole("region", { name: "Yönetici atamaları" });
    expect(within(atamalar).getByText("Ayşe Yönetici")).toBeInTheDocument();
    expect(within(atamalar).getByText("ayse@example.com")).toBeInTheDocument();
    expect(within(atamalar).getByText("Son Super Admin başka bir role indirilemez.")).toBeInTheDocument();
    expect(within(atamalar).getAllByRole("combobox")).toHaveLength(3);
  });

  it("yeni rol: kod temizleme, istemci doğrulaması ve ilk alana odak, eski payload ile POST, başarıda onaysız kapanır", async () => {
    // JS varsayılan toUpperCase: "i"→"I"; Türkçe harfler A-Z dışı kalıp silinir.
    expect(kodTemizle("içerik-editörü 2")).toBe("IERIKEDITR2");
    expect(kodTemizle("icerik_editoru")).toBe("ICERIK_EDITORU");
    kur();
    await userEvent.click(screen.getByRole("button", { name: /Yeni rol/ }));
    const pencere = await screen.findByRole("dialog");
    expect(within(pencere).getByText("Yeni yönetici rolü")).toBeInTheDocument();
    expect(within(pencere).getByText("Ürünler")).toBeInTheDocument();
    expect(within(pencere).getByText("products.manage")).toBeInTheDocument();
    await userEvent.click(altbilgi(pencere, /^Kaydet$/));
    expect(await within(pencere).findByText("Rol kodu en az 3 karakter olmalı.")).toBeInTheDocument();
    expect(within(pencere).getByText("Rol adı en az 2 karakter olmalı.")).toBeInTheDocument();
    await waitFor(() => expect(within(pencere).getByLabelText("Rol kodu")).toHaveFocus());
    expect(olustur).not.toHaveBeenCalled();

    await userEvent.type(within(pencere).getByLabelText("Rol kodu"), "icerik-editoru");
    expect(within(pencere).getByLabelText("Rol kodu")).toHaveValue("ICERIKEDITORU");
    await userEvent.type(within(pencere).getByLabelText("Rol adı"), "İçerik Editörü");
    await userEvent.type(within(pencere).getByLabelText(/Açıklama/), "  Katalog düzenler  ");
    await userEvent.click(within(pencere).getByRole("checkbox", { name: /Ürünleri görüntüle/ }));
    await userEvent.click(within(pencere).getByRole("checkbox", { name: /Siparişleri görüntüle/ }));
    await userEvent.dblClick(altbilgi(pencere, /^Kaydet$/));
    await waitFor(() => expect(olustur).toHaveBeenCalledTimes(1));
    expect(olustur.mock.calls[0][0]).toEqual({ code: "ICERIKEDITORU", name: "İçerik Editörü", description: "Katalog düzenler", permission_codes: ["products.view", "orders.view"] });
    act(() => olustur.mock.calls[0][1].onSuccess());
    act(() => olustur.mock.calls[0][1].onSettled());
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).not.toBeInTheDocument();
  });

  it("rol düzenleme: kod alanı yok, alanlar dolu, payload eski sözleşmeyle PUT; 422 alanlara, 409 genel; girdiler korunur", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "İçerik Editörü rolünü düzenle" }));
    const pencere = await screen.findByRole("dialog");
    expect(within(pencere).getByText("Yönetici rolünü düzenle")).toBeInTheDocument();
    expect(within(pencere).queryByLabelText("Rol kodu")).not.toBeInTheDocument();
    expect(within(pencere).getByLabelText("Rol adı")).toHaveValue("İçerik Editörü");
    expect(within(pencere).getByRole("checkbox", { name: /Ürünleri yönet/ })).toBeChecked();
    expect(within(pencere).getByRole("checkbox", { name: /Siparişleri görüntüle/ })).not.toBeChecked();
    await userEvent.click(within(pencere).getByRole("checkbox", { name: /Ürünleri yönet/ }));
    await userEvent.click(altbilgi(pencere, /^Kaydet$/));
    await waitFor(() => expect(guncelle).toHaveBeenCalledTimes(1));
    expect(guncelle.mock.calls[0][0]).toEqual({ id: 2, payload: { name: "İçerik Editörü", description: "Katalog düzenler.", permission_codes: ["products.view"] } });

    act(() => guncelle.mock.calls[0][1].onError(yanit422("permission_codes", "Bu izni veremezsiniz")));
    act(() => guncelle.mock.calls[0][1].onSettled());
    expect(await within(pencere).findByText("Bu izni veremezsiniz")).toBeInTheDocument();
    expect(within(pencere).queryByRole("alert")).not.toBeInTheDocument();
    act(() => guncelle.mock.calls[0][1].onError(yanit422("name", "Ad kullanımda")));
    expect(await within(pencere).findByText("Ad kullanımda")).toBeInTheDocument();
    act(() => guncelle.mock.calls[0][1].onError({ response: { status: 409, data: { detail: "Rol kodu zaten var" } } }));
    expect(await within(pencere).findByRole("alert")).toHaveTextContent("Rol kodu zaten var");
    expect(within(pencere).getByLabelText("Rol adı")).toHaveValue("İçerik Editörü");
    expect(within(pencere).getByRole("checkbox", { name: /Ürünleri yönet/ })).not.toBeChecked();
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
  });

  it("temiz form doğrudan kapanır; kirli form onay ister; gönderimle aynı tick ve pending'de kapanmaz", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: /Yeni rol/ }));
    let pencere = await screen.findByRole("dialog");
    await userEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: /Yeni rol/ }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).not.toBeNull());
    pencere = document.querySelector(".ant-drawer-open .ant-drawer-content") as HTMLElement;
    await userEvent.type(within(pencere).getByLabelText("Rol kodu"), "KIRLI");
    await userEvent.click(within(pencere).getByRole("button", { name: /Close|Kapat/ }));
    await userEvent.click(within(await onay()).getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();

    await userEvent.type(within(pencere).getByLabelText("Rol adı"), "Kirli Rol");
    await userEvent.click(altbilgi(pencere, /^Kaydet$/));
    await waitFor(() => expect(olustur).toHaveBeenCalledTimes(1));
    const onayAdedi = document.querySelectorAll(".ant-modal-confirm").length;
    await userEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    expect(document.querySelectorAll(".ant-modal-confirm")).toHaveLength(onayAdedi);
    act(() => olustur.mock.calls[0][1].onError(new Error("x")));
    act(() => olustur.mock.calls[0][1].onSettled());
    await userEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    await userEvent.click(within(await onay()).getByRole("button", { name: "Değişiklikleri sil" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());

    vi.mocked(useCreateAdminRole).mockReturnValue({ mutate: olustur, isPending: true } as never);
    kur();
    await userEvent.click(screen.getAllByRole("button", { name: /Yeni rol/ }).at(-1)!);
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).not.toBeNull());
    const acik = document.querySelector(".ant-drawer-open .ant-drawer-content") as HTMLElement;
    await userEvent.click(within(acik).getByRole("button", { name: "Vazgeç" }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
  });

  it("rol atama: eski payload; satır bazlı kilit; 409 gerçek mesaj ve seçim mevcut değerde kalır; başarı mesajı", async () => {
    kur();
    const secici = screen.getByRole("combobox", { name: "Mehmet Editör için yönetici rolü" });
    await userEvent.click(secici);
    await userEvent.click(await acikSecenek("Süper Yönetici"));
    expect(ata).toHaveBeenCalledTimes(1);
    expect(ata.mock.calls[0][0]).toEqual({ adminId: 11, roleId: 1 });
    // Aynı satır beklerken ikinci değişiklik yok; başka satır serbest
    expect(secici.closest(".ant-select")).toHaveClass("ant-select-disabled");
    const diger = screen.getByRole("combobox", { name: "Rolsüz Kişi için yönetici rolü" });
    expect(diger.closest(".ant-select")).not.toHaveClass("ant-select-disabled");
    await userEvent.click(diger);
    await userEvent.click(await acikSecenek("İçerik Editörü"));
    expect(ata).toHaveBeenCalledTimes(2);
    expect(ata.mock.calls[1][0]).toEqual({ adminId: 12, roleId: 2 });

    // İlk satır 409 ile reddedilir: gerçek mesaj görünür, kilit bırakılır, seçim veriden gelen değerde kalır.
    await act(async () => {
      sozler[0].rej({ response: { status: 409, data: { detail: "Son Super Admin başka bir role indirilemez" } } });
      await Promise.resolve();
    });
    expect(await screen.findByText("Son Super Admin başka bir role indirilemez")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Yönetici atamaları" })).getAllByText("İçerik Editörü").length).toBeGreaterThan(0);
    await waitFor(() => expect(secici.closest(".ant-select")).not.toHaveClass("ant-select-disabled"));
    // İkinci satır hâlâ bekliyor (ilkinin sonucu onu etkilemedi); sonra 403 bile sessiz kalmaz.
    expect(diger.closest(".ant-select")).toHaveClass("ant-select-disabled");
    await act(async () => {
      sozler[1].rej({ response: { status: 403, data: { detail: "Bu işlem için yetkin yok." } } });
      await Promise.resolve();
    });
    expect(await screen.findByText(/yetkin yok/)).toBeInTheDocument();
    await waitFor(() => expect(diger.closest(".ant-select")).not.toHaveClass("ant-select-disabled"));
    // Yeniden deneme (kilit bırakıldı) ve başarı mesajı; AntD dropdown geçiş animasyonunda pointer-events kapalı olabilir.
    const gevsek = userEvent.setup({ pointerEventsCheck: 0 });
    await gevsek.click(diger);
    await gevsek.click(await acikSecenek("Süper Yönetici"));
    await waitFor(() => expect(ata).toHaveBeenCalledTimes(3));
    expect(ata.mock.calls[2][0]).toEqual({ adminId: 12, roleId: 1 });
    await act(async () => {
      sozler[2].res();
      await Promise.resolve();
    });
    expect(await screen.findByText("Yönetici rolü atandı.")).toBeInTheDocument();
  });

  it("yalnız admin_roles.view: salt okunur; Yeni rol/Düzenle/seçici yok, rol adı metin olarak; izinsizde AccessDenied ve üç sorgu kapalı", () => {
    izin("admin_roles.view");
    const ilk = kur();
    expect(screen.getByText(/yalnız görüntüleme yetkiniz var/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Yeni rol/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /rolünü düzenle/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Rol atanmamış")).toBeInTheDocument();
    ilk.unmount();

    izin("settings.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    for (const m of [useAdminPermissions, useAdminRoles, useAdminRoleAssignments]) expect(sonEnabled(m)).toBe(false);
  });

  it("yükleniyor, hata + Tekrar dene (üç sorgu) ve boş durumlar", async () => {
    vi.mocked(useAdminRoles).mockReturnValue(sonuc(undefined, { isPending: true }));
    const ilk = kur();
    expect(screen.getByText("Yetki bilgileri yükleniyor…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Yeni rol/ })).not.toBeInTheDocument();
    ilk.unmount();

    const r1 = vi.fn(), r2 = vi.fn(), r3 = vi.fn();
    vi.mocked(useAdminPermissions).mockReturnValue(sonuc(undefined, { refetch: r1 }));
    vi.mocked(useAdminRoles).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch: r2 }));
    vi.mocked(useAdminRoleAssignments).mockReturnValue(sonuc(undefined, { refetch: r3 }));
    const ikinci = kur();
    expect(screen.getByText("Yetki bilgileri yüklenemedi.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(r1).toHaveBeenCalled();
    expect(r2).toHaveBeenCalled();
    expect(r3).toHaveBeenCalled();
    ikinci.unmount();

    vi.mocked(useAdminPermissions).mockReturnValue(sonuc([]));
    vi.mocked(useAdminRoles).mockReturnValue(sonuc([]));
    vi.mocked(useAdminRoleAssignments).mockReturnValue(sonuc([]));
    kur();
    expect(screen.getByText("Tanımlı rol yok")).toBeInTheDocument();
    expect(screen.getByText("Yönetici bulunamadı")).toBeInTheDocument();
  });

  it("rota ve menü: Ayarlar → Personel & Yetkiler admin_roles izniyle; seçili/açık anahtarlar; Ayarlar sırası korunur", () => {
    expect(PATHS.adminNewStaffPermissions).toBe("/yonetim-yeni/ayarlar/personel-yetkiler");
    expect(ROUTES.adminNewStaffPermissions).toBe(PATHS.adminNewStaffPermissions);
    const ayarlar = PANEL_MENU.find((m) => m.key === "ayarlar")!;
    expect(ayarlar.children?.map((c) => c.label)).toEqual(["Genel", "Personel & Yetkiler", "Denetim Kayıtları", "Hata Çözme"]);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewStaffPermissions)).toMatchObject({ label: "Personel & Yetkiler", requiredPermission: "admin_roles" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewStaffPermissions)).toEqual({ selectedKey: "personel-yetkiler", openKeys: ["ayarlar"] });
    expect(izinBeyaniniKarsilarMi(["admin_roles.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewStaffPermissions)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["settings.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewStaffPermissions)!)).toBe(false);
    const gorunur = menuyuIzneGoreSuz(PANEL_MENU, ["settings.view"]).find((m) => m.key === "ayarlar");
    expect(gorunur?.children?.map((c) => c.key)).toEqual(["ayarlar-genel", "hata-cozme"]);
  });
});
