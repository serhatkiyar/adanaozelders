/**
 * BÖLÜM DONDURMA — BAYRAK AÇIKKEN eski davranış aynen geri gelir.
 *
 * Dondurmanın şartı yalnız "kapanıyor mu" değildir: kararın geri alınabilir
 * olması da sözleşmenin parçasıdır. Tek bayrak `true` yapıldığında menü
 * öğesi yeniden gerçek bir bağlantı olmalı, "Yakında" rozeti kalkmalı ve rota
 * gerçek sayfayı açmalıdır — başka hiçbir dosyaya dokunmadan.
 *
 * Bu dosya olmadan dondurma "kalıcı silme"den ayırt edilemezdi: menüyü
 * tamamen kaldıran ya da rotayı sabit `Yakinda`ya bağlayan bir uygulama,
 * `bolumDondurma.test.tsx`in her düğümünü geçerdi.
 *
 * Bayraklar `vi.mock` ile açılır — üretim varsayılanı `false` KALIR.
 *
 * Test türü (§H): gerçek DOM (jsdom + RTL) + gerçek `App`/react-router.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ozellikBayraklari", () => ({
  KUTUPHANELER_ACIK: true,
  DENEMELER_ACIK: true,
}));

import App from "@/App";
import "@/pages/NotFound";

import { CategoryBar } from "@/components/CategoryBar";
import { DashboardHeader } from "@/components/DashboardHeader";
import { TUTOR_NAV } from "@/lib/nav";
import Learn from "@/pages/Learn";

function sar(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("bayrak AÇIK — kategori çubuğu eski hâline döner", () => {
  it("'Kütüphaneler' ve 'Denemeler' yeniden gerçek bağlantı", () => {
    sar(<CategoryBar />);
    expect(
      screen.getByRole("link", { name: /Kütüphaneler/ }).getAttribute("href")
    ).toBe("/kutuphaneler");
    expect(
      screen.getByRole("link", { name: /Denemeler/ }).getAttribute("href")
    ).toBe("/kutuphaneler");
  });

  it("'Yakında' rozeti kalkar", () => {
    sar(<CategoryBar />);
    expect(screen.queryByText("Yakında")).toBeNull();
  });

  it("sekme kipinde donmuş kategoriler yeniden seçilebilir", () => {
    const onSelect = vi.fn();
    sar(<CategoryBar active="hepsi" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Kütüphaneler"));
    expect(onSelect).toHaveBeenCalledWith("kutuphaneler");
    fireEvent.click(screen.getByText("Denemeler"));
    expect(onSelect).toHaveBeenCalledWith("denemeler");
  });
});

describe("bayrak AÇIK — menü girdileri ve hub kartı eski hâline döner", () => {
  it("eğitmen menüsündeki 'Kütüphaneler' yeniden /kutuphaneler'e gidiyor", () => {
    sar(<DashboardHeader navItems={TUTOR_NAV} />);
    const hedefler = Array.from(document.body.querySelectorAll("a[href]")).map(
      (a) => a.getAttribute("href")
    );
    expect(hedefler).toContain("/kutuphaneler");
    expect(screen.queryByText("Yakında")).toBeNull();
  });

  it("Öğren hub'ındaki 'Denemelerim' yeniden /denemeler'e gidiyor", () => {
    sar(<Learn />);
    const hedefler = Array.from(document.body.querySelectorAll("a[href]")).map(
      (a) => a.getAttribute("href")
    );
    expect(hedefler).toContain("/denemeler");
    expect(screen.queryByText("Yakında")).toBeNull();
  });
});

describe("bayrak AÇIK — rotalar gerçek sayfayı açar", () => {
  const yoluBas = async (yol: string) => {
    window.history.pushState({}, "", yol);
    const sonuc = render(
      <HelmetProvider>
        <App />
      </HelmetProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    return sonuc;
  };

  it.each(["/kutuphaneler", "/kutuphane-kayit"])(
    "%s artık 'Yakında' DEĞİL",
    async (yol) => {
      await yoluBas(yol);
      expect(screen.queryByRole("heading", { name: /^Yakında$/i })).toBeNull();
    }
  );
});
