import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PanelShell } from "@/panel/layout/PanelShell";
import { PANEL_MENU } from "@/panel/layout/menu";
import { PATHS } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { TAM_ADMIN_IZINLERI } from "@/test-utils/adminIzinleri";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";

/**
 * Gerçek `matchMedia` sorgusunu (`min-width`/`max-width`, hangisi geçtiyse)
 * ayrıştırır — belirli bir sorgu metnini varsaymaz, PanelShell'in hangi
 * hook/mekanizmayı kullandığından bağımsız çalışır.
 */
function setViewport(width: number) {
  window.innerWidth = width;
  window.matchMedia = ((query: string) => {
    const min = query.match(/min-width:\s*([\d.]+)px/);
    const max = query.match(/max-width:\s*([\d.]+)px/);
    let matches = true;
    if (min) matches = matches && width >= parseFloat(min[1]);
    if (max) matches = matches && width <= parseFloat(max[1]);
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

/**
 * İzin kapısı testleri gerçek `admin_permissions` sözleşmesiyle çalışır
 * (`lib/adminAccess.ts`): joker yok, kod tam eşleşir. Varsayılan oturum TAM
 * yetkilidir — mevcut kabuk testleri izinle ilgilenmediği için bunları
 * kırmamak adına her testten önce tam yetkili bir yönetici kurulur; izin
 * kapısını ölçen testler kendi oturumunu üzerine yazar.
 */
beforeEach(() => {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: [...TAM_ADMIN_IZINLERI] } as never,
  });
});

describe("PanelShell", () => {
  it("menü ağacı ikas modüllerini içerir", () => {
    const kokler = PANEL_MENU.map((m) => m.label);
    expect(kokler).toEqual(
      expect.arrayContaining(["Ürünler", "Siparişler", "Dağıtım", "Dersler", "Ayarlar"]),
    );
  });

  it("Ürünler alt menüsü bizim iki modülümüzü (Stok Hareketleri, Hasarlı Stok) kaybetmez", () => {
    // Spec §4 (docs/superpowers/specs/2026-09-11-admin-panel-ikas-yeniden-
    // tasarim-design.md): ikas'ta karşılığı olmayan bu iki öğe bilinçli
    // olarak eklendi (▲) — bir daha sessizce düşmesinler.
    const urunlerGrubu = PANEL_MENU.find((m) => m.key === "urunler");
    const altEtiketler = urunlerGrubu?.children?.map((c) => c.label) ?? [];
    expect(altEtiketler).toEqual(
      expect.arrayContaining(["Stok Hareketleri", "Hasarlı Stok"]),
    );
  });

  it("masaüstünde sol menü görünür", () => {
    setViewport(1280);
    render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByText("Ürünler")).toBeVisible();
  });

  it("mobilde menü düğmesi çıkar", () => {
    setViewport(390);
    render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /menü/i })).toBeInTheDocument();
  });

  it("aktif rotaya göre doğru menü öğesi seçili ve üst menüsü açık olur", () => {
    setViewport(1280);
    const { container } = render(
      <MemoryRouter initialEntries={["/yonetim-yeni/urunler"]}>
        <PanelShell />
      </MemoryRouter>,
    );
    const secililer = container.querySelectorAll(".ant-menu-item-selected");
    expect(secililer).toHaveLength(1);
    expect(secililer[0]?.getAttribute("data-menu-id")).toMatch(/-urun-listesi$/);
    expect(container.querySelector(".ant-menu-submenu-open")).not.toBeNull();
  });

  it("üst bar kaldırıldı: marka adı artık kabukta yok, mobilde menü düğmesi duruyor", () => {
    // ikas referansı §5/4: üst bar yok, sayfa başlığı içeriğin içinde. Bilinçli
    // davranış değişikliği (eskiden `Header`de "Adana Özel Ders" vardı) —
    // mobil çekmeceyi açan TEK giriş (menü düğmesi) hâlâ durmalı, artık
    // içeriğin üstünde.
    setViewport(390);
    render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Adana Özel Ders")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /menü/i })).toBeInTheDocument();
  });

  it("her menü öğesi (kök ve alt) bir ikon taşır", () => {
    function dogrula(items: typeof PANEL_MENU) {
      for (const item of items) {
        expect(item.icon, `"${item.label}" ikon taşımıyor`).toBeTruthy();
        if (item.children) dogrula(item.children);
      }
    }
    dogrula(PANEL_MENU);
  });

  it("masaüstünde menü öğeleri AntD ikonlarıyla render olur", () => {
    setViewport(1280);
    const { container } = render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    // Görünür kök öğe sayısı kadar (en az) `.anticon` beklenir — alt öğeler
    // kapalı submenu'de DOM'da olsa da olmasa da bu alt sınırı bozmaz.
    expect(container.querySelectorAll(".anticon").length).toBeGreaterThanOrEqual(
      PANEL_MENU.length,
    );
  });

  it("Sider altında kullanıcı kartı gerçek oturum verisinden gelir (uydurma yok)", () => {
    setViewport(1280);
    useAuthStore.setState({
      token: "test-token",
      isAuthenticated: true,
      user: {
        id: 1,
        role_id: 1,
        full_name: "Test Kullanıcı Adı",
        admin_permissions: [...TAM_ADMIN_IZINLERI],
      } as never,
    });
    render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    const kart = screen.getByTestId("panel-kullanici-karti");
    expect(kart).toHaveTextContent("Test Kullanıcı Adı");
    // Rol etiketi `lib/roles.ts` TEK kaynağından: admin (role_id 1) → "Yönetici".
    expect(kart).toHaveTextContent("Yönetici");
  });

  it("767px genişlikte mobil dala geçer: menü düğmesi var, Sider yok", () => {
    setViewport(767);
    const { container } = render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /menü/i })).toBeInTheDocument();
    expect(container.querySelector(".ant-layout-sider")).toBeNull();
  });

  it("768px genişlikte masaüstü dalına geçer: Sider var, menü düğmesi yok", () => {
    setViewport(768);
    const { container } = render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(container.querySelector(".ant-layout-sider")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /menü/i })).not.toBeInTheDocument();
  });

  it("Sider genişliği ikas referansından ölçülen 224px'tir (docs/ikas-panel-referans.md §7)", () => {
    setViewport(1280);
    const { container } = render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    const sider = container.querySelector(".ant-layout-sider") as HTMLElement | null;
    expect(sider?.style.width).toBe("224px");
  });

  it("mobil menü düğmesi büyük dokunma hedefi boyutundadır", () => {
    setViewport(390);
    render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /menü/i })).toHaveClass("ant-btn-lg");
  });

  it("mobilde menüden bir öğeye tıklayınca drawer kapanır", async () => {
    setViewport(390);
    render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /menü/i }));
    expect(document.querySelector(".ant-drawer")).toHaveClass("ant-drawer-open");
    await userEvent.click(screen.getByText("Giriş"));
    expect(document.querySelector(".ant-drawer")).not.toHaveClass("ant-drawer-open");
  });
});

/** `admin_permissions`i verilen bir oturum kurar (izin kapısı testleri). */
function izinliOturumKur(permissions: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: permissions } as never,
  });
}

describe("PanelShell · izin kapısı", () => {
  // Alt öğe yalnız kendi üst submenu'sü AÇIKKEN DOM'a girer (rc-menu inline
  // mod), o yüzden her iki test de ürün rotasına navigate ederek submenu'yü
  // açık kılıyor (aynı mekanizma: "aktif rotaya göre" testi).
  it("ürün izni olmayan kullanıcıya menüde Ürünler listesi görünmez", () => {
    setViewport(1280);
    izinliOturumKur([]);
    const { container } = render(
      <MemoryRouter initialEntries={[PATHS.adminNewProducts]}>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-menu-id$="-urun-listesi"]')).toBeNull();
    // Grup başlığı, izinsiz yer tutucu alt öğeler yüzünden yine de durabilir —
    // ama listelenen tek gerçek ekran (ürün listesi) menüden düşmüş olmalı.
  });

  it("ürün izni olan kullanıcıya menüde Ürünler listesi görünür", () => {
    setViewport(1280);
    izinliOturumKur(["products.view"]);
    const { container } = render(
      <MemoryRouter initialEntries={[PATHS.adminNewProducts]}>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-menu-id$="-urun-listesi"]')).not.toBeNull();
  });

  it("ürün izni olmayan kullanıcı ürün rotasına girince yetkisiz ekranı görür", () => {
    setViewport(1280);
    izinliOturumKur([]);
    render(
      <MemoryRouter initialEntries={[PATHS.adminNewProducts]}>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeVisible();
  });

  it("izin bilgisi henüz yüklenmemişken ürün rotasının içeriği açılmaz", () => {
    setViewport(1280);
    // `/auth/me` henüz dönmedi: token var ama kullanıcı yok — ProtectedRoute
    // dışında (izole kabuk testi) fail-closed davranışı burada sınanır.
    useAuthStore.setState({ token: "test-token", isAuthenticated: true, user: null });
    render(
      <MemoryRouter initialEntries={[PATHS.adminNewProducts]}>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(screen.queryByText(ERISIM_REDDEDILDI_BASLIK)).toBeNull();
    expect(screen.getByTestId("panel-icerik-yukleniyor")).toBeInTheDocument();
  });
});
