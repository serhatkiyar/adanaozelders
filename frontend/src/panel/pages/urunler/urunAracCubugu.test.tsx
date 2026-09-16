/**
 * Ürün listesi araç çubuğunun DAVRANIŞ testleri (görünüm testi değil):
 * filtrenin gerçek sorgu alanlarına dönüşmesi, içe aktarma sonucunun ekranda
 * KALMASI, kolon görünürlüğü, liste/ızgara kalıcılığı ve BİLİNÇLİ boşlukların
 * (Dışa Aktar düğmesi, satır seçimi checkbox'ı) geri sızmaması.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { UrunListesi } from "@/panel/pages/urunler/UrunListesi";
import {
  useAdminProducts,
  useBookFacets,
  useBulkImportProducts,
  useCategories,
  useStoreConfig,
} from "@/hooks/useStore";
import { deleteProduct, updateProduct, uploadProductCover } from "@/api/store";
import { useAuthStore } from "@/store/authStore";
import { TAM_ADMIN_IZINLERI } from "@/test-utils/adminIzinleri";

const yenileMock = vi.fn();
vi.mock("@/hooks/useStore", () => ({
  useAdminProducts: vi.fn(),
  useCategories: vi.fn(),
  useBookFacets: vi.fn(),
  useBulkImportProducts: vi.fn(),
  useStoreConfig: vi.fn(),
  useInvalidateAdminStore: () => yenileMock,
}));

// Satır menüsünün üç mutasyonu gerçek API fonksiyonlarına gider; burada
// yalnız çağrı sözleşmesi (id + gövde) doğrulanır.
vi.mock("@/api/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/store")>();
  return {
    ...actual,
    updateProduct: vi.fn().mockResolvedValue({}),
    deleteProduct: vi.fn().mockResolvedValue(undefined),
    uploadProductCover: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const mockUseAdminProducts = vi.mocked(useAdminProducts);
const mockUseCategories = vi.mocked(useCategories);
const mockUseBookFacets = vi.mocked(useBookFacets);
const mockUseBulkImport = vi.mocked(useBulkImportProducts);
const mockUseStoreConfig = vi.mocked(useStoreConfig);

const URUNLER = [
  { id: 1, title: "9. Sınıf Matematik", price: 250, stock: 50, status: "ACTIVE" },
  { id: 2, title: "10. Sınıf Fizik", price: 180, stock: null, status: "DRAFT" },
];

/** Yetkili (tam izinli) yönetici oturumu. */
function oturumKur(izinler: readonly string[] = TAM_ADMIN_IZINLERI) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: [...izinler] } as never,
  });
}

function veriDondur(items: unknown[] = URUNLER) {
  mockUseAdminProducts.mockReturnValue({
    data: { items, total: items.length },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useAdminProducts>);
}

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

/** Sorgunun SON hâli — araç çubuğu testlerinin tek iddia yüzeyi. */
const sonSorgu = () => mockUseAdminProducts.mock.calls.at(-1)?.[0] ?? {};

/** AntD `Select`i (erişilebilir adıyla, SON örneği) aç ve seçeneğe tıkla. */
async function secimYap(ad: string, secenek: string) {
  const kutular = screen.getAllByRole("combobox", { name: ad });
  await userEvent.click(kutular[kutular.length - 1]);
  const secenekler = await screen.findAllByTitle(secenek);
  await userEvent.click(secenekler[secenekler.length - 1]);
}

/**
 * Filtre penceresinde bir satır ekle (ikas akışı): `+ Filtre Ekle` → alan
 * seçici → değer seçici. Uygulamak çağıranın işi (`Uygula`).
 */
async function filtreSatiriEkle(alan: string, deger: string) {
  await userEvent.click(screen.getByRole("button", { name: /Filtre Ekle/ }));
  await secimYap("Filtre alanı", alan);
  await secimYap("Filtre değeri", deger);
}

const filtreAc = () => userEvent.click(screen.getByRole("button", { name: "Filtre" }));
const uygula = () => userEvent.click(screen.getByRole("button", { name: "Uygula" }));

beforeEach(() => {
  localStorage.clear();
  mockUseCategories.mockReturnValue({
    data: [{ id: 1, slug: "kirtasiye", name: "Kırtasiye", parent_id: null, sort_order: 0, is_active: true }],
    isPending: false,
  } as unknown as ReturnType<typeof useCategories>);
  mockUseBookFacets.mockReturnValue({
    data: {
      publisher: [{ value: "Palme", count: 12 }],
      author: [{ value: "Ahmet Yılmaz", count: 3 }],
      cover_type: [],
    },
    isPending: false,
  } as unknown as ReturnType<typeof useBookFacets>);
  mockUseBulkImport.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useBulkImportProducts>);
  mockUseStoreConfig.mockReturnValue({
    data: { low_stock_threshold: 5 },
    isPending: false,
  } as unknown as ReturnType<typeof useStoreConfig>);
  yenileMock.mockClear();
  vi.mocked(updateProduct).mockClear();
  vi.mocked(deleteProduct).mockClear();
  vi.mocked(uploadProductCover).mockClear();
  // Tedarikçi süzgeci `suppliers.view` izninin arkasında (D-6) — izinli
  // oturum kurulmazsa o alan hiç render edilmez.
  oturumKur();
});

describe("izin kapısı (products.manage)", () => {
  it("yalnız görüntüleme izniyle Ürün Ekle / İçe Aktar yok, salt okunur uyarısı var, menüde yalnız Düzenle", async () => {
    oturumKur(TAM_ADMIN_IZINLERI.filter((i) => i !== "products.manage"));
    veriDondur();
    kur();

    expect(screen.queryByRole("button", { name: /Ürün Ekle/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /İçe Aktar/ })).not.toBeInTheDocument();
    expect(screen.getByText(/yalnız görüntüleme yetkiniz var/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "satır aksiyonları" })[0]);
    expect(await screen.findByRole("menuitem", { name: "Düzenle" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Sil" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Gizle" })).not.toBeInTheDocument();
  });
});

describe("satır aksiyonları (eski panel paritesi)", () => {
  it("Gizle seçilince ürün HIDDEN olarak güncellenir ve liste yenilenir", async () => {
    veriDondur();
    kur();

    await userEvent.click(screen.getAllByRole("button", { name: "satır aksiyonları" })[0]);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Gizle" }));

    await waitFor(() => expect(updateProduct).toHaveBeenCalledWith(1, { status: "HIDDEN" }));
    await waitFor(() => expect(yenileMock).toHaveBeenCalled());
  });

  it("taslak üründe seçenek 'Yayınla'dır ve ACTIVE gönderir", async () => {
    veriDondur();
    kur();

    await userEvent.click(screen.getAllByRole("button", { name: "satır aksiyonları" })[1]);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Yayınla" }));

    await waitFor(() => expect(updateProduct).toHaveBeenCalledWith(2, { status: "ACTIVE" }));
  });

  it("Sil onay ister; Vazgeç'te silmez, onayda deleteProduct çağrılır", async () => {
    veriDondur();
    kur();

    await userEvent.click(screen.getAllByRole("button", { name: "satır aksiyonları" })[0]);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sil" }));
    const onay = await screen.findByRole("dialog");
    expect(within(onay).getByText(/"9\. Sınıf Matematik" katalogdan kaldırılacak/)).toBeInTheDocument();
    await userEvent.click(within(onay).getByRole("button", { name: "Vazgeç" }));
    expect(deleteProduct).not.toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole("button", { name: "satır aksiyonları" })[0]);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sil" }));
    // Vazgeçilen ilk pencere kapanış animasyonu boyunca DOM'da kalabilir;
    // yeni açılan SON pencere aranır.
    const onay2 = (await screen.findAllByRole("dialog")).at(-1) as HTMLElement;
    await userEvent.click(within(onay2).getByRole("button", { name: "Ürünü sil" }));
    await waitFor(() => expect(deleteProduct).toHaveBeenCalledWith(1));
  });

  it("Kapak görseli yükle: seçilen dosya uploadProductCover'a gider", async () => {
    veriDondur();
    kur();

    const dosya = new File(["x"], "kapak.png", { type: "image/png" });
    const girdi = screen.getByLabelText("9. Sınıf Matematik için kapak görseli");
    await userEvent.upload(girdi, dosya);

    await waitFor(() => expect(uploadProductCover).toHaveBeenCalledWith(1, dosya));
  });
});

describe("hücreler", () => {
  it("durum rozeti ve düşük stok/tükendi uyarısı basılır", () => {
    veriDondur([
      { id: 1, title: "A", price: 10, stock: 0, status: "ACTIVE" },
      { id: 2, title: "B", price: 10, stock: 3, status: "HIDDEN" },
      { id: 3, title: "C", price: 10, stock: 50, status: "DRAFT" },
    ]);
    kur();

    expect(screen.getByText("Tükendi")).toBeInTheDocument();
    expect(screen.getByText("3 adet")).toBeInTheDocument();
    expect(screen.getByText("50 adet")).toBeInTheDocument();
    expect(screen.getByText("Yayında")).toBeInTheDocument();
    expect(screen.getByText("Gizli")).toBeInTheDocument();
    expect(screen.getByText("Taslak")).toBeInTheDocument();
  });

  it("maliyet kolonu suppliers.view izniyle görünür, izinsiz kolon ayarında da sunulmaz", async () => {
    veriDondur([
      {
        id: 1, title: "A", price: 100, stock: 5, status: "ACTIVE", supplier_backed: true,
        supplier: { stock_qty: "12.5", unit_name: "adet", cost_gross: "120", margin_percent: "-20", below_cost: true },
      },
    ]);
    kur();
    expect(screen.getByRole("columnheader", { name: "Maliyet / Marj" })).toBeInTheDocument();
    expect(screen.getByText("Zararına")).toBeInTheDocument();
    expect(screen.getByText(/Tedarikçide 12,5 adet/)).toBeInTheDocument();

    oturumKur(TAM_ADMIN_IZINLERI.filter((i) => !i.startsWith("suppliers")));
    kur();
    expect(screen.queryByRole("columnheader", { name: "Maliyet / Marj" })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Kolon Ayarı" })[1]);
    expect(await screen.findByRole("switch", { name: "Durum" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Maliyet / Marj" })).not.toBeInTheDocument();
  });
});

describe("araç çubuğu düğmeleri ekranda", () => {
  it("Filtre, kolon ayarı, liste ve ızgara görünümü düğmeleri render edilir; etkin görünüm basılı", () => {
    veriDondur();
    kur();

    expect(screen.getByRole("button", { name: "Filtre" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Liste Görünümü" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Izgara Görünümü" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Kolon Ayarı" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Liste Görünümü" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Izgara Görünümü" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /İçe Aktar/ })).toBeInTheDocument();
  });

  it("alt bilgi birimi 'Ürün' (ikas'ın '1 - 1 / 1 Ürün' biçimi)", () => {
    veriDondur();
    kur();
    expect(screen.getByText(/\/ 2 Ürün/)).toBeInTheDocument();
  });

  // ── BİLİNÇLİ BOŞLUKLAR: geri sızmasın ──
  it("'Dışa Aktar' düğmesi YOKTUR (backend'de ürün dışa aktarma ucu yok)", () => {
    veriDondur();
    kur();
    expect(screen.queryByRole("button", { name: /Dışa Aktar/i })).not.toBeInTheDocument();
  });

  it("satır seçimi checkbox'ı YOKTUR (toplu aksiyon ucu yok)", () => {
    veriDondur();
    kur();
    // Tablo içindeki tek checkbox bile olmamalı; kolon ayarındaki kutular
    // çekmecede yaşar ve çekmece kapalıdır.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("filtre", () => {
  it("pencere düğmenin altında açılır, boşken 'Henüz filtre eklemediniz.' der ve Uygula'ya kadar sorgu değişmez", async () => {
    veriDondur();
    kur();

    await filtreAc();
    expect(await screen.findByText("Henüz filtre eklemediniz.")).toBeInTheDocument();
    await filtreSatiriEkle("Stok durumu", "Tükendi");
    // Uygula basılmadan istek atılmaz (ikas: seçim anında değil, Uygula ile).
    expect(sonSorgu()).not.toHaveProperty("stok");
    await uygula();
    await waitFor(() => expect(sonSorgu()).toMatchObject({ stok: "tukendi", offset: 0 }));
  });

  it("yayınevi ve yazar GERÇEK facet kaynağından gelir ve publisher/author olarak gider", async () => {
    veriDondur();
    kur();

    await filtreAc();
    // Seçenek metni facet sayısını taşır (uydurma liste değil, /store/book-facets).
    await filtreSatiriEkle("Yayınevi", "Palme (12)");
    await filtreSatiriEkle("Yazar", "Ahmet Yılmaz (3)");
    await uygula();
    await waitFor(() =>
      expect(sonSorgu()).toMatchObject({ publisher: "Palme", author: "Ahmet Yılmaz" }),
    );
  });

  it("tedarikçi seçimi supplier alanına çevrilir (below_cost = zararına satılan)", async () => {
    veriDondur();
    kur();

    await filtreAc();
    await filtreSatiriEkle("Tedarikçi", "Zararına satılan");
    await uygula();

    await waitFor(() => expect(sonSorgu()).toMatchObject({ supplier: "below_cost" }));
  });

  it("satırdaki çöp ikonu filtreyi kaldırır", async () => {
    veriDondur();
    kur();

    await filtreAc();
    await filtreSatiriEkle("Stok durumu", "Tükendi");
    await userEvent.click(screen.getByRole("button", { name: "Stok durumu filtresini kaldır" }));
    await uygula();
    await waitFor(() => expect(sonSorgu()).not.toHaveProperty("stok"));
  });

  it("uygulanan filtre sayısı ekranda görünür ve temizlenince alanlar isteğe HİÇ girmez", async () => {
    veriDondur();
    kur();

    await filtreAc();
    await filtreSatiriEkle("Stok durumu", "Tükendi");
    await filtreSatiriEkle("Yayınevi", "Palme (12)");
    await uygula();

    expect(await screen.findByText("2 filtre uygulandı")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Temizle" }));

    await waitFor(() => {
      expect(sonSorgu()).not.toHaveProperty("stok");
      expect(sonSorgu()).not.toHaveProperty("publisher");
    });
    expect(screen.queryByText(/filtre uygulandı/)).not.toBeInTheDocument();
  });

  it("filtreliyken sonuç boşsa 'kayıt yok' değil 'sonuç yok' denir ve temizleme sunulur", async () => {
    veriDondur();
    kur();

    veriDondur([]);
    await filtreAc();
    await filtreSatiriEkle("Stok durumu", "Tükendi");
    // Filtre uygulanınca yeni bir render tetiklenir; boş veri o render'da okunur.
    await uygula();
    expect(await screen.findByText("Sonuç bulunamadı")).toBeInTheDocument();
    expect(screen.queryByText("İlk Ürününüzü Yükleyin!")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Filtreleri temizle" }));
    await waitFor(() => expect(sonSorgu()).not.toHaveProperty("stok"));
  });
});

describe("içe aktarma", () => {
  it("dosya seçmeden Yükle basılınca istek atılmaz, sebep alanda okunur", async () => {
    const mutateAsync = vi.fn();
    mockUseBulkImport.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useBulkImportProducts>);
    veriDondur();
    kur();

    await userEvent.click(screen.getByRole("button", { name: /İçe Aktar/ }));
    await userEvent.click(screen.getByRole("button", { name: "Yükle" }));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(await screen.findByText("Önce içe aktarılacak CSV dosyasını seçin.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Şablon CSV indir" })).toBeInTheDocument();
  });

  it("seçilen dosya yüklenir ve sonuç (hatalı satırlar dahil) ekranda KALIR", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      created: 12,
      skipped: 1,
      errors: [{ row: 4, message: "price alanı sayı değil" }],
    });
    mockUseBulkImport.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useBulkImportProducts>);
    veriDondur();
    kur();

    await userEvent.click(screen.getByRole("button", { name: /İçe Aktar/ }));
    const dosya = new File(["baslik,fiyat\nkalem,10"], "urunler.csv", { type: "text/csv" });
    const girdi = screen.getByLabelText("İçe aktarılacak CSV dosyası");
    await userEvent.upload(girdi, dosya);
    await userEvent.click(screen.getByRole("button", { name: "Yükle" }));

    expect(mutateAsync).toHaveBeenCalledWith(dosya);
    // Sonuç bir toast DEĞİL: çekmecede durur, hata satırı okunabilir.
    expect(
      await screen.findByText("12 ürün eklendi, 1 satır atlandı, 1 satır hatalı."),
    ).toBeInTheDocument();
    expect(screen.getByText(/4\. satır: price alanı sayı değil/)).toBeInTheDocument();
  });
});

describe("kolon ayarı", () => {
  it("kapatılan kolon tabloda YOK, 'Ürün' kolonu kapatılamaz", async () => {
    veriDondur();
    kur();

    expect(screen.getByRole("columnheader", { name: "Envanter" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Kolon Ayarı" }));
    const urunAnahtari = await screen.findByRole("switch", { name: "Ürün" });
    expect(urunAnahtari).toBeChecked();
    expect(urunAnahtari).toBeDisabled();

    await userEvent.click(screen.getByRole("switch", { name: "Envanter" }));

    await waitFor(() =>
      expect(screen.queryByRole("columnheader", { name: "Envanter" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("columnheader", { name: "Ürün" })).toBeInTheDocument();
  });

  it("kolon tercihi localStorage'da kalıcıdır", async () => {
    veriDondur();
    const ilk = kur();

    await userEvent.click(screen.getByRole("button", { name: "Kolon Ayarı" }));
    await userEvent.click(await screen.findByRole("switch", { name: "Satış Fiyatı" }));
    await waitFor(() =>
      expect(screen.queryByRole("columnheader", { name: "Satış Fiyatı" })).not.toBeInTheDocument(),
    );

    ilk.unmount();
    kur();

    expect(screen.queryByRole("columnheader", { name: "Satış Fiyatı" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Envanter" })).toBeInTheDocument();
  });
});

describe("liste / ızgara görünümü", () => {
  it("ızgaraya geçince ürünler kart bağlantısı olur, listeye dönünce kolon başlıkları geri gelir", async () => {
    veriDondur();
    kur();

    await userEvent.click(screen.getByRole("button", { name: "Izgara Görünümü" }));

    // Kart bir bağlantıdır (klavyeyle odaklanabilir, Enter çalışır).
    const kart = await screen.findByRole("link", { name: /9\. Sınıf Matematik/ });
    expect(kart).toHaveAttribute("href", expect.stringContaining("/urunler/1"));
    // Izgarada kolon başlığı yok.
    expect(screen.queryByRole("columnheader", { name: "Envanter" })).not.toBeInTheDocument();
    // Sayfalama ve arama ızgarada da çalışır.
    expect(screen.getByText(/\/ 2 Ürün/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Tabloda arama yapın")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Liste Görünümü" }));
    expect(await screen.findByRole("columnheader", { name: "Envanter" })).toBeInTheDocument();
  });

  it("ızgarada her ürün için kapak/ad/fiyat/envanter basılır (dijitalde envanter —)", async () => {
    veriDondur();
    kur();

    await userEvent.click(screen.getByRole("button", { name: "Izgara Görünümü" }));

    const dijital = await screen.findByRole("link", { name: /10\. Sınıf Fizik/ });
    expect(within(dijital).getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /50 adet/ })).toBeInTheDocument();
  });

  it("görünüm tercihi localStorage'da kalıcıdır", async () => {
    veriDondur();
    const ilk = kur();

    await userEvent.click(screen.getByRole("button", { name: "Izgara Görünümü" }));
    await screen.findByRole("link", { name: /9\. Sınıf Matematik/ });

    ilk.unmount();
    kur();

    expect(await screen.findByRole("link", { name: /9\. Sınıf Matematik/ })).toBeInTheDocument();
  });

  it("depolama erişimi patlarsa ekran çalışmaya devam eder", async () => {
    const okuma = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const yazma = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    veriDondur();
    kur();

    // Varsayılana düşer (liste) ve tercih yazılamasa bile geçiş çalışır.
    expect(screen.getByRole("columnheader", { name: "Envanter" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Izgara Görünümü" }));
    expect(await screen.findByRole("link", { name: /9\. Sınıf Matematik/ })).toBeInTheDocument();

    okuma.mockRestore();
    yazma.mockRestore();
  });
});
