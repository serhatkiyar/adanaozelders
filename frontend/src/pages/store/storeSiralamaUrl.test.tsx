/**
 * TB-70 (b) · Sıralama seçimi URL'e yazılmalı.
 *
 * ## Neden
 *
 * `setSort` yalnız yerel duruma yazıyordu. Sonucu: seçilen sıralama
 * paylaşılamıyor, yer imine alınamıyor ve sayfa yenilenince kayboluyordu —
 * oysa `q`, `category` ve `kind` URL'de yaşıyor. Aynı ekranda bir filtre
 * URL'de, ötekisi değil.
 *
 * ## Ölçülen sözleşme
 *
 *   • Sıralama seçilince `?sort=` adrese yazılır.
 *   • "Önerilen"e (boş değer) dönülünce parametre adresten SİLİNİR —
 *     `?sort=` gibi boş bir kuyruk bırakmaz.
 *   • Adreste `sort` varsa açılışta seçili gelir (mevcut davranış; nöbetçi).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import StorePage from "@/pages/store/StorePage";

import type { AxiosRequestConfig } from "axios";

let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    const data = url.includes("/store/home")
      ? { id: 1, slug: "ana-sayfa", revision: { id: 1, blocks: [] } }
      : [];
    return { data, status: 200, statusText: "OK", headers: {}, config } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
});

/** Adres çubuğunu teste görünür kılar. */
function AdresYansitici() {
  const konum = useLocation();
  return <div data-testid="adres">{konum.pathname + konum.search}</div>;
}

function sar(baslangic = "/magaza") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[baslangic]}>
          <AdresYansitici />
          <Routes>
            <Route path="/magaza" element={<StorePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

const adres = () => screen.getByTestId("adres").textContent ?? "";

describe("sıralama URL'de yaşar", () => {
  it("sıralama seçilince adrese yazılır", async () => {
    // Sıralama seçicisi YALNIZ filtre görünümünde vardır (vitrin modunda
    // sıralama menüsü yoktur ve bu doğru tasarımdır); bu yüzden test bir
    // aramayla başlar.
    sar("/magaza?q=kitap");
    const secici = await screen.findByRole("combobox", { name: /sırala/i });
    fireEvent.change(secici, { target: { value: "rating" } });

    await waitFor(() => expect(adres()).toContain("sort=rating"));
  });

  it("Önerilen'e dönülünce parametre SİLİNİR", async () => {
    sar("/magaza?sort=rating");
    const secici = await screen.findByRole("combobox", { name: /sırala/i });
    fireEvent.change(secici, { target: { value: "" } });

    // Boş bir `?sort=` kuyruğu bırakmak da kusurdur: paylaşılan adres
    // "sıralama seçilmiş" gibi görünür.
    await waitFor(() => expect(adres()).not.toContain("sort"));
  });

  it("adresteki sıralama açılışta seçili gelir", async () => {
    sar("/magaza?sort=newest");
    const secici = (await screen.findByRole("combobox", {
      name: /sırala/i,
    })) as HTMLSelectElement;
    expect(secici.value).toBe("newest");
  });
});
