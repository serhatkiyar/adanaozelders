import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { VaryantPenceresi } from "@/panel/pages/urunler/VaryantPenceresi";
import { Matris } from "@/panel/components/Matris";
import { YanPencere } from "@/panel/components/YanPencere";
import { PanelProvider } from "@/panel/PanelProvider";

/**
 * Gerçek `matchMedia` sorgusunu (`min-width`/`max-width`, hangisi geçtiyse)
 * ayrıştırır — belirli bir sorgu metnini varsaymaz. Aynı desen
 * `panelShell.test.tsx`'te kullanılıyor: sahte bir `max-width:767` deseni
 * hook'un gerçek sorgusuyla (`max-width: 767.98px`) eşleşmediği için daha
 * önce testler tesadüfen geçmişti — o hatayı burada tekrarlama.
 */
function setViewport(width: number) {
  window.innerWidth = width;
  window.matchMedia = ((query: string) => {
    const min = query.match(/min-width:\s*([\d.]+)px/);
    const max = query.match(/max-width:\s*([\d.]+)px/);
    let matches = true;
    if (min) matches = matches && width >= parseFloat(min[1]);
    if (max) matches = matches && width <= parseFloat(max[1]);
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

const previewVariantMatrix = vi.fn();
const createVariantMatrix = vi.fn();
vi.mock("@/api/store", () => ({
  previewVariantMatrix: (...a: unknown[]) => previewVariantMatrix(...a),
  createVariantMatrix: (...a: unknown[]) => createVariantMatrix(...a),
}));

afterEach(() => {
  vi.clearAllMocks();
});

// `userEvent.type` karakter karakter yazar — her tuş bir React render + AntD
// Form doğrulaması tetikler; bu dosyadaki alanların hiçbiri tuş DAVRANIŞININ
// kendisini sınamıyor (yalnız SONUÇ değeri önemli), o yüzden emsal
// `urunFormu.test.tsx`teki `yaz()` yardımcısı ile tek `fireEvent.change`e
// indirilir (bkz. o dosyadaki aynı ad ve gerekçe). Tuş davranışının
// sınandığı yer yoksa (klavyeyle seçim, canlı zorunluluk tepkisi) burada
// yok — bu dosyada yalnız düğme tıklamaları (`userEvent.click`) ve
// `userEvent.clear` (tek adımlık, ucuz) `userEvent`de kalır.
function yaz(alan: HTMLElement, deger: string) {
  fireEvent.change(alan, { target: { value: deger } });
}

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

    yaz(screen.getByLabelText("Renk değerleri"), "Kırmızı,Mavi");
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

    yaz(screen.getByLabelText("Renk değerleri"), "Kırmızı");
    yaz(screen.getByLabelText("Beden değerleri"), "S,M");
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

    yaz(screen.getByLabelText("Renk değerleri"), "Kırmızı,Mavi");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await screen.findByText("Kırmızı");

    // Yalnız birinci satıra barkod girilir, ikincisi BİLEREK boş bırakılır.
    const barkodlar = screen.getAllByLabelText(/^Barkod /);
    yaz(barkodlar[0], "8690000000012");

    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    expect(
      await screen.findByText("Her satır için barkod girin: gruplu ürün barkodsuz olamaz."),
    ).toBeInTheDocument();
    expect(createVariantMatrix).not.toHaveBeenCalled();
  });

  it("aynı barkod iki satırda kullanılırsa toplu yazım engellenir", async () => {
    previewVariantMatrix.mockResolvedValueOnce(ONIZLEME_TEK_EKSEN);
    kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" />);

    yaz(screen.getByLabelText("Renk değerleri"), "Kırmızı,Mavi");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await screen.findByText("Kırmızı");

    const barkodlar = screen.getAllByLabelText(/^Barkod /);
    yaz(barkodlar[0], "8690000000012");
    yaz(barkodlar[1], "8690000000012");

    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    expect(await screen.findByText("Aynı barkod iki satırda kullanılamaz.")).toBeInTheDocument();
    expect(createVariantMatrix).not.toHaveBeenCalled();
  });

  it("her satıra geçerli barkod girilince createVariantMatrix satırları doğru şekilde taşır", async () => {
    previewVariantMatrix.mockResolvedValueOnce(ONIZLEME_TEK_EKSEN);
    createVariantMatrix.mockResolvedValueOnce({ created: 2, product_ids: [10, 11] });
    kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" />);

    yaz(screen.getByLabelText("Renk değerleri"), "Kırmızı,Mavi");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await screen.findByText("Kırmızı");

    const barkodlar = screen.getAllByLabelText(/^Barkod /);
    yaz(barkodlar[0], "8690000000012");
    yaz(barkodlar[1], "8690000000029");

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

  it("matriste fiyat yazılıp sonra silinirse gönderilen satırda price alanı hiç yer almaz (0 gönderilmez)", async () => {
    previewVariantMatrix.mockResolvedValueOnce(ONIZLEME_TEK_EKSEN);
    createVariantMatrix.mockResolvedValueOnce({ created: 2, product_ids: [10, 11] });
    kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" />);

    yaz(screen.getByLabelText("Renk değerleri"), "Kırmızı,Mavi");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await screen.findByText("Kırmızı");

    // Birinci satırın fiyatı yazılır, sonra BİLEREK silinir — backend
    // `price: Decimal | None = Field(default=None, gt=0, ...)` (0 geçersiz,
    // boş = ana üründen devral).
    const fiyatlar = screen.getAllByLabelText(/^Fiyat /);
    yaz(fiyatlar[0], "150");
    await userEvent.clear(fiyatlar[0]);

    const barkodlar = screen.getAllByLabelText(/^Barkod /);
    yaz(barkodlar[0], "8690000000012");
    yaz(barkodlar[1], "8690000000029");

    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(createVariantMatrix).toHaveBeenCalled());
    const gonderilenSatirlar = createVariantMatrix.mock.calls[0]![1] as Array<Record<string, unknown>>;
    expect(gonderilenSatirlar[0]!.price).toBeUndefined();
    // JSON gövdesinde alan hiç yer almamalı — `undefined` bunu doğal olarak
    // sağlar, `0` ise sağlamaz (asıl kırmızı senaryo buydu).
    expect(JSON.stringify(gonderilenSatirlar[0])).not.toMatch(/"price"/);
  });

  it("matriste stok yazılıp sonra silinirse gönderilen satırda stock alanı hiç yer almaz (0 gönderilmez)", async () => {
    previewVariantMatrix.mockResolvedValueOnce(ONIZLEME_TEK_EKSEN);
    createVariantMatrix.mockResolvedValueOnce({ created: 2, product_ids: [10, 11] });
    kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" />);

    yaz(screen.getByLabelText("Renk değerleri"), "Kırmızı,Mavi");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await screen.findByText("Kırmızı");

    const stoklar = screen.getAllByLabelText(/^Stok /);
    yaz(stoklar[0], "20");
    await userEvent.clear(stoklar[0]);

    const barkodlar = screen.getAllByLabelText(/^Barkod /);
    yaz(barkodlar[0], "8690000000012");
    yaz(barkodlar[1], "8690000000029");

    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(createVariantMatrix).toHaveBeenCalled());
    const gonderilenSatirlar = createVariantMatrix.mock.calls[0]![1] as Array<Record<string, unknown>>;
    expect(gonderilenSatirlar[0]!.stock).toBeUndefined();
    expect(JSON.stringify(gonderilenSatirlar[0])).not.toMatch(/"stock"/);
  });

  it("önizleme başarısız olursa kullanıcı hata görür", async () => {
    previewVariantMatrix.mockRejectedValueOnce(new Error("ağ hatası"));
    kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" />);

    yaz(screen.getByLabelText("Renk değerleri"), "Kırmızı");
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));

    expect(await screen.findByText("Önizleme alınamadı.")).toBeInTheDocument();
    expect(createVariantMatrix).not.toHaveBeenCalled();
  });

  // İP-A8 gönder düğmesi nöbetçisi (`gecerlilik-borc`): "Önizle" düğmesi
  // FORM GEÇERLİLİĞİYLE kapanıyordu (`disabled={onizleDisabled}`) ve —
  // `VariantMatrixPanel`in aynı adlı düğmesinin aksine — yanında hangi
  // koşulun eksik olduğunu söyleyen CANLI bir metin yoktu, yalnız statik
  // `placeholder`/`help` vardı. Düğme artık kapanmaz: tıklanınca doğrulama
  // çalışır, eksik eksen alanda görünür ve odak ona gider.
  describe("Önizle — gönder düğmesi geçerlilikle kapanmaz", () => {
    it("eksen değeri hiç girilmemişken tıklanınca istek atılmaz, hata görünür ve odak alana gider", async () => {
      kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" />);

      await userEvent.click(screen.getByRole("button", { name: "Önizle" }));

      expect(await screen.findByText("Renk değerlerini girin.")).toBeInTheDocument();
      expect(previewVariantMatrix).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Renk değerleri")).toHaveFocus();
    });

    it("iki eksenli grupta ikinci eksen boşken tıklanınca istek atılmaz, hata görünür ve odak ikinci eksene gider", async () => {
      kur(<VaryantPenceresi acik kapat={() => {}} productId={5} eksen1Adi="Renk" eksen2Adi="Beden" />);

      yaz(screen.getByLabelText("Renk değerleri"), "Kırmızı");
      await userEvent.click(screen.getByRole("button", { name: "Önizle" }));

      expect(await screen.findByText("Beden değerlerini girin.")).toBeInTheDocument();
      expect(previewVariantMatrix).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Beden değerleri")).toHaveFocus();
    });
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
    yaz(barkod, "A");
    expect(degisti).toHaveBeenCalledWith("k1", "barcode", expect.any(String));
  });

  it("fiyat alanı temizlenince degisti undefined ile çağrılır, 0 ile DEĞİL", async () => {
    const degisti = vi.fn();
    kur(
      <Matris
        satirlar={[{ anahtar: "k1", kombinasyon: "Kırmızı", price: 100, barcode: "" }]}
        degisti={degisti}
      />,
    );
    const fiyat = screen.getByLabelText("Fiyat Kırmızı");
    await userEvent.clear(fiyat);
    expect(degisti).toHaveBeenCalledWith("k1", "price", undefined);
    expect(degisti).not.toHaveBeenCalledWith("k1", "price", 0);
  });

  it("stok alanı temizlenince degisti undefined ile çağrılır, 0 ile DEĞİL", async () => {
    const degisti = vi.fn();
    kur(
      <Matris
        satirlar={[{ anahtar: "k1", kombinasyon: "Kırmızı", stock: 20, barcode: "" }]}
        degisti={degisti}
      />,
    );
    const stok = screen.getByLabelText("Stok Kırmızı");
    await userEvent.clear(stok);
    expect(degisti).toHaveBeenCalledWith("k1", "stock", undefined);
    expect(degisti).not.toHaveBeenCalledWith("k1", "stock", 0);
  });

  it("stokta elle 0 yazılırsa geçerli bir değer olarak kalır (boş ile aynı değildir, backend stock ge=0)", async () => {
    const degisti = vi.fn();
    kur(
      <Matris
        satirlar={[{ anahtar: "k1", kombinasyon: "Kırmızı", barcode: "" }]}
        degisti={degisti}
      />,
    );
    const stok = screen.getByLabelText("Stok Kırmızı");
    yaz(stok, "0");
    expect(degisti).toHaveBeenCalledWith("k1", "stock", 0);
  });
});

describe("YanPencere", () => {
  afterEach(() => {
    setViewport(1280);
  });

  it("mobil genişlikte pencere tam genişlik açılır (≤767px)", () => {
    setViewport(767);
    render(
      <PanelProvider>
        <YanPencere acik baslik="Test" kapat={() => {}} kaydet={() => {}}>
          içerik
        </YanPencere>
      </PanelProvider>,
    );
    const sarmalayici = document.querySelector(".ant-drawer-content-wrapper") as HTMLElement;
    expect(sarmalayici.style.width).toBe("100%");
  });

  it("masaüstü genişlikte pencere 480px açılır (≥768px)", () => {
    setViewport(768);
    render(
      <PanelProvider>
        <YanPencere acik baslik="Test" kapat={() => {}} kaydet={() => {}}>
          içerik
        </YanPencere>
      </PanelProvider>,
    );
    const sarmalayici = document.querySelector(".ant-drawer-content-wrapper") as HTMLElement;
    expect(sarmalayici.style.width).toBe("480px");
  });
});
