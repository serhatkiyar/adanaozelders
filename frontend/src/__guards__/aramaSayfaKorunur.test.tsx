/**
 * `?sayfa=` HAYATTA KALIR — iki yüzeyde birden.
 *
 * ## Ölçtüğü kusur sınıfı (canlıydı, ikizdi)
 *
 * `Libraries.tsx` ve `PublicMarketplace.tsx` URL↔state senkronunu elle
 * yazıyordu ve ikisi de aynı hatayı yapmıştı: efekt adresi
 * `new URLSearchParams()` ile SIFIRDAN kuruyor, dolayısıyla aynı dosyanın bir
 * kaç satır yukarıda OKUDUĞU `sayfa` parametresini siliyordu.
 *
 * Sonucu ölçüldü: paylaşılan `/kutuphaneler?ilce=Seyhan&sayfa=3` bağlantısı
 * karşı tarafta 1. sayfayı açıyordu. Hata yok, uyarı yok — yalnız yanlış
 * içerik. Aynı kusurun iki dosyada birden yaşaması, elle senkronun kendisinin
 * kusurlu olduğunun kanıtıydı; `useAramaDurumu` bu yüzden var.
 *
 * Genel kural: şemanın TANIMADIĞI hiçbir anahtar yazma sırasında düşmez
 * (`utm_*`, gelecekteki A/B anahtarları da). `sayfa` bunun en görünür örneği.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek sayfa bileşenlerini gerçek router'da basar; veri kancası sahtelenir
 * çünkü ölçülen şey ADRES ve API'ye giden LİMİT, listenin içeriği değil.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, screen } from "@testing-library/react";

import { EGITMEN_ARAMA, type EgitmenAramasi } from "@/lib/aramaUrl";
import { useAramaDurumu } from "@/hooks/useAramaDurumu";
import Libraries from "@/pages/Libraries";
import PublicMarketplace from "@/pages/PublicMarketplace";
import { useLibrarySearch } from "@/hooks/useLibraries";
import { useTutorSearch } from "@/hooks/useTutorSearch";
import { limitForPage } from "@/lib/pagination";

vi.mock("@/hooks/useTutorSearch", () => ({
  useTutorSearch: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useTutorPriceHistogram: vi.fn(() => ({ data: [], isLoading: false })),
  useFeaturedTutors: vi.fn(() => ({ data: [], isLoading: false })),
  useTutorGenderFacets: vi.fn(() => ({ data: null })),
}));
vi.mock("@/hooks/useLibraries", () => ({
  useLibrarySearch: vi.fn(() => ({
    data: [],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  })),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/components/FeaturedTutorBlock", () => ({
  FeaturedTutorBlock: () => null,
}));
vi.mock("@/components/LibrariesMap", () => ({ LibrariesMap: () => null }));

/** Adres çubuğunun MemoryRouter içindeki karşılığı. */
let sonAdres = "";
function AdresGozcusu() {
  const konum = useLocation();
  sonAdres = konum.pathname + konum.search;
  return null;
}

function ciz(Ekran: () => JSX.Element, adres: string) {
  sonAdres = "";
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[adres]}>
          <Ekran />
          <AdresGozcusu />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

/** `Libraries.tsx`'in sayfa boyu (PER_PAGE). Değişirse bu nöbetçi de değişir. */
const KUTUPHANE_SAYFA_BOYU = 30;

const sonEgitmenParam = () => vi.mocked(useTutorSearch).mock.calls.at(-1)?.[0];
const sonKutuphaneParam = () => vi.mocked(useLibrarySearch).mock.calls.at(-1)?.[0];

/**
 * Kancaya giden TÜM limitler.
 *
 * Son çağrıya bakmak yetmiyor: her iki ekran da aynı kancayı liste dışında
 * da çağırıyor (kütüphanede harita `limit: 500`, keşif şeritleri `limit: 20`).
 * "Sayfa limite dönüştü mü" sorusu bu yüzden kümede aranır.
 */
const limitler = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls.map((c) => (c[0] as { limit?: number } | undefined)?.limit);

beforeEach(() => {
  vi.mocked(useTutorSearch).mockClear();
  vi.mocked(useLibrarySearch).mockClear();
});

describe("?sayfa= korunur · öğretmen", () => {
  it("DOLULUK: arama kancası gerçekten çağrılıyor", () => {
    ciz(PublicMarketplace, "/egitmenler");
    expect(vi.mocked(useTutorSearch)).toHaveBeenCalled();
    expect(sonEgitmenParam()).toBeTruthy();
  });

  it("`?sayfa=3` adreste KALIR", async () => {
    ciz(PublicMarketplace, "/egitmenler?sayfa=3");
    await waitFor(() => expect(vi.mocked(useTutorSearch)).toHaveBeenCalled());
    // Kusurlu hâlde efekt bu anahtarı siliyordu ve adres `/egitmenler`e
    // düşüyordu.
    expect(sonAdres).toContain("sayfa=3");
  });

  it("`?sayfa=3` API limitine GERÇEKTEN dönüşüyor", async () => {
    // Adresin korunması tek başına yeterli değil: sayfa numarası limite hiç
    // girmiyorsa kullanıcı yine ilk 20 sonucu görür.
    ciz(PublicMarketplace, "/egitmenler?sayfa=3");
    await waitFor(() =>
      expect(limitler(vi.mocked(useTutorSearch))).toContain(limitForPage(3, 20))
    );
    expect(limitForPage(3, 20)).toBeGreaterThan(limitForPage(1, 20));
  });

  it("filtre + sayfa BİRLİKTE yaşar", async () => {
    ciz(PublicMarketplace, "/egitmenler?ilce=Seyhan&sayfa=2");
    await waitFor(() => expect(vi.mocked(useTutorSearch)).toHaveBeenCalled());
    expect(sonAdres).toContain("ilce=Seyhan");
    expect(sonAdres).toContain("sayfa=2");
  });

  it("BİLİNMEYEN anahtar da düşmez (`utm_*`)", async () => {
    // Aynı kökün genel hâli: şemanın tanımadığı anahtar yazma sırasında
    // silinmemeli. Kampanya bağlantıları buna bağlı.
    ciz(PublicMarketplace, "/egitmenler?utm_source=bulten&sayfa=2");
    await waitFor(() => expect(vi.mocked(useTutorSearch)).toHaveBeenCalled());
    expect(sonAdres).toContain("utm_source=bulten");
  });
});

describe("?sayfa= korunur · kütüphane", () => {
  it("DOLULUK: arama kancası gerçekten çağrılıyor", () => {
    ciz(Libraries, "/kutuphaneler");
    expect(vi.mocked(useLibrarySearch)).toHaveBeenCalled();
    expect(sonKutuphaneParam()).toBeTruthy();
  });

  it("`?ilce=Seyhan&sayfa=3` ikisi birden adreste KALIR", async () => {
    ciz(Libraries, "/kutuphaneler?ilce=Seyhan&sayfa=3");
    await waitFor(() => expect(vi.mocked(useLibrarySearch)).toHaveBeenCalled());
    expect(sonAdres).toContain("ilce=Seyhan");
    expect(sonAdres).toContain("sayfa=3");
  });

  it("`?sayfa=3` API limitine dönüşüyor", async () => {
    ciz(Libraries, "/kutuphaneler?sayfa=3");
    await waitFor(() =>
      expect(limitler(vi.mocked(useLibrarySearch))).toContain(
        limitForPage(3, KUTUPHANE_SAYFA_BOYU)
      )
    );
  });
});

/* ─── Yazma yolu ─────────────────────────────────────────────────────────
   Yukarıdaki iddialar OKUMA yolunu ölçer: adres olduğu gibi duruyor mu.
   Asıl kusur ise YAZMA yolundaydı — efekt adresi sıfırdan kuruyordu. Yazma
   ancak kullanıcı bir filtre değiştirince tetiklenir, o yüzden burada
   `useAramaDurumu` doğrudan bir koşumla sürülür. Bu blok olmasaydı
   "bilinmeyen anahtar korunur" iddiası, hiç yazma olmadığı için kendiliğinden
   yeşil kalırdı (ölçüldü: `aramayiYaz`den tabanı düşürmek 8 testin hiçbirini
   kırmıyordu). */

function Kosum({ yama }: { yama: Partial<EgitmenAramasi> }) {
  const { ayarla } = useAramaDurumu(EGITMEN_ARAMA);
  return (
    <button type="button" onClick={() => ayarla(yama)}>
      yaz
    </button>
  );
}

describe("?sayfa= korunur · YAZMA yolu", () => {
  it("filtre değişince BİLİNMEYEN anahtar hayatta kalır", () => {
    ciz(
      () => <Kosum yama={{ sinav: "TYT" }} />,
      "/egitmenler?sayfa=3&utm_source=bulten"
    );
    fireEvent.click(screen.getByText("yaz"));

    // Şemanın tanımadığı anahtar yazma sırasında düşerse kampanya
    // bağlantıları ilk tıklamada kimliğini kaybeder.
    expect(sonAdres).toContain("utm_source=bulten");
    expect(sonAdres).toContain("sinav=TYT");
  });

  it("filtre değişince SAYFA başa döner", () => {
    // 3. sayfada filtre daraltıp boş ekran görmek gerçek bir kullanıcı
    // hatası kaynağı.
    ciz(() => <Kosum yama={{ sinav: "TYT" }} />, "/egitmenler?sayfa=3");
    fireEvent.click(screen.getByText("yaz"));
    expect(sonAdres).not.toContain("sayfa=");
  });

  it("sayfa AÇIKÇA verilirse yazılır ve bilinmeyen yine korunur", () => {
    ciz(() => <Kosum yama={{ sayfa: 4 }} />, "/egitmenler?utm_source=bulten");
    fireEvent.click(screen.getByText("yaz"));
    expect(sonAdres).toContain("sayfa=4");
    expect(sonAdres).toContain("utm_source=bulten");
  });
});
