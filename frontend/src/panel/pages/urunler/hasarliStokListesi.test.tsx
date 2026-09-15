import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { HasarliStokListesi } from "@/panel/pages/urunler/HasarliStokListesi";
import { useCreateDamageEvent, useDamageEvents } from "@/hooks/useInventory";
import { useAuthStore } from "@/store/authStore";
import type { DamageEventOut } from "@/api/inventory";
import { PATHS } from "@/lib/routes";
import { PANEL_MENU, rotaIzniBul } from "@/panel/layout/menu";

vi.mock("@/hooks/useInventory", () => ({ useDamageEvents: vi.fn(), useCreateDamageEvent: vi.fn() }));
vi.mock("@/hooks/useStore", () => ({
  useAdminProducts: () => ({ data: { items: [{ id: 5, title: "9. Sınıf Matematik" }], total: 1 }, isFetching: false }),
}));
vi.mock("@/hooks/useDebounce", () => ({ useDebounce: <T,>(v: T) => v }));

const mockListe = vi.mocked(useDamageEvents);
const mutate = vi.fn();

const OLAY = {
  id: 31, product_id: 5, kind: "TRANSFER", qty: 2, source_bucket: "SALEABLE", reason_code: "DIGER", note: "Kapak yırtık",
  actor_admin_id: 1, created_at: "2026-09-10T10:00:00Z", idempotency_key: "dmg-abc",
} as DamageEventOut;

let git: (yol: string) => void = () => {};
function Konum() {
  git = useNavigate();
  return <output data-testid="konum">{useLocation().search}</output>;
}

const YOL = PATHS.adminNewDamageEvents;
function kur(baslangic = YOL) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[baslangic]}>
          <Routes>
            <Route path={YOL} element={<><HasarliStokListesi /><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isSuccess: true, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const sonSorgu = () => mockListe.mock.calls.at(-1)?.[0] ?? {};
const izin = (...kodlar: string[]) =>
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: kodlar } as never });

beforeEach(() => {
  mockListe.mockReset();
  mutate.mockReset();
  mockListe.mockReturnValue(sonuc({ items: [OLAY], total: 1, limit: 25, offset: 0 }));
  vi.mocked(useCreateDamageEvent).mockReturnValue({ mutate, isPending: false } as never);
  izin("inventory.view", "inventory.apply");
});

describe("HasarliStokListesi", () => {
  it("menü öğesi yeni rotaya bağlı ve inventory izni ister", () => {
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewDamageEvents)).toEqual({ label: "Hasarlı Stok", requiredPermission: "inventory" });
  });

  it("satır işlem/ürün/miktar/kova/neden+not/yapan/zaman basar; dört işlem düğmesi vardır", () => {
    kur();
    for (const b of ["İşlem", "Ürün", "Miktar", "Kaynak kova", "Neden", "Yapan", "Zaman"]) {
      expect(screen.getByRole("columnheader", { name: b })).toBeInTheDocument();
    }
    expect(screen.getByText("Hasara ayrıldı")).toBeInTheDocument();
    expect(screen.getByText("Ürün #5")).toBeInTheDocument();
    expect(screen.getByText("Satılabilir")).toBeInTheDocument();
    expect(screen.getByText("Diğer")).toBeInTheDocument();
    expect(screen.getByText("Kapak yırtık")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    for (const ad of ["Hasara ayır", "Satılabilir duruma döndür", "İmha et", "Tedarikçiye iade et"]) {
      expect(screen.getByRole("button", { name: ad })).toBeInTheDocument();
    }
  });

  it("ürün süzgeci URL'den hook'a gider; geçersiz/negatif değer elenir; kutu URL'yi yazar ve sayfayı 1'e alır", async () => {
    kur(`${YOL}?urun=abc&sayfa=3&boyut=50`);
    expect(sonSorgu()).toMatchObject({ product_id: undefined, limit: 50, offset: 100 });
    await userEvent.click(screen.getByRole("button", { name: "Filtre" }));
    await userEvent.type(await screen.findByRole("spinbutton", { name: "Ürün numarası" }), "5");
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("urun=5"));
    expect(screen.getByTestId("konum")).not.toHaveTextContent("sayfa=");
    expect(sonSorgu()).toMatchObject({ product_id: 5, limit: 50, offset: 0 });
  });

  it("negatif ürün numarası sorguya gitmez", () => {
    kur(`${YOL}?urun=-4`);
    expect(sonSorgu().product_id).toBeUndefined();
  });

  it("sayfa ve boyut URL'de yaşar; harici URL değişimi tabloyu ve sayfalayıcıyı URL'e döndürür", async () => {
    mockListe.mockReturnValue(sonuc({ items: [OLAY], total: 120, limit: 25, offset: 0 }));
    kur();
    await userEvent.click(screen.getByTitle("2"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("sayfa=2"));
    expect(sonSorgu()).toMatchObject({ limit: 25, offset: 25 });
    // Sayfa boyutu URL'e yazılır, sayfa 1'e döner.
    await userEvent.click(screen.getByRole("combobox", { name: "Satır Adedi" }));
    await userEvent.click(await screen.findByTitle("50"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("boyut=50"));
    expect(screen.getByTestId("konum")).not.toHaveTextContent("sayfa=");
    expect(sonSorgu()).toMatchObject({ limit: 50, offset: 0 });
    // Geri/ileri gibi harici URL değişimi.
    act(() => git(`${YOL}?sayfa=2`));
    await waitFor(() => expect(sonSorgu()).toMatchObject({ limit: 25, offset: 25 }));
    expect(screen.getByText("26 - 50 / 120 Kayıt")).toBeInTheDocument();
  });

  it("filtreli boş ile filtresiz boş ayrılır; İlk kaydı oluştur çekmeceyi açar", async () => {
    mockListe.mockReturnValue(sonuc({ items: [], total: 0, limit: 25, offset: 0 }));
    const ilk = kur(`${YOL}?urun=999`);
    expect(screen.getByText("Bu filtreyle kayıt bulunamadı")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İlk kaydı oluştur" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Filtreyi temizle" }));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent(""));
    expect(sonSorgu().product_id).toBeUndefined();
    ilk.unmount();

    kur();
    expect(screen.getByText("Hasar kaydı yok")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filtreyi temizle" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "İlk kaydı oluştur" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Satılabilir raftan düşer, hasarlı rafa eklenir.");
  });

  it("yalnız inventory.view: liste var, yazma düğmeleri yok, inventory.apply açıklaması var", () => {
    izin("inventory.view");
    mockListe.mockReturnValue(sonuc({ items: [], total: 0, limit: 25, offset: 0 }));
    kur();
    expect(mockListe).toHaveBeenLastCalledWith(expect.anything(), true);
    expect(screen.queryByRole("button", { name: "Hasara ayır" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İlk kaydı oluştur" })).not.toBeInTheDocument();
    expect(screen.getByText("Hasar kaydı yok")).toBeInTheDocument();
    expect(screen.getByText(/inventory\.apply izni bulunmalı/)).toBeInTheDocument();
  });

  it("inventory.view yoksa AccessDenied basılır ve sorgu kapalıdır", () => {
    izin("products.view");
    kur();
    expect(screen.getByText("Bu alan için yetkiniz yok")).toBeInTheDocument();
    expect(mockListe).toHaveBeenLastCalledWith(expect.anything(), false);
    expect(screen.queryByRole("heading", { name: "Hasarlı Stok" })).not.toBeInTheDocument();
  });

  it("sunucu 422 qty hatası Miktar alanında; bilinmeyen alan ve genel hata Alert'te; anahtar hata sonrası değişmez", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Hasara ayır" }));
    const cekmece = await screen.findByRole("dialog");
    await userEvent.type(within(cekmece).getByRole("combobox", { name: "Ürünler" }), "mat");
    await userEvent.click(await screen.findByTitle("9. Sınıf Matematik"));
    await userEvent.type(within(cekmece).getByRole("spinbutton", { name: "Miktar" }), "3");
    await userEvent.click(within(cekmece).getByRole("combobox", { name: "Neden" }));
    await userEvent.click(await screen.findByTitle("Kırık"));

    await userEvent.click(within(cekmece).getByRole("button", { name: "Hasara ayır" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const anahtar = mutate.mock.calls[0][0].idempotency_key;
    act(() =>
      mutate.mock.calls[0][1].onError({
        response: { status: 422, data: { detail: [
          { loc: ["body", "qty"], msg: "Stoktan fazla miktar" },
          { loc: ["body", "bilinmeyen_alan"], msg: "Ek kural ihlali" },
        ] } },
      }),
    );
    expect(await within(cekmece).findByText("Stoktan fazla miktar")).toBeInTheDocument();
    expect(within(cekmece).getByRole("alert")).toHaveTextContent("Ek kural ihlali");

    await userEvent.click(within(cekmece).getByRole("button", { name: "Hasara ayır" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(mutate.mock.calls[1][0].idempotency_key).toBe(anahtar);
    act(() => mutate.mock.calls[1][1].onError({ response: { status: 500 } }));
    expect(await within(cekmece).findByRole("alert")).toHaveTextContent(/Sunucu hatası/);
  });

  it("hata boş durum gibi gösterilmez; Tekrar dene refetch çağırır", async () => {
    const refetch = vi.fn();
    mockListe.mockReturnValue(sonuc(undefined, { isSuccess: false, isError: true, error: { response: { status: 500 } }, refetch }));
    kur();
    expect(screen.getByRole("alert")).toHaveTextContent(/Sunucu hatası/);
    expect(screen.queryByText("Hasar kaydı yok")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("boş gönderim istek atmaz ve hatalar alanda çıkar; dolu form doğru gövde ve sabit anahtarla gider", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Hasara ayır" }));
    const cekmece = await screen.findByRole("dialog");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Hasara ayır" }));
    expect(await within(cekmece).findByText("Ürün seçilmeden işlem yapılamaz.")).toBeInTheDocument();
    expect(within(cekmece).getByText("Miktar sıfırdan büyük bir tam sayı olmalı.")).toBeInTheDocument();
    expect(within(cekmece).getByText("Neden seçmeden işlem yapılamaz.")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.type(within(cekmece).getByRole("combobox", { name: "Ürünler" }), "mat");
    await userEvent.click(await screen.findByTitle("9. Sınıf Matematik"));
    await userEvent.type(within(cekmece).getByRole("spinbutton", { name: "Miktar" }), "3");
    await userEvent.click(within(cekmece).getByRole("combobox", { name: "Neden" }));
    await userEvent.click(await screen.findByTitle("Kırık"));
    expect(within(cekmece).getByTestId("hasar-etki")).toHaveTextContent("Satılabilir raf −3, Hasarlı raf +3.");

    await userEvent.click(within(cekmece).getByRole("button", { name: "Hasara ayır" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toEqual({
      product_id: 5, kind: "TRANSFER", qty: 3, reason_code: "KIRIK", note: null, idempotency_key: expect.stringMatching(/^ui-/),
    });
  });

  it("imha onay kutusu işaretlenmeden gönderim yapılmaz; hata alanda çıkar", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "İmha et" }));
    const cekmece = await screen.findByRole("dialog");
    await userEvent.type(within(cekmece).getByRole("combobox", { name: "Ürünler" }), "mat");
    await userEvent.click(await screen.findByTitle("9. Sınıf Matematik"));
    await userEvent.type(within(cekmece).getByRole("spinbutton", { name: "Miktar" }), "1");
    await userEvent.click(within(cekmece).getByRole("combobox", { name: "Neden" }));
    await userEvent.click(await screen.findByTitle("Kırık"));
    await userEvent.click(within(cekmece).getByRole("button", { name: "İmha et" }));
    expect(await within(cekmece).findByText("Devam etmek için bu kutuyu işaretleyin.")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    await userEvent.click(within(cekmece).getByRole("checkbox"));
    await userEvent.click(within(cekmece).getByRole("button", { name: "İmha et" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({ kind: "DISPOSAL", qty: 1 });
  });
});
