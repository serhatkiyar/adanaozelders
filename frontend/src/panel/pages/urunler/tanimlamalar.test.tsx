import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PanelProvider } from "@/panel/PanelProvider";
import { KART_STILI, Tanimlamalar } from "@/panel/pages/urunler/Tanimlamalar";
import { PANEL_MENU, izinBeyaniniKarsilarMi, menuyuIzneGoreSuz, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

function izin(izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}

function kur() {
  return render(
    <PanelProvider>
      <MemoryRouter initialEntries={[PATHS.adminNewDefinitions]}>
        <Tanimlamalar />
      </MemoryRouter>
    </PanelProvider>,
  );
}

const urunlerMenusu = (izinler: string[]) => menuyuIzneGoreSuz(PANEL_MENU, izinler).find((m) => m.key === "urunler")?.children ?? [];
const tanimlamalarVar = (izinler: string[]) => urunlerMenusu(izinler).some((c) => c.key === "tanimlamalar");

describe("Tanımlamalar hub'ı", () => {
  it("iki izin: Kategoriler ve Tedarikçiler bağlantı; diğer kartlar bağlantı değil", () => {
    izin(["products.view", "suppliers.view"]);
    kur();
    expect(screen.getByRole("heading", { name: "Tanımlamalar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kategoriler" })).toHaveAttribute("href", ROUTES.adminNewCategories);
    expect(screen.getByRole("link", { name: "Tedarikçiler" })).toHaveAttribute("href", ROUTES.adminNewSuppliers);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(tanimlamalarVar(["products.view", "suppliers.view"])).toBe(true);
  });

  it("products-only: menüde Tanımlamalar var, hub açılır, yalnız Kategoriler bağlantı", () => {
    izin(["products.view"]);
    kur();
    expect(screen.getByRole("link", { name: "Kategoriler" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tedarikçiler" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(tanimlamalarVar(["products.view"])).toBe(true);
  });

  it("suppliers-only: menüde Tanımlamalar var, hub açılır, yalnız Tedarikçiler bağlantı", () => {
    izin(["suppliers.view"]);
    kur();
    expect(screen.getByRole("link", { name: "Tedarikçiler" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Kategoriler" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(tanimlamalarVar(["suppliers.view"])).toBe(true);
  });

  it("izin yok: menü öğesi düşer, doğrudan hub AccessDenied", () => {
    izin(["orders.view"]);
    kur();
    expect(screen.getByText("Bu alan için yetkiniz yok")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tanımlamalar" })).not.toBeInTheDocument();
    expect(tanimlamalarVar(["orders.view"])).toBe(false);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDefinitions)!)).toBe(false);
    expect(izinBeyaniniKarsilarMi(undefined, rotaIzniBul(PANEL_MENU, PATHS.adminNewDefinitions)!)).toBe(false);
    expect(izinBeyaniniKarsilarMi(["products.view"], { requiredAnyPermissions: [] })).toBe(false);
  });

  it("yetkisiz gerçek kart bağlantı değil ve aktif bağlantıyla aynı görünmüyor", () => {
    izin(["products.view"]);
    kur();
    const kartlar = screen.getAllByTestId("tanim-karti");
    const aktif = kartlar.find((k) => k.getAttribute("aria-label") === "Kategoriler")!;
    const pasif = kartlar.find((k) => k.getAttribute("aria-label") === "Tedarikçiler")!;
    expect(aktif.tagName).toBe("A");
    expect(pasif.tagName).toBe("DIV");
    expect(pasif.style.background).not.toBe(aktif.style.background);
  });

  it("kart sözleşmesi: 80px yükseklik, 8/24/8/8 padding, 8px radius, 12px boşluk, açıklama iki satırla sınırlı", () => {
    izin(["products.view", "suppliers.view"]);
    kur();
    expect(KART_STILI).toEqual({ height: 80, padding: "8px 24px 8px 8px", borderRadius: 8, gap: 12, aciklamaSatir: 2 });
    for (const kart of screen.getAllByTestId("tanim-karti")) {
      expect(kart.style.height).toBe("80px");
      expect(kart.style.padding).toBe("8px 24px 8px 8px");
      expect(kart.style.borderRadius).toBe("8px");
      expect(kart.style.overflow).toBe("hidden");
      const aciklama = within(kart).getByTestId("tanim-aciklama");
      // jsdom -webkit-line-clamp'ı tutmaz; satır sınırı sözleşmeden, taşma gizleme DOM'dan doğrulanır.
      expect(aciklama.style.overflow).toBe("hidden");
      expect(aciklama.style.lineHeight).toBe("20px");
    }
    expect((screen.getByRole("list") as HTMLElement).style.gap).toBe("12px");
  });

  it("menü: Tanımlamalar hub'a gider, any-of izin taşır; alias rotaları kendi izin kapısını korur", () => {
    const urunler = PANEL_MENU.find((m) => m.key === "urunler")?.children ?? [];
    const tanimlamalar = urunler.find((c) => c.key === "tanimlamalar");
    expect(urunler.some((c) => ["Kategoriler", "Tedarikçiler"].includes(c.label))).toBe(false);
    expect(urunler.some((c) => c.children?.length)).toBe(false);
    expect(tanimlamalar?.path).toBe(PATHS.adminNewDefinitions);
    expect(tanimlamalar?.requiredPermission).toBeUndefined();
    expect(tanimlamalar?.requiredAnyPermissions).toEqual(["products", "suppliers"]);
    for (const yol of [PATHS.adminNewDefinitions, PATHS.adminNewCategories, PATHS.adminNewSuppliers]) {
      expect(seciliMenuDurumu(PANEL_MENU, yol)).toEqual({ selectedKey: "tanimlamalar", openKeys: ["urunler"] });
    }
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewDefinitions)).toEqual({ label: "Tanımlamalar", requiredPermission: undefined, requiredAnyPermissions: ["products", "suppliers"] });
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewCategories)).toMatchObject({ label: "Tanımlamalar", requiredPermission: "products" });
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewSuppliers)).toMatchObject({ label: "Tanımlamalar", requiredPermission: "suppliers" });
    // Alias kapıları: yalnız kendi izni açar, hub'ın any-of izni devralınmaz.
    expect(izinBeyaniniKarsilarMi(["suppliers.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewCategories)!)).toBe(false);
    expect(izinBeyaniniKarsilarMi(["products.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewSuppliers)!)).toBe(false);
    expect(izinBeyaniniKarsilarMi(["suppliers.manage"], rotaIzniBul(PANEL_MENU, PATHS.adminNewSuppliers)!)).toBe(true);
    // Takma adlar menü öğesi olarak çizilmez.
    expect(urunlerMenusu(["products.view", "suppliers.view"]).filter((c) => c.path === PATHS.adminNewCategories || c.path === PATHS.adminNewSuppliers)).toHaveLength(0);
  });

  it("mevcut tek izinli rotalar geriye uyumlu", () => {
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewProducts)).toMatchObject({ label: "Ürünler", requiredPermission: "products" });
    expect(izinBeyaniniKarsilarMi(["products.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewProducts)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["suppliers.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewProducts)!)).toBe(false);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNew)!)).toBe(true);
    expect(urunlerMenusu(["inventory.view"]).map((c) => c.key)).toContain("envanter");
    expect(urunlerMenusu(["inventory.view"]).map((c) => c.key)).not.toContain("urun-listesi");
  });
});
