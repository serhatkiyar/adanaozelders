import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { UrunFormu } from "@/panel/pages/urunler/UrunFormu";
import { PATHS } from "@/lib/routes";

const createProduct = vi.fn().mockResolvedValue({ id: 7 });
const updateProduct = vi.fn().mockResolvedValue({ id: 9 });
const fetchProductAdmin = vi.fn();
vi.mock("@/api/store", () => ({
  createProduct: (...a: unknown[]) => createProduct(...a),
  updateProduct: (...a: unknown[]) => updateProduct(...a),
  fetchProductAdmin: (...a: unknown[]) => fetchProductAdmin(...a),
}));

afterEach(() => {
  // Her testte YENİ bir `render()` ile YENİ bir `UrunFormu` örneği kuruluyor
  // (kendi `Form` instance'ıyla); ama mock çağrı geçmişi paylaşılan modül
  // seviyesindeki spy'larda birikir — sıradaki testin `mock.calls[0]`
  // okuması bir önceki testin isteğini görmesin diye temizlenir. Varsayılan
  // `mockResolvedValue` implementasyonları KORUNUR (`clearAllMocks` yalnız
  // çağrı geçmişini siler, implementasyonu değil).
  vi.clearAllMocks();
});

const DUZENLENECEK_URUN = {
  id: 9,
  title: "Kırmızı Defter",
  kind: "PHYSICAL",
  price: "45.50",
  compare_at_price: null,
  tax_rate: "0.20",
  stock: 12,
  barcode: "8690000000012",
  variants: null,
};

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

// Düzenleme akışı `useParams()`e ihtiyaç duyar; bunun için gerçek bir
// `<Route path=":id">` eşleşmesi kurulur.
function kurDuzenleme(id: number | string = 9) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[`/yonetim-yeni/urunler/${id}`]}>
          <Routes>
            <Route path={PATHS.adminNewProductEdit} element={<UrunFormu />} />
            {/* Kayıt sonrası `navigate(ROUTES.adminNewProducts)` gerçekleşir —
                eşleşen bir rota olmadan RR konsola uyarı basar. */}
            <Route path={PATHS.adminNewProducts} element={<div>Ürünler</div>} />
          </Routes>
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

  describe("düzenleme modu", () => {
    it("mevcut ürün verisi forma dolar", async () => {
      fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN);
      kurDuzenleme();

      expect(await screen.findByDisplayValue("Kırmızı Defter")).toBeInTheDocument();
      expect(screen.getByLabelText("Satış Fiyatı")).toHaveValue("45.5");
      expect(screen.getByLabelText("KDV Oranı (%)")).toHaveValue("20");

      await userEvent.click(screen.getByRole("tab", { name: "Envanter" }));
      expect(screen.getByLabelText("Stok")).toHaveValue("12");
      expect(screen.getByLabelText("Barkod")).toHaveValue("8690000000012");
    });

    it("kayıt çekilemediğinde hata alanı gösterir, Kaydet yok ve updateProduct çağrılmaz", async () => {
      fetchProductAdmin.mockRejectedValueOnce(new Error("ağ hatası"));
      kurDuzenleme();

      expect(await screen.findByText("Ürün yüklenemedi.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tekrar dene" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Kaydet" })).not.toBeInTheDocument();
      expect(updateProduct).not.toHaveBeenCalled();
    });

    it("stok değiştirilip gerekçe seçilince updateProduct'a giden gövde stock ve stock_reason_code içerir", async () => {
      fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN);
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");

      await userEvent.click(screen.getByRole("tab", { name: "Envanter" }));
      const stokAlani = screen.getByLabelText("Stok");
      await userEvent.clear(stokAlani);
      await userEvent.type(stokAlani, "20");

      await userEvent.click(screen.getByLabelText("Stok Gerekçesi"));
      await userEvent.click(await screen.findByTitle("Sayım farkı"));

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ stock: 20, stock_reason_code: "SAYIM_FARKI" }),
      );
    });

    it("stok değişmediyse gövdede stock alanı hiç gitmez", async () => {
      fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN);
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      const govde = updateProduct.mock.calls[0][1];
      expect(govde).not.toHaveProperty("stock");
      expect(govde).not.toHaveProperty("stock_reason_code");
    });

    it("stok değiştirilip gerekçe seçilmezse form uyarır ve istek atılmaz", async () => {
      fetchProductAdmin.mockResolvedValueOnce(DUZENLENECEK_URUN);
      kurDuzenleme();
      await screen.findByDisplayValue("Kırmızı Defter");

      await userEvent.click(screen.getByRole("tab", { name: "Envanter" }));
      const stokAlani = screen.getByLabelText("Stok");
      await userEvent.clear(stokAlani);
      await userEvent.type(stokAlani, "20");

      await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

      expect(await screen.findByText("Stok değiştiyse gerekçe zorunludur.")).toBeInTheDocument();
      expect(updateProduct).not.toHaveBeenCalled();
    });
  });
});
