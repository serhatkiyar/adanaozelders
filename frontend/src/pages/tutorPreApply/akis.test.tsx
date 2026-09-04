/**
 * Ön başvuru formunun DAVRANIŞ matrisi.
 *
 * Sessizce bozulduğunda kayıp üreten davranışlar:
 *
 *  1. Eksik formda istek ATILMAZ ve hata alanın yanında görünür (aksi hâlde
 *     kullanıcı "gönderdim" sanır, panele kayıt düşmez).
 *  2. Yalnız zorunlu üç alanı doldurup gönderen kişi geçebilir — isteğe bağlı
 *     bölümler formu kilitlemez.
 *  3. Doldurulan isteğe bağlı alanlar AYNI istekte gider; boş bırakılanlar
 *     `null` olarak yollanır (sunucuda NULL yazılsın diye).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TutorPreApply from "./TutorPreApply";
import { submitTutorPreApplication } from "@/api/tutorPreApplications";

vi.mock("@/api/tutorPreApplications", () => ({
  submitTutorPreApplication: vi.fn(),
}));

const gonder = vi.mocked(submitTutorPreApplication);

function ekran() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TutorPreApply />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

function zorunlulariDoldur() {
  fireEvent.change(screen.getByLabelText(/Ad Soyad/), {
    target: { value: "Ayşe Yılmaz" },
  });
  fireEvent.change(screen.getByLabelText(/Cep telefonu/), {
    target: { value: "0532 123 45 67" },
  });
  fireEvent.change(screen.getByLabelText(/Hangi dersleri veriyorsun/), {
    target: { value: "Matematik, Geometri" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("eğitmen ön başvurusu · tek ekranlı form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("tüm bölümler ilk ekranda görünür", () => {
    ekran();
    for (const baslik of [
      "Seni tanıyalım",
      "Profilin",
      "Dersin nasıl işliyor",
      "Eğitimin ve belgelerin",
    ]) {
      expect(screen.getByRole("heading", { name: new RegExp(baslik) })).toBeTruthy();
    }
    // İsteğe bağlı bölümler açıkça işaretli olmalı: yıldızsız alanların
    // zorunlu sanılması formu terk ettiren en yaygın sebeplerden biri.
    expect(screen.getAllByText("isteğe bağlı").length).toBe(3);
  });

  it("eksik formda istek atmaz, hatayı alanın yanında gösterir", async () => {
    ekran();
    fireEvent.click(screen.getByRole("button", { name: "Başvuruyu gönder" }));

    expect(await screen.findByText("Adını ve soyadını yaz.")).toBeTruthy();
    expect(screen.getByText(/Hangi dersleri verdiğini yaz/)).toBeTruthy();
    expect(gonder).not.toHaveBeenCalled();
  });

  it("yalnız zorunlu alanlarla gönderilebilir", async () => {
    gonder.mockResolvedValue({ detail: "ok" });
    ekran();
    zorunlulariDoldur();
    fireEvent.click(screen.getByRole("button", { name: "Başvuruyu gönder" }));

    await waitFor(() => expect(gonder).toHaveBeenCalledTimes(1));
    expect(gonder.mock.calls[0][0]).toMatchObject({
      full_name: "Ayşe Yılmaz",
      phone: "+905321234567",
      subjects: ["Matematik", "Geometri"],
      kvkk_accepted: true,
      // Boş bırakılanlar null gider — sunucuda boş dize değil NULL yazılsın.
      headline: null,
      bio: null,
      hourly_rate: null,
      teaching_mode: null,
    });
    expect(await screen.findByText("Başvurun bize ulaştı")).toBeTruthy();
  });

  it("doldurulan isteğe bağlı alanlar aynı istekte gider", async () => {
    gonder.mockResolvedValue({ detail: "ok" });
    ekran();
    zorunlulariDoldur();
    fireEvent.change(screen.getByLabelText(/Tek cümleyle kendini tanıt/), {
      target: { value: "10 yıllık matematik öğretmeni" },
    });
    fireEvent.change(screen.getByLabelText(/Saatlik ücretin/), {
      target: { value: "1.250,5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Yüz yüze" }));
    fireEvent.click(screen.getByRole("button", { name: "Başvuruyu gönder" }));

    await waitFor(() => expect(gonder).toHaveBeenCalledTimes(1));
    expect(gonder.mock.calls[0][0]).toMatchObject({
      headline: "10 yıllık matematik öğretmeni",
      // Türkçe biçim sunucunun beklediği ondalığa çevrilir.
      hourly_rate: "1250.5",
      teaching_mode: "IN_PERSON",
    });
  });
});
