import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { UrunFormu } from "@/panel/pages/urunler/UrunFormu";

const createProduct = vi.fn().mockResolvedValue({ id: 7 });
vi.mock("@/api/store", () => ({
  createProduct: (...a: unknown[]) => createProduct(...a),
  updateProduct: vi.fn(),
  fetchProductAdmin: vi.fn(),
}));

// `MemoryRouter` doğrudan `UrunFormu`yu sarıyor (aradaki `<Routes>` YOK) —
// bu yüzden `useParams()` hep boş döner (id yok, hep YENİ kayıt akışı);
// `useSearchParams` ise Route eşleşmesine ihtiyaç duymaz, `?tip` bu yolla
// okunur.
function kur(baslangicYolu = "/yonetim-yeni/urunler/yeni") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[baslangicYolu]}>
          <UrunFormu />
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

describe("UrunFormu", () => {
  it("zorunlu alanlar boşken kaydetmez", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(createProduct).not.toHaveBeenCalled();
  });

  // Not: brief yalnız "ad ve fiyat" varsayıyordu; gerçek sözleşmede
  // (`ProductCreate.tax_rate`) KDV oranının sunucuda varsayılanı YOK ve
  // formda da sessizce doldurulmuyor (eski panelle aynı kural) — bu yüzden
  // üçüncü alan da girilmeden istek atılmıyor.
  it("ad, fiyat ve KDV oranı girilince createProduct çağrılır", async () => {
    kur();
    await userEvent.type(screen.getByLabelText("Ürün Adı"), "Deneme Kalem Seti");
    await userEvent.type(screen.getByLabelText("Satış Fiyatı"), "120");
    await userEvent.type(screen.getByLabelText("KDV Oranı (%)"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Deneme Kalem Seti", price: 120, tax_rate: 0.2 }),
    );
  });

  it("?tip=varyantli ile açılınca varyant sekmesi görünür", () => {
    kur("/yonetim-yeni/urunler/yeni?tip=varyantli");
    expect(screen.getByRole("tab", { name: "Varyantlar" })).toBeInTheDocument();
  });

  it("?tip=basit ile varyant sekmesi görünmez", () => {
    kur("/yonetim-yeni/urunler/yeni?tip=basit");
    expect(screen.queryByRole("tab", { name: "Varyantlar" })).not.toBeInTheDocument();
  });

  it("tip parametresi yokken (elle açılmış URL) varyant sekmesi görünmez", () => {
    kur("/yonetim-yeni/urunler/yeni");
    expect(screen.queryByRole("tab", { name: "Varyantlar" })).not.toBeInTheDocument();
  });
});
