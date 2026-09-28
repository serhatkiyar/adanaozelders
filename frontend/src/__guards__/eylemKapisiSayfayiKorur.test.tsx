/**
 * KORUMALI EYLEM SAYFAYI KAYBETTİRMEZ — ÜK-10'un ikinci yarısı.
 *
 * ## Ölçülmüş kusur sınıfı
 *
 * Depoda iki kapı deseni yan yana yaşıyordu:
 *
 *   İYİ — `?modal=login`: pencere mevcut adrese eklenir, sayfa yerinde kalır.
 *   KÖTÜ — tam sayfa `/giris`: `Login` başarıda `roleHome()`e gider, yani
 *          kullanıcı geldiği yere DÖNMEZ. Ödemeye gitmek isteyen kişi giriş
 *          yapınca kendini panosunda bulur; hedefi sessizce kaybolmuştur.
 *
 * En kötü yol kütüphane rezervasyonuydu: kapı sihirbazın İÇİNDEYDİ. Ziyaretçi
 * tarih, saat ve süre seçip FİYATI gördükten sonra tam sayfa girişe çarpıyordu
 * — emek harcandıktan sonra bağlam imhası.
 *
 * ## Bu nöbetçinin iddiaları
 *
 * 1. Anonim tıklama sihirbazı DEĞİL giriş penceresini açar (kapı dışarıda).
 * 2. Adres yolu korunur — kullanıcı sayfadan atılmaz.
 * 3. Bu kapılar niyet SAKLAMAZ: rezervasyon ve ödeme para harcatan
 *    eylemlerdir, giriş sonrası kendiliğinden başlatılmamalıdır.
 * 4. `ProtectedRoute` hedefi `?git=` ile taşır ve `Login` onu
 *    `guvenliDonusYolu`ndan geçirir (açık yönlendirme savunması).
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek DOM + gerçek router. Sunucunun 401/403 davranışını KANITLAMAZ;
 * ölçülen yalnız istemci kapısının nereye götürdüğü.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { apiClient } from "@/api/axios";
import { AuthModal } from "@/components/AuthModal";
import LibraryDetail from "@/pages/LibraryDetail";
import PublicTutorProfile from "@/pages/PublicTutorProfile";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { guvenliDonusYolu } from "@/lib/guvenliDonus";
import { niyetiGozle, niyetiSakla, niyetiTemizle } from "@/lib/bekleyenNiyet";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

/** Windows sürücü harfli `file://` yolunu düzeltir. */
const YOL_ONEKI = /^\/([A-Za-z]:)/;

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: null, isLoading: false, isError: false }),
}));

/*
 * Veri kancaları sahtelenir: ölçülen şey KAPININ NEREYE GÖTÜRDÜĞÜ, listenin
 * içeriği değil. Sahte kayıtlar düğmenin çizilmesine yetecek kadar dolu.
 */
const KUTUPHANE = {
  id: 1,
  slug: "test-1",
  name: "Test Kütüphanesi",
  district: "Seyhan",
  city: "Adana",
  is_active: true,
  amenities: [],
  photos: [],
  hours: [],
  rating_avg: 0,
  rating_count: 0,
};
const EGITMEN = {
  id: 42,
  display_name: "Ali",
  headline: "Matematik",
  hourly_rate: 300,
  subjects: [],
  districts: [],
  rating_avg: 0,
  rating_count: 0,
  first_lesson_free: false,
};

vi.mock("@/hooks/useLibraries", () => ({
  useLibraryDetail: () => ({ data: KUTUPHANE, isLoading: false, isError: false }),
  useLibrarySearch: () => ({ data: [], isLoading: false, isFetching: false }),
  useLibraryReviews: () => ({ data: [] }),
  useLibraryRatingDistribution: () => ({ data: null }),
  useCreateLibraryReview: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteLibraryReview: () => ({ mutate: vi.fn(), isPending: false }),
  useLibraryMedia: () => ({ data: [] }),
}));
vi.mock("@/hooks/useTutorSearch", () => ({
  useTutorDetail: () => ({ data: EGITMEN, isLoading: false, isError: false }),
  useTutorSearch: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useReviews", () => ({
  useReviewsByTutor: () => ({ data: [] }),
  useTutorRatingDistribution: () => ({ data: null }),
}));
vi.mock("@/hooks/useCanonicalTutorSlug", () => ({
  useCanonicalTutorSlug: () => undefined,
}));

let sonAdres = "";
function AdresGozcusu() {
  const konum = useLocation();
  sonAdres = konum.pathname + konum.search;
  return null;
}

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

afterEach(() => {
  cleanup();
  niyetiTemizle();
  useAuthStore.setState({ token: null, user: null } as never);
});

/* ─── Kütüphane rezervasyonu: kapı sihirbazın DIŞINDA ────────────────── */

describe("kütüphane rezervasyonu · kapı sihirbazın dışında", () => {
  beforeEach(() => {
    sonAdres = "";
  });

  it("anonim tıklama SİHİRBAZI AÇMAZ, giriş penceresini açar", async () => {
    render(
      <HelmetProvider>
        <QueryClientProvider client={qc()}>
          <MemoryRouter initialEntries={["/kutuphaneler/test-1"]}>
            <AdresGozcusu />
            <Routes>
              <Route path="/kutuphaneler/:slug" element={<LibraryDetail />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </HelmetProvider>
    );

    const dugme = await screen.findByRole("button", { name: /Rezervasyon Yap/i });
    fireEvent.click(dugme);

    // Kapı içerideyken burada tarih/saat sihirbazı açılıyordu.
    expect(sonAdres).toContain("modal=login");
    expect(sonAdres.startsWith("/kutuphaneler/")).toBe(true);
    expect(screen.queryByText(/Saat seçin/i)).toBeNull();
  });

  it("NİYET SAKLAMAZ — para harcatan eylem kendiliğinden başlamaz", async () => {
    render(
      <HelmetProvider>
        <QueryClientProvider client={qc()}>
          <MemoryRouter initialEntries={["/kutuphaneler/test-1"]}>
            <Routes>
              <Route path="/kutuphaneler/:slug" element={<LibraryDetail />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </HelmetProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /Rezervasyon Yap/i }));
    expect(niyetiGozle()).toBeNull();
  });
});

/* ─── Ders talebi: niyet SAKLANIR (para harcatmaz) ───────────────────── */

describe("ders talebi · niyet saklanır", () => {
  it("anonim 'Ders Talep Et' niyeti saklar ve sayfada kalır", async () => {
    sonAdres = "";
    render(
      <HelmetProvider>
        <QueryClientProvider client={qc()}>
          <MemoryRouter initialEntries={["/egitmenler/ali-42"]}>
            <AdresGozcusu />
            <Routes>
              <Route path="/egitmenler/:slug" element={<PublicTutorProfile />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </HelmetProvider>
    );

    const dugme = await screen.findByRole("button", { name: /Ders Talep Et/i });
    fireEvent.click(dugme);

    // Rezervasyonun tersi: ders talebi bir PENCERE açar, para harcatmaz.
    // Bu yüzden niyet saklanır ve giriş sonrası pencere kendiliğinden açılır.
    expect(niyetiGozle()).toEqual({ tip: "dersTalebi", egitmenId: 42 });
    expect(sonAdres).toContain("modal=login");
    expect(sonAdres.startsWith("/egitmenler/")).toBe(true);
  });

  it("bağlantı DEĞİL düğme — yeni sekmede niyet kaybolmasın", () => {
    // `<Link>` orta tıkla yeni sekmede açılır; `sessionStorage` sekmeye
    // özeldir, niyet orada yoktur. Kusur sessizdir: pencere açılır, giriş
    // yapılır, hiçbir şey olmaz.
    const kaynak = kaynakOku("src/pages/PublicTutorProfile.tsx");
    const i = kaynak.indexOf("Ders Talep Et");
    expect(i).toBeGreaterThan(0);
    const oncesi = kaynak.slice(0, i);
    expect(oncesi.slice(oncesi.lastIndexOf("<"))).not.toContain("Link");
  });
});

/* ─── Giriş penceresi: vazgeçiş niyeti siler, başarı korur ───────────── */

describe("giriş penceresi · bekleyen niyet", () => {
  /*
   * Vazgeçen kullanıcının niyeti sekmede kalırsa, sonraki (belki saatler
   * sonraki) bir girişte hiç istemediği bir ders penceresi açılır. Başarılı
   * girişte ise niyet sayfaya kadar yaşamalı; onu sayfa uygular
   * (`TutorProfile.dersTalebiRolKapisi.test.tsx`).
   */
  const eskiAdapter = apiClient.defaults.adapter;
  afterEach(() => {
    apiClient.defaults.adapter = eskiAdapter;
  });

  function pencereyiAc() {
    sonAdres = "";
    niyetiSakla({ tip: "dersTalebi", egitmenId: 42 });
    render(
      <QueryClientProvider client={qc()}>
        <MemoryRouter initialEntries={["/egitmenler/ali-42?modal=login"]}>
          <AdresGozcusu />
          <AuthModal />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("Escape ile kapatınca niyet silinir", () => {
    pencereyiAc();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(sonAdres).not.toContain("modal=login");
    expect(niyetiGozle()).toBeNull();
  });

  it("X ile kapatınca niyet silinir", () => {
    pencereyiAc();
    fireEvent.click(screen.getAllByRole("button", { name: "Kapat" })[0]);
    expect(sonAdres).not.toContain("modal=login");
    expect(niyetiGozle()).toBeNull();
  });

  it("başarılı girişte niyet KORUNUR (sayfa uygulayacak)", async () => {
    apiClient.defaults.adapter = async (config) => {
      const url = String(config.url);
      const data = url.includes("/auth/login")
        ? { access_token: "t", token_type: "bearer" }
        : url.includes("/auth/me")
          ? { id: 7, role_id: 3, display_name: "Test", email: "t@example.com" }
          : { open: true };
      return { data, status: 200, statusText: "OK", headers: {}, config } as never;
    };
    pencereyiAc();
    fireEvent.change(screen.getByPlaceholderText("ornek@eposta.com"), {
      target: { value: "t@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "parola123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Giriş Yap" }));
    await waitFor(() => expect(sonAdres).not.toContain("modal=login"));
    expect(niyetiGozle()).toEqual({ tip: "dersTalebi", egitmenId: 42 });
  });
});

/* ─── ProtectedRoute → Login dönüş adresi ────────────────────────────── */

describe("korumalı rota · hedef taşınır", () => {
  it("`?git=` hedefi taşır ve yol kodlanır", () => {
    sonAdres = "";
    render(
      <QueryClientProvider client={qc()}>
        <MemoryRouter initialEntries={["/magaza/odeme?adim=2"]}>
          <AdresGozcusu />
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/magaza/odeme" element={<div>ödeme</div>} />
            </Route>
            <Route path={ROUTES.login} element={<div>giriş</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(sonAdres.startsWith(ROUTES.login)).toBe(true);
    const git = new URLSearchParams(sonAdres.split("?")[1]).get("git");
    expect(git, "hedef taşınmadı — kullanıcı panosuna düşer").toBe(
      "/magaza/odeme?adim=2"
    );
  });

  it("AÇIK YÖNLENDİRME savunması yerinde", () => {
    // `git` ham hâliyle `navigate`e verilseydi `//evil.example` kullanıcıyı
    // siteden dışarı atardı. Doğrulayıcı `Login`de zorunlu.
    expect(guvenliDonusYolu("//evil.example")).toBeNull();
    expect(guvenliDonusYolu("https://evil.example")).toBeNull();
    expect(guvenliDonusYolu("/magaza/odeme?adim=2")).toBe("/magaza/odeme?adim=2");

    const kaynak = kaynakOku("src/pages/Login.tsx");
    expect(
      kaynak.includes("guvenliDonusYolu("),
      "Login dönüş adresini doğrulamadan kullanıyor"
    ).toBe(true);
  });
});

/* ─── Kaynak yardımcısı ──────────────────────────────────────────────── */

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(YOL_ONEKI, "$1")),
  "..",
  ".."
);

function kaynakOku(goreli: string): string {
  return readFileSync(join(KOK, ...goreli.split("/")), "utf8");
}
