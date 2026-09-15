import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { TedarikciListesi } from "@/panel/pages/urunler/TedarikciListesi";
import { BaglamaCekmecesi } from "@/panel/pages/urunler/TedarikciCekmecesi";
import {
  useLinkSupplierProduct,
  useSupplierProducts,
  useSuppliers,
  useSyncSupplier,
  useUnlinkSupplierProduct,
  useUpdateSupplier,
} from "@/hooks/useSuppliers";
import { useAuthStore } from "@/store/authStore";
import type { SupplierOut, SupplierProductOut } from "@/types/supplier";

vi.mock("@/hooks/useSuppliers", () => ({
  useSuppliers: vi.fn(),
  useSupplierProducts: vi.fn(),
  useSyncSupplier: vi.fn(),
  useUpdateSupplier: vi.fn(),
  useLinkSupplierProduct: vi.fn(),
  useUnlinkSupplierProduct: vi.fn(),
}));
vi.mock("@/hooks/useStore", () => ({
  useAdminProducts: () => ({ data: { items: [{ id: 5, title: "Matematik Seti", sku: "MAT-5" }], total: 1 }, isFetching: false }),
}));

const TEDARIKCI: SupplierOut = {
  id: 3, provider: "yildirim", name: "Yıldırım Dağıtım", is_enabled: true,
  base_url: "https://b2b.example/api", has_token: true, token_expires_at: "2099-01-01T00:00:00Z",
  stock_interval_seconds: 60, price_interval_seconds: 21600,
  last_stock_sync_ok_at: null, last_price_sync_ok_at: null, last_error: null, last_error_at: null,
  consecutive_failures: 0, cooldown_until: null, linked_count: 12, unmatched_count: 4,
};
const IKINCI: SupplierOut = { ...TEDARIKCI, id: 4, name: "İkinci Tedarikçi" };
const SATIR = {
  id: 91, external_id: 1, external_code: "ÇINARDEF 11003", name: "Çınar Okul Defteri A5", brand: "ÇINAR",
  barcode: "8695894110038", barcode_valid: true, unit_name: "Düzine", stock_qty: "12.500", stockless: false,
  cost_gross: "168.30", currency_ok: true, campaign: false, quarantine_flags: ["BIRIM_ADET_DEGIL"],
  product: null, link_source: null, is_favorite: true,
} as SupplierProductOut;

const senkron = vi.fn();
const guncelle = vi.fn();
const bagla = vi.fn();
const coz = vi.fn();
const YOL = "/yonetim-yeni/urunler/tedarikciler";

// 422 gövdesi: sunucudaki alan adıyla.
const yanit422 = (alan: string, msg: string) => ({ response: { status: 422, data: { detail: [{ loc: ["body", alan], msg }] } } });

function Konum() {
  const git = useNavigate();
  return (
    <>
      <output data-testid="konum">{useLocation().search}</output>
      <button type="button" onClick={() => git(-1)}>geri</button>
      <button type="button" onClick={() => git(1)}>ileri</button>
    </>
  );
}

function agac(baslangic: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[baslangic]}>
          <Routes>
            <Route path={YOL} element={<><TedarikciListesi /><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}

function kur(baslangic = YOL) {
  return render(agac(baslangic));
}

function izin(izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}

const sonParametre = () => vi.mocked(useSupplierProducts).mock.calls.at(-1);
// Onay penceresi her zaman en son açılan dialog; başlığı (AntD iki yerde basar) içinde doğrulanır.
const sonOnay = async () => {
  const onay = (await screen.findAllByRole("dialog")).at(-1)!;
  await within(onay).findAllByText("Kaydedilmemiş değişiklikler var");
  return onay;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSuppliers).mockReturnValue({ data: [TEDARIKCI], isPending: false, isError: false, refetch: vi.fn() } as never);
  vi.mocked(useSupplierProducts).mockReturnValue({ data: { items: [SATIR], total: 1 }, isPending: false, isError: false, refetch: vi.fn() } as never);
  vi.mocked(useSyncSupplier).mockReturnValue({ mutate: senkron, isPending: false } as never);
  vi.mocked(useUpdateSupplier).mockReturnValue({ mutate: guncelle, isPending: false } as never);
  vi.mocked(useLinkSupplierProduct).mockReturnValue({ mutate: bagla, isPending: false } as never);
  vi.mocked(useUnlinkSupplierProduct).mockReturnValue({ mutate: coz, isPending: false } as never);
  izin(["suppliers.view", "suppliers.manage"]);
});

describe("TedarikciListesi", () => {
  it("durum şeridi, eşleşmemiş satır ve linked=false sorgusu; URL kanonik sağlayıcıya çekilir", async () => {
    kur();
    expect(screen.getByRole("heading", { name: "Tedarikçiler" })).toBeInTheDocument();
    expect(screen.getByText("Yıldırım Dağıtım")).toBeInTheDocument();
    expect(screen.getByText("Çınar Okul Defteri A5")).toBeInTheDocument();
    expect(screen.getByText("Birim adet değil")).toBeInTheDocument();
    expect(screen.getByTestId("token-durumu")).toHaveTextContent(/gün sonra dolar/);
    expect(sonParametre()).toEqual([3, { linked: false, limit: 25, offset: 0 }, true]);
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("saglayici=3"));
  });

  it("görünüm/arama/sayfa/limit URL'de yaşar; geçersiz değerler varsayılana düşer", async () => {
    kur(`${YOL}?gorunum=bagli&sayfa=3&limit=50&saglayici=999`);
    expect(sonParametre()).toEqual([3, { linked: true, limit: 50, offset: 100 }, true]);
    expect(screen.getByRole("button", { name: "Çöz" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("saglayici=3"));
    expect(screen.getByTestId("konum")).toHaveTextContent("sayfa=3");

    kur(`${YOL}?gorunum=x&sayfa=abc&limit=7`);
    expect(sonParametre()).toEqual([3, { linked: false, limit: 25, offset: 0 }, true]);
  });

  it("arama URL'ye anında yazılır, sorguya gecikmeli gider ve sayfayı sıfırlar", async () => {
    kur(`${YOL}?sayfa=2`);
    await userEvent.type(screen.getByRole("textbox", { name: "Tedarikçiler içinde ara" }), "defter");
    expect(screen.getByTestId("konum")).toHaveTextContent("ara=defter");
    expect(screen.getByTestId("konum")).not.toHaveTextContent("sayfa=");
    expect(sonParametre()?.[1]).not.toHaveProperty("q");
    await waitFor(() => expect(sonParametre()).toEqual([3, { linked: false, q: "defter", limit: 25, offset: 0 }, true]));
    expect(screen.getByRole("textbox", { name: "Tedarikçiler içinde ara" })).toHaveValue("defter");
  });

  it("geri/ileri: görünüm URL, Segmented ve sorguyla birlikte döner", async () => {
    kur(`${YOL}?gorunum=bagli`);
    await userEvent.click(screen.getByText(/Eşleşmemiş favoriler/));
    await waitFor(() => expect(sonParametre()?.[1]).toMatchObject({ linked: false }));
    expect(screen.getByTestId("konum")).not.toHaveTextContent("gorunum=");
    await userEvent.click(screen.getByRole("button", { name: "geri" }));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("gorunum=bagli"));
    expect(sonParametre()?.[1]).toMatchObject({ linked: true });
    expect(screen.getByRole("radio", { name: /Bağlı ürünler/ })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "ileri" }));
    await waitFor(() => expect(sonParametre()?.[1]).toMatchObject({ linked: false }));
  });

  it("sağlayıcı değişince URL, sorgu ve seçici güncellenir; açık pencere kapanır; sayfa/arama silinir", async () => {
    vi.mocked(useSuppliers).mockReturnValue({ data: [TEDARIKCI, IKINCI], isPending: false, isError: false } as never);
    kur(`${YOL}?saglayici=3&sayfa=2&ara=x`);
    await userEvent.click(screen.getByRole("button", { name: "Bağla" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Tedarikçi" }));
    await userEvent.click(await screen.findByTitle("İkinci Tedarikçi"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("saglayici=4"));
    expect(screen.getByTestId("konum")).not.toHaveTextContent("sayfa=");
    expect(screen.getByTestId("konum")).not.toHaveTextContent("ara=");
    await waitFor(() => expect(sonParametre()).toEqual([4, { linked: false, limit: 25, offset: 0 }, true]));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    expect(screen.getByText("İkinci Tedarikçi", { selector: ".ant-select-selection-item" })).toBeInTheDocument();
  });

  it("bağlama penceresi: satır başka tedarikçiden geldiyse hiç açılmaz", () => {
    render(
      <PanelProvider>
        <MemoryRouter>
          <BaglamaCekmecesi acik supplierId={4} satirSupplierId={3} satir={SATIR} />
        </MemoryRouter>
      </PanelProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("son hata ve devre kesici görünür; iki senkron düğmesi de kapalı", () => {
    vi.mocked(useSuppliers).mockReturnValue({
      data: [{ ...TEDARIKCI, last_error: "Sunucuya ulaşılamadı (502)", cooldown_until: new Date(Date.now() + 600_000).toISOString(), consecutive_failures: 4 }],
      isPending: false, isError: false,
    } as never);
    kur();
    expect(screen.getByText(/ulaşılamadı \(502\)/)).toBeInTheDocument();
    expect(screen.getByTestId("devre-kesici")).toHaveTextContent("Devre kesici açık: 10 dk");
    expect(screen.getByRole("button", { name: /Stoğu senkronla/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Fiyatı senkronla/ })).toBeDisabled();
  });

  it("senkron: aynı tick'te çift tık tek istek; stok sürerken fiyat başlamaz", async () => {
    kur();
    const stok = screen.getByRole("button", { name: /Stoğu senkronla/ });
    await userEvent.dblClick(stok);
    expect(senkron).toHaveBeenCalledTimes(1);
    expect(senkron).toHaveBeenCalledWith("stock", expect.anything());
    act(() => senkron.mock.calls[0][1].onSettled());

    vi.mocked(useSyncSupplier).mockReturnValue({ mutate: senkron, isPending: true, variables: "stock" } as never);
    kur();
    await userEvent.click(screen.getAllByRole("button", { name: /Fiyatı senkronla/ }).at(-1)!);
    expect(senkron).toHaveBeenCalledTimes(1);
  });

  it("ayarlar: token boş açılır, gerekçe zorunlu, yalnız dokunulan alan gider; 422 alana düşer, pencere ve girdi korunur, tekrar denenebilir", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: /Ayarlar/ }));
    const cekmece = await screen.findByRole("dialog");
    expect(within(cekmece).getByLabelText(/API token/)).toHaveValue("");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Kaydet" }));
    expect(await within(cekmece).findByText("Gerekçe en az 3 karakter olmalı.")).toBeInTheDocument();
    expect(guncelle).not.toHaveBeenCalled();

    const stok = within(cekmece).getByLabelText("Stok senkron aralığı (saniye)");
    await userEvent.clear(stok);
    await userEvent.type(stok, "120");
    // Boşluk token gönderilmez; dokunulup eski değere dönen alan da gitmez.
    await userEvent.type(within(cekmece).getByLabelText(/API token/), "   ");
    const fiyat = within(cekmece).getByLabelText("Fiyat senkron aralığı (saat)");
    await userEvent.clear(fiyat);
    await userEvent.type(fiyat, "6");
    await userEvent.type(within(cekmece).getByLabelText("Gerekçe"), "aralık gevşetildi");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(guncelle).toHaveBeenCalledTimes(1));
    expect(guncelle.mock.calls[0][0]).toEqual({ reason: "aralık gevşetildi", stock_interval_seconds: 120 });

    act(() => guncelle.mock.calls[0][1].onError(yanit422("api_token", "Token geçersiz")));
    act(() => guncelle.mock.calls[0][1].onSettled());
    expect(await within(cekmece).findByText("Token geçersiz")).toBeInTheDocument();
    expect(stok).toHaveValue("120");
    act(() => guncelle.mock.calls[0][1].onError(new Error("boom")));
    expect(await within(cekmece).findByRole("alert")).toHaveTextContent("Ayarlar kaydedilemedi.");

    await userEvent.click(within(cekmece).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(guncelle).toHaveBeenCalledTimes(2));
    act(() => guncelle.mock.calls[1][1].onSuccess());
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
  });

  it("ayarlar: bekleyen istek çift gönderimi ve kapatmayı engeller", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: /Ayarlar/ }));
    const cekmece = await screen.findByRole("dialog");
    await userEvent.type(within(cekmece).getByLabelText("Gerekçe"), "sadece gerekçe");
    await userEvent.dblClick(within(cekmece).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(guncelle).toHaveBeenCalledTimes(1));
    expect(guncelle.mock.calls[0][0]).toEqual({ reason: "sadece gerekçe" });

    vi.mocked(useUpdateSupplier).mockReturnValue({ mutate: guncelle, isPending: true } as never);
    kur();
    await userEvent.click(screen.getAllByRole("button", { name: /Ayarlar/ }).at(-1)!);
    const ikinci = (await screen.findAllByRole("dialog")).at(-1)!;
    await userEvent.click(within(ikinci).getByRole("button", { name: "Vazgeç" }));
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).not.toBeInTheDocument();
    expect(ikinci).toBeInTheDocument();
  });

  it("ayarlar: kirli kapatma onay ister, temiz kapatma doğrudan kapanır; refetch açık formu ezmez", async () => {
    const { rerender } = kur();
    await userEvent.click(screen.getByRole("button", { name: /Ayarlar/ }));
    const cekmece = await screen.findByRole("dialog");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: /Ayarlar/ }));
    const yeniden = await screen.findByRole("dialog");
    const stok = within(yeniden).getByLabelText("Stok senkron aralığı (saniye)");
    await userEvent.clear(stok);
    await userEvent.type(stok, "300");
    vi.mocked(useSuppliers).mockReturnValue({ data: [{ ...TEDARIKCI, stock_interval_seconds: 90 }], isPending: false, isError: false } as never);
    rerender(agac(YOL));
    expect(within(yeniden).getByLabelText("Stok senkron aralığı (saniye)")).toHaveValue("300");

    await userEvent.click(within(yeniden).getByRole("button", { name: "Vazgeç" }));
    const onay = await sonOnay();
    await userEvent.click(within(onay).getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(yeniden).toBeInTheDocument();
    await userEvent.click(within(yeniden).getByRole("button", { name: "Vazgeç" }));
    const onay2 = await sonOnay();
    await userEvent.click(within(onay2).getByRole("button", { name: "Değişiklikleri sil" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
  });

  it("bağla: ürün seçilmeden istek yok; gerçek gövde gider; 422 product_id alana düşer; yeniden açılışta seçim kalmaz", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Bağla" }));
    const cekmece = await screen.findByRole("dialog");
    expect(within(cekmece).getByText("ÇINARDEF 11003 · Çınar Okul Defteri A5")).toBeInTheDocument();
    await userEvent.type(within(cekmece).getByLabelText("Bağlama gerekçesi"), "künye doğrulandı");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Bağla" }));
    expect(await within(cekmece).findByText("Bağlanacak ürünü seçin.")).toBeInTheDocument();
    expect(bagla).not.toHaveBeenCalled();

    await userEvent.type(within(cekmece).getByRole("combobox", { name: "Bağlanacak ürün" }), "mat");
    await userEvent.click(await screen.findByTitle("Matematik Seti · MAT-5"));
    await userEvent.dblClick(within(cekmece).getByRole("button", { name: "Bağla" }));
    await waitFor(() => expect(bagla).toHaveBeenCalledTimes(1));
    expect(bagla.mock.calls[0][0]).toEqual({ spId: 91, product_id: 5, reason: "künye doğrulandı" });

    act(() => bagla.mock.calls[0][1].onError(yanit422("product_id", "Ürün bulunamadı")));
    act(() => bagla.mock.calls[0][1].onSettled());
    expect(await within(cekmece).findByText("Ürün bulunamadı")).toBeInTheDocument();
    expect(within(cekmece).getByLabelText("Bağlama gerekçesi")).toHaveValue("künye doğrulandı");
    expect(cekmece).toBeInTheDocument();

    await userEvent.click(within(cekmece).getByRole("button", { name: "Vazgeç" }));
    await userEvent.click(within(await sonOnay()).getByRole("button", { name: "Değişiklikleri sil" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    // Çekmece kapanış animasyonu bitene dek DOM'da kalır; satırdaki düğme tablo içindedir.
    await userEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Bağla" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).not.toBeNull());
    const yeniden = document.querySelector(".ant-drawer-open .ant-drawer-content") as HTMLElement;
    expect(within(yeniden).getByLabelText("Bağlama gerekçesi")).toHaveValue("");
    expect(within(yeniden).queryByText("Matematik Seti · MAT-5")).not.toBeInTheDocument();
  });

  it("çöz: gerekçe zorunlu; gerçek mutasyon; 422 reason mesajı ve girdi korunur; kirli kapatma onay ister", async () => {
    vi.mocked(useSupplierProducts).mockReturnValue({
      data: { items: [{ ...SATIR, product: { id: 5, title: "Matematik Seti", price: "10", supplier_backed: true }, link_source: "AUTO" }], total: 1 },
      isPending: false, isError: false,
    } as never);
    kur(`${YOL}?gorunum=bagli`);
    await userEvent.click(screen.getByRole("button", { name: "Çöz" }));
    const cekmece = await screen.findByRole("dialog");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Bağı çöz" }));
    expect(await within(cekmece).findByRole("alert")).toHaveTextContent("Gerekçe en az 3 karakter olmalı.");
    expect(coz).not.toHaveBeenCalled();
    await userEvent.type(within(cekmece).getByLabelText("Çözme gerekçesi"), "yanlış barkod");
    await userEvent.dblClick(within(cekmece).getByRole("button", { name: "Bağı çöz" }));
    expect(coz).toHaveBeenCalledTimes(1);
    expect(coz.mock.calls[0][0]).toEqual({ spId: 91, reason: "yanlış barkod" });

    act(() => coz.mock.calls[0][1].onError(yanit422("reason", "Gerekçe çok kısa")));
    act(() => coz.mock.calls[0][1].onSettled());
    expect(within(cekmece).getByRole("alert")).toHaveTextContent("Gerekçe çok kısa");
    expect(within(cekmece).getByLabelText("Çözme gerekçesi")).toHaveValue("yanlış barkod");

    await userEvent.click(within(cekmece).getByRole("button", { name: "Vazgeç" }));
    expect(await sonOnay()).toBeInTheDocument();
  });

  it("yalnız görüntüleme: yazma yüzeyi yok, salt okunur notu boş durumda da görünür", () => {
    izin(["suppliers.view"]);
    kur();
    expect(screen.queryByRole("button", { name: /senkronla/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ayarlar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bağla" })).not.toBeInTheDocument();
    expect(screen.getByText(/salt okunur yetkiniz var/)).toBeInTheDocument();

    vi.mocked(useSupplierProducts).mockReturnValue({ data: { items: [], total: 0 }, isPending: false, isError: false } as never);
    kur();
    expect(screen.getByText("Eşleşmemiş favori yok")).toBeInTheDocument();
    expect(screen.getAllByText(/salt okunur yetkiniz var/)).toHaveLength(2);
  });

  it("görüntüleme izni yoksa AccessDenied; tedarikçi ve katalog sorguları kapalı", () => {
    izin(["products.view"]);
    kur();
    expect(screen.getByText("Bu alan için yetkiniz yok")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tedarikçiler" })).not.toBeInTheDocument();
    expect(vi.mocked(useSuppliers)).toHaveBeenLastCalledWith(false);
    expect(sonParametre()?.[2]).toBe(false);
  });

  it("tedarikçi yoksa boş durum; ürün hatasında durum şeridi kalır ve Tekrar dene yeniden çeker", async () => {
    vi.mocked(useSuppliers).mockReturnValue({ data: [], isPending: false, isError: false } as never);
    kur();
    expect(screen.getByText("Tanımlı tedarikçi yok")).toBeInTheDocument();
    expect(sonParametre()).toEqual([undefined, { linked: false, limit: 25, offset: 0 }, false]);

    const refetch = vi.fn();
    vi.mocked(useSuppliers).mockReturnValue({ data: [TEDARIKCI], isPending: false, isError: false } as never);
    vi.mocked(useSupplierProducts).mockReturnValue({ data: undefined, isPending: false, isError: true, error: new Error("boom"), refetch } as never);
    kur();
    expect(screen.getByTestId("tedarikci-durum")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });
});
