import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { StokHareketleriListesi } from "@/panel/pages/urunler/StokHareketleriListesi";
import { useLedgerAudit, useStockMovements } from "@/hooks/useStock";
import { PANEL_MENU, rotaIzniBul } from "@/panel/layout/menu";
import { PATHS } from "@/lib/routes";
import type { StockMovementOut } from "@/api/stock";

vi.mock("@/hooks/useStock", () => ({ useStockMovements: vi.fn(), useLedgerAudit: vi.fn() }));

const mockListe = vi.mocked(useStockMovements);
const mockDenetim = vi.mocked(useLedgerAudit);

const HAREKET = {
  id: 1, product_id: 10, sku: "FZK-000010", product_title: "9. Sınıf Matematik", qty_delta: -2, qty_after: 48,
  movement_type: "SALE", reason_code: "", ref_type: "order", ref_id: 55, ref_line_id: 3, actor_type: "SYSTEM", actor_id: null,
  note: null, created_at: "2026-09-10T10:00:00Z",
} as StockMovementOut;
const HAREKET2 = { ...HAREKET, id: 2, qty_delta: 5, qty_after: 53, movement_type: "COUNT_ADJUSTMENT", reason_code: "", ref_type: null, actor_type: "ADMIN", actor_id: 7, note: "Raf sayımı" } as StockMovementOut;

let git: (yol: string) => void = () => {};
function Konum() {
  git = useNavigate();
  return <output data-testid="konum">{useLocation().search}</output>;
}

function kur(baslangic = "/yonetim-yeni/urunler/stok-hareketleri") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[baslangic]}>
          <Routes>
            <Route path="/yonetim-yeni/urunler/stok-hareketleri" element={<><StokHareketleriListesi /><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const sonSorgu = () => mockListe.mock.calls.at(-1)?.[0] ?? {};

beforeEach(() => {
  mockListe.mockReset();
  mockDenetim.mockReset();
  mockListe.mockReturnValue(sonuc({ rows: [HAREKET, HAREKET2], total: 2, limit: 25, offset: 0 }));
  mockDenetim.mockReturnValue(sonuc(undefined, { isPending: true }));
});

describe("StokHareketleriListesi", () => {
  it("satırlar bütün kolonlarla basılır; değişim işaretli, SKU seçilebilir", () => {
    kur();
    for (const b of ["Tarih", "Ürün", "Hareket", "Değişim", "Sonraki stok", "Gerekçe", "Kaynak", "Kim"]) {
      expect(screen.getByRole("columnheader", { name: b })).toBeInTheDocument();
    }
    expect(screen.getByText("Stok defteri salt okunurdur; ödeme, iade, sayım ve hasar işlemleri burada izlenir.")).toBeInTheDocument();
    expect(screen.getAllByText("FZK-000010")[0]).toHaveStyle({ userSelect: "all" });
    expect(screen.getByText("Satış")).toBeInTheDocument();
    expect(screen.getByText("Sayım düzeltmesi")).toBeInTheDocument();
    expect(screen.getByText("−2")).toBeInTheDocument();
    expect(screen.getByText("+5")).toBeInTheDocument();
    expect(screen.getByText("Sipariş #55 · satır 3")).toBeInTheDocument();
    expect(screen.getByText("Sistem")).toBeInTheDocument();
    expect(screen.getByText("Yönetici #7")).toBeInTheDocument();
    expect(screen.getByText("Raf sayımı")).toBeInTheDocument();
  });

  it("filtre penceresi güncel bütün hareket türlerini sunar; tür/aktör URL'ye ve hook'a gider", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Filtre" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Hareket türü" }));
    for (const etiket of ["Açılış bakiyesi", "Hasara ayrıldı", "Tedarikçiye iade edildi", "İmha edildi"]) {
      expect(await screen.findByTitle(etiket)).toBeInTheDocument();
    }
    await userEvent.click(screen.getByTitle("Hasara ayrıldı"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("tur=DAMAGE_TRANSFER"));
    expect(sonSorgu()).toMatchObject({ movement_type: "DAMAGE_TRANSFER", offset: 0 });

    await userEvent.click(screen.getByRole("combobox", { name: "Kim" }));
    await userEvent.click(await screen.findByTitle("Yönetici"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("aktor=ADMIN"));
    expect(sonSorgu()).toMatchObject({ actor_type: "ADMIN", movement_type: "DAMAGE_TRANSFER" });
    expect(screen.getByText("2")).toBeInTheDocument(); // rozet
  });

  it("SKU araması URL'ye ve hook'a gider; beyaz liste dışı tur/aktor yok sayılır", async () => {
    kur("/yonetim-yeni/urunler/stok-hareketleri?tur=UYDURMA&aktor=BOT");
    expect(sonSorgu()).not.toHaveProperty("movement_type", "UYDURMA");
    expect(sonSorgu().actor_type).toBeUndefined();
    await userEvent.type(screen.getByRole("textbox", { name: /içinde ara/ }), "FZK-1");
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("sku=FZK-1"));
    expect(sonSorgu()).toMatchObject({ sku: "FZK-1", offset: 0 });
  });

  it("tarayıcı geri gidince URL, tablo ve arama alanı aynı SKU'yu gösterir", async () => {
    kur();
    const kutu = screen.getByRole("textbox", { name: /içinde ara/ });
    await userEvent.type(kutu, "FZK-006787");
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("sku=FZK-006787"));
    await userEvent.clear(kutu);
    await userEvent.type(kutu, "FZK-006786");
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("sku=FZK-006786"));
    expect(sonSorgu()).toMatchObject({ sku: "FZK-006786" });

    // Harici URL değişimi (tarayıcı geri/ileri gibi): alan da URL'yi izler.
    act(() => git("/yonetim-yeni/urunler/stok-hareketleri?sku=FZK-006787"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("sku=FZK-006787"));
    expect(screen.getByRole("textbox", { name: /içinde ara/ })).toHaveValue("FZK-006787");
    expect(sonSorgu()).toMatchObject({ sku: "FZK-006787" });
  });

  it("hareket listesi boşken de açılan denetim sonucu görünür kalır", async () => {
    mockListe.mockReturnValue(sonuc({ rows: [], total: 0, limit: 25, offset: 0 }));
    mockDenetim.mockReturnValue(sonuc({ checked: 3, inconsistent: 0, problems: [], next_offset: null, limit: 100, offset: 0 }));
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Defteri denetle" }));
    expect(screen.getAllByRole("region", { name: "Defter denetimi" })).toHaveLength(1);
    expect(screen.getByText("Bu sayfada sapma yok")).toBeInTheDocument();
    expect(screen.getByText("Henüz stok hareketi yok")).toBeInTheDocument();
  });

  it("sayfalama gerçek total/offset ile çalışır", async () => {
    mockListe.mockReturnValue(sonuc({ rows: [HAREKET], total: 60, limit: 25, offset: 0 }));
    kur();
    expect(screen.getByText(/\/ 60 Hareket/)).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("2"));
    await waitFor(() => expect(sonSorgu()).toMatchObject({ limit: 25, offset: 25 }));
  });

  it("denetim kapalıyken sorgu çalışmaz; açılınca tutarlı/sapmalı/hata durumları gösterilir", async () => {
    kur();
    expect(mockDenetim).toHaveBeenLastCalledWith(expect.anything(), false);
    expect(screen.queryByRole("region", { name: "Defter denetimi" })).not.toBeInTheDocument();

    mockDenetim.mockReturnValue(sonuc({ checked: 100, inconsistent: 0, problems: [], next_offset: null, limit: 100, offset: 0 }));
    await userEvent.click(screen.getByRole("button", { name: "Defteri denetle" }));
    expect(mockDenetim).toHaveBeenLastCalledWith({ limit: 100, offset: 0 }, true);
    const yuzey = screen.getByRole("region", { name: "Defter denetimi" });
    expect(within(yuzey).getByText("Bu sayfada sapma yok")).toBeInTheDocument();
    expect(within(yuzey).getByText("100 ürün denetlendi")).toBeInTheDocument();
    expect(within(yuzey).getByText("Bu ekran yalnız teşhis gösterir; hiçbir kayıt düzeltilmez.")).toBeInTheDocument();
    expect(within(yuzey).queryByRole("button", { name: /Düzelt|Onar/ })).not.toBeInTheDocument();

    mockDenetim.mockReturnValue(
      sonuc({
        checked: 100, inconsistent: 1, next_offset: 100, limit: 100, offset: 0,
        problems: [{ code: "DRIFT", message: "Defter bakiyesi ürün stoğundan farklı", product_id: 10, sku: "FZK-000010", movement_id: null, expected: 48, actual: 50 }],
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Denetimi gizle" }));
    await userEvent.click(screen.getByRole("button", { name: "Defteri denetle" }));
    expect(screen.getByText("1 üründe sapma")).toBeInTheDocument();
    expect(screen.getByText(/sonraki sayfalar da denetlenmeli/)).toBeInTheDocument();
    expect(screen.getByText(/Defter bakiyesi ürün stoğundan farklı/)).toBeInTheDocument();
    const yuzey2 = screen.getByRole("region", { name: "Defter denetimi" });
    expect(within(yuzey2).getByText("48")).toBeInTheDocument();
    expect(within(yuzey2).getByText("50")).toBeInTheDocument();

    const refetch = vi.fn();
    mockDenetim.mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch }));
    await userEvent.click(screen.getByRole("button", { name: "Denetimi gizle" }));
    await userEvent.click(screen.getByRole("button", { name: "Defteri denetle" }));
    expect(screen.getByText("Denetim çalıştırılamadı")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("region", { name: "Defter denetimi" })).getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("filtresiz boş ile filtreli boş ayrılır; Süzgeçleri temizle URL'yi boşaltır", async () => {
    mockListe.mockReturnValue(sonuc({ rows: [], total: 0, limit: 25, offset: 0 }));
    const ilk = kur();
    expect(screen.getByText("Henüz stok hareketi yok")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Süzgeçleri temizle" })).not.toBeInTheDocument();
    ilk.unmount();

    kur("/yonetim-yeni/urunler/stok-hareketleri?aktor=ADMIN");
    expect(screen.getByText("Bu süzgeçlerle hareket bulunamadı")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Süzgeçleri temizle" }));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent(""));
    expect(sonSorgu().actor_type).toBeUndefined();
  });

  it("hata boş durum gibi gösterilmez; Tekrar dene refetch çağırır", async () => {
    const refetch = vi.fn();
    mockListe.mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch }));
    kur();
    expect(screen.getByText(/Stok hareketleri yüklenemedi/)).toBeInTheDocument();
    expect(screen.queryByText("Henüz stok hareketi yok")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("menü öğesi yeni rotaya bağlı ve products izni ister", () => {
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewStockMovements)).toEqual({ label: "Stok Hareketleri", requiredPermission: "products" });
  });
});
