import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TipSecimi } from "@/panel/components/TipSecimi";
import { PanelProvider } from "@/panel/PanelProvider";

describe("TipSecimi", () => {
  it("seçenekleri gösterir ve seçimi bildirir", async () => {
    const secildi = vi.fn();
    render(
      <PanelProvider>
        <TipSecimi
          acik
          baslik="Ürün Ekle"
          secenekler={[
            { anahtar: "basit", baslik: "Basit Ürün", aciklama: "Tek parça olarak bir ürün ekleyin" },
            { anahtar: "varyantli", baslik: "Varyantlı Ürün", aciklama: "Renk, boyut gibi seçeneklerle ekleyin" },
          ]}
          kapat={() => {}}
          secildi={secildi}
        />
      </PanelProvider>,
    );
    expect(screen.getByText("Basit Ürün")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Varyantlı Ürün"));
    expect(secildi).toHaveBeenCalledWith("varyantli");
  });

  it("klavyeyle Enter ile seçim yapılabilir", async () => {
    const secildi = vi.fn();
    render(
      <PanelProvider>
        <TipSecimi
          acik
          baslik="Ürün Ekle"
          secenekler={[
            { anahtar: "basit", baslik: "Basit Ürün", aciklama: "Tek parça olarak bir ürün ekleyin" },
            { anahtar: "varyantli", baslik: "Varyantlı Ürün", aciklama: "Renk, boyut gibi seçeneklerle ekleyin" },
          ]}
          kapat={() => {}}
          secildi={secildi}
        />
      </PanelProvider>,
    );
    const kart = screen.getByText("Basit Ürün").closest('[role="button"]') as HTMLElement;
    kart.focus();
    await userEvent.keyboard("{Enter}");
    expect(secildi).toHaveBeenCalledWith("basit");
  });

  it("klavyeyle Space ile seçim yapılabilir", async () => {
    const secildi = vi.fn();
    render(
      <PanelProvider>
        <TipSecimi
          acik
          baslik="Ürün Ekle"
          secenekler={[
            { anahtar: "basit", baslik: "Basit Ürün", aciklama: "Tek parça olarak bir ürün ekleyin" },
            { anahtar: "varyantli", baslik: "Varyantlı Ürün", aciklama: "Renk, boyut gibi seçeneklerle ekleyin" },
          ]}
          kapat={() => {}}
          secildi={secildi}
        />
      </PanelProvider>,
    );
    const kart = screen.getByText("Varyantlı Ürün").closest('[role="button"]') as HTMLElement;
    kart.focus();
    await userEvent.keyboard(" ");
    expect(secildi).toHaveBeenCalledWith("varyantli");
  });
});
