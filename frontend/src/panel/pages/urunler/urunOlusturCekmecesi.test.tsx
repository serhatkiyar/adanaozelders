import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { UrunOlusturCekmecesi } from "@/panel/pages/urunler/UrunOlusturCekmecesi";
import { PATHS } from "@/lib/routes";

const createProduct = vi.fn();
const uploadProductCover = vi.fn();
const fetchCategories = vi.fn().mockResolvedValue([
  { id: 1, slug: "kirtasiye", name: "Kırtasiye", parent_id: null, sort_order: 0, is_active: true },
]);

// Aynı desen `urunFormu.test.tsx`teki gibi: yalnız `@/api/store` taklit
// edilir, `useCategories` GERÇEK çalışır ve `fetchCategories`i tüketir.
vi.mock("@/api/store", () => ({
  createProduct: (...a: unknown[]) => createProduct(...a),
  uploadProductCover: (...a: unknown[]) => uploadProductCover(...a),
  fetchCategories: (...a: unknown[]) => fetchCategories(...a),
}));

// `compressImage`in gerçek gövdesi (canvas) jsdom'da yok — geçirgen sahte,
// bkz. `urunFormu.test.tsx`teki aynı gerekçe (MedyaSekmesi/compressImage).
const compressImage = vi.fn(async (dosya: File) => dosya);
vi.mock("@/lib/compressImage", () => ({
  compressImage: (...a: [File]) => compressImage(...a),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

afterEach(() => {
  vi.clearAllMocks();
  fetchCategories.mockResolvedValue([
    { id: 1, slug: "kirtasiye", name: "Kırtasiye", parent_id: null, sort_order: 0, is_active: true },
  ]);
});

function yaz(alan: HTMLElement, deger: string) {
  // `urunFormu.test.tsx`teki `yaz` yardımcısıyla AYNI gerekçe: bu dosyada da
  // yalnız SONUÇ değeri sınanıyor, tuş davranışının kendisi değil.
  return fireEvent.change(alan, { target: { value: deger } });
}

function kur(acik = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const kapat = vi.fn();
  const sonuc = render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter>
          <UrunOlusturCekmecesi acik={acik} kapat={kapat} />
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
  return { ...sonuc, kapat };
}

/** Zorunlu alanları doldurup kategoriyi seçer — birçok testin ortak ön koşulu. */
async function zorunluAlanlariDoldur() {
  yaz(screen.getByLabelText("Ürün Adı"), "Deneme Ürün");
  yaz(screen.getByLabelText("Satış Fiyatı"), "120");
  yaz(screen.getByLabelText("KDV Oranı (%)"), "20");
  // Kategori listesi `useCategories()` ile ASENKRON gelir — Select alanı
  // veriler dönene kadar hiç MOUNT olmaz (bkz. bileşendeki `kategorilerYukleniyor`
  // dalı), bu yüzden `findByLabelText` (bekleyen) gerekir, `getByLabelText` değil.
  await userEvent.click(await screen.findByLabelText("Kategori"));
  await userEvent.click(await screen.findByTitle("Kırtasiye"));
}

describe("UrunOlusturCekmecesi", () => {
  it("üç bölüm başlığını ve açıklama satırlarını referansla birebir gösterir", async () => {
    kur();

    expect(screen.getByText("Ürün Oluştur")).toBeInTheDocument();

    expect(screen.getByText("Ürün Detayları")).toBeInTheDocument();
    expect(
      screen.getByText("Ürünün özelliklerini ve önemli bilgilerini buradan yönetin."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ürün görselini bu alana sürükleyin veya yüklemek için tıklayın."),
    ).toBeInTheDocument();

    expect(screen.getByText("Satış Ayarları")).toBeInTheDocument();
    expect(screen.getByText("Satışa başlamak için gerekli temel bilgileri girin.")).toBeInTheDocument();
    expect(screen.getByLabelText("İndirimli fiyat girmek istiyorum")).toBeInTheDocument();
    // "Stoksuz satmaya izin ver" BİLİNÇLİ olarak yok: sunucuda karşılığı
    // olmadığı için işaretlense hiçbir şey değişmezdi (bkz. bileşen başı, 2).
    expect(screen.queryByLabelText("Stoksuz satmaya izin ver")).toBeNull();

    expect(screen.getByText("Kategori Seçimi")).toBeInTheDocument();
    expect(screen.getByText("Ürünün ait olduğu kategoriyi belirleyin.")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Gelişmiş Ürün Eklemeye Geç/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Kaydet ve Satışa Aç" })).toBeInTheDocument();
  });

  it("kategori yoksa referanstaki boş durum metnini ve Kategori Ekle düğmesini gösterir", async () => {
    fetchCategories.mockResolvedValueOnce([]);
    kur();

    expect(await screen.findByText("Henüz kategori oluşturmadınız.")).toBeInTheDocument();
    expect(
      screen.getByText("Ürünleri düzenlemek için ilk kategorinizi ekleyin."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kategori Ekle" })).toBeInTheDocument();
  });

  it("zorunlu alan eksikse istek atılmıyor, düğme disabled DEĞİL ve eksik alan görünür", async () => {
    kur();

    const dugme = await screen.findByRole("button", { name: "Kaydet ve Satışa Aç" });
    expect(dugme).not.toBeDisabled();

    await userEvent.click(dugme);

    expect(await screen.findByText("Ürün adı zorunludur.")).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("kategori hiç oluşturulmamışsa 'Kaydet ve Satışa Aç' isteği engeller ve sebebi gösterir", async () => {
    fetchCategories.mockResolvedValueOnce([]);
    kur();

    yaz(screen.getByLabelText("Ürün Adı"), "Deneme Ürün");
    yaz(screen.getByLabelText("Satış Fiyatı"), "120");
    yaz(screen.getByLabelText("KDV Oranı (%)"), "20");

    await userEvent.click(await screen.findByRole("button", { name: "Kaydet ve Satışa Aç" }));

    expect(
      await screen.findByText("Aktif ürün için kategori zorunludur. Önce bir kategori oluşturun."),
    ).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("gerçek gövdeyle createProduct çağırır — status ACTIVE, kind PHYSICAL, KDV oran'a çevrilmiş", async () => {
    createProduct.mockResolvedValue({ id: 42 });
    kur();

    await zorunluAlanlariDoldur();
    await userEvent.click(await screen.findByRole("button", { name: "Kaydet ve Satışa Aç" }));

    await waitFor(() => expect(createProduct).toHaveBeenCalled());
    expect(createProduct.mock.calls[0][0]).toMatchObject({
      title: "Deneme Ürün",
      kind: "PHYSICAL",
      price: 120,
      compare_at_price: null,
      tax_rate: "0.2000",
      status: "ACTIVE",
      category_id: 1,
    });
  });

  it("İndirimli fiyat girmek istiyorum işaretlenince Eski Fiyat alanı görünür ve gövdeye girer", async () => {
    createProduct.mockResolvedValue({ id: 42 });
    kur();

    await zorunluAlanlariDoldur();
    await userEvent.click(screen.getByLabelText("İndirimli fiyat girmek istiyorum"));
    yaz(await screen.findByLabelText("Eski Fiyat"), "200");

    await userEvent.click(await screen.findByRole("button", { name: "Kaydet ve Satışa Aç" }));

    await waitFor(() => expect(createProduct).toHaveBeenCalled());
    expect(createProduct.mock.calls[0][0]).toMatchObject({ compare_at_price: 200 });
  });

  it("Gelişmiş Ürün Eklemeye Geç tam forma (?tip=basit) yönlendirir", async () => {
    kur();

    await userEvent.click(screen.getByRole("button", { name: /Gelişmiş Ürün Eklemeye Geç/ }));

    expect(navigateMock).toHaveBeenCalledWith(`${PATHS.adminNewProductNew}?tip=basit`);
  });

  it("görsel seçilmişse kaydetmeden SONRA yükleme çağrısı yapılır", async () => {
    createProduct.mockResolvedValue({ id: 7 });
    uploadProductCover.mockResolvedValue({ id: 7 });
    kur();

    await zorunluAlanlariDoldur();
    const dosya = new File(["icerik"], "kapak.png", { type: "image/png" });
    const girdi = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(girdi, dosya);

    await userEvent.click(await screen.findByRole("button", { name: "Kaydet ve Satışa Aç" }));

    await waitFor(() => expect(uploadProductCover).toHaveBeenCalledWith(7, dosya));
    // Sıra: önce ürün, SONRA görsel — `uploadProductCover` yalnız
    // `createProduct` başarıyla dönüp id verdikten sonra çağrılabilir.
    expect(createProduct.mock.invocationCallOrder[0]).toBeLessThan(
      uploadProductCover.mock.invocationCallOrder[0],
    );
  });

  it("görsel yüklemesi başarısız olursa kullanıcı GÖRÜR (sessiz kalmaz) — ürün yine de kaydedilmiş sayılır", async () => {
    createProduct.mockResolvedValue({ id: 7 });
    uploadProductCover.mockRejectedValue(new Error("ağ hatası"));
    const { kapat } = kur();

    await zorunluAlanlariDoldur();
    const dosya = new File(["icerik"], "kapak.png", { type: "image/png" });
    const girdi = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(girdi, dosya);

    await userEvent.click(await screen.findByRole("button", { name: "Kaydet ve Satışa Aç" }));

    await waitFor(() => expect(uploadProductCover).toHaveBeenCalled());
    expect(await screen.findByText(/görsel yüklenemedi/i)).toBeInTheDocument();
    // Ürün zaten kaydedildi — çekmece yine de kapanır (sessiz veri kaybı yok,
    // ama başarısız bir görsel akışı sonsuza dek açık bırakmaz).
    await waitFor(() => expect(kapat).toHaveBeenCalled());
  });
});
