import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { DagitimBugun, konumMetni, tarihNo, turlariSirala } from "@/panel/pages/dagitim/DagitimBugun";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { todayIso } from "@/components/admin/delivery/bits";
import {
  useAttentionOrders,
  useCapacityOverview,
  useCreateDeliveryRun,
  useDeliveryRuns,
  useDispatchDay,
  useEligibleOrders,
  useRetryExhausted,
  useRoutingHealth,
  useRunPosition,
  useVehicles,
} from "@/hooks/useDelivery";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { DeliveryEligibleOrder, DeliveryRun, Vehicle } from "@/types";

vi.mock("@/hooks/useDelivery", () => ({
  useAttentionOrders: vi.fn(),
  useCapacityOverview: vi.fn(),
  useCreateDeliveryRun: vi.fn(),
  useDeliveryRuns: vi.fn(),
  useDispatchDay: vi.fn(),
  useEligibleOrders: vi.fn(),
  useRetryExhausted: vi.fn(),
  useRoutingHealth: vi.fn(),
  useRunPosition: vi.fn(),
  useVehicles: vi.fn(),
}));

const retry = vi.fn();
const create = vi.fn();
const dispatch = vi.fn();
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
const ertelenmis = () => new Promise((res, rej) => { sozler.push({ res, rej }); });

const BUGUN = todayIso();
function tur(ek: Partial<DeliveryRun> = {}): DeliveryRun {
  return {
    id: 1, run_date: BUGUN, vehicle_id: 10, vehicle: "Lada", status: "PLANNED", created_at: "2026-09-12T06:00:00Z", depot_lat: null, depot_lng: null,
    courier: null, stops: [], ...ek,
  } as DeliveryRun;
}
const durak = (status: string) => ({ id: Math.random(), status }) as never;
const AKTIF = tur({ id: 3, status: "ACTIVE", courier: { id: 5, name: "Ali Kurye" } as never, stops: [durak("DELIVERED"), durak("PENDING"), durak("FAILED")] });
const PLANLI = tur({ id: 1, status: "PLANNED", stops: [durak("PENDING")] });
const BITEN = tur({ id: 2, status: "DONE", vehicle: "Fiat" });
const IPTAL = tur({ id: 4, status: "CANCELLED" });
const ARAC = (ek: Partial<Vehicle> = {}): Vehicle => ({ id: 10, code: "LADA", label: "Lada", plate: null, profile: "car", max_stops: null, shift_start: null, shift_end: null, fixed_cost: 0, is_active: true, ...ek }) as Vehicle;
const siparis = (ek: Partial<DeliveryEligibleOrder> = {}): DeliveryEligibleOrder => ({ order_id: 501, recipient: "Ayşe Yılmaz", address: "Atatürk Cad. 5", total: "150.00", item_count: 1, created_at: "2026-09-10T10:00:00Z", lat: 37, lng: 35, ...ek });

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
function agac(yol = PATHS.adminNewDelivery) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewDelivery} element={<><DagitimBugun /><Konum /></>} />
            <Route path={PATHS.adminNewDeliveryRunDetail} element={<><div>Yeni tur detayı</div><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = (yol?: string) => render(agac(yol));
const onayGorunur = () => [...document.querySelectorAll(".ant-modal-confirm")].some((m) => !m.classList.contains("ant-zoom-leave") && (m.closest(".ant-modal-wrap") as HTMLElement | null)?.style.display !== "none");
const onayDugmesi = (ad: RegExp) => {
  const acik = [...document.querySelectorAll(".ant-modal-confirm")].filter((m) => !m.classList.contains("ant-zoom-leave"));
  return within(acik[acik.length - 1] as HTMLElement).getByRole("button", { name: ad });
};

beforeEach(() => {
  for (const f of [retry, create, dispatch]) f.mockReset().mockImplementation(ertelenmis);
  sozler.length = 0;
  vi.mocked(useRoutingHealth).mockReset().mockReturnValue(sonuc({ degraded: false }));
  vi.mocked(useAttentionOrders).mockReset().mockReturnValue(sonuc([]));
  vi.mocked(useDeliveryRuns).mockReset().mockReturnValue(sonuc([BITEN, PLANLI, IPTAL, AKTIF]));
  vi.mocked(useVehicles).mockReset().mockReturnValue(sonuc([ARAC({ id: 11, label: "Pasif", is_active: false }), ARAC(), ARAC({ id: 12, label: "Fiat" })]));
  vi.mocked(useEligibleOrders).mockReset().mockReturnValue(sonuc([siparis(), siparis({ order_id: 502, lat: null, lng: null }), siparis({ order_id: 503 })]));
  vi.mocked(useCapacityOverview).mockReset().mockReturnValue(sonuc([{ day: BUGUN, capacity: 10, booked: 4, retry_debt: 1, is_working_day: true }]));
  vi.mocked(useRunPosition).mockReset().mockReturnValue(sonuc({ lat: 1, lng: 1, age_seconds: 12 }));
  vi.mocked(useRetryExhausted).mockReturnValue({ mutateAsync: retry, isPending: false } as never);
  vi.mocked(useCreateDeliveryRun).mockReturnValue({ mutateAsync: create, isPending: false } as never);
  vi.mocked(useDispatchDay).mockReturnValue({ mutateAsync: dispatch, isPending: false } as never);
  izin("delivery.view", "delivery.manage");
});

describe("saf kurallar", () => {
  it("tarihNo: yalnız gerçek ISO gün; geçersiz/uydurma tarih bugüne düşer", () => {
    expect(tarihNo("2026-09-20")).toBe("2026-09-20");
    for (const h of [null, "", "abc", "2026-13-01", "2026-02-30", "20260920", "2026-9-2", "1e3"]) expect(tarihNo(h)).toBe(BUGUN);
  });
  it("turlariSirala: ACTIVE · PLANNED · DONE · CANCELLED, sonra id", () => {
    expect(turlariSirala([BITEN, PLANLI, IPTAL, AKTIF, tur({ id: 9, status: "YENI" as never })]).map((r) => r.id)).toEqual([3, 1, 2, 4, 9]);
  });
  it("konumMetni: <30 sn canlı, aksi dk; veri yoksa null", () => {
    expect(konumMetni(12)).toBe("konum canlı");
    expect(konumMetni(150)).toBe("konum 3 dk önce");
    expect(konumMetni(null)).toBeNull();
  });
});

describe("DagitimBugun", () => {
  it("view yokken bütün sorgular kapalı ve AccessDenied", () => {
    // `adminAreaAccess` sözleşmesinde manage view'ı ima eder; view'sız oturum başka alan izniyle kurulur.
    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(useRoutingHealth)).toEqual([false]);
    expect(son(useAttentionOrders)).toEqual([false]);
    expect(son(useDeliveryRuns)).toEqual([BUGUN, false]);
    expect(son(useVehicles)).toEqual([false]);
    expect(son(useEligibleOrders)).toEqual([false]);
    expect(vi.mocked(useCapacityOverview)).not.toHaveBeenCalled();
  });

  it("view-only: tarih, turlar, kapasite, istisnalar görünür; araç seçici ve yazma aksiyonları yok; araç/uygun sorguları kapalı", () => {
    izin("delivery.view");
    vi.mocked(useAttentionOrders).mockReturnValue(sonuc([siparis()]));
    kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getByLabelText("Tur tarihi")).toBeInTheDocument();
    expect(screen.getByTestId("tur-3")).toBeInTheDocument();
    expect(screen.getByTestId("istisna-501")).toBeInTheDocument();
    expect(screen.getByLabelText("Önümüzdeki günlerin teslimat kapasitesi")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Araç" })).not.toBeInTheDocument();
    for (const ad of ["Yeni Tur", /Günü Optimize Et/, "Yeniden Dene"]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    expect(son(useVehicles)).toEqual([false]);
    expect(son(useEligibleOrders)).toEqual([false]);
    expect(son(useDeliveryRuns)).toEqual([BUGUN, true]);
  });

  it("sağlık şeridi yalnız degraded=true iken; sağlık hatası kokpiti bloklamaz", () => {
    const a = kur();
    expect(screen.queryByText("Rota optimizasyonu yaklaşık modda.")).not.toBeInTheDocument();
    a.unmount();
    vi.mocked(useRoutingHealth).mockReturnValue(sonuc({ degraded: true }));
    const b = kur();
    expect(screen.getByText("Rota optimizasyonu yaklaşık modda.")).toBeInTheDocument();
    b.unmount();
    vi.mocked(useRoutingHealth).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x") }));
    kur();
    expect(screen.queryByText("Rota optimizasyonu yaklaşık modda.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bugün" })).toBeInTheDocument();
    expect(screen.getByTestId("tur-3")).toBeInTheDocument();
  });

  it("istisna kuyruğu: boş tek satır; dolu alanlar; bağımsız hata + Tekrar dene", async () => {
    const a = kur();
    expect(screen.getByText("İstisna yok: karar bekleyen sipariş bulunmuyor.")).toBeInTheDocument();
    a.unmount();
    vi.mocked(useAttentionOrders).mockReturnValue(sonuc([siparis(), siparis({ order_id: 502, recipient: null, address: null, total: "20.50" })]));
    const b = kur();
    const s = within(screen.getByTestId("istisna-501"));
    expect(s.getByText("Ayşe Yılmaz")).toBeInTheDocument();
    expect(s.getByText("#501")).toBeInTheDocument();
    expect(s.getByText("Atatürk Cad. 5")).toBeInTheDocument();
    expect(s.getByText(/150/)).toBeInTheDocument();
    expect(within(screen.getByTestId("istisna-502")).getByText("Adres yok")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Yeniden Dene" })).toHaveLength(2);
    b.unmount();
    const refetch = vi.fn();
    vi.mocked(useAttentionOrders).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Kuyruk çöktü" } } }, refetch }));
    kur();
    expect(screen.getByText("Kuyruk çöktü")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tur-3")).toBeInTheDocument();
  });

  it("günün turları: sıra, araç, kurye/atanmadı, ilerleme, durum, ACTIVE konum polling ve geçici eski detay bağlantısı", () => {
    kur();
    expect([...document.querySelectorAll('[data-testid^="tur-"]')].map((e) => e.getAttribute("data-testid"))).toEqual(["tur-3", "tur-1", "tur-2", "tur-4"]);
    const a = within(screen.getByTestId("tur-3"));
    expect(a.getByRole("link", { name: "Tur #3" })).toHaveAttribute("href", ROUTES.adminNewDeliveryRun(3));
    expect(a.getByText("Lada")).toBeInTheDocument();
    expect(a.getByText(/Ali Kurye/)).toBeInTheDocument();
    expect(a.getByText(/konum canlı/)).toBeInTheDocument();
    expect(a.getByText("2/3 durak")).toBeInTheDocument();
    expect(a.getByText("Sahada")).toBeInTheDocument();
    expect(within(screen.getByTestId("tur-1")).getByText(/Kurye atanmadı/)).toBeInTheDocument();
    expect(within(screen.getByTestId("tur-1")).queryByText(/konum/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("tur-2")).getByText("Tamamlandı")).toBeInTheDocument();
    expect(within(screen.getByTestId("tur-4")).getByText("İptal")).toBeInTheDocument();
    expect(document.querySelectorAll("a button, button a, a a, button button")).toHaveLength(0);
    // Satır tıklaması da eski detaya gider (geçici).
    fireEvent.click(within(screen.getByTestId("tur-2")).getByText("Fiat"));
    expect(screen.getByTestId("konum")).toHaveTextContent(ROUTES.adminNewDeliveryRun(2));
    // Polling yalnız ACTIVE turda açık.
    expect(vi.mocked(useRunPosition)).toHaveBeenCalledWith(3, true);
    expect(vi.mocked(useRunPosition)).toHaveBeenCalledWith(1, false);
    expect(vi.mocked(useRunPosition)).not.toHaveBeenCalledWith(3, false);
  });

  it("tarih: URL'den okunur, değişince push, geri/ileri eşler, geçersiz değer bugüne düşer ve sunucuya gitmez", async () => {
    const a = kur(`${PATHS.adminNewDelivery}?tarih=2026-02-30`);
    expect(son(useDeliveryRuns)).toEqual([BUGUN, true]);
    expect((screen.getByLabelText("Tur tarihi") as HTMLInputElement).value).toBe(BUGUN);
    a.unmount();
    kur(`${PATHS.adminNewDelivery}?tarih=2026-09-20`);
    expect(son(useDeliveryRuns)).toEqual(["2026-09-20", true]);
    fireEvent.change(screen.getByLabelText("Tur tarihi"), { target: { value: "2026-09-21" } });
    await waitFor(() => expect(son(useDeliveryRuns)).toEqual(["2026-09-21", true]));
    expect(screen.getByTestId("konum")).toHaveTextContent("tarih=2026-09-21");
    await userEvent.click(screen.getByRole("button", { name: "geri" }));
    await waitFor(() => expect(son(useDeliveryRuns)).toEqual(["2026-09-20", true]));
    expect((screen.getByLabelText("Tur tarihi") as HTMLInputElement).value).toBe("2026-09-20");
    await userEvent.click(screen.getByRole("button", { name: "ileri" }));
    await waitFor(() => expect(son(useDeliveryRuns)).toEqual(["2026-09-21", true]));
    // Kapasite şeridindeki gün de tarihi değiştirir.
    await userEvent.click(screen.getByLabelText("Önümüzdeki günlerin teslimat kapasitesi").querySelector("button") as HTMLElement);
    await waitFor(() => expect(son(useDeliveryRuns)).toEqual([BUGUN, true]));
    expect(screen.getByTestId("konum")).not.toHaveTextContent("tarih=");
  });

  it("araç: yalnız aktif araçlar, varsayılan ilk aktif; araç yokken Yeni Tur istek atmaz ve nedeni söyler", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    const a = kur();
    await u.click(screen.getByRole("combobox", { name: "Araç" }));
    await screen.findAllByRole("option");
    expect([...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content")].map((o) => o.textContent)).toEqual(["Lada", "Fiat"]);
    await u.keyboard("{Escape}");
    fireEvent.click(screen.getByRole("button", { name: "Yeni Tur" }));
    expect(create).toHaveBeenCalledWith({ run_date: BUGUN, vehicle_id: 10 });
    a.unmount();
    vi.mocked(useVehicles).mockReturnValue(sonuc([ARAC({ is_active: false })]));
    kur();
    create.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Yeni Tur" }));
    expect(create).not.toHaveBeenCalled();
    expect(await screen.findByText("Önce bir araç tanımlayın: Araçlar sekmesinden eklenir.")).toBeInTheDocument();
  });

  it("Yeni Tur: seçilen araç ve tarih payload'ı, aynı tick tek istek, hata görünür ve yeniden denenir, başarıda sunucu ID'siyle eski detaya gider", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    kur(`${PATHS.adminNewDelivery}?tarih=2026-09-20`);
    await u.click(screen.getByRole("combobox", { name: "Araç" }));
    await u.click(await screen.findByTitle("Fiat"));
    const dugme = screen.getByRole("button", { name: "Yeni Tur" });
    fireEvent.click(dugme);
    fireEvent.click(dugme);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ run_date: "2026-09-20", vehicle_id: 12 });
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Araç o gün dolu" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Araç o gün dolu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yeni Tur" }));
    expect(create).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res(tur({ id: 77 })); await Promise.resolve(); });
    expect(await screen.findByText("Tur oluşturuldu.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent(ROUTES.adminNewDeliveryRun(77)));
    expect(screen.getByText("Yeni tur detayı")).toBeInTheDocument();
  });

  it("optimize: konumlu sipariş yoksa kapalı ve neden görünür; varsa sayı, onay, aynı tick tek istek, hata açık kalır, tek/çok tur metinleri", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    vi.mocked(useEligibleOrders).mockReturnValue(sonuc([siparis({ lat: null, lng: null })]));
    const a = kur();
    expect(screen.getByRole("button", { name: /Günü Optimize Et/ })).toBeDisabled();
    expect(screen.getByText("Dağıtılacak konumlu sipariş yok; Günü Optimize Et kapalı.")).toBeInTheDocument();
    a.unmount();
    vi.mocked(useEligibleOrders).mockReturnValue(sonuc([siparis(), siparis({ order_id: 502, lat: null, lng: null }), siparis({ order_id: 503 })]));
    kur(`${PATHS.adminNewDelivery}?tarih=2026-09-20`);
    const dugme = screen.getByRole("button", { name: /Günü Optimize Et/ });
    expect(dugme).toBeEnabled();
    expect(dugme).toHaveTextContent("Günü Optimize Et (2)");
    await u.click(dugme);
    expect(await screen.findByText(/2 konumlu sipariş aktif araçlara bölüştürülüp/)).toBeInTheDocument();
    await u.dblClick(onayDugmesi(/Turları kur/));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("2026-09-20");
    await act(async () => { sozler.pop()!.rej({ response: { status: 500, data: { detail: "VROOM cevap vermedi" } } }); await Promise.resolve(); });
    expect(await screen.findByText("VROOM cevap vermedi")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi(/Turları kur/)).not.toHaveClass("ant-btn-loading"));
    await u.click(onayDugmesi(/Turları kur/));
    expect(dispatch).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res([tur({ id: 81 }), tur({ id: 82 })]); await Promise.resolve(); });
    expect(await screen.findByText("Gün 2 araca bölüştürüldü.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent(ROUTES.adminNewDeliveryRun(81)));
    // Tek tur metni.
    await userEvent.click(screen.getByRole("button", { name: "geri" }));
    await u.click(await screen.findByRole("button", { name: /Günü Optimize Et/ }));
    await u.click(onayDugmesi(/Turları kur/));
    await act(async () => { sozler.pop()!.res([tur({ id: 83 })]); await Promise.resolve(); });
    expect(await screen.findByText("Günün turu kuruldu ve optimize edildi.")).toBeInTheDocument();
  });

  it("Yeniden Dene: hedef sabit, aynı tick çift onay tek istek, pending'de kapanmaz, 403 açık kalır, başarı", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    vi.mocked(useAttentionOrders).mockReturnValue(sonuc([siparis(), siparis({ order_id: 502 })]));
    kur();
    await u.click(within(screen.getByTestId("istisna-501")).getByRole("button", { name: "Yeniden Dene" }));
    expect(await screen.findByText(/Sipariş #501 müşteriyle görüşüldüğü kabul edilerek/)).toBeInTheDocument();
    await u.dblClick(onayDugmesi(/^Yeniden dene$/));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(501);
    await u.click(onayDugmesi(/Vazgeç/));
    expect(onayGorunur()).toBe(true);
    await act(async () => { sozler.pop()!.rej({ response: { status: 403, data: { detail: "Yetkin yok" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Yetkin yok")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi(/Yeniden dene/)).not.toHaveClass("ant-btn-loading"));
    await u.click(onayDugmesi(/Yeniden dene/));
    expect(retry).toHaveBeenCalledTimes(2);
    expect(retry).toHaveBeenLastCalledWith(501);
    await act(async () => { sozler.pop()!.res(siparis()); await Promise.resolve(); });
    expect(await screen.findByText("#501 yeniden dağıtım kuyruğuna alındı.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
  });

  it("turlar: yükleniyor, hata + Tekrar dene, boş durum (manage'de Yeni Tur)", async () => {
    vi.mocked(useDeliveryRuns).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    expect(screen.getByText("Turlar yükleniyor…")).toBeInTheDocument();
    a.unmount();
    const refetch = vi.fn();
    vi.mocked(useDeliveryRuns).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Turlar çöktü" } } }, refetch }));
    const b = kur();
    expect(screen.getByText("Turlar çöktü")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    b.unmount();
    vi.mocked(useDeliveryRuns).mockReturnValue(sonuc([]));
    const c = kur();
    expect(screen.getByText("Bu tarihte tur yok")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Yeni Tur" })).toHaveLength(2);
    c.unmount();
    izin("delivery.view");
    kur();
    expect(screen.getByText("Bu tarihte tur yok")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yeni Tur" })).not.toBeInTheDocument();
  });

  it("araç sorgusu hatası: görünür hata, yalnız kendi refetch'i, yanlış 'araç tanımlayın' mesajı yok, create yok; kuyruk ve turlar açık", async () => {
    const refetch = vi.fn();
    vi.mocked(useVehicles).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch }));
    vi.mocked(useAttentionOrders).mockReturnValue(sonuc([siparis()]));
    kur();
    expect(screen.getByText("Araçlar yüklenemedi.")).toBeInTheDocument();
    const dugme = screen.getByRole("button", { name: "Yeni Tur" });
    expect(dugme).toBeDisabled();
    fireEvent.click(dugme);
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByText(/Önce bir araç tanımlayın/)).not.toBeInTheDocument();
    const hata = screen.getByText("Araçlar yüklenemedi.").closest(".ant-alert") as HTMLElement;
    await userEvent.click(within(hata).getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useAttentionOrders).mock.results.at(-1)?.value.refetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("istisna-501")).toBeInTheDocument();
    expect(screen.getByTestId("tur-3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Günü Optimize Et/ })).toBeEnabled();
  });

  it("uygun sipariş sorgusu hatası: görünür hata, yalnız kendi refetch'i, 'konumlu sipariş yok' metni yok, optimize onayı/mutation yok", async () => {
    const refetch = vi.fn();
    vi.mocked(useEligibleOrders).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch }));
    kur();
    expect(screen.getByText("Dağıtılabilir siparişler yüklenemedi.")).toBeInTheDocument();
    expect(screen.queryByText(/Dağıtılacak konumlu sipariş yok/)).not.toBeInTheDocument();
    const dugme = screen.getByRole("button", { name: /Günü Optimize Et/ });
    expect(dugme).toBeDisabled();
    fireEvent.click(dugme);
    expect(onayGorunur()).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    const hata = screen.getByText("Dağıtılabilir siparişler yüklenemedi.").closest(".ant-alert") as HTMLElement;
    await userEvent.click(within(hata).getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Yeni Tur" })).toBeEnabled();
    expect(screen.getByTestId("tur-3")).toBeInTheDocument();
  });

  it("destek sorguları yüklenirken: durum yazılı, aynı tick tıklamalar mutation üretmez", () => {
    vi.mocked(useVehicles).mockReturnValue(sonuc(undefined, { isPending: true }));
    vi.mocked(useEligibleOrders).mockReturnValue(sonuc(undefined, { isPending: true }));
    kur();
    // Metin hem Select yer tutucusunda hem durum satırında; en az biri görünür.
    expect(screen.getAllByText("Araçlar yükleniyor…").length).toBeGreaterThan(0);
    expect(screen.getByText("Dağıtılabilir siparişler yükleniyor…")).toBeInTheDocument();
    const yeni = screen.getByRole("button", { name: "Yeni Tur" });
    const opt = screen.getByRole("button", { name: /Günü Optimize Et/ });
    expect(yeni).toBeDisabled();
    expect(opt).toBeDisabled();
    fireEvent.click(yeni);
    fireEvent.click(yeni);
    fireEvent.click(opt);
    fireEvent.click(opt);
    expect(create).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(onayGorunur()).toBe(false);
    expect(screen.queryByText(/Dağıtılacak konumlu sipariş yok/)).not.toBeInTheDocument();
  });

  it("önbellekte veri varken arka plan tazeleme hatası: uyarı gösterilir, mevcut araç ve hesapla işlem sürer", async () => {
    vi.mocked(useVehicles).mockReturnValue(sonuc([ARAC()], { isError: true, error: new Error("x") }));
    vi.mocked(useEligibleOrders).mockReturnValue(sonuc([siparis()], { isError: true, error: new Error("x") }));
    kur();
    expect(screen.getByText(/Araç listesi tazelenemedi/)).toBeInTheDocument();
    expect(screen.getByText(/Dağıtılabilir sipariş listesi tazelenemedi/)).toBeInTheDocument();
    expect(screen.queryByText("Araçlar yüklenemedi.")).not.toBeInTheDocument();
    expect(screen.queryByText("Dağıtılabilir siparişler yüklenemedi.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yeni Tur" }));
    expect(create).toHaveBeenCalledWith({ run_date: BUGUN, vehicle_id: 10 });
    const opt = screen.getByRole("button", { name: /Günü Optimize Et/ });
    expect(opt).toBeEnabled();
    await userEvent.click(opt);
    expect(await screen.findByText(/1 konumlu sipariş aktif araçlara/)).toBeInTheDocument();
  });

  it("rota, menü kök grubu, çocuk sırası, izin, selectedKey/openKeys; Paketleme ayrı", () => {
    expect(PATHS.adminNewDelivery).toBe("/yonetim-yeni/dagitim");
    expect(ROUTES.adminNewDelivery).toBe(PATHS.adminNewDelivery);
    const grup = PANEL_MENU.find((m) => m.key === "dagitim")!;
    expect(grup.icon).toBeTruthy();
    expect(grup.path).toBeUndefined();
    expect(grup.children?.map((c) => c.label)).toEqual(["Bugün", "Siparişler", "Turlar", "Performans", "Kuryeler", "Tahta", "Araçlar"]);
    expect(grup.children?.map((c) => Boolean(c.path))).toEqual([true, true, true, false, false, false, false]);
    expect(PANEL_MENU.find((m) => m.key === "paketleme")?.children?.length).toBe(3);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewDelivery)).toMatchObject({ label: "Bugün", requiredPermission: "delivery" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewDelivery)).toEqual({ selectedKey: "dagitim-bugun", openKeys: ["dagitim"] });
    expect(izinBeyaniniKarsilarMi(["delivery.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDelivery)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["packing.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDelivery)!)).toBe(false);
  });
});
