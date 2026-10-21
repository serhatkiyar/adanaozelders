/**
 * EĞİTMEN PROFİLİ · MOBİL DETAY EKRANI — çıkmaz sokak ve çift CTA nöbetçisi.
 *
 * ## Neden var
 *
 * Kullanıcı kararı, 10 Eyl 2026: telefonda eğitmen profilinde ÜST BAR da ALT
 * SEKME ÇUBUĞU da çizilmiyor. İkisi birden kalkınca sayfanın tek çıkışı
 * hero'nun sol üstündeki geri düğmesi oluyor. O düğme bir süs değil, gezinme
 * sözleşmesinin kendisi — silinirse ya da `navigate(-1)`e indirgenirse
 * paylaşılan her profil bağlantısı çıkışsız bir ekran açar. Bu dosya tam
 * olarak onu ve iki yan sözleşmeyi çıpalar.
 *
 * `mobilAltSekmeler.test.tsx` bunu YAKALAYAMAZ: o, bileşeni doğrudan render
 * eder ve rotadan haberi yoktur. Buradaki iddia kabuk kararıyla ilgili.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek DOM + gerçek router. YERLEŞİM ÖLÇMEZ — 44px dokunma hedefi, yatay
 * taşma, şeridin son içeriği örtüp örtmediği jsdom'da hesaplanmaz; hepsi
 * `scripts/anasayfa_mobil_turu.mjs`in (gerçek Chrome) işi.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import PublicTutorProfile from "@/pages/PublicTutorProfile";
import { PublicShell } from "@/components/PublicShell";
import { GORSEL_USTU_DAIRE } from "@/components/egitmen/gorselUstuDaire";
import { niyetiGozle, niyetiTemizle } from "@/lib/bekleyenNiyet";
import { ROUTES } from "@/lib/routes";

const YOL_ONEKI = /^\/([A-Za-z]:)/;
const KOK = (() => {
  const buDosya = resolve(dirname(new URL(import.meta.url).pathname).replace(YOL_ONEKI, "$1"));
  return resolve(buDosya, "..", "..");
})();
const kaynakOku = (goreli: string) => readFileSync(join(KOK, goreli), "utf8");

const EGITMEN = {
  id: 42,
  display_name: "Ali Veli",
  headline: "Matematik",
  hourly_rate: 300,
  subjects: [],
  districts: [],
  rating_avg: 0,
  rating_count: 0,
  
};

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: null, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useTutorSearch", () => ({
  useTutorDetail: () => ({ data: EGITMEN, isLoading: false, isError: false }),
  useTutorSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useReviews", () => ({
  useReviewsByTutor: () => ({ data: [] }),
  useTutorRatingDistribution: () => ({ data: null }),
}));

/**
 * `useMobil()` MONTAJ kararıdır: telefon dalı ile masaüstü dalı asla birlikte
 * basılmaz. Testte hangi dalı ölçtüğümüzü bu belirler.
 */
function ekraniAyarla(mobil: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: mobil && query.includes("max-width"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

const qc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

let sonAdres = "";
function AdresGozcusu() {
  const loc = useLocation();
  sonAdres = loc.pathname + loc.search;
  return null;
}

function profiliBas(girisler: string[] = ["/egitmenler/ali-42"]) {
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc()}>
        <MemoryRouter initialEntries={girisler}>
          <AdresGozcusu />
          <Routes>
            <Route path="/egitmenler/:slug" element={<PublicTutorProfile />} />
            <Route path={ROUTES.tutors} element={<p>arama ekranı</p>} />
            {/* Yedek yoldan FARKLI bir hedef: "geri gerçekten geri gitti mi"
                sorusu ancak iki dal ayrı adrese çıkarsa ölçülebilir. */}
            <Route path="/kutuphaneler" element={<p>kütüphaneler</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

beforeEach(() => {
  niyetiTemizle();
  sonAdres = "";
});
afterEach(() => {
  cleanup();
  ekraniAyarla(false);
});

/* ─── 1. Alt sekme çubuğu ──────────────────────────────────────────────── */

describe("mobil detay ekranı · alt sekme çubuğu", () => {
  const kabuk = (mobilDetayEkrani: boolean) =>
    render(
      <QueryClientProvider client={qc()}>
        <MemoryRouter>
          <PublicShell mobilDetayEkrani={mobilDetayEkrani}>
            <p>içerik</p>
          </PublicShell>
        </MemoryRouter>
      </QueryClientProvider>
    );

  it("DOLULUK: bayraksız kabuk çubuğu GERÇEKTEN çiziyor", () => {
    // Bu düğüm olmasaydı aşağıdaki "çizilmiyor" iddiası bedava geçerdi:
    // çubuk hiçbir koşulda çizilmese de test yeşil kalırdı.
    kabuk(false);
    expect(screen.getByRole("navigation", { name: "Alt gezinme" })).toBeTruthy();
  });

  it("`mobilDetayEkrani` ile çubuk ÇİZİLMEZ", () => {
    kabuk(true);
    expect(screen.queryByRole("navigation", { name: "Alt gezinme" })).toBeNull();
  });
});

/* ─── 2. Rotanın İKİ kabuğu da bayrağı geçer ───────────────────────────── */

describe("rotanın iki kabuğu ayrışmaz", () => {
  // Sayfa iki dosyada yaşıyor (anonim/girişli) ve daha önce sessizce
  // ayrışmışlardı. Biri bayrağı geçip öteki geçmezse girişli kullanıcı
  // telefonda hâlâ üst bar + alt çubuk görürdü.
  const KABUKLAR = ["src/pages/PublicTutorProfile.tsx", "src/pages/TutorProfile.tsx"];

  it.each(KABUKLAR)("%s kabuğuna `mobilDetayEkrani` geçiyor", (dosya) => {
    expect(kaynakOku(dosya)).toContain("mobilDetayEkrani");
  });

  it.each(KABUKLAR)("%s mobil üst bloğu ORTAK bileşenden alıyor", (dosya) => {
    expect(kaynakOku(dosya)).toContain("EgitmenMobilUst");
    expect(kaynakOku(dosya)).toContain("DersTalepSeridi");
  });
});

/* ─── 3. ÇIKMAZ SOKAK YOK ──────────────────────────────────────────────── */

describe("çıkmaz sokak yok · geri düğmesi", () => {
  it("telefonda sayfanın bir GERİ düğmesi var", () => {
    ekraniAyarla(true);
    profiliBas();
    expect(screen.getByRole("button", { name: "Geri" })).toBeTruthy();
  });

  it("geçmiş VARSA gerçekten geri gider (yedek yol devreye girmez)", () => {
    // Kapının iki yönü de ölçülmeli: yalnız yedek yol sınansaydı, düğmeyi
    // koşulsuz `/egitmenler`e bağlayan bir gerileme sessiz kalırdı.
    ekraniAyarla(true);
    profiliBas(["/kutuphaneler", "/egitmenler/ali-42"]);
    fireEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect(screen.getByText("kütüphaneler")).toBeTruthy();
    expect(sonAdres).toBe("/kutuphaneler");
  });

  it("GEÇMİŞSİZ girişte geri, arama ekranına düşer (siteden atmaz)", () => {
    // Paylaşılan bağlantı / arama motoru girişi: `navigate(-1)` burada ya
    // hiçbir şey yapmaz ya da kullanıcıyı siteden tamamen çıkarır.
    ekraniAyarla(true);
    profiliBas();
    fireEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect(sonAdres).toBe(ROUTES.tutors);
  });
});

/* ─── 4. TEK CTA ───────────────────────────────────────────────────────── */

describe("tek 'Ders talep et' düğmesi", () => {
  it.each([
    ["telefon", true],
    ["masaüstü", false],
  ])("%s dalında düğme TEK", (_ad, mobil) => {
    ekraniAyarla(mobil as boolean);
    profiliBas();
    expect(screen.getAllByRole("button", { name: /ders talep et/i })).toHaveLength(1);
  });

  it("telefondaki şerit de niyeti saklar ve sayfada kalır", () => {
    ekraniAyarla(true);
    profiliBas();
    fireEvent.click(screen.getByRole("button", { name: /ders talep et/i }));
    expect(niyetiGozle()).toEqual({ tip: "dersTalebi", egitmenId: 42 });
    expect(sonAdres).toContain("modal=login");
    expect(sonAdres.startsWith("/egitmenler/")).toBe(true);
  });
});

/* ─── 5. Yüzen daireler tek kaynaktan ──────────────────────────────────── */

describe("fotoğraf üstündeki daireler tek kaynaktan", () => {
  it("geri ve paylaş AYNI kabı taşır", () => {
    ekraniAyarla(true);
    profiliBas();
    // Kıyas sabit bir dizeye değil, modülün KENDİ çıktısına: sınıf değişirse
    // test de onunla değişsin, ama üç düğme ayrışırsa kırılsın.
    const parcalar = GORSEL_USTU_DAIRE.trim().split(/\s+/);
    for (const ad of ["Geri", "Paylaş"]) {
      const sinif = screen.getByRole("button", { name: ad }).className;
      for (const parca of parcalar) {
        expect(sinif, `${ad} düğmesi '${parca}' taşımıyor`).toContain(parca);
      }
    }
  });
});
