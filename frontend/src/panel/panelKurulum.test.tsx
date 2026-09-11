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
});
