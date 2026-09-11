import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UrunListesi } from "@/panel/pages/urunler/UrunListesi";
import { useAdminProducts } from "@/hooks/useStore";
import { formatTL } from "@/lib/money";

vi.mock("@/hooks/useStore", () => ({
  useAdminProducts: vi.fn(),
}));

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
});
