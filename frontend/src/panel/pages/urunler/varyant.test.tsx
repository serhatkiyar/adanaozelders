import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VaryantPenceresi } from "@/panel/pages/urunler/VaryantPenceresi";
import { Matris } from "@/panel/components/Matris";
import { PanelProvider } from "@/panel/PanelProvider";

vi.mock("@/api/store", () => ({
  fetchVariantConfig: vi.fn().mockResolvedValue({ axes: ["Renk", "Ebat"] }),
}));

describe("varyant akışı", () => {
  it("eksen adı ve değerler girilip eklenebilir", async () => {
    const eklendi = vi.fn();
    render(
      <PanelProvider>
        <VaryantPenceresi acik kapat={() => {}} eklendi={eklendi} />
      </PanelProvider>,
    );
    await userEvent.type(screen.getByLabelText("Varyant Türü Adı"), "Renk");
    await userEvent.type(screen.getByLabelText("Varyantlar"), "Kırmızı,Mavi");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(eklendi).toHaveBeenCalledWith({ ad: "Renk", degerler: ["Kırmızı", "Mavi"] });
  });

  it("matris her kombinasyon için düzenlenebilir alan gösterir", async () => {
    const degisti = vi.fn();
    render(
      <PanelProvider>
        <Matris
          satirlar={[
            { anahtar: "k1", kombinasyon: "Kırmızı", price: 100 },
            { anahtar: "k2", kombinasyon: "Mavi", price: 100 },
          ]}
          degisti={degisti}
        />
      </PanelProvider>,
    );
    expect(screen.getByText("Kırmızı")).toBeTruthy();
    expect(screen.getByText("Mavi")).toBeTruthy();
    const sku = screen.getAllByLabelText(/SKU/i)[0];
    await userEvent.type(sku, "ABC");
    expect(degisti).toHaveBeenCalled();
  });
});
