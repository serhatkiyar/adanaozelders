import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { DagitimTurDetayi, birakilmisSira, tasinmisSira, turKimligi } from "@/panel/pages/dagitim/DagitimTurDetayi";
import { PANEL_MENU, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import {
  useAddStops,
  useCouriers,
  useDeliveryRun,
  useEligibleOrders,
  useOptimizeRun,
  useRemoveStop,
  useReorderStops,
  useRunAction,
  useRunPosition,
  useUpdateDeliveryRun,
} from "@/hooks/useDelivery";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { DeliveryEligibleOrder, DeliveryRun, DeliveryStop } from "@/types";

vi.mock("@/hooks/useDelivery", () => ({
  useAddStops: vi.fn(),
  useCouriers: vi.fn(),
  useDeliveryRun: vi.fn(),
  useEligibleOrders: vi.fn(),
  useOptimizeRun: vi.fn(),
  useRemoveStop: vi.fn(),
  useReorderStops: vi.fn(),
  useRunAction: vi.fn(),
  useRunPosition: vi.fn(),
  useUpdateDeliveryRun: vi.fn(),
}));
vi.mock("@/components/DeliveryRouteMap", () => ({ DeliveryRouteMap: () => <div data-testid="harita" /> }));
vi.mock("@/components/admin/delivery/LabelSheet", () => ({ LabelSheet: ({ onClose }: { onClose: () => void }) => <div data-testid="etiketler"><button onClick={onClose}>Etiketi kapat</button></div> }));

const aksiyon = vi.fn();
const optimize = vi.fn();
const kurye = vi.fn();
const sirala = vi.fn();
const cikar = vi.fn();
const ekle = vi.fn();
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
const ertelenmis = () => new Promise((res, rej) => { sozler.push({ res, rej }); });

const durak = (ek: Partial<DeliveryStop>): DeliveryStop =>
  ({ id: 1, run_id: 77, order_id: 501, sequence: 1, status: "PENDING", qr_payload: "1:tok", recipient: "Ayşe Yılmaz", address: "Atatürk Cad. 5", lat: 37, lng: 35, items: [{ title: "9. Sınıf Matematik", quantity: 2 }], delivery_pref: "KAPIYA_BIRAK", delivery_pref_note: "Kapıcıya", ...ek }) as DeliveryStop;
const D_TESLIM = durak({ id: 1, order_id: 501, sequence: 1, status: "DELIVERED" });
const D_BASARISIZ = durak({ id: 2, order_id: 502, sequence: 2, status: "FAILED", fail_reason: "EVDE_YOK", recipient: "Veli Demir" });
const D_BEK1 = durak({ id: 3, order_id: 503, sequence: 3, status: "PENDING", recipient: "Can Kaya", eta: "2026-09-13T11:30:00", is_outlier: true, detour_km: 4.2, failed_attempts: 1 });
const D_BEK2 = durak({ id: 4, order_id: 504, sequence: 4, status: "PENDING", recipient: "Can Kaya", lat: null, lng: null, address: null, promised_delivery_date: "2020-01-01" });
const D_BEK3 = durak({ id: 5, order_id: 505, sequence: 5, status: "PENDING", recipient: "Deniz Ak", lat: 37.01, lng: 35.01 });

function tur(ek: Partial<DeliveryRun> = {}): DeliveryRun {
  return {
    id: 77, run_date: "2026-09-13", vehicle_id: 10, vehicle: "Lada", status: "PLANNED", created_at: "", depot_lat: null, depot_lng: null,
    courier: null, stops: [D_TESLIM, D_BASARISIZ, D_BEK1, D_BEK2, D_BEK3], ...ek,
  } as DeliveryRun;
}
const PLANLI = tur();
const AKTIF = tur({ status: "ACTIVE", courier: { id: 5, name: "Ali Kurye", is_active: true } as never, optimized_at: "2026-09-13T08:00:00", optimize_provider: "vroom", total_distance_km: 12.5, total_duration_seconds: 5400 });
const siparis = (ek: Partial<DeliveryEligibleOrder> = {}): DeliveryEligibleOrder => ({ order_id: 601, recipient: "Ece Su", address: "Kurtuluş Mah. 3", total: "99.90", item_count: 2, created_at: "", lat: 37, lng: 35, promised_delivery_date: "2099-01-01", ...ek });

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const son = (h: unknown) => vi.mocked(h as () => unknown).mock.calls.at(-1);

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}
function Konum() {
  return <output data-testid="konum">{`${useLocation().pathname}${useLocation().search}`}</output>;
}
function agac(yol = ROUTES.adminNewDeliveryRun(77)) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewDeliveryRunDetail} element={<><DagitimTurDetayi /><Konum /></>} />
            <Route path={PATHS.adminNewDeliveryRuns} element={<><div>Turlar listesi</div><Konum /></>} />
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
// AntD yükleniyor simgesi jsdom'da erişilebilir ada "loading" ekler; ad sonuna göre eşlenir.
const dugme = (ad: string, kapsam: ReturnType<typeof within> = screen) => kapsam.getByRole("button", { name: new RegExp(`${ad}$`) });

beforeEach(() => {
  for (const f of [aksiyon, optimize, kurye, sirala, cikar, ekle]) f.mockReset().mockImplementation(ertelenmis);
  sozler.length = 0;
  vi.mocked(useDeliveryRun).mockReset().mockReturnValue(sonuc(PLANLI));
  vi.mocked(useRunPosition).mockReset().mockReturnValue(sonuc({ lat: 1, lng: 1, age_seconds: 12 }));
  vi.mocked(useCouriers).mockReset().mockReturnValue(sonuc([{ id: 5, name: "Ali Kurye", is_active: true }, { id: 6, name: "Pasif Kurye", is_active: false }, { id: 7, name: "Zeynep Kurye", is_active: true }]));
  vi.mocked(useEligibleOrders).mockReset().mockReturnValue(sonuc([siparis(), siparis({ order_id: 602, recipient: "Mert Öz", lat: null, lng: null })]));
  vi.mocked(useRunAction).mockReturnValue({ mutateAsync: aksiyon, isPending: false } as never);
  vi.mocked(useOptimizeRun).mockReturnValue({ mutateAsync: optimize, isPending: false } as never);
  vi.mocked(useUpdateDeliveryRun).mockReturnValue({ mutateAsync: kurye, isPending: false } as never);
  vi.mocked(useReorderStops).mockReturnValue({ mutateAsync: sirala, isPending: false } as never);
  vi.mocked(useRemoveStop).mockReturnValue({ mutateAsync: cikar, isPending: false } as never);
  vi.mocked(useAddStops).mockReturnValue({ mutateAsync: ekle, isPending: false } as never);
  izin("delivery.view", "delivery.manage");
});

describe("saf kurallar", () => {
  it("turKimligi katı; tasinmisSira/birakilmisSira sonuçlanmış durakların üzerinden geçmez", () => {
    expect(turKimligi("77")).toBe(77);
    for (const h of [undefined, "", "0", "-1", "abc", "1e3", "0x10", "42.0", " 5", String(Number.MAX_SAFE_INTEGER + 1)]) expect(turKimligi(h)).toBeNull();
    const s = PLANLI.stops;
    expect(tasinmisSira(s, 3, -1)).toBeNull(); // üstü FAILED
    expect(tasinmisSira(s, 3, 1)).toEqual([1, 2, 4, 3, 5]);
    expect(tasinmisSira(s, 5, 1)).toBeNull(); // son
    expect(tasinmisSira(s, 2, 1)).toBeNull(); // sonuçlanmış durak taşınmaz
    expect(birakilmisSira(s, 5, 3)).toEqual([1, 2, 5, 3, 4]);
    expect(birakilmisSira(s, 3, 1)).toBeNull(); // hedef sonuçlanmış
    expect(birakilmisSira(s, 3, 3)).toBeNull();
  });
});

describe("DagitimTurDetayi", () => {
  it("geçersiz kimlik: sorgular kapalı, açık hata, Turlar listesine dönüş; view yokken AccessDenied ve bütün sorgular kapalı", async () => {
    kur("/yonetim-yeni/dagitim/turlar/abc");
    expect(son(useDeliveryRun)).toEqual([null, { pollWhenActive: true, enabled: false }]);
    expect(screen.getByText("Tur adresi geçersiz. Turlar listesinden yeniden açın.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turlar listesine dön" }));
    expect(screen.getByTestId("konum")).toHaveTextContent(PATHS.adminNewDeliveryRuns);

    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(useDeliveryRun)).toEqual([77, { pollWhenActive: true, enabled: false }]);
    expect(son(useRunPosition)).toEqual([77, false]);
    expect(son(useCouriers)).toEqual([false]);
    expect(son(useEligibleOrders)).toEqual([false]);
  });

  it("yükleniyor, 404 ve genel hata + Tekrar dene", async () => {
    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    expect(screen.getByText("Tur yükleniyor…")).toBeInTheDocument();
    a.unmount();
    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 404 } } }));
    const b = kur();
    expect(screen.getByText("Tur bulunamadı")).toBeInTheDocument();
    b.unmount();
    const refetch = vi.fn();
    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Tur servisi çöktü" } } }, refetch }));
    kur();
    expect(screen.getByText("Tur servisi çöktü")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("başlık/özet: tarih, araç, durum, ilerleme, istisna rozetleri; PLANNED aksiyonları; polling yalnız ACTIVE; harita mount koşulu", () => {
    const a = kur();
    expect(screen.getByRole("heading", { name: "Tur #77" })).toBeInTheDocument();
    expect(screen.getByText("Planlanıyor")).toBeInTheDocument();
    expect(screen.getByText("Lada")).toBeInTheDocument();
    expect(screen.getByText(/13 Eylül 2026/)).toBeInTheDocument();
    expect(screen.getByText("2/5 durak")).toBeInTheDocument();
    expect(screen.getByText("1 söz riski")).toBeInTheDocument();
    expect(screen.getByText("1 pinsiz")).toBeInTheDocument();
    expect(screen.getByText("1 yeniden deneme")).toBeInTheDocument();
    expect(screen.getByText("1 rotayı bozan")).toBeInTheDocument();
    expect(screen.queryByText(/ETA aşıldı/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rotayı Optimize Et/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Etiketler" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Turu Başlat/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "İptal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Turu Tamamla/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Saha Ekranı/ })).not.toBeInTheDocument();
    expect(son(useRunPosition)).toEqual([77, false]);
    expect(screen.queryByTestId("harita")).not.toBeInTheDocument();
    expect(screen.queryByText("12,5 km")).not.toBeInTheDocument();
    expect(son(useDeliveryRun)).toEqual([77, { pollWhenActive: true, enabled: true }]);
    a.unmount();

    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(AKTIF));
    kur();
    expect(son(useRunPosition)).toEqual([77, true]);
    expect(screen.getByText(/kurye konumu canlı/)).toBeInTheDocument();
    expect(screen.getByText("12,5 km")).toBeInTheDocument();
    expect(screen.getByText("~1 sa 30 dk")).toBeInTheDocument();
    expect(screen.getByText("yol ağı")).toBeInTheDocument();
    expect(screen.getByTestId("harita")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Haritayı gizle" }));
    expect(screen.queryByTestId("harita")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Saha Ekranı/ })).toHaveAttribute("href", ROUTES.deliveryRun(77));
    expect(screen.getByRole("button", { name: /Turu Tamamla/ })).toBeDisabled();
    expect(document.querySelectorAll("a button, button a, a a, button button")).toHaveLength(0);
  });

  it("DONE/CANCELLED salt okunur; view-only'de aksiyon ve düzenleme yok, kurye düz metin", () => {
    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(tur({ status: "DONE", courier: { id: 5, name: "Ali Kurye" } as never })));
    const a = kur();
    for (const ad of [/Rotayı Optimize Et/, /Turu Başlat/, /Turu Tamamla/, "İptal", /yukarı taşı/, /turdan çıkar/, "Ekle"]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Etiketler" })).toBeInTheDocument();
    expect(screen.queryByText("Dağıtıma hazır siparişler")).not.toBeInTheDocument();
    expect(son(useEligibleOrders)).toEqual([false]);
    a.unmount();
    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(tur({ status: "CANCELLED" })));
    const b = kur();
    expect(screen.queryByRole("button", { name: "Etiketler" })).not.toBeInTheDocument();
    b.unmount();
    izin("delivery.view");
    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(AKTIF));
    kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.getByText("Kurye: Ali Kurye")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Kurye" })).not.toBeInTheDocument();
    for (const ad of [/Turu Tamamla/, "İptal", /yukarı taşı/, /turdan çıkar/]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    expect(son(useCouriers)).toEqual([false]);
    expect(son(useEligibleOrders)).toEqual([false]);
    expect(son(useRunPosition)).toEqual([77, true]);
  });

  it("kurye atama: aktif + atanmış kurye seçenekleri, payload, aynı tick tek istek, hata görünür ve seçim sunucu değerine döner, kaldırma", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(tur({ courier: { id: 6, name: "Pasif Kurye", is_active: false } as never })));
    kur();
    expect(son(useCouriers)).toEqual([true]);
    await u.click(screen.getByRole("combobox", { name: "Kurye" }));
    await screen.findAllByRole("option");
    expect([...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content")].map((o) => o.textContent)).toEqual(["Kurye seç…", "Ali Kurye", "Pasif Kurye", "Zeynep Kurye"]);
    await u.click(screen.getByTitle("Zeynep Kurye"));
    expect(kurye).toHaveBeenCalledTimes(1);
    expect(kurye).toHaveBeenCalledWith({ runId: 77, courierId: 7 });
    // Pending'de seçici kapalı; ikinci değişiklik gönderilmez.
    expect(screen.getByRole("combobox", { name: "Kurye" })).toBeDisabled();
    expect(kurye).toHaveBeenCalledTimes(1);
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Kurye başka turda" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Kurye başka turda")).toBeInTheDocument();
    // Seçim sunucu değerine (Pasif Kurye) döner; yeniden deneme mümkün.
    expect(screen.getByRole("combobox", { name: "Kurye" }).closest(".ant-select")).toHaveTextContent("Pasif Kurye");
    await u.click(screen.getByRole("combobox", { name: "Kurye" }));
    await u.click((await screen.findAllByTitle("Kurye seç…")).at(-1)!);
    expect(kurye).toHaveBeenLastCalledWith({ runId: 77, courierId: null });
    await act(async () => { sozler.pop()!.res(tur()); await Promise.resolve(); });
  });

  it("kurye yoksa yeni Kuryeler ekranı bağlantısı; kurye sorgusu hatası kendi Tekrar dene'siyle", async () => {
    vi.mocked(useCouriers).mockReturnValue(sonuc([{ id: 6, name: "Pasif", is_active: false }]));
    const a = kur();
    expect(screen.getByRole("link", { name: "Kurye ekle →" })).toHaveAttribute("href", ROUTES.adminNewDeliveryCouriers);
    a.unmount();
    const refetch = vi.fn();
    vi.mocked(useCouriers).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch }));
    kur();
    expect(screen.getByText("Kuryeler yüklenemedi.")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Kuryeler yüklenemedi.").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("başlat: durak yokken görünür nedenle kapalı; aynı tick tek istek; hata görünür ve yeniden denenir; başarı mesajı", async () => {
    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(tur({ stops: [] })));
    const a = kur();
    expect(screen.getByRole("button", { name: /Turu Başlat/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Turu Başlat/ })).toHaveAttribute("title", "Önce tura durak ekleyin.");
    expect(screen.queryByRole("button", { name: /Rotayı Optimize Et/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Etiketler" })).not.toBeInTheDocument();
    expect(screen.getByText("Henüz durak yok: aşağıdaki hazır siparişlerden ekleyin.")).toBeInTheDocument();
    a.unmount();
    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(PLANLI));
    kur();
    const b = screen.getByRole("button", { name: /Turu Başlat/ });
    fireEvent.click(b);
    fireEvent.click(b);
    expect(aksiyon).toHaveBeenCalledTimes(1);
    expect(aksiyon).toHaveBeenCalledWith({ runId: 77, action: "start" });
    // Başlat uçuştayken iptal onayı açılmaz (çapraz kilit).
    fireEvent.click(screen.getByRole("button", { name: "İptal" }));
    expect(onayGorunur()).toBe(false);
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Kurye atanmadı" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Kurye atanmadı")).toBeInTheDocument();
    fireEvent.click(dugme("Turu Başlat"));
    expect(aksiyon).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res(tur({ status: "ACTIVE" })); await Promise.resolve(); });
    expect(await screen.findByText("Tur başlatıldı: siparişler 'dağıtımda' olarak işaretlendi.")).toBeInTheDocument();
  });

  it("tamamla: bekleyen durak varken sayı içeren nedenle kapalı; bekleyen yokken tek istek ve başarı; optimize sağlayıcı metinleri", async () => {
    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(AKTIF));
    const a = kur();
    expect(screen.getByRole("button", { name: /Turu Tamamla/ })).toBeDisabled();
    // Görünür neden: ipucu + erişilebilir title (jsdom ipucunu açmaz).
    expect(screen.getByRole("button", { name: /Turu Tamamla/ })).toHaveAttribute("title", expect.stringMatching(/3 durak henüz sonuçlanmadı/));
    // Optimize: konumlu PENDING ≥ 2.
    const opt = screen.getByRole("button", { name: /Rotayı Optimize Et/ });
    fireEvent.click(opt);
    fireEvent.click(opt);
    expect(optimize).toHaveBeenCalledTimes(1);
    expect(optimize).toHaveBeenCalledWith(77);
    await act(async () => { sozler.pop()!.res({ ...AKTIF, optimize_provider: "haversine" }); await Promise.resolve(); });
    expect(await screen.findByText("Rota optimize edildi (yaklaşık: yol ağı servisi kapalı).")).toBeInTheDocument();
    fireEvent.click(dugme("Rotayı Optimize Et"));
    await act(async () => { sozler.pop()!.res({ ...AKTIF, optimize_provider: "vroom" }); await Promise.resolve(); });
    expect(await screen.findByText("Rota optimize edildi (yol ağı).")).toBeInTheDocument();
    a.unmount();

    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(tur({ status: "ACTIVE", stops: [D_TESLIM, D_BASARISIZ] })));
    kur();
    expect(screen.queryByRole("button", { name: /Rotayı Optimize Et/ })).not.toBeInTheDocument();
    const t = screen.getByRole("button", { name: /Turu Tamamla/ });
    expect(t).toBeEnabled();
    fireEvent.click(t);
    fireEvent.click(t);
    expect(aksiyon).toHaveBeenCalledTimes(1);
    expect(aksiyon).toHaveBeenCalledWith({ runId: 77, action: "complete" });
    await act(async () => { sozler.pop()!.res(tur({ status: "DONE" })); await Promise.resolve(); });
    expect(await screen.findByText("Tur tamamlandı.")).toBeInTheDocument();
  });

  it("iptal: onay, hedef sabit, aynı tick çift onay tek istek, pending'de Vazgeç kapatmaz, hata açık kalır, başarı", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    kur();
    await u.click(screen.getByRole("button", { name: "İptal" }));
    expect(await screen.findByText(/Tur #77: bekleyen 3 durak "teslim edilemedi" olarak kapanacak/)).toBeInTheDocument();
    await u.dblClick(onayDugmesi(/Turu iptal et/));
    expect(aksiyon).toHaveBeenCalledTimes(1);
    expect(aksiyon).toHaveBeenCalledWith({ runId: 77, action: "cancel" });
    await u.click(onayDugmesi(/Vazgeç/));
    expect(onayGorunur()).toBe(true);
    await act(async () => { sozler.pop()!.rej({ response: { status: 500, data: { detail: "İptal edilemedi" } } }); await Promise.resolve(); });
    expect(await screen.findByText("İptal edilemedi")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi(/Turu iptal et/)).not.toHaveClass("ant-btn-loading"));
    await u.click(onayDugmesi(/Turu iptal et/));
    expect(aksiyon).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res(tur({ status: "CANCELLED" })); await Promise.resolve(); });
    expect(await screen.findByText("Tur iptal edildi.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
  });

  it("durak satırı alanları: sıra, alıcı + sipariş bağlantısı, adres, tercih, ItemLines, konumsuz, +paket, rotayı bozan, ETA, durum, FAILED gerekçesi", () => {
    kur();
    const d1 = within(screen.getByTestId("durak-1"));
    expect(d1.getByText("1")).toBeInTheDocument();
    expect(d1.getByRole("link", { name: "#501" })).toHaveAttribute("href", ROUTES.adminNewOrder(501));
    expect(d1.getByText("Ayşe Yılmaz")).toBeInTheDocument();
    expect(d1.getByText("Atatürk Cad. 5")).toBeInTheDocument();
    expect(d1.getByText("Kapıya bırak")).toBeInTheDocument();
    expect(d1.getByText(/9\. Sınıf Matematik/)).toBeInTheDocument();
    expect(d1.getByText("Teslim edildi")).toBeInTheDocument();
    expect(d1.queryByRole("button")).not.toBeInTheDocument();
    const d2 = within(screen.getByTestId("durak-2"));
    expect(d2.getByText("Teslim edilemedi · Kimse evde yok")).toBeInTheDocument();
    const d3 = within(screen.getByTestId("durak-3"));
    expect(d3.getByText("+1 paket")).toBeInTheDocument();
    expect(d3.getByText(/rotayı bozuyor · \+4[.,]2 km/)).toBeInTheDocument();
    expect(d3.getByText(/~11:30/)).toBeInTheDocument();
    expect(d3.getByText("Bekliyor")).toBeInTheDocument();
    const d4 = within(screen.getByTestId("durak-4"));
    expect(d4.getByText("konumsuz")).toBeInTheDocument();
    expect(d4.getByText("Adres yok")).toBeInTheDocument();
    // Koordinat metin olarak basılmaz.
    expect(document.body.textContent).not.toMatch(/37\.01|35\.01/);
  });

  it("sıralama: ilk/son bekleyen kontrolü erişilebilir nedenle kapalı; yukarı/aşağı payload tam id sırası; sonuçlanmış duraklar sabit; aynı tick tek reorder; hata refetch", async () => {
    const refetch = vi.fn();
    vi.mocked(useDeliveryRun).mockReturnValue(sonuc(PLANLI, { refetch }));
    kur();
    expect(screen.getByRole("button", { name: "Durak 3 yukarı taşı" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Durak 5 aşağı taşı" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Durak 1 /})).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Durak 2 /})).not.toBeInTheDocument();
    const asagi = screen.getByRole("button", { name: "Durak 3 aşağı taşı" });
    fireEvent.click(asagi);
    fireEvent.click(screen.getByRole("button", { name: "Durak 4 yukarı taşı" }));
    expect(sirala).toHaveBeenCalledTimes(1);
    expect(sirala).toHaveBeenCalledWith({ runId: 77, stopIds: [1, 2, 4, 3, 5] });
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Sıra bayat" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Sıra bayat")).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Durak 5 yukarı taşı" }));
    expect(sirala).toHaveBeenLastCalledWith({ runId: 77, stopIds: [1, 2, 3, 5, 4] });
    await act(async () => { sozler.pop()!.res(PLANLI); await Promise.resolve(); });
  });

  it("sürükle-bırak: PENDING → PENDING taşır, sonuçlanmış hedefe bırakma istek üretmez", () => {
    kur();
    const d5 = screen.getByTestId("durak-5");
    const d3 = screen.getByTestId("durak-3");
    const d1 = screen.getByTestId("durak-1");
    expect(d5).toHaveAttribute("draggable", "true");
    expect(d1).not.toHaveAttribute("draggable", "true");
    const dt = { effectAllowed: "" };
    fireEvent.dragStart(d5, { dataTransfer: dt });
    fireEvent.dragOver(d1, { dataTransfer: dt });
    fireEvent.drop(d1, { dataTransfer: dt });
    expect(sirala).not.toHaveBeenCalled();
    fireEvent.dragStart(d5, { dataTransfer: dt });
    fireEvent.dragOver(d3, { dataTransfer: dt });
    fireEvent.drop(d3, { dataTransfer: dt });
    expect(sirala).toHaveBeenCalledWith({ runId: 77, stopIds: [1, 2, 5, 3, 4] });
  });

  it("turdan çıkar: onay, sabit hedef, satır kilidi, aynı tick tek istek, hata açık kalır, başarı", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    kur();
    await u.click(screen.getByRole("button", { name: "Durak 3 turdan çıkar" }));
    expect(await screen.findByText(/Can Kaya · sipariş #503 bu turdan çıkarılacak/)).toBeInTheDocument();
    await u.dblClick(onayDugmesi(/Turdan çıkar/));
    expect(cikar).toHaveBeenCalledTimes(1);
    expect(cikar).toHaveBeenCalledWith(3);
    // Başka satır kilitlenmez: onay penceresi açıkken satır düğmesi yükleniyor, diğerleri değil.
    expect(screen.getByRole("button", { name: /Durak 3 turdan çıkar/ })).toHaveClass("ant-btn-loading");
    expect(screen.getByRole("button", { name: "Durak 4 turdan çıkar" })).not.toHaveClass("ant-btn-loading");
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Durak zaten teslim" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Durak zaten teslim")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi(/Turdan çıkar/)).not.toHaveClass("ant-btn-loading"));
    await u.click(onayDugmesi(/Turdan çıkar/));
    expect(cikar).toHaveBeenCalledTimes(2);
    expect(cikar).toHaveBeenLastCalledWith(3);
    await act(async () => { sozler.pop()!.res(PLANLI); await Promise.resolve(); });
    expect(await screen.findByText("Durak turdan çıkarıldı.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
  });

  it("hazır siparişler: alanlar, tek/toplu ekleme, sipariş bazlı çakışma kilidi, hata slotları, boş/hata durumları", async () => {
    kur();
    expect(son(useEligibleOrders)).toEqual([true]);
    expect(screen.getByText("Dağıtıma hazır siparişler (2)")).toBeInTheDocument();
    const s1 = within(screen.getByTestId("uygun-601"));
    expect(s1.getByRole("link", { name: "#601" })).toHaveAttribute("href", ROUTES.adminNewOrder(601));
    expect(s1.getByText("Ece Su")).toBeInTheDocument();
    expect(s1.getByText("Kurtuluş Mah. 3")).toBeInTheDocument();
    expect(s1.getByText(/Söz:/)).toBeInTheDocument();
    expect(s1.getByText(/2 parça · /)).toBeInTheDocument();
    expect(within(screen.getByTestId("uygun-602")).getByText("konumsuz")).toBeInTheDocument();
    fireEvent.click(dugme("Ekle", s1));
    fireEvent.click(dugme("Ekle", s1));
    // Zincir bir mikro görev sonra gönderir; aynı tick iki tık yine tek istek.
    await waitFor(() => expect(ekle).toHaveBeenCalledTimes(1));
    expect(ekle).toHaveBeenCalledWith({ runId: 77, orderIds: [601] });
    // 601 uçuştayken toplu ekleme (601'i kapsar) çıkmaz; 602 tek ekleme reddedilmez ama SIRAYA alınır:
    // paralel POST backend'de aynı sequence üretebileceği için 601 sonuçlanmadan gönderilmez.
    fireEvent.click(dugme("Tümünü ekle"));
    expect(ekle).toHaveBeenCalledTimes(1);
    fireEvent.click(dugme("Ekle", within(screen.getByTestId("uygun-602"))));
    expect(ekle).toHaveBeenCalledTimes(1);
    expect(dugme("Ekle", within(screen.getByTestId("uygun-602")))).toHaveClass("ant-btn-loading");
    await act(async () => { sozler.shift()!.rej({ response: { status: 409, data: { detail: "Sipariş zaten turda" } } }); await Promise.resolve(); });
    expect(await s1.findByRole("alert")).toHaveTextContent("Sipariş zaten turda");
    await waitFor(() => expect(ekle).toHaveBeenCalledTimes(2));
    expect(ekle).toHaveBeenLastCalledWith({ runId: 77, orderIds: [602] });
    await act(async () => { sozler.shift()!.res(PLANLI); await Promise.resolve(); });
    expect(await screen.findByText("Sipariş tura eklendi.")).toBeInTheDocument();
    fireEvent.click(dugme("Tümünü ekle"));
    await waitFor(() => expect(ekle).toHaveBeenLastCalledWith({ runId: 77, orderIds: [601, 602] }));
    await act(async () => { sozler.shift()!.rej({ response: { status: 500, data: { detail: "Toplu ekleme başarısız" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Toplu ekleme başarısız")).toBeInTheDocument();
    expect(s1.getByRole("alert")).toHaveTextContent("Sipariş zaten turda");
  });

  it("hazır siparişler: boşken yeni Siparişler bağlantısı; hata + yalnız kendi refetch'i; yükleniyor", async () => {
    vi.mocked(useEligibleOrders).mockReturnValue(sonuc([]));
    const a = kur();
    expect(screen.getByRole("link", { name: "Siparişler" })).toHaveAttribute("href", ROUTES.adminNewDeliveryOrders);
    expect(screen.queryByRole("button", { name: /Tümünü ekle/ })).not.toBeInTheDocument();
    a.unmount();
    const refetch = vi.fn();
    vi.mocked(useEligibleOrders).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Havuz çöktü" } } }, refetch }));
    const b = kur();
    expect(screen.getByText("Havuz çöktü")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Havuz çöktü").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useDeliveryRun).mock.results.at(-1)?.value.refetch).not.toHaveBeenCalled();
    b.unmount();
    vi.mocked(useEligibleOrders).mockReturnValue(sonuc(undefined, { isPending: true }));
    kur();
    expect(screen.getByText("Hazır siparişler yükleniyor…")).toBeInTheDocument();
  });

  it("etiket yüzeyi yalnız istek üzerine açılır ve kapanır", async () => {
    kur();
    expect(screen.queryByTestId("etiketler")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Etiketler" }));
    expect(screen.getByTestId("etiketler")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Etiketi kapat" }));
    expect(screen.queryByTestId("etiketler")).not.toBeInTheDocument();
  });

  describe("tur yazma koordinasyonu", () => {
    const hepsiSayisi = () => aksiyon.mock.calls.length + optimize.mock.calls.length + kurye.mock.calls.length + sirala.mock.calls.length + cikar.mock.calls.length + ekle.mock.calls.length;

    it("start sürerken optimize/iptal/reorder/remove/kurye/ekle yeni istek üretmez; kontroller kapalı ve neden görünür; hata sonrası kilit bırakılır", async () => {
      const u = userEvent.setup({ pointerEventsCheck: 0 });
      kur();
      fireEvent.click(dugme("Turu Başlat"));
      expect(aksiyon).toHaveBeenCalledTimes(1);
      // Görünür durum: diğer kontroller kapalı, neden title'da.
      expect(dugme("Rotayı Optimize Et")).toBeDisabled();
      expect(dugme("Rotayı Optimize Et")).toHaveAttribute("title", "Turda başka bir işlem sürüyor.");
      expect(dugme("İptal")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Durak 4 yukarı taşı" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Durak 4 yukarı taşı" })).toHaveAttribute("title", "Turda başka bir işlem sürüyor.");
      expect(screen.getByRole("button", { name: "Durak 4 turdan çıkar" })).toBeDisabled();
      expect(screen.getByRole("combobox", { name: "Kurye" })).toBeDisabled();
      expect(dugme("Ekle", within(screen.getByTestId("uygun-601")))).toBeDisabled();
      expect(dugme("Tümünü ekle")).toBeDisabled();
      // Kapalı kontrollere rağmen doğrudan tetikleme denemeleri de istek üretmez (senkron kilit).
      fireEvent.click(dugme("Rotayı Optimize Et"));
      fireEvent.click(dugme("İptal"));
      fireEvent.click(screen.getByRole("button", { name: "Durak 4 yukarı taşı" }));
      fireEvent.click(screen.getByRole("button", { name: "Durak 4 turdan çıkar" }));
      fireEvent.click(dugme("Ekle", within(screen.getByTestId("uygun-601"))));
      fireEvent.click(dugme("Tümünü ekle"));
      await act(async () => { await Promise.resolve(); });
      expect(onayGorunur()).toBe(false);
      expect(hepsiSayisi()).toBe(1);
      // Hata → kilit bırakılır; farklı işlem (optimize) çalışır.
      await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Başlatılamadı" } } }); await Promise.resolve(); });
      expect(await screen.findByText("Başlatılamadı")).toBeInTheDocument();
      await waitFor(() => expect(dugme("Rotayı Optimize Et")).toBeEnabled());
      await u.click(dugme("Rotayı Optimize Et"));
      expect(optimize).toHaveBeenCalledTimes(1);
      // optimize sürerken start/iptal üretmez.
      fireEvent.click(dugme("Turu Başlat"));
      fireEvent.click(dugme("İptal"));
      expect(aksiyon).toHaveBeenCalledTimes(1);
      expect(onayGorunur()).toBe(false);
      await act(async () => { sozler.pop()!.res(PLANLI); await Promise.resolve(); });
    });

    it("add_stops kuyruğu varken tur aksiyonu/yapısal işlem üretmez; özel yazım varken ekleme üretmez; farklı siparişler sırayla iki istek", async () => {
      kur();
      fireEvent.click(dugme("Ekle", within(screen.getByTestId("uygun-601"))));
      fireEvent.click(dugme("Ekle", within(screen.getByTestId("uygun-602"))));
      await waitFor(() => expect(ekle).toHaveBeenCalledTimes(1));
      // Kuyrukta 602 beklerken: tur aksiyonları ve yapısal işlemler kapalı, neden görünür.
      expect(dugme("Turu Başlat")).toBeDisabled();
      expect(dugme("Turu Başlat")).toHaveAttribute("title", "Tura sipariş ekleniyor; bitince deneyin.");
      fireEvent.click(dugme("Turu Başlat"));
      fireEvent.click(dugme("Rotayı Optimize Et"));
      fireEvent.click(dugme("İptal"));
      fireEvent.click(screen.getByRole("button", { name: "Durak 4 yukarı taşı" }));
      fireEvent.click(screen.getByRole("button", { name: "Durak 4 turdan çıkar" }));
      await act(async () => { await Promise.resolve(); });
      expect(aksiyon).not.toHaveBeenCalled();
      expect(optimize).not.toHaveBeenCalled();
      expect(sirala).not.toHaveBeenCalled();
      expect(cikar).not.toHaveBeenCalled();
      expect(onayGorunur()).toBe(false);
      // Sıralı: 601 bitince 602 gönderilir; paralel değil.
      await act(async () => { sozler.shift()!.res(PLANLI); await Promise.resolve(); });
      await waitFor(() => expect(ekle).toHaveBeenCalledTimes(2));
      expect(ekle).toHaveBeenLastCalledWith({ runId: 77, orderIds: [602] });
      await act(async () => { sozler.shift()!.res(PLANLI); await Promise.resolve(); });
      await waitFor(() => expect(dugme("Turu Başlat")).toBeEnabled());
      // Özel yazım (reorder) sürerken ekleme üretmez.
      fireEvent.click(screen.getByRole("button", { name: "Durak 4 yukarı taşı" }));
      expect(sirala).toHaveBeenCalledTimes(1);
      fireEvent.click(dugme("Ekle", within(screen.getByTestId("uygun-601"))));
      await act(async () => { await Promise.resolve(); });
      expect(ekle).toHaveBeenCalledTimes(2);
      await act(async () => { sozler.shift()!.res(PLANLI); await Promise.resolve(); });
    });

    it("reorder/remove çakışması tek mutation; yukarı ve aşağı düğmeleri reorder pending'ini aynı biçimde gösterir", async () => {
      const u = userEvent.setup({ pointerEventsCheck: 0 });
      kur();
      fireEvent.click(screen.getByRole("button", { name: "Durak 4 yukarı taşı" }));
      expect(sirala).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: /Durak 4 yukarı taşı/ })).toHaveClass("ant-btn-loading");
      expect(screen.getByRole("button", { name: /Durak 4 aşağı taşı/ })).toHaveClass("ant-btn-loading");
      expect(screen.getByRole("button", { name: /Durak 5 yukarı taşı/ })).toHaveClass("ant-btn-loading");
      fireEvent.click(screen.getByRole("button", { name: /Durak 5 yukarı taşı/ }));
      fireEvent.click(screen.getByRole("button", { name: /Durak 4 turdan çıkar/ }));
      await act(async () => { await Promise.resolve(); });
      expect(sirala).toHaveBeenCalledTimes(1);
      expect(cikar).not.toHaveBeenCalled();
      expect(onayGorunur()).toBe(false);
      await act(async () => { sozler.pop()!.res(PLANLI); await Promise.resolve(); });
      await waitFor(() => expect(screen.getByRole("button", { name: "Durak 4 yukarı taşı" })).not.toHaveClass("ant-btn-loading"));
      // Remove sürerken reorder/optimize üretmez; onay pending koruması bozulmaz.
      await u.click(screen.getByRole("button", { name: "Durak 4 turdan çıkar" }));
      await u.click(onayDugmesi(/Turdan çıkar/));
      expect(cikar).toHaveBeenCalledTimes(1);
      await u.click(onayDugmesi(/Vazgeç/));
      expect(onayGorunur()).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: /Durak 5 yukarı taşı/ }));
      await act(async () => { await Promise.resolve(); });
      expect(sirala).toHaveBeenCalledTimes(1);
      await act(async () => { sozler.pop()!.res(PLANLI); await Promise.resolve(); });
      await waitFor(() => expect(onayGorunur()).toBe(false));
    });

    it("sürükle-bırak da kilide uyar: reorder/başlat sürerken bırakma istek üretmez; ekleme zincirinde ilk hata sonraki eklemeyi durdurmaz", async () => {
      kur();
      const dt = { effectAllowed: "" };
      fireEvent.click(screen.getByRole("button", { name: "Durak 4 yukarı taşı" }));
      expect(sirala).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("durak-5")).not.toHaveAttribute("draggable", "true");
      fireEvent.dragStart(screen.getByTestId("durak-5"), { dataTransfer: dt });
      fireEvent.drop(screen.getByTestId("durak-3"), { dataTransfer: dt });
      expect(sirala).toHaveBeenCalledTimes(1);
      // Reorder hatası: kilit tazeleme bitene kadar tutulur, sonra bırakılır.
      await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Sıra bayat" } } }); await Promise.resolve(); });
      expect(await screen.findByText("Sıra bayat")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole("button", { name: "Durak 4 yukarı taşı" })).toBeEnabled());
      // Ekleme zinciri: 601 hata verse de kuyruktaki 602 gönderilir.
      fireEvent.click(dugme("Ekle", within(screen.getByTestId("uygun-601"))));
      fireEvent.click(dugme("Ekle", within(screen.getByTestId("uygun-602"))));
      await waitFor(() => expect(ekle).toHaveBeenCalledTimes(1));
      await act(async () => { sozler.shift()!.rej({ response: { status: 409, data: { detail: "601 zaten turda" } } }); await Promise.resolve(); });
      await waitFor(() => expect(ekle).toHaveBeenCalledTimes(2));
      expect(ekle).toHaveBeenLastCalledWith({ runId: 77, orderIds: [602] });
      expect(await within(screen.getByTestId("uygun-601")).findByRole("alert")).toHaveTextContent("601 zaten turda");
      await act(async () => { sozler.shift()!.res(PLANLI); await Promise.resolve(); });
      await waitFor(() => expect(dugme("Turu Başlat")).toBeEnabled());
    });

    it("kurye ataması sürerken tur durum geçişi gönderilmez; ataması bitince serbest", async () => {
      const u = userEvent.setup({ pointerEventsCheck: 0 });
      kur();
      await u.click(screen.getByRole("combobox", { name: "Kurye" }));
      await u.click(await screen.findByTitle("Zeynep Kurye"));
      expect(kurye).toHaveBeenCalledTimes(1);
      fireEvent.click(dugme("Turu Başlat"));
      fireEvent.click(dugme("İptal"));
      await act(async () => { await Promise.resolve(); });
      expect(aksiyon).not.toHaveBeenCalled();
      expect(onayGorunur()).toBe(false);
      await act(async () => { sozler.pop()!.res(PLANLI); await Promise.resolve(); });
      await waitFor(() => expect(dugme("Turu Başlat")).toBeEnabled());
      fireEvent.click(dugme("Turu Başlat"));
      expect(aksiyon).toHaveBeenCalledTimes(1);
    });
  });

  it("rota ve menü: detay rotası Turlar yaprağını seçili tutar; ayrı menü öğesi yok", () => {
    expect(PATHS.adminNewDeliveryRunDetail).toBe("/yonetim-yeni/dagitim/turlar/:id");
    expect(ROUTES.adminNewDeliveryRun(77)).toBe("/yonetim-yeni/dagitim/turlar/77");
    expect(rotaIzniBul(PANEL_MENU, ROUTES.adminNewDeliveryRun(77))).toMatchObject({ label: "Turlar", requiredPermission: "delivery" });
    expect(seciliMenuDurumu(PANEL_MENU, ROUTES.adminNewDeliveryRun(77))).toEqual({ selectedKey: "dagitim-turlar", openKeys: ["dagitim"] });
    expect(PANEL_MENU.find((m) => m.key === "dagitim")?.children?.map((c) => c.label)).toEqual(["Bugün", "Siparişler", "Turlar", "Performans", "Kuryeler", "Tahta", "Araçlar"]);
  });
});
