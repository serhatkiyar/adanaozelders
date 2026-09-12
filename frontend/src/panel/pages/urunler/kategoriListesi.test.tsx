import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { KategoriListesi } from "@/panel/pages/urunler/KategoriListesi";
import { useCategories } from "@/hooks/useStore";
import { createCategory, deleteCategory, updateCategory } from "@/api/store";
import { useAuthStore } from "@/store/authStore";
import { TAM_ADMIN_IZINLERI } from "@/test-utils/adminIzinleri";
import { PATHS } from "@/lib/routes";
import { PANEL_MENU, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";

const yenileMock = vi.fn();
vi.mock("@/hooks/useStore", () => ({
  useCategories: vi.fn(),
  useInvalidateAdminStore: () => yenileMock,
}));
vi.mock("@/api/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/store")>();
  return {
    ...actual,
    createCategory: vi.fn().mockResolvedValue({}),
    updateCategory: vi.fn().mockResolvedValue({}),
    deleteCategory: vi.fn().mockResolvedValue(undefined),
  };
});

const mockKategoriler = vi.mocked(useCategories);

const KATEGORILER = [
  { id: 1, slug: "kitap", name: "Kitap", parent_id: null, sort_order: 0, is_active: true, product_count: 12, default_tax_rate: "0.2000", effective_tax_rate: "0.2000" },
  { id: 2, slug: "roman", name: "Roman", parent_id: 1, sort_order: 0, is_active: true, product_count: 3, default_tax_rate: null, effective_tax_rate: "0.2000" },
  { id: 3, slug: "eski", name: "Eski Ürünler", parent_id: null, sort_order: 1, is_active: false, product_count: 0, default_tax_rate: null, effective_tax_rate: null },
];

function oturumKur(izinler: readonly string[] = TAM_ADMIN_IZINLERI) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: [...izinler] } as never });
}

function veriDondur(data: unknown[] | undefined = KATEGORILER, ek: Record<string, unknown> = {}) {
  mockKategoriler.mockReturnValue({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek } as never);
}

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter>
          <KategoriListesi />
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

async function satirMenusu(sira: number, oge: string) {
  await userEvent.click(screen.getAllByRole("button", { name: "satır aksiyonları" })[sira]);
  await userEvent.click(await screen.findByRole("menuitem", { name: oge }));
}

beforeEach(() => {
  yenileMock.mockClear();
  vi.mocked(createCategory).mockClear();
  vi.mocked(updateCategory).mockClear();
  vi.mocked(deleteCategory).mockClear();
  oturumKur();
  veriDondur();
});

describe("KategoriListesi", () => {
  it("satırlar: ad (alt kategori ok işaretli), ürün sayısı, KDV (kendi / miras / —) ve durum", () => {
    kur();
    expect(screen.getByRole("heading", { name: "Kategoriler" })).toBeInTheDocument();
    expect(screen.getByText("Kitap")).toBeInTheDocument();
    expect(screen.getByText("↳ Roman")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("%20")).toBeInTheDocument();
    expect(screen.getByText("%20 (miras)")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getAllByText("Aktif")).toHaveLength(2);
    expect(screen.getByText("Pasif")).toBeInTheDocument();
    expect(screen.getByText(/\/ 3 Kategori/)).toBeInTheDocument();
  });

  it("ekleme: boş ad istek atmaz ve hata alanda çıkar; geçerli form createCategory'ye gider", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: /Kategori Ekle/ }));
    const cekmece = await screen.findByRole("dialog");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Kaydet" }));
    expect(await within(cekmece).findByText("Kategori adı zorunlu.")).toBeInTheDocument();
    expect(createCategory).not.toHaveBeenCalled();

    await userEvent.type(within(cekmece).getByLabelText("Kategori adı"), "Dergi");
    await userEvent.type(within(cekmece).getByLabelText("Varsayılan KDV (%)"), "abc");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Kaydet" }));
    expect(await within(cekmece).findByText("KDV oranı sayı olmalı")).toBeInTheDocument();
    expect(createCategory).not.toHaveBeenCalled();

    await userEvent.clear(within(cekmece).getByLabelText("Varsayılan KDV (%)"));
    await userEvent.type(within(cekmece).getByLabelText("Varsayılan KDV (%)"), "10");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Kaydet" }));
    await waitFor(() =>
      expect(createCategory).toHaveBeenCalledWith({ name: "Dergi", parent_id: null, default_tax_rate: "0.1000", is_active: true }),
    );
    await waitFor(() => expect(yenileMock).toHaveBeenCalled());
  });

  it("düzenleme: çekmece mevcut değerlerle dolar, boş KDV varsayılanı temizler ve updateCategory'ye gider", async () => {
    kur();
    await satirMenusu(0, "Düzenle");
    const cekmece = await screen.findByRole("dialog");
    expect(within(cekmece).getByText("Kategoriyi düzenle")).toBeInTheDocument();
    expect(within(cekmece).getByLabelText("Kategori adı")).toHaveValue("Kitap");
    expect(within(cekmece).getByLabelText("Varsayılan KDV (%)")).toHaveValue("20");

    await userEvent.clear(within(cekmece).getByLabelText("Varsayılan KDV (%)"));
    await userEvent.click(within(cekmece).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith(1, { name: "Kitap", parent_id: null, default_tax_rate: null }));
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("Pasife al / Etkinleştir is_active'i tersine çevirir", async () => {
    kur();
    await satirMenusu(0, "Pasife al");
    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith(1, { is_active: false }));
    await satirMenusu(2, "Etkinleştir");
    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith(3, { is_active: true }));
  });

  it("Sil onay ister; Vazgeç'te silmez, onayda deleteCategory çağrılır", async () => {
    kur();
    await satirMenusu(1, "Sil");
    const onay = await screen.findByRole("dialog");
    expect(within(onay).getByText(/"Roman" kategorisi silinecek/)).toBeInTheDocument();
    await userEvent.click(within(onay).getByRole("button", { name: "Vazgeç" }));
    expect(deleteCategory).not.toHaveBeenCalled();

    await satirMenusu(1, "Sil");
    const onay2 = (await screen.findAllByRole("dialog")).at(-1) as HTMLElement;
    await userEvent.click(within(onay2).getByRole("button", { name: "Kategoriyi sil" }));
    await waitFor(() => expect(deleteCategory).toHaveBeenCalledWith(2));
    await waitFor(() => expect(yenileMock).toHaveBeenCalled());
  });

  it("menü: doğrudan Kategoriler öğesi yok; Tanımlamalar kategori rotasına bağlı, products izni ister ve seçili görünür", () => {
    const urunler = PANEL_MENU.find((m) => m.key === "urunler")?.children ?? [];
    expect(urunler.some((c) => c.label === "Kategoriler" || c.key === "kategoriler")).toBe(false);
    expect(urunler.some((c) => c.children?.length)).toBe(false);
    expect(urunler.find((c) => c.key === "tanimlamalar")?.path).toBe(PATHS.adminNewCategories);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewCategories)).toEqual({ label: "Tanımlamalar", requiredPermission: "products" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewCategories)).toEqual({ selectedKey: "tanimlamalar", openKeys: ["urunler"] });
  });

  it("görüntüleme izni yoksa AccessDenied basılır", () => {
    oturumKur(TAM_ADMIN_IZINLERI.filter((i) => !i.startsWith("products")));
    kur();
    expect(screen.getByText("Bu alan için yetkiniz yok")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kategoriler" })).not.toBeInTheDocument();
  });

  it("yalnız görüntüleme izni: aksiyon yok, salt okunur açıklaması dolu/boş/hata durumlarında görünür", () => {
    oturumKur(TAM_ADMIN_IZINLERI.filter((i) => i !== "products.manage"));
    const ilk = kur();
    expect(screen.queryByRole("button", { name: /Kategori Ekle/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "satır aksiyonları" })).not.toBeInTheDocument();
    expect(screen.getByText(/yalnız görüntüleme yetkiniz var/)).toBeInTheDocument();
    expect(screen.getByText("Kitap")).toBeInTheDocument();
    ilk.unmount();

    veriDondur([]);
    const bos = kur();
    expect(screen.getByText("Henüz kategori yok")).toBeInTheDocument();
    expect(screen.getByText(/yalnız görüntüleme yetkiniz var/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kategori Ekle/ })).not.toBeInTheDocument();
    bos.unmount();

    veriDondur(undefined, { isError: true, error: new Error("x"), refetch: vi.fn() });
    kur();
    expect(screen.getByRole("alert")).toHaveTextContent("Kategoriler yüklenemedi.");
    expect(screen.getByText(/yalnız görüntüleme yetkiniz var/)).toBeInTheDocument();
  });

  it("sayfa boyutu 25 ile başlar; veri azalınca etkin sayfa geçerli son sayfaya çekilir", async () => {
    const cok = Array.from({ length: 30 }, (_, i) => ({ ...KATEGORILER[0], id: 100 + i, name: `K${i}`, parent_id: null }));
    veriDondur(cok);
    const { rerender } = kur();
    expect(screen.getByText("1 - 25 / 30 Kategori")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("2"));
    expect(await screen.findByText("26 - 30 / 30 Kategori")).toBeInTheDocument();
    expect(screen.getByText("K25")).toBeInTheDocument();

    veriDondur(cok.slice(0, 10));
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PanelProvider>
          <MemoryRouter>
            <KategoriListesi />
          </MemoryRouter>
        </PanelProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("1 - 10 / 10 Kategori")).toBeInTheDocument();
    expect(screen.getByText("K0")).toBeInTheDocument();
    expect(screen.queryByText("Henüz kategori yok")).not.toBeInTheDocument();
  });

  it("çekmece: temiz formda Vazgeç doğrudan kapatır; kirli formda onay ister, devam et açık bırakır, sil kapatır", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: /Kategori Ekle/ }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: /Kategori Ekle/ }));
    await userEvent.type(await screen.findByLabelText("Kategori adı"), "Dergi");
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect((await screen.findAllByText("Kaydedilmemiş değişiklikler var")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole("button", { name: "Düzenlemeye devam et" }).at(-1) as HTMLElement);
    expect(screen.getByLabelText("Kategori adı")).toHaveValue("Dergi");
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await userEvent.click((await screen.findAllByRole("button", { name: "Değişiklikleri sil" })).at(-1) as HTMLElement);
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("başarılı kayıt doğrudan kapanır, onay çıkmaz; sunucu hatasında açık kalır ve girdiler korunur", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: /Kategori Ekle/ }));
    const cekmece = await screen.findByRole("dialog");
    await userEvent.type(within(cekmece).getByLabelText("Kategori adı"), "Dergi");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(createCategory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).not.toBeInTheDocument();

    vi.mocked(createCategory).mockRejectedValueOnce({ response: { status: 409, data: { detail: "Aynı adda kategori var." } } });
    await userEvent.click(screen.getByRole("button", { name: /Kategori Ekle/ }));
    const cekmece2 = (await screen.findAllByRole("dialog")).at(-1) as HTMLElement;
    await userEvent.type(within(cekmece2).getByLabelText("Kategori adı"), "Dergi");
    await userEvent.click(within(cekmece2).getByRole("button", { name: "Kaydet" }));
    expect(await within(cekmece2).findByRole("alert")).toHaveTextContent("Aynı adda kategori var.");
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    expect(within(cekmece2).getByLabelText("Kategori adı")).toHaveValue("Dergi");
  });

  it("422: name/default_tax_rate hataları ilgili alanda, eşleşmeyen hata genel Alert'te", async () => {
    vi.mocked(createCategory).mockRejectedValueOnce({
      response: { status: 422, data: { detail: [
        { loc: ["body", "name"], msg: "Ad zaten kullanılıyor" },
        { loc: ["body", "default_tax_rate"], msg: "Oran 1'den küçük olmalı" },
        { loc: ["body", "sort_order"], msg: "Sıra geçersiz" },
      ] } },
    });
    kur();
    await userEvent.click(screen.getByRole("button", { name: /Kategori Ekle/ }));
    const cekmece = await screen.findByRole("dialog");
    await userEvent.type(within(cekmece).getByLabelText("Kategori adı"), "Dergi");
    await userEvent.type(within(cekmece).getByLabelText("Varsayılan KDV (%)"), "10");
    await act(async () => {
      await userEvent.click(within(cekmece).getByRole("button", { name: "Kaydet" }));
    });
    expect(await within(cekmece).findByText("Ad zaten kullanılıyor")).toBeInTheDocument();
    expect(within(cekmece).getByText("Oran 1'den küçük olmalı")).toBeInTheDocument();
    expect(within(cekmece).getByRole("alert")).toHaveTextContent("Sıra geçersiz");
    expect(within(cekmece).getByRole("alert")).not.toHaveTextContent("Ad zaten kullanılıyor");
  });

  it("boş liste: boş durum ve Kategori Ekle", () => {
    veriDondur([]);
    kur();
    expect(screen.getByText("Henüz kategori yok")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Kategori Ekle/ }).length).toBeGreaterThan(0);
  });

  it("hata: mesaj ve Tekrar dene yeniden çeker", async () => {
    const refetch = vi.fn();
    veriDondur(undefined, { isError: true, error: new Error("patladı"), refetch });
    kur();
    expect(screen.getByRole("alert")).toHaveTextContent("Kategoriler yüklenemedi.");
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
