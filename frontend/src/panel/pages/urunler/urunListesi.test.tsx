import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UrunListesi } from "@/panel/pages/urunler/UrunListesi";
import { useAdminProducts } from "@/hooks/useStore";

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
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminProducts>);

    kur();
    expect(screen.getByText("9. Sınıf Matematik Soru Bankası")).toBeInTheDocument();
    expect(screen.getByText(/250/)).toBeInTheDocument();
  });

  it("ürün ekle aksiyonu bulunur", () => {
    mockUseAdminProducts.mockReturnValue({
      data: { items: [{ id: 1, title: "9. Sınıf Matematik Soru Bankası", price: 250, stock: 50 }], total: 1 },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminProducts>);

    kur();
    expect(screen.getByRole("button", { name: /Ürün Ekle/i })).toBeInTheDocument();
  });

  it("hata varken hata mesajını gösterir, boş durumu göstermez", () => {
    mockUseAdminProducts.mockReturnValue({
      data: undefined,
      isLoading: false,
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
      isLoading: false,
      isError: true,
      error: new Error("network"),
      refetch,
    } as unknown as ReturnType<typeof useAdminProducts>);

    kur();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });
});
