import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { VaryantPenceresi } from "@/panel/pages/urunler/VaryantPenceresi";
import { Matris } from "@/panel/components/Matris";
import { PanelProvider } from "@/panel/PanelProvider";

const previewVariantMatrix = vi.fn();
const createVariantMatrix = vi.fn();
vi.mock("@/api/store", () => ({
  previewVariantMatrix: (...a: unknown[]) => previewVariantMatrix(...a),
  createVariantMatrix: (...a: unknown[]) => createVariantMatrix(...a),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function kur(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>{ui}</PanelProvider>
    </QueryClientProvider>,
  );
}

// Tek eksenli grup (Renk) önizleme cevabı — gerçek `VariantMatrixPreview`
// şekli: `cells[].existing_product_id` doluysa o kombinasyon zaten var.
const ONIZLEME_TEK_EKSEN = {
  group_id: 1,
  option1_name: "Renk",
  option2_name: null,
  cells: [
    { option1_value: "Kırmızı", option2_value: null, existing_product_id: null },
    { option1_value: "Mavi", option2_value: null, existing_product_id: null },
  ],
  new_count: 2,
  existing_count: 0,
  limit: 200,
};

describe("VaryantPenceresi", () => {
  it("tek eksenli grupta eksen değerleri girilip önizleme istendiğinde previewVariantMatrix doğru gövdeyle çağrılır", async () => {
    previewVariantMatrix.mockResolvedValueOnce(ONIZLEME_TEK_EKSEN);
    kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" />);

    await userEvent.type(screen.getByLabelText("Renk değerleri"), "Kırmızı,Mavi");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));

    await waitFor(() =>
      expect(previewVariantMatrix).toHaveBeenCalledWith(5, {
        option1_values: ["Kırmızı", "Mavi"],
        option2_values: null,
      }),
    );
  });

  it("iki eksenli grupta option2_values de gerçek değerlerle gönderilir", async () => {
    previewVariantMatrix.mockResolvedValueOnce({
      ...ONIZLEME_TEK_EKSEN,
      option2_name: "Beden",
      cells: [{ option1_value: "Kırmızı", option2_value: "S", existing_product_id: null }],
      new_count: 1,
    });
    kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" eksen2Adi="Beden" />);

    await userEvent.type(screen.getByLabelText("Renk değerleri"), "Kırmızı");
    await userEvent.type(screen.getByLabelText("Beden değerleri"), "S,M");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));

    await waitFor(() =>
      expect(previewVariantMatrix).toHaveBeenCalledWith(5, {
        option1_values: ["Kırmızı"],
        option2_values: ["S", "M"],
      }),
    );
  });

  it("matriste barkodu boş bir satır varken toplu yazım engellenir (istek atılmaz)", async () => {
    previewVariantMatrix.mockResolvedValueOnce(ONIZLEME_TEK_EKSEN);
    kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" />);

    await userEvent.type(screen.getByLabelText("Renk değerleri"), "Kırmızı,Mavi");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await screen.findByText("Kırmızı");

    // Yalnız birinci satıra barkod girilir, ikincisi BİLEREK boş bırakılır.
    const barkodlar = screen.getAllByLabelText(/^Barkod /);
    await userEvent.type(barkodlar[0], "8690000000012");

    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    expect(
      await screen.findByText("Her satır için barkod girin: gruplu ürün barkodsuz olamaz."),
    ).toBeInTheDocument();
    expect(createVariantMatrix).not.toHaveBeenCalled();
  });

  it("aynı barkod iki satırda kullanılırsa toplu yazım engellenir", async () => {
    previewVariantMatrix.mockResolvedValueOnce(ONIZLEME_TEK_EKSEN);
    kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" />);

    await userEvent.type(screen.getByLabelText("Renk değerleri"), "Kırmızı,Mavi");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await screen.findByText("Kırmızı");

    const barkodlar = screen.getAllByLabelText(/^Barkod /);
    await userEvent.type(barkodlar[0], "8690000000012");
    await userEvent.type(barkodlar[1], "8690000000012");

    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    expect(await screen.findByText("Aynı barkod iki satırda kullanılamaz.")).toBeInTheDocument();
    expect(createVariantMatrix).not.toHaveBeenCalled();
  });

  it("her satıra geçerli barkod girilince createVariantMatrix satırları doğru şekilde taşır", async () => {
    previewVariantMatrix.mockResolvedValueOnce(ONIZLEME_TEK_EKSEN);
    createVariantMatrix.mockResolvedValueOnce({ created: 2, product_ids: [10, 11] });
    kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" />);

    await userEvent.type(screen.getByLabelText("Renk değerleri"), "Kırmızı,Mavi");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await screen.findByText("Kırmızı");

    const barkodlar = screen.getAllByLabelText(/^Barkod /);
    await userEvent.type(barkodlar[0], "8690000000012");
    await userEvent.type(barkodlar[1], "8690000000029");

    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(createVariantMatrix).toHaveBeenCalled());
    expect(createVariantMatrix).toHaveBeenCalledWith(5, [
      {
        option1_value: "Kırmızı",
        option2_value: null,
        barcode: "8690000000012",
        price: undefined,
        stock: undefined,
      },
      {
        option1_value: "Mavi",
        option2_value: null,
        barcode: "8690000000029",
        price: undefined,
        stock: undefined,
      },
    ]);
  });

  it("önizleme başarısız olursa kullanıcı hata görür", async () => {
    previewVariantMatrix.mockRejectedValueOnce(new Error("ağ hatası"));
    kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" />);

    await userEvent.type(screen.getByLabelText("Renk değerleri"), "Kırmızı");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));

    expect(await screen.findByText("Önizleme alınamadı.")).toBeInTheDocument();
    expect(createVariantMatrix).not.toHaveBeenCalled();
  });
});

describe("Matris", () => {
  it("her kombinasyon için düzenlenebilir fiyat/barkod/stok alanı gösterir, sku sütunu yok", async () => {
    const degisti = vi.fn();
    kur(
      <Matris
        satirlar={[
          { anahtar: "k1", kombinasyon: "Kırmızı", price: 100, barcode: "" },
          { anahtar: "k2", kombinasyon: "Mavi", price: 100, barcode: "" },
        ]}
        degisti={degisti}
      />,
    );
    expect(screen.getByText("Kırmızı")).toBeInTheDocument();
    expect(screen.getByText("Mavi")).toBeInTheDocument();
    expect(screen.queryByText("SKU")).not.toBeInTheDocument();

    const barkod = screen.getAllByLabelText(/^Barkod /)[0];
    await userEvent.type(barkod, "A");
    expect(degisti).toHaveBeenCalledWith("k1", "barcode", expect.any(String));
  });
});
