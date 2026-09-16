import { render, screen } from "@testing-library/react";
import { Button } from "antd";
import { PanelProvider } from "@/panel/PanelProvider";
import { panelTheme } from "@/panel/theme";

describe("panel kurulumu", () => {
  it("aksan rengi marka turuncusu (index.css --marka ile eşleşmeli; çapraz dosya eşleşmesi panelMarkaRengi.test.ts'te sınanır)", () => {
    expect(panelTheme.token?.colorPrimary).toBe("#FF9900");
  });

  it("AntD butonu Türkçe locale ile ve kendi sınıfıyla render olur", () => {
    render(
      <PanelProvider>
        <Button type="primary">Kaydet</Button>
      </PanelProvider>,
    );
    const btn = screen.getByRole("button", { name: "Kaydet" });
    // Tailwind preflight AntD sınıfını ezmemeli: AntD kendi sınıfını korumalı
    expect(btn.className).toMatch(/ant-btn/);
  });

  it("tema token'ları ikas referansından ölçülen değerleri taşır (docs/ikas-panel-referans.md §7)", () => {
    expect(panelTheme.token?.borderRadius).toBe(4);
    expect(panelTheme.token?.controlHeight).toBe(40);
    expect(panelTheme.token?.fontSize).toBe(14);
    expect(panelTheme.token?.colorBorder).toBe("#E3E8EF");
    expect(panelTheme.token?.colorText).toBe("#121926");
    expect(panelTheme.token?.colorTextSecondary).toBe("#4B5565");
  });

  it("koyu menü renkleri ölçülen değerlerde (varsayılan/seçili zemin+yazı, yükseklik, yarıçap)", () => {
    const menu = panelTheme.components?.Menu;
    expect(menu?.darkItemColor).toBe("#ECECED");
    expect(menu?.darkItemSelectedBg).toBe("#2E2E33");
    expect(menu?.darkItemSelectedColor).toBe("#F8FAFC");
    expect(menu?.itemHeight).toBe(36);
    expect(menu?.itemBorderRadius).toBe(4);
    expect(menu?.itemPaddingInline).toBe(10);
  });

  it("düğme token'ları ölçülen değerlerde (kalınlık + ikincil düğme zemin/kenarlık/yazı)", () => {
    const button = panelTheme.components?.Button;
    expect(button?.fontWeight).toBe(500);
    expect(button?.defaultBg).toBe("#FFFFFF");
    expect(button?.defaultBorderColor).toBe("#E3E8EF");
    expect(button?.defaultColor).toBe("#121926");
  });
});
