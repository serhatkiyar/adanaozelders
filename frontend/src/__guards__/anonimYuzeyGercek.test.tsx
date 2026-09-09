/**
 * ANONİM YÜZEY: kayıt bandı YOK, filtreler GERÇEK.
 *
 * ## Karar (kullanıcı, 9 Eyl 2026 · ÜK-10)
 *
 * > *"Henüz hesap açmadan eğitmenlere bakmak isteyen bir kişiyi çok daraltıyor
 * > gibiyiz. İşlem yapmak istediğimizde uyarı versek daha iyi olmaz mı?"*
 *
 * İki kusur sökülüyor:
 *
 * 1. **Kayıt bandı** — koşulsuz, sonuç listesinin ÜSTÜNDE, turuncu gradient.
 *    Ziyaretçi tek eğitmen görmeden duvarla karşılaşıyordu (NN/g, "Login
 *    Walls"). Üstelik yanlış vaat: "mesaj için hesap aç" diyordu ama
 *    mesajlaşma aktif rezervasyona bağlı.
 * 2. **Boş "Filtrele ve Sırala" penceresi** — gövdesinde tek filtre yoktu,
 *    yalnız "ücretsiz hesap oluşturun" reklam kartı vardı. İşlevsel görünen
 *    bir düğme pazarlama gösteriyordu.
 *
 * ## Bu nöbetçinin ölçtüğü SESSİZ kusur
 *
 * İkisi de geri gelirse hiçbir şey kırılmaz: sayfa çalışır, testler geçer,
 * yalnız ziyaretçi yeniden daraltılır. Bandın kendisi için bugüne kadar
 * nöbetçi YOKTU — o yüzden hiç sorgulanmadı.
 *
 * İkinci ve daha ince kusur filtrelerde: bir filtre yerel state'i değiştirip
 * API'ye hiç ulaşmayabilir. Ekran "seçildi" gösterir, liste daralmaz.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek DOM, gerçek bileşenler; veri kancaları sahteli. Sunucunun filtreyi
 * uyguladığını KANITLAMAZ — ölçülen, isteğin doğru kurulup kurulmadığı.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PublicMarketplace from "@/pages/PublicMarketplace";
import { useTutorSearch } from "@/hooks/useTutorSearch";
import { useKonumStore } from "@/store/konumStore";
import { Gender } from "@/types";

vi.mock("@/hooks/useTutorSearch", () => ({
  useTutorSearch: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useTutorPriceHistogram: vi.fn(() => ({ data: [120, 300, 450], isLoading: false })),
  useFeaturedTutors: vi.fn(() => ({ data: [], isLoading: false })),
  useTutorGenderFacets: vi.fn(() => ({
    data: { FEMALE: 42, MALE: 61, UNSPECIFIED: 12, gorunmeyen: 87 },
  })),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/components/FeaturedTutorBlock", () => ({
  FeaturedTutorBlock: () => null,
}));

let sonAdres = "";
function AdresGozcusu() {
  const konum = useLocation();
  sonAdres = konum.pathname + konum.search;
  return null;
}

function ciz(adres = "/egitmenler") {
  sonAdres = "";
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[adres]}>
          <AdresGozcusu />
          <PublicMarketplace />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

const sonIstek = () => vi.mocked(useTutorSearch).mock.calls.at(-1)?.[0];

beforeEach(() => vi.mocked(useTutorSearch).mockClear());
afterEach(() => cleanup());

/* ─── Bandın sökümü ──────────────────────────────────────────────────── */

describe("anonim yüzey · kayıt bandı SÖKÜLDÜ", () => {
  it("DOLULUK: sayfa gerçekten çizildi", () => {
    // Bu olmadan aşağıdaki "yok" iddiaları boş bir ekranda da geçerdi.
    ciz();
    expect(vi.mocked(useTutorSearch)).toHaveBeenCalled();
    expect(screen.getByRole("main")).toBeTruthy();
  });

  it("içerik alanında giriş/kayıt bağlantısı YOK", () => {
    // Kapsam `<main>`: navbar'ın meşru "Giriş Yap"ı dışarıda kalır.
    // `SiteFooter.test.tsx`teki negatif nöbetçinin aynı deseni.
    ciz();
    const govde = within(screen.getByRole("main"));
    for (const ad of [/Giriş Yap/i, /Kayıt Ol/i]) {
      expect(govde.queryByRole("link", { name: ad }), `${ad} içerikte`).toBeNull();
    }
  });

  it("bandın METNİ hiçbir biçimde yok", () => {
    // Bant farklı bir bağlantı biçimiyle geri gelirse yukarıdaki iddia
    // sessizce geçerdi.
    ciz();
    expect(screen.queryByText(/ücretsiz hesap aç/i)).toBeNull();
    expect(screen.queryByText(/Eğitmenleri keşfet/i)).toBeNull();
  });
});

/* ─── Filtre penceresi gerçek ────────────────────────────────────────── */

describe("anonim yüzey · filtreler GERÇEK", () => {
  const filtreyiAc = async () => {
    ciz();
    fireEvent.click(screen.getByRole("button", { name: /Filtre/i }));
    await screen.findByText("Filtrele");
  };

  it("pencerede reklam DEĞİL, dört gerçek grup var", async () => {
    await filtreyiAc();
    for (const baslik of [
      "Ders İşleme Şekli",
      "Mesafe",
      "Fiyat Aralığı",
      "Cinsiyet",
    ]) {
      expect(screen.getByText(baslik), `${baslik} grubu yok`).toBeTruthy();
    }
    // Sökülen reklam kartı.
    expect(screen.queryByText(/Daha fazla filtre mi arıyorsunuz/i)).toBeNull();
    expect(screen.queryByText(/hesap oluşturun/i)).toBeNull();
  });

  it("faset SAYILARI anonime de gösteriliyor", async () => {
    // Uçlar `require_roles` taşımıyor; sunucu bu sayıları zaten veriyordu.
    await filtreyiAc();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("61")).toBeTruthy();
  });

  it("ASIL İDDİA: cinsiyet seçimi hem ADRESE hem İSTEĞE ulaşıyor", async () => {
    await filtreyiAc();
    fireEvent.click(screen.getByRole("button", { name: /Kadın/ }));

    // Yerel state'i değiştirip API'ye ulaşmayan bir filtre "seçildi" görünür
    // ama listeyi daraltmaz — sessiz kusur.
    await waitFor(() => expect(sonAdres).toContain("cinsiyet=kadin"));
    await waitFor(() => expect(sonIstek()?.gender).toBe(Gender.FEMALE));
  });

  it("sessiz eleme uyarısı anonime de görünüyor", async () => {
    await filtreyiAc();
    fireEvent.click(screen.getByRole("button", { name: /Kadın/ }));
    await screen.findByText(/Cinsiyetini belirtmemiş 87 eğitmen/);
  });
});

/* ─── "Yakınımda" — adreste niyet, istekte koordinat ─────────────────── */

describe("anonim yüzey · yakınımda", () => {
  it("`?yakinimda=1` KOORDİNATLA isteğe dönüşüyor", async () => {
    /*
     * Ölçülmüş kusur: anonim sayfa `egitmenIstegi`ye `konumum` vermiyordu,
     * dolayısıyla `aramaUrl` koordinatsız niyeti düşürüyordu. Adres filtreyi
     * taşıyor, istek taşımıyordu — hata yok, yalnız daraltılmamış sonuç.
     */
    useKonumStore.setState({ konum: { lat: 37.001, lng: 35.321 } });

    ciz("/egitmenler?yakinimda=1&yaricap=10");
    await waitFor(() => expect(sonIstek()?.lat).toBe(37.001));
    expect(sonIstek()?.radius_km).toBe(10);

    // GİZLİLİK: koordinat adrese yazılmaz.
    expect(sonAdres).not.toContain("lat");
    expect(sonAdres).not.toContain("lng");
    useKonumStore.setState({ konum: null });
  });
});
