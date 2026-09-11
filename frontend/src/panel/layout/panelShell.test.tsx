import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PanelShell } from "@/panel/layout/PanelShell";
import { PANEL_MENU } from "@/panel/layout/menu";

function setViewport(width: number) {
  window.innerWidth = width;
  window.matchMedia = ((query: string) => ({
    matches: /max-width:\s*767/.test(query) ? width < 768 : width >= 768,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
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
});
