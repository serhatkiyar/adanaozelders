import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { DenetimKayitlariListesi } from "@/panel/pages/ayarlar/DenetimKayitlariListesi";
import { PANEL_MENU, izinBeyaniniKarsilarMi, menuyuIzneGoreSuz, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { useAdminAuditLogs } from "@/hooks/useAdmin";
import { useAuthStore } from "@/store/authStore";
import { TAM_ADMIN_IZINLERI } from "@/test-utils/adminIzinleri";
import type { AuditLogOut } from "@/types";

vi.mock("@/hooks/useAdmin", () => ({ useAdminAuditLogs: vi.fn() }));

const mockListe = vi.mocked(useAdminAuditLogs);
const YOL = "/yonetim-yeni/ayarlar/denetim-kayitlari";

const KAYIT: AuditLogOut = {
  id: 91, action: "BOOKING_CANCEL", target_type: "booking", target_id: 12, actor_id: 3, actor_role: 1,
  reason: "Öğrenci talebi", details: null, ip_address: "10.0.0.1", request_id: "req-abc",
  before_values: { status: "ACCEPTED" }, after_values: { status: "CANCELLED" }, meta: null, created_at: "2027-03-03T11:00:00+00:00",
};
const KAYIT2: AuditLogOut = { ...KAYIT, id: 92, action: "PRODUCT_UPDATE", target_type: "product", target_id: 5, actor_id: 7, actor_role: 1, reason: null, details: "Fiyat güncellendi", request_id: null, before_values: null, after_values: null, meta: { kaynak: "panel" } };

function Konum() {
  const git = useNavigate();
  return (
    <>
      <output data-testid="konum">{useLocation().search}</output>
      <button type="button" onClick={() => git(-1)}>geri</button>
      <button type="button" onClick={() => git(`${YOL}?q=harici`)}>harici</button>
    </>
  );
}

function kur(baslangic = YOL) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[baslangic]}>
          <Routes>
            <Route path={YOL} element={<><DenetimKayitlariListesi /><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const sonSorgu = () => mockListe.mock.calls.at(-1)?.[0] ?? {};
const sonEnabled = () => mockListe.mock.calls.at(-1)?.[1];
const arama = () => screen.getByRole("textbox", { name: /içinde ara/ });
const konum = () => screen.getByTestId("konum");

beforeEach(() => {
  mockListe.mockReset();
  mockListe.mockReturnValue(sonuc({ items: [KAYIT, KAYIT2], total: 2 }));
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: [...TAM_ADMIN_IZINLERI] } as never });
});

describe("DenetimKayitlariListesi", () => {
  it("satırlar bütün kolonlarla basılır; ekranda yazma aksiyonu yoktur; sorgu açık", () => {
    kur();
    for (const b of ["Aksiyon", "Hedef", "Aktör", "Gerekçe / Açıklama", "Zaman"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(b) })).toBeInTheDocument();
    }
    expect(screen.getByText("BOOKING_CANCEL")).toBeInTheDocument();
    expect(screen.getByText("booking #12")).toBeInTheDocument();
    expect(screen.getByText("Yönetici #3")).toBeInTheDocument();
    expect(screen.getByText("Öğrenci talebi")).toBeInTheDocument();
    expect(screen.getByText("Fiyat güncellendi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sil|Düzelt|Kaydet|Ekle|Dışa aktar/ })).not.toBeInTheDocument();
    expect(sonSorgu()).toMatchObject({ limit: 25, offset: 0, sort: "created_at", order: "desc" });
    expect(sonEnabled()).toBe(true);
  });

  it("filtre penceresi değerleri URL'ye ve hook'a taşır; sayfa başa döner; rozet q'yu saymaz", async () => {
    mockListe.mockReturnValue(sonuc({ items: [KAYIT, KAYIT2], total: 90 }));
    kur(`${YOL}?page=3&q=iptal`);
    expect(sonSorgu()).toMatchObject({ offset: 50 });
    await userEvent.click(screen.getByRole("button", { name: "Filtre" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Hedef türü" }), "booking");
    await waitFor(() => expect(konum()).toHaveTextContent("target=booking"));
    expect(konum()).not.toHaveTextContent("page=");
    expect(konum()).toHaveTextContent("q=iptal");
    expect(sonSorgu()).toMatchObject({ target_type: "booking", offset: 0 });

    await userEvent.type(screen.getByRole("spinbutton", { name: "Aktör ID" }), "7");
    await waitFor(() => expect(sonSorgu()).toMatchObject({ actor_id: 7 }));
    await userEvent.type(screen.getByRole("textbox", { name: "Request ID" }), "req-1");
    await waitFor(() => expect(sonSorgu()).toMatchObject({ request_id: "req-1" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Aksiyon" }), "BOOKING");
    await waitFor(() => expect(sonSorgu()).toMatchObject({ action: "BOOKING", target_type: "booking", actor_id: 7 }));
    expect(konum()).toHaveTextContent("rid=req-1");
    // Rozet yalnız action/target/actor/rid sayar (sayfalayıcı 4 de basabilir; AntD Badge sınıfı ayırt eder).
    expect(document.querySelector(".ant-badge .ant-scroll-number")).toHaveAttribute("title", "4");
  });

  it("beyaz liste dışı sort/limit/actor/anahtar yok sayılır ve isteğe gitmez; geçerli boyutlar 10/25/50", async () => {
    kur(`${YOL}?sort=drop_table&order=asc&limit=999&actor=abc&x=1&page=2`);
    expect(sonSorgu()).toMatchObject({ sort: "created_at", order: "asc", limit: 25 });
    expect(sonSorgu().actor_id).toBeUndefined();
    expect(sonSorgu()).not.toHaveProperty("x");
    await userEvent.click(screen.getByRole("button", { name: "Filtre" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Aksiyon" }), "A");
    await waitFor(() => expect(konum()).toHaveTextContent("action=A"));
    expect(konum()).not.toHaveTextContent("x=1");
    expect(konum()).not.toHaveTextContent("page=");

    const secici = screen.getByRole("combobox", { name: "Satır Adedi" });
    await userEvent.click(secici);
    const secenekler = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(secenekler).toEqual(["10", "25", "50"]);
    await userEvent.click(screen.getByTitle("50"));
    await waitFor(() => expect(sonSorgu()).toMatchObject({ limit: 50, offset: 0 }));
    expect(konum()).toHaveTextContent("limit=50");

    mockListe.mockClear();
    kur(`${YOL}?limit=20`);
    expect(sonSorgu()).toMatchObject({ limit: 25 });
  });

  it("arama URL'ye anında yazılır (replace), API q'su gecikir, sayfa başa döner", async () => {
    mockListe.mockReturnValue(sonuc({ items: [KAYIT, KAYIT2], total: 90 }));
    kur();
    // push edilmiş bir girdi üstüne arama yazılır: geri tuşu aramayı değil girişi geri alır
    await userEvent.click(screen.getByRole("button", { name: "harici" }));
    await waitFor(() => expect(sonSorgu().q).toBe("harici"));
    await userEvent.click(screen.getByTitle("2"));
    await waitFor(() => expect(konum()).toHaveTextContent("page=2"));
    await userEvent.clear(arama());
    await userEvent.type(arama(), "iptal");
    expect(konum()).toHaveTextContent("q=iptal");
    expect(konum()).not.toHaveTextContent("page=");
    expect(arama()).toHaveValue("iptal");
    // URL anında güncel, API q'su henüz gecikmede
    expect(sonSorgu().q).not.toBe("iptal");
    await waitFor(() => expect(sonSorgu()).toMatchObject({ q: "iptal", offset: 0 }));
    await userEvent.click(screen.getByRole("button", { name: "geri" }));
    await waitFor(() => expect(konum()).toHaveTextContent("q=harici"));
    expect(konum()).not.toHaveTextContent("page=");
    expect(arama()).toHaveValue("harici");
  });

  it("iki arama sonrası harici URL değişiminde kutu, URL ve sorgu aynı değerde kalır", async () => {
    kur();
    await userEvent.type(arama(), "bir");
    await userEvent.clear(arama());
    await userEvent.type(arama(), "iki");
    await userEvent.click(screen.getByRole("button", { name: "harici" }));
    await waitFor(() => expect(konum()).toHaveTextContent("q=harici"));
    expect(arama()).toHaveValue("harici");
    await waitFor(() => expect(sonSorgu()).toMatchObject({ q: "harici" }));
    await new Promise((r) => setTimeout(r, 400));
    expect(konum()).toHaveTextContent("q=harici");
    expect(arama()).toHaveValue("harici");
    expect(sonSorgu()).toMatchObject({ q: "harici" });
  });

  it("kolon başlığı sıralamayı adrese yazar ve geri tuşu önceki sıralamaya döner", async () => {
    kur();
    await userEvent.click(screen.getByRole("columnheader", { name: /Aksiyon/ }));
    await waitFor(() => expect(konum()).toHaveTextContent("sort=action"));
    expect(sonSorgu()).toMatchObject({ sort: "action", order: "asc" });
    await userEvent.click(screen.getByRole("button", { name: "geri" }));
    await waitFor(() => expect(sonSorgu()).toMatchObject({ sort: "created_at", order: "desc" }));
  });

  it("sayfalama gerçek total ile çalışır ve filtreyi korur", async () => {
    mockListe.mockReturnValue(sonuc({ items: [KAYIT], total: 60 }));
    kur(`${YOL}?target=booking`);
    expect(screen.getByText(/\/ 60 Kayıt/)).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("2"));
    await waitFor(() => expect(sonSorgu()).toMatchObject({ limit: 25, offset: 25, target_type: "booking" }));
    expect(konum()).toHaveTextContent("page=2");
    expect(konum()).toHaveTextContent("target=booking");
  });

  it("veri azalınca sayfa son geçerli sayfaya çekilir", async () => {
    mockListe.mockReturnValue(sonuc({ items: [], total: 30 }));
    kur(`${YOL}?page=9&target=booking`);
    await waitFor(() => expect(konum()).toHaveTextContent("page=2"));
    expect(konum()).toHaveTextContent("target=booking");
    expect(sonSorgu()).toMatchObject({ offset: 25 });

    mockListe.mockReturnValue(sonuc({ items: [], total: 0 }));
    kur(`${YOL}?page=4`);
    await waitFor(() => expect(screen.getAllByTestId("konum").at(-1)).not.toHaveTextContent("page="));
  });

  it("Ayrıntı düğmesi gerçek button; kaydın tüm alanları salt okunur pencerede; X kapatır", async () => {
    kur();
    const dugme = screen.getByRole("button", { name: "BOOKING_CANCEL: denetim kaydı ayrıntısı" });
    expect(dugme.tagName).toBe("BUTTON");
    expect(dugme.closest("a")).toBeNull();
    await userEvent.click(dugme);
    const pencere = await screen.findByRole("dialog");
    expect(within(pencere).getByText("Denetim kaydı")).toBeInTheDocument();
    expect(within(pencere).getByText("req-abc")).toBeInTheDocument();
    expect(within(pencere).getByText("10.0.0.1")).toBeInTheDocument();
    expect(within(pencere).getByText("Öğrenci talebi")).toBeInTheDocument();
    expect(within(pencere).getByLabelText("Önce")).toHaveTextContent('"status": "ACCEPTED"');
    expect(within(pencere).getByLabelText("Sonra")).toHaveTextContent('"status": "CANCELLED"');
    expect(within(pencere).getByLabelText("Önce").tagName).toBe("PRE");
    expect(within(pencere).queryByLabelText("Ek bilgi")).not.toBeInTheDocument();
    expect(within(pencere).queryByRole("button", { name: /Kaydet|Vazgeç|Kopyala|İndir/ })).not.toBeInTheDocument();
    await userEvent.click(within(pencere).getByRole("button", { name: /Close|Kapat/ }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "PRODUCT_UPDATE: denetim kaydı ayrıntısı" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).not.toBeNull());
    const acik = document.querySelector(".ant-drawer-open .ant-drawer-content") as HTMLElement;
    expect(within(acik).getByText("Fiyat güncellendi")).toBeInTheDocument();
    expect(within(acik).getByLabelText("Ek bilgi")).toHaveTextContent('"kaynak": "panel"');
  });

  it("filtresiz boş ile filtreli boş ayrılır; Filtreleri temizle adresi boşaltır", async () => {
    mockListe.mockReturnValue(sonuc({ items: [], total: 0 }));
    const ilk = kur();
    expect(screen.getByText("Denetim kaydı yok")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filtreleri temizle" })).not.toBeInTheDocument();
    ilk.unmount();

    kur(`${YOL}?q=iptal&rid=req-1&sort=action`);
    expect(screen.getByText("Bu filtreyle kayıt bulunamadı")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Filtreleri temizle" }));
    await waitFor(() => expect(konum()).toHaveTextContent("?sort=action"));
    expect(konum()).not.toHaveTextContent("q=");
    await waitFor(() => expect(sonSorgu().q).toBeUndefined());
    expect(arama()).toHaveValue("");
  });

  it("hata boş durum gibi gösterilmez; Tekrar dene refetch çağırır", async () => {
    const refetch = vi.fn();
    mockListe.mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch }));
    kur();
    expect(screen.getByText(/Denetim kayıtları yüklenemedi/)).toBeInTheDocument();
    expect(screen.queryByText("Denetim kaydı yok")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("audit.view izni yoksa AccessDenied ve hook enabled=false", () => {
    useAuthStore.setState({ user: { id: 1, role_id: 1, admin_permissions: TAM_ADMIN_IZINLERI.filter((i) => !i.startsWith("audit")) } as never });
    kur();
    expect(screen.getByText("Bu alan için yetkiniz yok")).toBeInTheDocument();
    expect(screen.queryByText("BOOKING_CANCEL")).not.toBeInTheDocument();
    expect(sonEnabled()).toBe(false);
  });

  it("menü: Ayarlar grubu, Denetim Kayıtları audit izniyle bağlı, seçili/açık anahtarlar; Tanımlamalar alias/any-of bozulmadı", () => {
    expect(PATHS.adminNewAuditLogs).toBe("/yonetim-yeni/ayarlar/denetim-kayitlari");
    expect(ROUTES.adminNewAuditLogs).toBe(PATHS.adminNewAuditLogs);
    const ayarlar = PANEL_MENU.find((m) => m.key === "ayarlar")!;
    expect(ayarlar.icon).toBe("setting");
    expect(ayarlar.path).toBeUndefined();
    expect(ayarlar.requiredPermission).toBeUndefined();
    expect(ayarlar.children?.map((c) => c.label)).toEqual(["Genel", "Personel & Yetkiler", "Denetim Kayıtları", "Hata Çözme"]);
    // Genel (settings) ve Denetim Kayıtları (audit) bağlı; diğer ikisi yer tutucu.
    expect(ayarlar.children?.filter((c) => c.path).map((c) => c.key)).toEqual(["ayarlar-genel", "denetim-kayitlari"]);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewAuditLogs)).toMatchObject({ label: "Denetim Kayıtları", requiredPermission: "audit" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewAuditLogs)).toEqual({ selectedKey: "denetim-kayitlari", openKeys: ["ayarlar"] });
    expect(izinBeyaniniKarsilarMi(["audit.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewAuditLogs)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["products.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewAuditLogs)!)).toBe(false);
    const gorunur = menuyuIzneGoreSuz(PANEL_MENU, ["products.view"]).find((m) => m.key === "ayarlar");
    expect(gorunur?.children?.some((c) => c.key === "denetim-kayitlari")).toBe(false);
    expect(gorunur?.children?.map((c) => c.key)).toEqual(["personel-yetkiler", "hata-cozme"]);
    // Tanımlamalar altyapısı korunuyor
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewSuppliers)).toEqual({ selectedKey: "tanimlamalar", openKeys: ["urunler"] });
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewDefinitions)?.requiredAnyPermissions).toEqual(["products", "suppliers"]);
  });
});
