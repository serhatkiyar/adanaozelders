import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { IadeListesi } from "@/panel/pages/siparisler/IadeListesi";
import { useAdminReturns, useResolveReturn } from "@/hooks/useStore";
import { useAuthStore } from "@/store/authStore";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import type { OrderReturn } from "@/types";
import { PATHS } from "@/lib/routes";
import { PANEL_MENU, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";

vi.mock("@/hooks/useStore", () => ({ useAdminReturns: vi.fn(), useResolveReturn: vi.fn() }));

const mockListe = vi.mocked(useAdminReturns);
const mutate = vi.fn();
const mutateAsync = vi.fn();
let git: (yol: string) => void = () => {};

const IADE = {
  id: 5, order_id: 42, type: "AYIPLI", status: "PENDING", reason: "Kapak yırtık geldi", admin_note: null,
  created_at: "2026-09-10T10:00:00Z", resolved_at: null, refund_status: "NONE", refund_amount: "0", is_partial: false, items: [],
  order: { id: 42, order_no: "SP-42", total: "250.00", ship_recipient: "Ayşe Yılmaz", ship_address: "Seyhan/Adana" },
} as unknown as OrderReturn;

function Konum() {
  git = useNavigate();
  return <output data-testid="konum">{useLocation().search}</output>;
}

function veri(rows: OrderReturn[] | undefined, ek: object = {}) {
  mockListe.mockReturnValue({ data: rows, isPending: false, isSuccess: rows !== undefined, isError: false, error: null, refetch: vi.fn(), ...ek } as never);
}

function izin(...perms: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: perms } as never });
}

const YOL = PATHS.adminNewReturns;
function kur(baslangic: string = YOL) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[baslangic]}>
          <Routes>
            <Route path={YOL} element={<><IadeListesi /><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

async function detayAc() {
  await userEvent.click(screen.getByText("Kapak yırtık geldi"));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  mutate.mockReset();
  mutateAsync.mockReset().mockResolvedValue({});
  veri([IADE]);
  vi.mocked(useResolveReturn).mockReturnValue({ mutate, mutateAsync, isPending: false } as never);
  izin("returns.view", "returns.manage");
});

describe("IadeListesi", () => {
  it("satır sipariş/tutar/tür/durum basar; tıklama ayrıntı çekmecesini açar", async () => {
    kur();
    expect(screen.getByRole("heading", { name: "İadeler" })).toBeInTheDocument();
    expect(screen.getByText("Sipariş #42")).toBeInTheDocument();
    expect(screen.getByText(/250 TL · Ayşe Yılmaz/)).toBeInTheDocument();
    expect(screen.getByText("Ayıplı ürün")).toBeInTheDocument();
    expect(screen.getByText("Bekliyor")).toBeInTheDocument();
    const pencere = await detayAc();
    expect(within(pencere).getByText("Müşteri gerekçesi")).toBeInTheDocument();
    expect(within(pencere).getByText("Ayşe Yılmaz: Seyhan/Adana")).toBeInTheDocument();
    expect(within(pencere).getByRole("button", { name: "Onayla & iade et" })).toBeInTheDocument();
    expect(within(pencere).getByRole("button", { name: "Reddet" })).toBeInTheDocument();
  });

  it("durum süzgeci: varsayılan PENDING, uydurma değer elenir, seçim URL'ye ve hook'a gider", async () => {
    kur("/yonetim-yeni/siparisler/iadeler?durum=UYDURMA");
    expect(mockListe).toHaveBeenLastCalledWith("PENDING");
    await userEvent.click(screen.getByRole("button", { name: "Filtre" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Durum" }));
    await userEvent.click(await screen.findByTitle("Tümü"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("?durum=hepsi"));
    expect(mockListe).toHaveBeenLastCalledWith(undefined);
    await userEvent.click(screen.getByRole("button", { name: "Filtre" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Durum" }));
    await userEvent.click(await screen.findByTitle("Reddedilenler"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("?durum=REJECTED"));
    expect(mockListe).toHaveBeenLastCalledWith("REJECTED");
  });

  it("rota ve menü: Siparişler kök grup, çocuklar ikas sırasında + İadeler; seçili/açık anahtarlar doğru", () => {
    const grup = PANEL_MENU.find((m) => m.key === "siparisler");
    expect(grup?.path).toBeUndefined();
    expect(grup?.requiredPermission).toBeUndefined();
    expect(grup?.icon).toBe("container");
    expect(grup?.children?.map((c) => c.label)).toEqual(["Siparişler", "Taslaklar", "Terk Edilmiş Sepetler", "Etiketler", "Hediye Kartları", "İadeler"]);
    expect(grup?.children?.filter((c) => c.path).map((c) => [c.path, c.requiredPermission])).toEqual([
      [PATHS.adminNewOrders, "orders"],
      [PATHS.adminNewReturns, "returns"],
    ]);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewReturns)).toEqual({ label: "İadeler", requiredPermission: "returns" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewReturns)).toEqual({ selectedKey: "iadeler", openKeys: ["siparisler"] });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewOrders)).toEqual({ selectedKey: "siparis-listesi", openKeys: ["siparisler"] });
  });

  it("harici URL değişimi (geri/ileri) süzgeci ve hook'u URL'e döndürür", async () => {
    kur();
    expect(mockListe).toHaveBeenLastCalledWith("PENDING");
    act(() => git(`${YOL}?durum=APPROVED`));
    await waitFor(() => expect(mockListe).toHaveBeenLastCalledWith("APPROVED"));
    act(() => git(YOL));
    await waitFor(() => expect(mockListe).toHaveBeenLastCalledWith("PENDING"));
  });

  it("sayfa boyutu 20 ile başlar; veri azalınca etkin sayfa geçerli son sayfaya çekilir", async () => {
    const cok = Array.from({ length: 25 }, (_, i) => ({ ...IADE, id: 100 + i, order_id: 1000 + i, reason: `G${i}` }));
    veri(cok);
    const { rerender } = kur();
    expect(screen.getByText("1 - 20 / 25 Talep")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("2"));
    expect(await screen.findByText("21 - 25 / 25 Talep")).toBeInTheDocument();
    veri(cok.slice(0, 5));
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PanelProvider>
          <MemoryRouter initialEntries={[YOL]}>
            <Routes>
              <Route path={YOL} element={<><IadeListesi /><Konum /></>} />
            </Routes>
          </MemoryRouter>
        </PanelProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("1 - 5 / 5 Talep")).toBeInTheDocument();
    expect(screen.getByText("G0")).toBeInTheDocument();
    expect(screen.queryByText("Bekleyen iade talebi yok")).not.toBeInTheDocument();
  });

  it("salt okunur açıklaması dolu, boş ve hata durumlarında görünür", () => {
    izin("returns.view");
    const dolu = kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    dolu.unmount();
    veri([]);
    const bos = kur();
    expect(screen.getByText("Bekleyen iade talebi yok")).toBeInTheDocument();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    bos.unmount();
    veri(undefined, { isError: true, error: new Error("x"), refetch: vi.fn() });
    kur();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
  });

  it("onay: başarıda approve gövdesiyle gider ve ayrıntı kapanır; hatada onay penceresi açık kalır; çift gönderim yok", async () => {
    kur();
    const pencere = await detayAc();
    await userEvent.click(within(pencere).getByRole("button", { name: "Onayla & iade et" }));
    expect(await screen.findByText("Müşteriye ödeme iadesi yapılacak ve ürün stoğu geri yüklenecek.")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();

    mutateAsync.mockRejectedValueOnce({ response: { data: { detail: "Ödeme sağlayıcı yanıt vermedi" } } });
    await userEvent.click(screen.getByRole("button", { name: "Onayla ve iade et" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: 5, action: "approve" }));
    expect(await screen.findByText("Ödeme sağlayıcı yanıt vermedi")).toBeInTheDocument();
    // Onay penceresi ve ayrıntı açık kaldı.
    const onayDugmesi = await screen.findByRole("button", { name: /Onayla ve iade et/ });
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();

    await waitFor(() => expect(onayDugmesi).not.toHaveClass("ant-btn-loading"));
    await userEvent.click(onayDugmesi);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
  });

  it("onay sürerken karar düğmeleri kilitli: yeni onay penceresi açılmaz, istek atılmaz", async () => {
    vi.mocked(useResolveReturn).mockReturnValue({ mutate, mutateAsync, isPending: true } as never);
    kur();
    const pencere = await detayAc();
    await userEvent.click(within(pencere).getByRole("button", { name: /Onayla & iade et/ }));
    await userEvent.click(within(pencere).getByRole("button", { name: /Reddet/ }));
    expect(screen.queryByText("Müşteriye ödeme iadesi yapılacak ve ürün stoğu geri yüklenecek.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Red gerekçesi")).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("red: boş not null gider ve pencereler kapanır; dolu not adminNote olarak gider; kirli kapatma onay ister", async () => {
    kur();
    const detay = await detayAc();
    await userEvent.click(within(detay).getByRole("button", { name: "Reddet" }));
    await screen.findByLabelText("Red gerekçesi");
    await userEvent.click(screen.getByRole("button", { name: "Talebi reddet" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: 5, action: "reject", adminNote: null }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());

    await detayAc();
    await userEvent.click(screen.getAllByRole("button", { name: "Reddet" }).at(-1) as HTMLElement);
    const alan = (await screen.findAllByLabelText("Red gerekçesi")).at(-1) as HTMLElement;
    await userEvent.type(alan, "Kullanım hatası");
    await userEvent.click(screen.getAllByRole("button", { name: "Vazgeç" }).at(-1) as HTMLElement);
    expect((await screen.findAllByText("Yazdıklarınız kaybolacak")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole("button", { name: "Düzenlemeye devam et" }).at(-1) as HTMLElement);
    expect(alan).toHaveValue("Kullanım hatası");
    await userEvent.click(screen.getAllByRole("button", { name: "Talebi reddet" }).at(-1) as HTMLElement);
    await waitFor(() => expect(mutateAsync).toHaveBeenLastCalledWith({ id: 5, action: "reject", adminNote: "Kullanım hatası" }));
  });

  it("red hatası: pencere açık kalır, not korunur, sunucu hatası gösterilir; sürerken ikinci gönderim yok", async () => {
    mutateAsync.mockRejectedValueOnce({ response: { data: { detail: "Talep zaten karara bağlandı" } } });
    kur();
    const detay = await detayAc();
    await userEvent.click(within(detay).getByRole("button", { name: "Reddet" }));
    const alan = await screen.findByLabelText("Red gerekçesi");
    await userEvent.type(alan, "Süre geçmiş");
    await userEvent.click(screen.getByRole("button", { name: "Talebi reddet" }));
    expect(await screen.findByText("Talep zaten karara bağlandı")).toBeInTheDocument();
    expect(screen.getByLabelText("Red gerekçesi")).toHaveValue("Süre geçmiş");
    expect(document.querySelectorAll(".ant-drawer-open").length).toBe(2);

    vi.mocked(useResolveReturn).mockReturnValue({ mutate, mutateAsync, isPending: true } as never);
    act(() => git(`${YOL}?durum=PENDING`));
    await userEvent.click(screen.getByRole("button", { name: /Talebi reddet/ }));
    await userEvent.click(screen.getByRole("button", { name: /Vazgeç/ }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Yazdıklarınız kaybolacak")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".ant-drawer-open").length).toBe(2);
  });

  it("karara bağlanmış talepte ve salt görüntüleme izninde karar düğmesi yok", async () => {
    veri([{ ...IADE, status: "REJECTED", admin_note: "Süre geçmiş" }]);
    const ilk = kur("/yonetim-yeni/siparisler/iadeler?durum=REJECTED");
    let pencere = await detayAc();
    expect(within(pencere).getByText("Süre geçmiş")).toBeInTheDocument();
    expect(within(pencere).queryByRole("button", { name: "Reddet" })).not.toBeInTheDocument();
    ilk.unmount();

    izin("returns.view");
    veri([IADE]);
    kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    pencere = await detayAc();
    expect(within(pencere).queryByRole("button", { name: "Onayla & iade et" })).not.toBeInTheDocument();
    expect(within(pencere).queryByRole("button", { name: "Reddet" })).not.toBeInTheDocument();
  });

  it("APPROVED kayıt salt okunur: karar düğmesi yok", async () => {
    veri([{ ...IADE, status: "APPROVED", resolved_at: "2026-09-11T09:00:00Z" }]);
    kur(`${YOL}?durum=APPROVED`);
    const pencere = await detayAc();
    expect(within(pencere).getByText("Karar tarihi")).toBeInTheDocument();
    expect(within(pencere).queryByRole("button", { name: "Onayla & iade et" })).not.toBeInTheDocument();
    expect(within(pencere).queryByRole("button", { name: "Reddet" })).not.toBeInTheDocument();
  });

  it("yükleniyor: tablo yükleniyor, boş metni çıkmaz", () => {
    veri(undefined, { isPending: true });
    kur();
    expect(screen.queryByText("Bekleyen iade talebi yok")).not.toBeInTheDocument();
    expect(document.querySelector(".ant-spin")).not.toBeNull();
  });

  it("izin yoksa erişim reddi; hook verisi tabloya çizilmez", () => {
    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("boş ayrımı: bekleyen süzgecinde ve tümünde farklı metin", () => {
    veri([]);
    const ilk = kur();
    expect(screen.getByText("Bekleyen iade talebi yok")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tümünü göster" })).toBeInTheDocument();
    ilk.unmount();
    kur("/yonetim-yeni/siparisler/iadeler?durum=hepsi");
    expect(screen.getByText("İade talebi yok")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tümünü göster" })).not.toBeInTheDocument();
  });

  it("hata: sunucu ayrıntısı basılır, boş metni çıkmaz, Tekrar dene refetch çağırır", async () => {
    const refetch = vi.fn();
    veri(undefined, { isError: true, error: { response: { data: { detail: "Sunucu kapalı" } } }, refetch });
    kur();
    expect(screen.getByText("Sunucu kapalı")).toBeInTheDocument();
    expect(screen.queryByText("Bekleyen iade talebi yok")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });
});
