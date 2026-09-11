import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PanelShell } from "@/panel/layout/PanelShell";
import { PANEL_MENU } from "@/panel/layout/menu";

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

describe("PanelShell", () => {
  it("menü ağacı ikas modüllerini içerir", () => {
    const kokler = PANEL_MENU.map((m) => m.label);
    expect(kokler).toEqual(
      expect.arrayContaining(["Ürünler", "Siparişler", "Dağıtım", "Dersler", "Ayarlar"]),
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

  it("üst şeritte marka adı görünür", () => {
    setViewport(1280);
    render(
      <MemoryRouter>
        <PanelShell />
      </MemoryRouter>,
    );
    expect(screen.getByText("Adana Özel Ders")).toBeVisible();
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
