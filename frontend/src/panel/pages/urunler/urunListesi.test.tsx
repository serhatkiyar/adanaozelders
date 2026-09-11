import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UrunListesi } from "@/panel/pages/urunler/UrunListesi";
import { useAdminProducts } from "@/hooks/useStore";
import { formatTL } from "@/lib/money";
import { ROUTES } from "@/lib/routes";

vi.mock("@/hooks/useStore", () => ({
  useAdminProducts: vi.fn(),
}));

const navigateMock = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

const mockUseAdminProducts = vi.mocked(useAdminProducts);

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UrunListesi />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UrunListesi", () => {
  beforeEach(() => {
    navigateMock.mockClear();
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
