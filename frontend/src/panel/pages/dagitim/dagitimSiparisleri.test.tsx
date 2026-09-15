import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { DagitimSiparisleri, acikTurlar, kuyrukNo } from "@/panel/pages/dagitim/DagitimSiparisleri";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { todayIso } from "@/components/admin/delivery/bits";
import { useAddStops, useDeliveryRuns, useEligibleOrders, useOutsourcedOrders, usePrepQueue } from "@/hooks/useDelivery";
import { shipOrder } from "@/api/store";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { DeliveryEligibleOrder, DeliveryRun } from "@/types";

vi.mock("@/hooks/useDelivery", () => ({
  usePrepQueue: vi.fn(),
  useEligibleOrders: vi.fn(),
  useOutsourcedOrders: vi.fn(),
  useDeliveryRuns: vi.fn(),
  useAddStops: vi.fn(),
}));
vi.mock("@/api/store", () => ({ shipOrder: vi.fn() }));

const ekle = vi.fn();
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
const ertelenmis = () => new Promise((res, rej) => { sozler.push({ res, rej }); });

const siparis = (ek: Partial<DeliveryEligibleOrder> = {}): DeliveryEligibleOrder => ({
  order_id: 501, recipient: "Ayşe Yılmaz", address: "Atatürk Cad. 5", total: "150.00", item_count: 3, created_at: "2026-09-10T10:00:00Z", lat: 37, lng: 35,
  promised_delivery_date: "2099-01-01", items: [{ title: "9. Sınıf Matematik", quantity: 2 }, { title: "Deneme Seti", quantity: 1 }], ...ek,
});
const HAZIRLIK = [siparis(), siparis({ order_id: 502, recipient: null, address: null, items: [], item_count: 0, lat: null })];
const HAZIR = [siparis({ order_id: 601 }), siparis({ order_id: 602, recipient: "Veli Demir" })];
const DIS = [siparis({ order_id: 701, district: "Ceyhan", city: "Adana" }), siparis({ order_id: 702, district: null, city: null })];
const tur = (ek: Partial<DeliveryRun> = {}): DeliveryRun => ({ id: 1, run_date: todayIso(), vehicle_id: 10, vehicle: "Lada", status: "PLANNED", created_at: "", depot_lat: null, depot_lng: null, courier: null, stops: [], ...ek }) as DeliveryRun;
const TURLAR = [tur({ id: 9, status: "DONE" }), tur({ id: 11, status: "PLANNED" }), tur({ id: 12, status: "ACTIVE", vehicle: "Fiat" }), tur({ id: 13, status: "CANCELLED" })];

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const son = (h: unknown) => vi.mocked(h as () => unknown).mock.calls.at(-1);

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}
function Konum() {
  const nav = useNavigate();
  return (
    <>
      <output data-testid="konum">{`${useLocation().pathname}${useLocation().search}`}</output>
      <button onClick={() => nav(-1)}>geri</button>
      <button onClick={() => nav(1)}>ileri</button>
    </>
  );
}
function agac(yol = PATHS.adminNewDeliveryOrders) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewDeliveryOrders} element={<><DagitimSiparisleri /><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = (yol?: string) => render(agac(yol));
const secili = () => (document.querySelector(".ant-segmented-item-selected") as HTMLElement | null)?.textContent;
// AntD yükleniyor simgesi jsdom'da erişilebilir ada "loading" ekler; düğmeler ad sonuna göre eşlenir.
const sekme = (ad: RegExp) => screen.getByRole("radio", { name: ad });

beforeEach(() => {
  ekle.mockReset().mockImplementation(ertelenmis);
  vi.mocked(shipOrder).mockReset().mockImplementation(ertelenmis as never);
  sozler.length = 0;
  vi.mocked(usePrepQueue).mockReset().mockReturnValue(sonuc(HAZIRLIK));
  vi.mocked(useEligibleOrders).mockReset().mockReturnValue(sonuc(HAZIR));
  vi.mocked(useOutsourcedOrders).mockReset().mockReturnValue(sonuc(DIS));
  vi.mocked(useDeliveryRuns).mockReset().mockReturnValue(sonuc(TURLAR));
  vi.mocked(useAddStops).mockReturnValue({ mutateAsync: ekle, isPending: false } as never);
  izin("delivery.view", "delivery.manage", "orders.view", "orders.manage");
});

describe("saf kurallar", () => {
  it("kuyrukNo beyaz liste; acikTurlar yalnız PLANNED/ACTIVE", () => {
    expect(kuyrukNo("hazir")).toBe("hazir");
    expect(kuyrukNo("dis-kargo")).toBe("dis-kargo");
    for (const h of [null, "", "hazirlik", "constructor", "__proto__", "HAZIR", "x"]) expect(kuyrukNo(h)).toBe("hazirlik");
    expect(acikTurlar(TURLAR).map((r) => r.id)).toEqual([11, 12]);
    expect(acikTurlar(undefined)).toEqual([]);
  });
});

describe("DagitimSiparisleri", () => {
  it("delivery.view yokken AccessDenied ve üç sorgu kapalı", () => {
    izin("orders.manage");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(usePrepQueue)).toEqual([false]);
    expect(son(useEligibleOrders)).toEqual([false]);
    expect(son(useOutsourcedOrders)).toEqual([false]);
    expect(vi.mocked(useDeliveryRuns)).not.toHaveBeenCalled();
  });

  it("üç kuyruk adetli sekmeler; URL beyaz liste, değişim push, geri/ileri eşler; hata/yükleme sahte 0 değil", async () => {
    kur(`${PATHS.adminNewDeliveryOrders}?kuyruk=constructor`);
    expect(screen.getByRole("heading", { name: "Siparişler" })).toBeInTheDocument();
    expect(secili()).toBe("Paketlenecek (2)");
    expect(sekme(/Tura hazır \(2\)/)).toBeInTheDocument();
    expect(sekme(/Dış kargo \(2\)/)).toBeInTheDocument();
    expect(screen.getByTestId("siparis-501")).toBeInTheDocument();
    fireEvent.click(sekme(/Tura hazır/));
    expect(screen.getByTestId("konum")).toHaveTextContent("kuyruk=hazir");
    expect(screen.getByTestId("siparis-601")).toBeInTheDocument();
    fireEvent.click(sekme(/Dış kargo/));
    expect(screen.getByTestId("konum")).toHaveTextContent("kuyruk=dis-kargo");
    expect(screen.getByTestId("siparis-701")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "geri" }));
    await waitFor(() => expect(secili()).toBe("Tura hazır (2)"));
    expect(screen.getByTestId("siparis-601")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ileri" }));
    await waitFor(() => expect(secili()).toBe("Dış kargo (2)"));
    // Üç sorgu da kuyruktan bağımsız çağrılır.
    expect(son(usePrepQueue)).toEqual([true]);
    expect(son(useEligibleOrders)).toEqual([true]);
    expect(son(useOutsourcedOrders)).toEqual([true]);
  });

  it("adetler: yükleniyor ve hata sahte 0 göstermez", () => {
    vi.mocked(useEligibleOrders).mockReturnValue(sonuc(undefined, { isPending: true }));
    vi.mocked(useOutsourcedOrders).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x") }));
    kur();
    expect(sekme(/Tura hazır \(…\)/)).toBeInTheDocument();
    expect(sekme(/Dış kargo \(!\)/)).toBeInTheDocument();
    expect(screen.queryByText(/\(0\)/)).not.toBeInTheDocument();
  });

  it("Paketlenecek: satır alanları, ItemLines, konumsuz rozeti, sipariş bağlantısı, yeni paketleme bağlantısı; iç içe a/button yok; hazırlama düğmesi yok", () => {
    kur();
    const a = within(screen.getByTestId("siparis-501"));
    expect(a.getByText("Ayşe Yılmaz")).toBeInTheDocument();
    expect(a.getByRole("link", { name: "#501" })).toHaveAttribute("href", ROUTES.adminNewOrder(501));
    expect(a.getByText("Atatürk Cad. 5")).toBeInTheDocument();
    expect(a.getByText(/Söz:/)).toBeInTheDocument();
    expect(a.getByText(/9\. Sınıf Matematik/)).toBeInTheDocument();
    expect(a.getByText(/Deneme Seti/)).toBeInTheDocument();
    expect(a.getByText(/3 parça · /)).toBeInTheDocument();
    expect(a.queryByText("konumsuz")).not.toBeInTheDocument();
    const b = within(screen.getByTestId("siparis-502"));
    expect(b.getByText("-")).toBeInTheDocument();
    expect(b.getByText("Adres yok")).toBeInTheDocument();
    expect(b.getByText("konumsuz")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Paketleme istasyonunu aç →" })).toHaveAttribute("href", ROUTES.adminNewPacking);
    for (const ad of [/Hazırla/, /Tümünü hazırla/, /Geri al/, /Tura ekle/, /Kargola/]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    expect(document.querySelectorAll("a button, button a, a a, button button")).toHaveLength(0);
  });

  it("Tura hazır: açık tur seçimi (yalnız PLANNED/ACTIVE), tek/toplu payload, aynı tick ve ayrı kilitler, hata görünür + yeniden deneme, başarı", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    kur(`${PATHS.adminNewDeliveryOrders}?kuyruk=hazir`);
    expect(son(useDeliveryRuns)).toEqual([todayIso(), true]);
    await u.click(screen.getByRole("combobox", { name: "Hedef tur" }));
    await screen.findAllByRole("option");
    expect([...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content")].map((o) => o.textContent)).toEqual(["Tur #11 · Lada", "Tur #12 · Fiat"]);
    await u.click(screen.getByTitle("Tur #12 · Fiat"));
    const tek = within(screen.getByTestId("siparis-601")).getByRole("button", { name: /Tura ekle$/ });
    fireEvent.click(tek);
    fireEvent.click(tek);
    expect(ekle).toHaveBeenCalledTimes(1);
    expect(ekle).toHaveBeenCalledWith({ runId: 12, orderIds: [601] });
    // 601 uçuştayken onu kapsayan toplu istek çıkmaz; başka satır (602) serbesttir.
    fireEvent.click(screen.getByRole("button", { name: /Tümünü ekle$/ }));
    expect(ekle).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByTestId("siparis-602")).getByRole("button", { name: /Tura ekle$/ }));
    expect(ekle).toHaveBeenCalledTimes(2);
    expect(ekle).toHaveBeenLastCalledWith({ runId: 12, orderIds: [602] });
    // 601 hata: yalnız o satırda görünür; 602 başarı.
    await act(async () => { sozler.shift()!.rej({ response: { status: 409, data: { detail: "Sipariş zaten turda" } } }); await Promise.resolve(); });
    expect(await within(screen.getByTestId("siparis-601")).findByRole("alert")).toHaveTextContent("Sipariş zaten turda");
    expect(within(screen.getByTestId("siparis-602")).queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { sozler.shift()!.res([]); await Promise.resolve(); });
    expect(await screen.findByText("Sipariş tura eklendi.")).toBeInTheDocument();
    // Uçuş bitti: toplu ekleme artık her ikisini gönderir; çift tık tek istek; toplu hata liste üstünde, 601 hatası korunur.
    fireEvent.click(screen.getByRole("button", { name: /Tümünü ekle$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tümünü ekle$/ }));
    expect(ekle).toHaveBeenCalledTimes(3);
    expect(ekle).toHaveBeenLastCalledWith({ runId: 12, orderIds: [601, 602] });
    await act(async () => { sozler.shift()!.rej({ response: { status: 500, data: { detail: "Toplu ekleme başarısız" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Toplu ekleme başarısız")).toBeInTheDocument();
    expect(within(screen.getByTestId("siparis-601")).getByRole("alert")).toHaveTextContent("Sipariş zaten turda");
    // Hata sonrası yeniden deneme (tek), başarı.
    fireEvent.click(within(screen.getByTestId("siparis-601")).getByRole("button", { name: /Tura ekle$/ }));
    expect(ekle).toHaveBeenCalledTimes(4);
    await act(async () => { sozler.shift()!.res([]); await Promise.resolve(); });
    await waitFor(() => expect(within(screen.getByTestId("siparis-601")).queryByRole("alert")).not.toBeInTheDocument());
    expect((await screen.findAllByText("Sipariş tura eklendi.")).length).toBeGreaterThan(0);
  });

  it("Tura hazır: bayat hedef seçimi sunucuya gitmez, ilk açık tura düşer", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    const { rerender } = kur(`${PATHS.adminNewDeliveryOrders}?kuyruk=hazir`);
    await u.click(screen.getByRole("combobox", { name: "Hedef tur" }));
    await u.click(await screen.findByTitle("Tur #12 · Fiat"));
    vi.mocked(useDeliveryRuns).mockReturnValue(sonuc([tur({ id: 11, status: "PLANNED" }), tur({ id: 12, status: "DONE", vehicle: "Fiat" })]));
    rerender(agac(`${PATHS.adminNewDeliveryOrders}?kuyruk=hazir`));
    fireEvent.click(within(screen.getByTestId("siparis-601")).getByRole("button", { name: /Tura ekle$/ }));
    expect(ekle).toHaveBeenCalledWith({ runId: 11, orderIds: [601] });
  });

  it("Tura hazır: açık tur yoksa Bugün bağlantısı ve kapalı düğme; turlar hatası kendi Tekrar dene'siyle; view-only'de yazma yüzeyi ve tur sorgusu yok", async () => {
    vi.mocked(useDeliveryRuns).mockReturnValue(sonuc([tur({ id: 9, status: "DONE" })]));
    const a = kur(`${PATHS.adminNewDeliveryOrders}?kuyruk=hazir`);
    expect(screen.getByRole("link", { name: "Bugün ekranından" })).toHaveAttribute("href", ROUTES.adminNewDelivery);
    const dugme = within(screen.getByTestId("siparis-601")).getByRole("button", { name: /Tura ekle$/ });
    expect(dugme).toBeDisabled();
    fireEvent.click(dugme);
    expect(ekle).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Tümünü ekle$/ })).not.toBeInTheDocument();
    a.unmount();
    const refetch = vi.fn();
    vi.mocked(useDeliveryRuns).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch }));
    const b = kur(`${PATHS.adminNewDeliveryOrders}?kuyruk=hazir`);
    expect(screen.getByText("Bugünün turları yüklenemedi.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("siparis-601")).toBeInTheDocument();
    b.unmount();
    izin("delivery.view", "orders.manage");
    kur(`${PATHS.adminNewDeliveryOrders}?kuyruk=hazir`);
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getByTestId("siparis-601")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tura ekle|Tümünü ekle/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Hedef tur" })).not.toBeInTheDocument();
    expect(son(useDeliveryRuns)).toEqual([todayIso(), false]);
  });

  it("Dış kargo: ayrı orders.manage kapısı; delivery.manage vermez; izinsizde sipariş detayı bağlantısı", () => {
    izin("delivery.view", "delivery.manage");
    kur(`${PATHS.adminNewDeliveryOrders}?kuyruk=dis-kargo`);
    expect(screen.queryByRole("button", { name: /Kargola$/ })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("siparis-701")).getByRole("link", { name: "Sipariş detayında aç →" })).toHaveAttribute("href", ROUTES.adminNewOrder(701));
    expect(within(screen.getByTestId("siparis-701")).getByText("Ceyhan / Adana")).toBeInTheDocument();
    expect(within(screen.getByTestId("siparis-702")).queryByText(/\//)).not.toBeInTheDocument();
    expect(screen.queryByText(/Salt okunur görünüm/)).not.toBeInTheDocument();
  });

  it("Dış kargo: boş takip alan hatası + odak, trim payload, satır bazlı kilit, aynı tick, hata satırda ve değer korunur, yeniden deneme, başarı", async () => {
    kur(`${PATHS.adminNewDeliveryOrders}?kuyruk=dis-kargo`);
    const s1 = within(screen.getByTestId("siparis-701"));
    const s2 = within(screen.getByTestId("siparis-702"));
    fireEvent.click(s1.getByRole("button", { name: /Kargola$/ }));
    expect(vi.mocked(shipOrder)).not.toHaveBeenCalled();
    expect(s1.getByRole("alert")).toHaveTextContent("Takip numarası girin.");
    expect(s1.getByLabelText("#701 kargo takip numarası")).toHaveFocus();
    fireEvent.change(s1.getByLabelText("#701 kargo takip numarası"), { target: { value: "  ABC123  " } });
    expect(s1.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(s1.getByRole("button", { name: /Kargola$/ }));
    fireEvent.click(s1.getByRole("button", { name: /Kargola$/ }));
    // Gerçek useMutation: mutationFn bir mikro görev sonra koşar; aynı tick iki tık yine tek istek.
    await waitFor(() => expect(vi.mocked(shipOrder)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(shipOrder)).toHaveBeenCalledWith(701, "ABC123");
    // Diğer satır kilitlenmez.
    fireEvent.change(s2.getByLabelText("#702 kargo takip numarası"), { target: { value: "XYZ" } });
    fireEvent.click(s2.getByRole("button", { name: /Kargola$/ }));
    await waitFor(() => expect(vi.mocked(shipOrder)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(shipOrder)).toHaveBeenLastCalledWith(702, "XYZ");
    await act(async () => { sozler.shift()!.rej({ response: { status: 409, data: { detail: "Sipariş zaten kargoda" } } }); await Promise.resolve(); });
    expect(await s1.findByRole("alert")).toHaveTextContent("Sipariş zaten kargoda");
    expect(s1.getByLabelText("#701 kargo takip numarası")).toHaveValue("  ABC123  ");
    expect(s2.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(s1.getByRole("button", { name: /Kargola$/ }));
    await waitFor(() => expect(vi.mocked(shipOrder)).toHaveBeenCalledTimes(3));
    expect(vi.mocked(shipOrder)).toHaveBeenLastCalledWith(701, "ABC123");
    await act(async () => { sozler.shift()!.res({ id: 702 }); await Promise.resolve(); });
    expect(await screen.findByText("#702 kargolandı.")).toBeInTheDocument();
    await act(async () => { sozler.shift()!.res({ id: 701 }); await Promise.resolve(); });
    expect(await screen.findByText("#701 kargolandı.")).toBeInTheDocument();
  });

  it("kuyrukların bağımsız yükleniyor/hata/boş durumları; bir kuyruğun hatası diğerini bloklamaz", async () => {
    const refetch = vi.fn();
    vi.mocked(usePrepQueue).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Havuz çöktü" } } }, refetch }));
    vi.mocked(useEligibleOrders).mockReturnValue(sonuc(undefined, { isPending: true }));
    vi.mocked(useOutsourcedOrders).mockReturnValue(sonuc([]));
    kur();
    expect(screen.getByText("Havuz çöktü")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    fireEvent.click(sekme(/Tura hazır/));
    expect(screen.getByText("Kuyruk yükleniyor…")).toBeInTheDocument();
    fireEvent.click(sekme(/Dış kargo/));
    expect(screen.getByText("Dış kargo bekleyen sipariş yok")).toBeInTheDocument();
  });

  it("rota, menü yaprağı, izin, selectedKey/openKeys", () => {
    expect(PATHS.adminNewDeliveryOrders).toBe("/yonetim-yeni/dagitim/siparisler");
    expect(ROUTES.adminNewDeliveryOrders).toBe(PATHS.adminNewDeliveryOrders);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryOrders)).toMatchObject({ label: "Siparişler", requiredPermission: "delivery" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewDeliveryOrders)).toEqual({ selectedKey: "dagitim-siparisler", openKeys: ["dagitim"] });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewDelivery)).toEqual({ selectedKey: "dagitim-bugun", openKeys: ["dagitim"] });
    expect(izinBeyaniniKarsilarMi(["delivery.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryOrders)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryOrders)!)).toBe(false);
  });
});
