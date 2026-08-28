/**
 * Manuel vitrin sözleşmesi: vitrin SIFIR istekle çizilir, kartlar gerçek
 * rotalara bağlıdır. (Eski vitrinTekNesil kabulünün halefi — artık "eski
 * uçlara istek doğmaz" değil, "HİÇ istek doğmaz".)
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { apiClient } from "@/api/axios";

import { AnaVitrin } from "./AnaVitrin";

describe("AnaVitrin (manuel vitrin)", () => {
  it("dört Amazon kartını başlık ve CTA'larıyla basar, HİÇ istek atmaz", () => {
    const istek = vi.spyOn(apiClient, "get");
    render(
      <MemoryRouter>
        <AnaVitrin />
      </MemoryRouter>,
    );

    for (const baslik of [
      "Okula dönüş sezonu",
      "YKS hazırlık kaynakları",
      "LGS kitapları",
      "Defter ve ajandalar",
    ]) {
      expect(screen.getByRole("heading", { name: baslik })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "Kampanyayı keşfet" }).getAttribute("href")).toBe(
      "/magaza/okula-donus",
    );
    expect(screen.getByRole("link", { name: "YKS kitaplarına git" }).getAttribute("href")).toBe(
      "/magaza?category=57",
    );
    expect(istek).not.toHaveBeenCalled();
  });

  it("hero kampanya sayfasına bağlıdır ve alta fade katmanı taşır", () => {
    const { container } = render(
      <MemoryRouter>
        <AnaVitrin />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: "Okula dönüş kampanyası" }).getAttribute("href"),
    ).toBe("/magaza/okula-donus");
    expect(container.querySelector(".bg-gradient-to-b")).toBeTruthy();
  });
});
