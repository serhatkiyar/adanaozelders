/**
 * KEŞİF KABUĞU KATEGORİ DEĞİŞİMİNDE YERİNDE KALIR — nöbetçi.
 *
 * ## Karar (kullanıcı, 10 Eyl 2026)
 *
 * > *"kütüphaneler butonuna bastığımızda neden sayfa tamamen değişiyor?
 * >  Airbnb'de diğer kategoriye tıklayınca sayfa yenilenmiyor."*
 *
 * ## Ölçtüğü kusur sınıfı
 *
 * `/` ve `/kutuphaneler` iki AYRI üst-seviye rotaydı ve her biri kendi
 * kabuğunu (üst bar + kategori şeridi + arama hapı) basıyordu; React her
 * geçişte hepsini söküp yeniden kuruyordu. Adres değişimi doğruydu — kusur
 * orada DEĞİLDİ.
 *
 * Bir layout route eklemek TEK BAŞINA yetmedi ve sebebi bu dosyanın asıl
 * varlık nedeni: `RouteErrorBoundary` `key={location.pathname}` taşıyordu.
 * `key` değişimi React'e "bu ağacı SÖK" demektir ve sınır tüm `<Routes>`u
 * sardığı için HER gezinme uygulamanın tamamını remount ediyordu. Yani
 * kabuk doğru kurulsa bile üstteki tek satır onu geçersiz kılıyordu.
 *
 * Bu kusur SESSİZDİR: ekran doğru içeriği gösterir, hiçbir test kırılmaz;
 * yalnız gözle "sayfa değişti" görünür. Geri gelmesi de sessiz olur —
 * biri `resetKey`i `key`e çevirir, biri rotayı layout'un dışına taşır, biri
 * `KesifKabugu`yu `App()` gövdesinin içinde tanımlar (her render'da yeni
 * bileşen tipi = remount).
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek `App` + gerçek router + gerçek tıklama. Kanıt DOM DÜĞÜM
 * KİMLİĞİdir: remount olsaydı `header` YENİ bir nesne olurdu.
 *
 * ÖLÇMEDİĞİ: görsel süreklilik (aynı düğüm farklı yüksekliğe geçebilir) ve
 * geçiş sırasındaki boyama. Onları gerçek Chrome ölçüyor —
 * `scripts/anasayfa_mobil_turu.mjs` (üst bar yüksekliği rota başına) ve
 * ölçüm sonuçları `docs/anasayfa-mobil/`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import App from "@/App";
import "@/pages/Libraries";
import { ROUTES } from "@/lib/routes";

// Kabuk sözleşmesi iki keşif kategorisi arasında ölçülür; 26 Eyl 2026'dan beri
// Kütüphaneler lansman için gizli. Mimari iddia bayraktan bağımsız olduğu için
// burada yalnız o bayrak açık sayılır, geri kalanı gerçek değerini korur.
vi.mock("@/lib/ozellikBayraklari", async (gercek) => ({
  ...(await gercek<typeof import("@/lib/ozellikBayraklari")>()),
  KUTUPHANELER_ACIK: true,
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: null, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useLibraries", () => ({
  useLibraryDetail: () => ({ data: null, isLoading: false, isError: false }),
  useLibrarySearch: () => ({ data: [], isLoading: false, isFetching: false }),
  useLibraryReviews: () => ({ data: [] }),
  useLibraryRatingDistribution: () => ({ data: null }),
  useCreateLibraryReview: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteLibraryReview: () => ({ mutate: vi.fn(), isPending: false }),
  useLibraryMedia: () => ({ data: [] }),
}));
vi.mock("@/hooks/useTutorSearch", () => ({
  useTutorDetail: () => ({ data: null, isLoading: false, isError: false }),
  useTutorSearch: () => ({ data: [], isLoading: false, isFetching: false }),
  useFeaturedTutors: () => ({ data: [], isLoading: false }),
  useTutorPriceHistogram: () => ({ data: null }),
  useTutorGenderFacets: () => ({ data: null }),
}));

afterEach(cleanup);

async function uygulamayiBas(yol: string) {
  window.history.pushState({}, "", yol);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const sonuc = render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </HelmetProvider>
  );
  // Tembel sınırı akıt (bkz. bolumDondurma.test.tsx).
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return sonuc;
}

const kategoriBagi = (etiket: string) =>
  screen
    .getAllByRole("link")
    .find((a) => a.textContent?.trim() === etiket);

describe("keşif kabuğu · kategori değişiminde remount YOK", () => {
  it("DOLULUK: kökte üst bar ve kategori şeridi gerçekten çiziliyor", async () => {
    // Bu düğüm olmasaydı aşağıdaki kimlik iddiaları bedava geçerdi: hiç
    // header çizilmeyen bir uygulamada `null === null` de doğrudur.
    await uygulamayiBas("/");
    expect(document.querySelector("header")).toBeTruthy();
    expect(kategoriBagi("Kütüphaneler")).toBeTruthy();
    expect(kategoriBagi("Öğretmenler")).toBeTruthy();
  });

  it("Kütüphaneler'e tıklamak AYNI header düğümünü korur", async () => {
    await uygulamayiBas("/");
    const once = document.querySelector("header");
    expect(once).toBeTruthy();

    await act(async () => {
      fireEvent.click(kategoriBagi("Kütüphaneler")!);
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(window.location.pathname).toBe(ROUTES.libraries);
    // ASIL İDDİA: aynı DOM NESNESİ hâlâ belgede.
    expect(
      document.querySelector("header"),
      "üst bar remount oldu — layout route ya da RouteErrorBoundary bozulmuş"
    ).toBe(once);
    expect(once!.isConnected).toBe(true);
  });

  it("kategori şeridinin KENDİ düğümü de korunur", async () => {
    await uygulamayiBas("/");
    // Tıklanmayan sekme Eğitmenler.
    const bagOnce = kategoriBagi("Öğretmenler");
    expect(bagOnce).toBeTruthy();

    await act(async () => {
      fireEvent.click(kategoriBagi("Kütüphaneler")!);
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(kategoriBagi("Öğretmenler")).toBe(bagOnce);
  });

  it("KAYNAK SÖZLEŞMESİ: hata sınırı `key` ile sıfırlanmaz", () => {
    // `key={location.pathname}` tüm `<Routes>` ağacını her gezinmede remount
    // eder ve yukarıdaki iddiaları TEK BAŞINA geçersiz kılar. Kimlik testi
    // bunu zaten yakalar; bu düğüm kusuru İSMİYLE söyler, yoksa gerileme
    // "neden remount oluyor" diye saatlerce aranır.
    const kok = resolve(
      dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
      "..",
      ".."
    );
    const kaynak = readFileSync(join(kok, "src/components/ErrorBoundary.tsx"), "utf8");
    expect(kaynak, "RouteErrorBoundary yine `key` ile sıfırlıyor").not.toMatch(
      /<ErrorBoundary\s+key=/
    );
    expect(kaynak, "`resetKey` sözleşmesi kaybolmuş").toContain("resetKey");
  });
});
