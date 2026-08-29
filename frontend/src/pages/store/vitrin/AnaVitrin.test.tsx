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

    // 30 Ağu: başlıklar görsellerle eşleşir, dört CTA da kampanyaya götürür.
    for (const baslik of [
      "Sırt Çantaları",
      "Suluklar",
      "Beslenme Çantaları",
      "Resim Malzemeleri",
    ]) {
      expect(screen.getByRole("heading", { name: baslik })).toBeTruthy();
    }
    const ctalar = screen.getAllByRole("link", { name: "Okula Dönüş Alışverişi" });
    expect(ctalar).toHaveLength(4);
    for (const cta of ctalar) {
      expect(cta.getAttribute("href")).toBe("/magaza/okula-donus");
    }
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
