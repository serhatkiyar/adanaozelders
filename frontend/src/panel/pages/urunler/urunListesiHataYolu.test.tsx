import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { PanelProvider } from "@/panel/PanelProvider";
import { UrunListesi } from "@/panel/pages/urunler/UrunListesi";
import * as storeApi from "@/api/store";
import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";

// Yalnız `listProductsAdmin` taklit edilir — hook ve `ListePage` GERÇEK
// çalışır. Amaç: gerçek bir HTTP başarısızlığında `useAdminProducts`'ın
// döndürdüğü sinyallerin (isPending/isError/data) `UrunListesi`de doğru
// okunduğunu kanıtlamak.
//
// (`urunListesi.test.tsx`deki testler `@/hooks/useStore`'u taklit ediyor —
// o da geçerli bir kanıt ama yalnız "isError true verilirse doğru çizer"i
// gösteriyor, "gerçek bir başarısız istekte isError gerçekten true olur mu
// ve o ana kadar boş durum hiç görünmez mi"yi değil. Bu dosya HTTP katmanını
// taklit ederek gerçek `useQuery` durum makinesini çalıştırıyor.)
//
// `fetchCategories` de burada taklit edilir: `UrunListesi` artık HER ZAMAN
// (kapalıyken de) `UrunOlusturCekmecesi`yi mount ediyor ve o
// `useCategories()` çağırıyor — taklit edilmezse gerçek bir HTTP isteği
// jsdom'da hedefsiz gider (bu dosyanın konusu bu değil).
let actualListProductsAdmin: typeof storeApi.listProductsAdmin;

vi.mock("@/api/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/store")>();
  return {
    ...actual,
    listProductsAdmin: vi.fn(),
    fetchCategories: vi.fn().mockResolvedValue([
      { id: 1, slug: "kirtasiye", name: "Kırtasiye", parent_id: null, sort_order: 0, is_active: true },
    ]),
    // `fetchBookFacets` de aynı gerekçeyle taklit edilir: filtre çekmecesi
    // (`UrunAracCubugu.tsx`) kapalıyken de mount olur ve yayınevi/yazar
    // seçeneklerini bu uçtan çeker — bu dosyanın konusu ürün listesinin
    // HATA yolu, künye facet'leri değil.
    fetchBookFacets: vi
      .fn()
      .mockResolvedValue({ publisher: [], author: [], cover_type: [] }),
    // Düşük stok eşiği de aynı gerekçeyle: envanter hücresi `/store/config`
    // okur, konu o değil.
    fetchStoreConfig: vi.fn().mockResolvedValue({ low_stock_threshold: 5 }),
  };
});

beforeAll(async () => {
  const actual = await vi.importActual<typeof import("@/api/store")>("@/api/store");
  actualListProductsAdmin = actual.listProductsAdmin;
});

function kur() {
  // Üretimdeki `lib/queryClient.ts` varsayılanına yakın: retry: 1.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter>
          <UrunListesi />
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

const durum = () => ({
  bos: !!screen.queryByText("İlk Ürününüzü Yükleyin!"),
  hata: !!screen.queryByText("Ürünler yüklenemedi."),
});

describe("UrunListesi · gerçek istek başarısız olduğunda", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("boş durumu HİÇBİR ANDA göstermez; sonunda hata görünümüne geçer (500, retry:1)", async () => {
    const sunucuHatasi = new AxiosError(
      "Request failed with status code 500",
      "ERR_BAD_RESPONSE",
      undefined,
      undefined,
      {
        status: 500,
        statusText: "Internal Server Error",
        data: {},
        headers: {},
        config: {} as never,
      } as never,
    );
    vi.mocked(storeApi.listProductsAdmin).mockRejectedValue(sunucuHatasi);

    kur();

    // İlk deneme + retry(1) tükenene kadar — ara durumlar dahil — 50ms
    // adımlarla kontrol et: boş durum metni HİÇ görünmemeli.
    for (let i = 0; i < 40; i++) {
      expect(durum().bos, `t=${i * 50}ms'de boş durum görünmemeli`).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(50);
        await Promise.resolve();
      });
    }

    expect(durum()).toEqual({ bos: false, hata: true });
  });

  it("boş durumu HİÇBİR ANDA göstermez (gerçek 401 + axios interceptor, oturumsuz)", async () => {
    // Koordinatörün tarayıcıda ölçtüğü senaryonun birebir aynısı: oturum
    // yok (token null), gerçek `apiClient` interceptor zinciri çalışıyor
    // (yalnız HTTP taşıma katmanı — axios adapter'ı — taklit ediliyor).
    const oncekiAdapter = apiClient.defaults.adapter;
    const oncekiAuth = useAuthStore.getState();
    useAuthStore.setState({ token: null, user: null, isAuthenticated: false });
    apiClient.defaults.adapter = async (config: unknown) => {
      const err: Record<string, unknown> = {
        message: "Request failed with status code 401",
        config,
        response: { status: 401, statusText: "Unauthorized", data: {}, headers: {}, config },
        isAxiosError: true,
        toJSON: () => ({}),
      };
      throw err;
    };
    // Bu testte gerçek `listProductsAdmin` (dolayısıyla gerçek `apiClient`)
    // çalışsın — üstteki modül taklidini bu test için geçersiz kılıyoruz.
    vi.mocked(storeApi.listProductsAdmin).mockImplementation(actualListProductsAdmin);

    try {
      kur();

      for (let i = 0; i < 40; i++) {
        expect(durum().bos, `t=${i * 50}ms'de boş durum görünmemeli`).toBe(false);
        await act(async () => {
          vi.advanceTimersByTime(50);
          await Promise.resolve();
        });
      }

      expect(durum()).toEqual({ bos: false, hata: true });
    } finally {
      apiClient.defaults.adapter = oncekiAdapter;
      useAuthStore.setState(oncekiAuth);
    }
  });
});
