import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { UrunListesi } from "@/panel/pages/urunler/UrunListesi";
import { useAdminProducts, useCategories } from "@/hooks/useStore";
import { formatTL } from "@/lib/money";
import { ROUTES } from "@/lib/routes";

// `useCategories` burada mocklanıyor çünkü `UrunListesi` artık HER ZAMAN
// (kapalıyken de) `UrunOlusturCekmecesi`yi mount ediyor — o da kategori
// seçiciyi önceden hazırlamak için `useCategories()` çağırıyor (bkz. o
// dosyanın başı). Varsayılan dönüş boş olmayan bir liste: "kategori yok" boş
// durumunu ayrıca sınayan bir test yoksa bu dosyanın testleri onunla
// ilgilenmiyor (bkz. `urunOlusturCekmecesi.test.tsx`).
vi.mock("@/hooks/useStore", () => ({
  useAdminProducts: vi.fn(),
  useCategories: vi.fn(),
}));

const navigateMock = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

const mockUseAdminProducts = vi.mocked(useAdminProducts);
const mockUseCategories = vi.mocked(useCategories);

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

describe("UrunListesi", () => {
  beforeEach(() => {
    navigateMock.mockClear();
    mockUseCategories.mockReturnValue({
      data: [{ id: 1, slug: "kirtasiye", name: "Kırtasiye", parent_id: null, sort_order: 0, is_active: true }],
      isPending: false,
    } as unknown as ReturnType<typeof useCategories>);
  });

  it("ürün adını ve fiyatını listeler", () => {
    mockUseAdminProducts.mockReturnValue({
      data: { items: [{ id: 1, title: "9. Sınıf Matematik Soru Bankası", price: 250, stock: 50 }], total: 1 },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminProducts>);

    kur();
    expect(screen.getByText("9. Sınıf Matematik Soru Bankası")).toBeInTheDocument();
    expect(screen.getByText(formatTL(250))).toBeInTheDocument();
  });

  it("kapak görseli olan ürün 36px kare görselle, olmayan boş kareyle listelenir", () => {
    mockUseAdminProducts.mockReturnValue({
      data: {
        items: [
          { id: 1, title: "Görselli", price: 250, stock: 5, cover_url: "https://ornek/kapak.jpg" },
          { id: 2, title: "Görselsiz", price: 120, stock: 3 },
        ],
        total: 2,
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminProducts>);

    kur();
    // Kapak görseli DEKORATİF: hücrenin erişilebilir adı ürün adından gelir,
    // bu yüzden `alt=""` ile gelir ve erişilebilirlik ağacında görünmez.
    const gorsel = document.querySelector('img[src="https://ornek/kapak.jpg"]') as HTMLImageElement | null;
    expect(gorsel).not.toBeNull();
    expect(gorsel?.getAttribute("alt")).toBe("");
    expect(gorsel?.style.width).toBe("36px");
    expect(gorsel?.style.height).toBe("36px");
    // Görseli olmayan üründe hücre hizası bozulmasın diye aynı ölçüde boş
    // kare durur (ikas'ta da böyle) — `aria-hidden`, sayfaya gürültü katmaz.
    const bosKare = document.querySelector('span[aria-hidden="true"][style*="36px"]');
    expect(bosKare).not.toBeNull();
    expect(screen.getByText("Görselsiz")).toBeInTheDocument();
  });

  it("ürün adı kolonu sıralanabilir (backend sort=title destekliyor)", async () => {
    mockUseAdminProducts.mockReturnValue({
      data: { items: [{ id: 1, title: "A ürünü", price: 10, stock: 1 }], total: 1 },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminProducts>);

    kur();
    mockUseAdminProducts.mockClear();
    await userEvent.click(screen.getByRole("columnheader", { name: "Ürün" }));
    expect(mockUseAdminProducts).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "title", order: "asc" }),
    );
  });

  it("ürün ekle aksiyonu bulunur", () => {
    mockUseAdminProducts.mockReturnValue({
      data: { items: [{ id: 1, title: "9. Sınıf Matematik Soru Bankası", price: 250, stock: 50 }], total: 1 },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminProducts>);

    kur();
    expect(screen.getByRole("button", { name: /Ürün Ekle/i })).toBeInTheDocument();
  });

  it("Ürün Ekle'ye tıklanınca 'Ürün Oluştur' çekmecesi açılır (tip seçimi modalı DEĞİL)", async () => {
    mockUseAdminProducts.mockReturnValue({
      data: { items: [{ id: 1, title: "9. Sınıf Matematik Soru Bankası", price: 250, stock: 50 }], total: 1 },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminProducts>);

    kur();
    // Çekmece kapalıyken de mount'tur (`YanPencere` her zaman DOM'da durur,
    // `open` prop'uyla görünürlüğü değişir) — bu yüzden önce KAPALI olduğunu,
    // tıklandıktan SONRA "Ürün Oluştur" başlığının GÖRÜNÜR olduğunu sınıyoruz.
    expect(screen.queryByText("Ürün Oluştur")).not.toBeInTheDocument();
    // Eski tip seçimi modalının kendi başlığı hiç render edilmemeli.
    expect(screen.queryByText("Basit Ürün")).not.toBeInTheDocument();
    expect(screen.queryByText("Varyantlı Ürün")).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: /Ürün Ekle/i })[0]);

    expect(await screen.findByText("Ürün Oluştur")).toBeInTheDocument();
  });

  it("yüklenirken (henüz veri/hata yokken) boş durumu göstermez", () => {
    // `isPending` kullanılıyor — `isLoading` (v5'te `isPending && isFetching`)
    // DEĞİL: retry sırasında `isFetching` anlık false'a düşse bile veri henüz
    // gelmediği/hata oluşmadığı sürece "boş" ekranı çıkmamalı.
    mockUseAdminProducts.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminProducts>);

    kur();
    expect(screen.queryByText("İlk Ürününüzü Yükleyin!")).not.toBeInTheDocument();
    expect(screen.queryByText("Ürünler yüklenemedi.")).not.toBeInTheDocument();
  });

  it("hata varken hata mesajını gösterir, boş durumu göstermez", () => {
    mockUseAdminProducts.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("network"),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminProducts>);

    kur();
    expect(screen.getByText("Ürünler yüklenemedi.")).toBeInTheDocument();
    expect(screen.queryByText("İlk Ürününüzü Yükleyin!")).not.toBeInTheDocument();
  });

  it("tekrar dene tıklanınca refetch çağrılır", async () => {
    const refetch = vi.fn();
    mockUseAdminProducts.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("network"),
      refetch,
    } as unknown as ReturnType<typeof useAdminProducts>);

    kur();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });

  describe("arama gecikmesi", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("hızlı yazılan birkaç karakter API'ye tek istekle (gecikmiş değerle) gider", () => {
      mockUseAdminProducts.mockReturnValue({
        data: { items: [], total: 0 },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminProducts>);

      kur();
      const kutu = screen.getByPlaceholderText("Tabloda arama yapın");

      fireEvent.change(kutu, { target: { value: "k" } });
      fireEvent.change(kutu, { target: { value: "ka" } });
      fireEvent.change(kutu, { target: { value: "kalem" } });

      // Girdi anında güncellenir (kullanıcı takılma hissetmez) ama API'ye
      // giden sorgu henüz eski (boş) değerle çağrılıyor — gecikme dolmadı.
      expect((kutu as HTMLInputElement).value).toBe("kalem");
      expect(mockUseAdminProducts.mock.calls.at(-1)?.[0]).toMatchObject({ q: undefined });

      act(() => {
        vi.advanceTimersByTime(400);
      });

      // Üç ayrı tuş vuruşu, gecikme sonunda TEK bir güncel sorguya dönüşür.
      expect(mockUseAdminProducts.mock.calls.at(-1)?.[0]).toMatchObject({ q: "kalem" });
    });
  });

  describe("satır aksiyonu", () => {
    beforeEach(() => {
      mockUseAdminProducts.mockReturnValue({
        data: { items: [{ id: 7, title: "9. Sınıf Matematik Soru Bankası", price: 250, stock: 50 }], total: 1 },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminProducts>);
    });

    it("satır menüsünden Düzenle seçilince ürün düzenleme rotasına gider", async () => {
      kur();

      await userEvent.click(screen.getByRole("button", { name: /satır aksiyonları/i }));
      await userEvent.click(await screen.findByText("Düzenle"));

      expect(navigateMock).toHaveBeenCalledWith(ROUTES.adminNewProductEdit(7));
    });

    it("satıra tıklanınca da ürün düzenleme rotasına gider", async () => {
      kur();

      await userEvent.click(screen.getByText("9. Sınıf Matematik Soru Bankası"));

      expect(navigateMock).toHaveBeenCalledWith(ROUTES.adminNewProductEdit(7));
    });

    it("satır menüsüne tıklamak satır tıklamasını tetiklemez (çift gezinme olmaz)", async () => {
      kur();

      await userEvent.click(screen.getByRole("button", { name: /satır aksiyonları/i }));

      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  describe("sıralama", () => {
    beforeEach(() => {
      mockUseAdminProducts.mockReturnValue({
        data: { items: [{ id: 7, title: "9. Sınıf Matematik Soru Bankası", price: 250, stock: 50 }], total: 1 },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminProducts>);
    });

    it("satış fiyatı başlığına tıklanınca useAdminProducts gerçek alan adlarıyla (sort/order) çağrılır ve sayfa 1'e döner", async () => {
      kur();

      await userEvent.click(screen.getByRole("columnheader", { name: "Satış Fiyatı" }));

      expect(mockUseAdminProducts.mock.calls.at(-1)?.[0]).toMatchObject({
        sort: "price",
        order: "asc",
        offset: 0,
      });
    });

    it("aynı başlığa ikinci kez tıklanınca sıralama yönü tersine döner", async () => {
      kur();

      await userEvent.click(screen.getByRole("columnheader", { name: "Satış Fiyatı" }));
      await userEvent.click(screen.getByRole("columnheader", { name: "Satış Fiyatı" }));

      expect(mockUseAdminProducts.mock.calls.at(-1)?.[0]).toMatchObject({
        sort: "price",
        order: "desc",
      });
    });

    it("üçüncü kez tıklanınca sıralama kaldırılır (varsayılana döner)", async () => {
      kur();

      await userEvent.click(screen.getByRole("columnheader", { name: "Satış Fiyatı" }));
      await userEvent.click(screen.getByRole("columnheader", { name: "Satış Fiyatı" }));
      await userEvent.click(screen.getByRole("columnheader", { name: "Satış Fiyatı" }));

      expect(mockUseAdminProducts.mock.calls.at(-1)?.[0]).not.toHaveProperty("sort");
      expect(mockUseAdminProducts.mock.calls.at(-1)?.[0]).not.toHaveProperty("order");
    });
  });
});
