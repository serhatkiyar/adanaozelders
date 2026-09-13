import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { DagitimTahtasi, aktifDurakSayisi, aracAdi, dagitilabilirSayisi, dagitimAdaylari, dolulukMetni, duraklariSirala, tavaniAsarMi, turlariSirala, tutarMetni } from "@/panel/pages/dagitim/DagitimTahtasi";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { todayIso } from "@/components/admin/delivery/bits";
import { useAddBoardStops, useDeliveryBoard, useDispatchDay, useVehicles } from "@/hooks/useDelivery";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { BoardRun } from "@/api/delivery";
import type { Vehicle } from "@/types";

vi.mock("@/hooks/useDelivery", () => ({
  useAddBoardStops: vi.fn(),
  useDeliveryBoard: vi.fn(),
  useDispatchDay: vi.fn(),
  useVehicles: vi.fn(),
  // `tarihNo` DagitimBugun'dan içe aktarılıyor; o modülün hook adları da bağlanmalı.
  useAttentionOrders: vi.fn(),
  useCreateDeliveryRun: vi.fn(),
  useDeliveryRuns: vi.fn(),
  useEligibleOrders: vi.fn(),
  useRetryExhausted: vi.fn(),
  useRoutingHealth: vi.fn(),
  useRunPosition: vi.fn(),
}));

const m = { ekle: vi.fn(), optimize: vi.fn() };
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
const ertelenmis = () => new Promise((res, rej) => { sozler.push({ res, rej }); });

const arac = (ek: Partial<Vehicle> = {}): Vehicle => ({ id: 1, code: "DOBLO", label: "Doblo", plate: null, profile: "car", max_stops: 3, shift_start: null, shift_end: null, fixed_cost: 0, start_point_id: null, sort_order: 0, is_active: true, ...ek });
const ARACLAR = [arac(), arac({ id: 2, code: "MOTO", label: "Motor", max_stops: null })];
const HAVUZ = [
  { order_id: 501, recipient: "Ayşe Yılmaz", address: "Atatürk Cad. 5", total: "1250.50", lat: 36.98, lng: 35.32 },
  { order_id: 502, recipient: null, address: null, total: null, lat: null, lng: null },
  { order_id: 503, recipient: "Mehmet Kaya", address: "Bahçe Sok. 2", total: "80", lat: 37.0, lng: 35.4, promised_delivery_date: "2026-08-16" },
  // Konumlu ama sözü İLERİ tarihli: backend `dispatch_day` bugünkü adaylara almaz.
  { order_id: 504, recipient: "Zeynep Demir", address: "İleri Sok. 9", total: "40", lat: 36.9, lng: 35.3, promised_delivery_date: "2099-01-01" },
];
const TURLAR: BoardRun[] = [
  {
    id: 77, vehicle_id: 1, vehicle: "Sunucu Etiketi", status: "PLANNED", courier: { id: 3, name: "Arif Kıyar" },
    stops: [
      { id: 11, order_id: 601, sequence: 2, status: "PENDING", address: "İkinci durak" },
      { id: 10, order_id: 600, sequence: 1, status: "DELIVERED", address: "Birinci durak" },
      { id: 12, order_id: 602, sequence: 3, status: "CANCELLED", address: "İptal durak" },
    ],
  },
  { id: 42, vehicle_id: 2, status: "ACTIVE", courier: null, stops: [] },
];
const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const son = (h: unknown) => vi.mocked(h as () => unknown).mock.calls.at(-1);

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}
let konum = { pathname: "", search: "" };
let git: (n: number) => void = () => {};
function Izci() {
  const l = useLocation();
  git = useNavigate();
  konum = { pathname: l.pathname, search: l.search };
  return null;
}
function agac(girisler: string[] = [PATHS.adminNewDeliveryBoard]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={girisler} initialIndex={girisler.length - 1}>
          <Izci />
          <Routes>
            <Route path={PATHS.adminNewDeliveryBoard} element={<DagitimTahtasi />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = (girisler?: string[]) => render(agac(girisler));
const havuzSatiri = (id: number) => screen.getByTestId(`havuz-siparis-${id}`);
const turSeridi = (id: number) => screen.getByTestId(`tur-${id}`);
// AntD yükleniyor simgesi jsdom'da erişilebilir ada "loading" ekler; ad sonuna göre eşlenir.
const ekleDugmesi = (id: number) => within(havuzSatiri(id)).getByRole("button", { name: new RegExp(`Sipariş #${id} için tura ekle$`) });
/** jsdom'da `dataTransfer` yoktur; sürükleme beyanı (setData/effectAllowed) için taşıyıcı verilir. */
const dt = () => ({ setData: vi.fn(), effectAllowed: "", dropEffect: "" });
const onayGorunur = () => [...document.querySelectorAll(".ant-modal-confirm")].some((x) => !x.classList.contains("ant-zoom-leave"));
const onayDugmesi = (ad: RegExp) => {
  const acik = [...document.querySelectorAll(".ant-modal-confirm")].filter((x) => !x.classList.contains("ant-zoom-leave"));
  return within(acik[acik.length - 1] as HTMLElement).getByRole("button", { name: ad });
};
/** AntD Select: açar ve seçeneği metinle tıklar. */
async function turSec(siparisId: number, etiket: string) {
  const secici = within(havuzSatiri(siparisId)).getByRole("combobox");
  fireEvent.mouseDown(secici);
  // Kapanmakta olan önceki açılır listeler DOM'da kalır: yalnız AÇIK olanın son seçeneği tıklanır.
  const secenek = await waitFor(() => {
    const acik = [...document.querySelectorAll(".ant-select-dropdown")].filter((d) => !d.classList.contains("ant-select-dropdown-hidden"));
    const bulunan = acik.length > 0 ? [...acik[acik.length - 1].querySelectorAll(".ant-select-item-option-content")].find((e) => e.textContent === etiket) : undefined;
    if (!bulunan) throw new Error("seçenek yok");
    return bulunan;
  });
  fireEvent.click(secenek);
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset().mockImplementation(ertelenmis);
  sozler.length = 0;
  vi.mocked(useDeliveryBoard).mockReset().mockReturnValue(sonuc({ unassigned: HAVUZ, runs: TURLAR }));
  vi.mocked(useVehicles).mockReset().mockReturnValue(sonuc(ARACLAR));
  vi.mocked(useAddBoardStops).mockReturnValue({ mutateAsync: m.ekle, isPending: false } as never);
  vi.mocked(useDispatchDay).mockReturnValue({ mutateAsync: m.optimize, isPending: false } as never);
  izin("delivery.view", "delivery.manage");
});

describe("saf kurallar", () => {
  it("CANCELLED durak kapasiteye sayılmaz; turlar id artan, duraklar sequence artan; araç adı yedekleri; doluluk metni ve aşım yalnız açık tavanda", () => {
    expect(aktifDurakSayisi(TURLAR[0])).toBe(2);
    expect(aktifDurakSayisi(TURLAR[1])).toBe(0);
    expect(turlariSirala(TURLAR).map((r) => r.id)).toEqual([42, 77]);
    expect(duraklariSirala(TURLAR[0]).map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(aracAdi(TURLAR[0], ARACLAR[0])).toBe("Doblo");
    expect(aracAdi(TURLAR[0], undefined)).toBe("Sunucu Etiketi");
    expect(aracAdi(TURLAR[1], undefined)).toBe("Araç 2");
    expect(dolulukMetni(2, 3)).toBe("2/3 durak");
    expect(dolulukMetni(4, null)).toBe("4 durak · varsayılan tavan");
    expect(dolulukMetni(4, null)).not.toMatch(/sınırsız/);
    expect(tavaniAsarMi(4, 3)).toBe(true);
    expect(tavaniAsarMi(3, 3)).toBe(false);
    // `max_stops = null` sunucu varsayılanıdır: istemci aşım hesaplamaz.
    expect(tavaniAsarMi(9999, null)).toBe(false);
    // Aday filtresi backend ile birebir: konum + söz tarihi <= seçili gün (ya da sözsüz).
    expect(dagitimAdaylari(HAVUZ, "2026-09-13").map((o) => o.order_id)).toEqual([501, 503]);
    expect(dagitilabilirSayisi(HAVUZ, "2026-09-13")).toBe(2);
    // Söz tarihi seçili günden ileri → aday değil; o güne ilerletilince aday.
    expect(dagitilabilirSayisi(HAVUZ, "2026-08-15")).toBe(1);
    expect(dagitimAdaylari(HAVUZ, "2099-01-01").map((o) => o.order_id)).toEqual([501, 503, 504]);
  });

  it("tutar biçimi: geçerli sayı tr-TR TRY; geçersiz/boş değer ekranı çökertmez", () => {
    expect(tutarMetni("1250.50")).toBe(new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(1250.5));
    expect(tutarMetni("1250.50")).toMatch(/1\.250,50/);
    expect(tutarMetni(80)).toMatch(/80,00/);
    expect(tutarMetni(0)).toMatch(/0,00/);
    for (const ham of [null, undefined, "", "abc", NaN, "12,50 TL"]) expect(tutarMetni(ham as never)).toBeNull();
  });
});

describe("DagitimTahtasi", () => {
  it("delivery.view yokken AccessDenied ve iki sorgu da kapalı", () => {
    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(useDeliveryBoard)).toEqual([todayIso(), false]);
    expect(son(useVehicles)).toEqual([false]);
  });

  it("view-only: tahta salt okunur — sürükleme, Tura ekle ve Günü Optimize Et yok, açıklama görünür; sorgular açık", () => {
    izin("delivery.view");
    kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(son(useDeliveryBoard)).toEqual([todayIso(), true]);
    expect(son(useVehicles)).toEqual([true]);
    expect(screen.queryByRole("button", { name: /Günü Optimize Et/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tura ekle/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(havuzSatiri(501)).not.toHaveAttribute("draggable", "true");
    // PII yalnız view kapısından sonra çizilir; URL'ye taşınmaz.
    expect(within(havuzSatiri(501)).getByText("Ayşe Yılmaz")).toBeInTheDocument();
    expect(konum.search).toBe("");
  });

  it("havuz ve turlar: satır alanları, fallback metinleri, yeni panel linkleri, durum etiketi, sıralama, koordinat metni yok, iç içe a/button yok", () => {
    kur();
    const h1 = within(havuzSatiri(501));
    expect(h1.getByText("Ayşe Yılmaz")).toBeInTheDocument();
    expect(h1.getByText("Atatürk Cad. 5")).toBeInTheDocument();
    expect(h1.getByText(tutarMetni("1250.50")!)).toBeInTheDocument();
    expect(h1.getByRole("link", { name: "#501" })).toHaveAttribute("href", ROUTES.adminNewOrder(501));
    const h2 = within(havuzSatiri(502));
    expect(h2.getByText("Sipariş")).toBeInTheDocument();
    expect(h2.getByText("Adres yok")).toBeInTheDocument();
    expect(h2.queryByText(/₺/)).not.toBeInTheDocument();
    // Turlar id artan: 42 önce, 77 sonra.
    const sira = [...document.querySelectorAll('[data-testid^="tur-"]')].map((e) => e.getAttribute("data-testid"));
    expect(sira).toEqual(["tur-42", "tur-77"]);
    const t77 = within(turSeridi(77));
    expect(t77.getByRole("link", { name: "Tur #77" })).toHaveAttribute("href", ROUTES.adminNewDeliveryRun(77));
    expect(t77.getByText("Doblo")).toBeInTheDocument();
    expect(t77.getByText("Arif Kıyar")).toBeInTheDocument();
    expect(t77.getByText("2/3 durak")).toBeInTheDocument();
    expect(t77.getByText("Planlanıyor")).toBeInTheDocument();
    const t42 = within(turSeridi(42));
    expect(t42.getByText("Motor")).toBeInTheDocument();
    expect(t42.getByText("Kurye atanmadı")).toBeInTheDocument();
    expect(t42.getByText("0 durak · varsayılan tavan")).toBeInTheDocument();
    expect(t42.getByText("Sahada")).toBeInTheDocument();
    expect(t42.getByText(/Durak yok/)).toBeInTheDocument();
    // Duraklar sequence artan; CANCELLED durak listede ama kapasiteye sayılmadı.
    const duraklar = t77.getAllByText(/^(Birinci|İkinci|İptal) durak$/).map((e) => e.textContent);
    expect(duraklar).toEqual(["Birinci durak", "İkinci durak", "İptal durak"]);
    // Koordinatlar metin olarak basılmaz.
    expect(screen.queryByText(/36\.98|35\.32|37(\.0)?, ?35\.4/)).not.toBeInTheDocument();
    expect(document.querySelectorAll("a button, button a, a a, button button")).toHaveLength(0);
  });

  it("boş havuz ve tur yok durumları ayrı gösterilir", () => {
    vi.mocked(useDeliveryBoard).mockReturnValue(sonuc({ unassigned: [], runs: [] }));
    kur();
    expect(screen.getByText("Havuz boş")).toBeInTheDocument();
    expect(screen.getByText("Dağıtım bekleyen atanmamış sipariş yok.")).toBeInTheDocument();
    expect(screen.getByText("Bu tarihte tur yok")).toBeInTheDocument();
    expect(screen.getByText(/Günü Optimize Et ile araçlara bölüştürün/)).toBeInTheDocument();
  });

  it("tarih: katı YYYY-MM-DD; geçersiz değer sunucuya gitmez; bugünde yalnız tarih anahtarı silinir, ilgisiz parametre korunur; replace; geri/ileri eşleşir", async () => {
    const a = kur([`${PATHS.adminNewDeliveryBoard}?tarih=2026-13-45&sekme=x`]);
    expect(son(useDeliveryBoard)).toEqual([todayIso(), true]);
    expect(screen.getByLabelText("Tarih")).toHaveValue(todayIso());
    fireEvent.change(screen.getByLabelText("Tarih"), { target: { value: "2026-02-30" } });
    expect(son(useDeliveryBoard)).toEqual([todayIso(), true]);
    fireEvent.change(screen.getByLabelText("Tarih"), { target: { value: "2026-08-16" } });
    expect(son(useDeliveryBoard)).toEqual(["2026-08-16", true]);
    const sorgu = new URLSearchParams(konum.search);
    expect(sorgu.get("tarih")).toBe("2026-08-16");
    expect(sorgu.get("sekme")).toBe("x");
    fireEvent.change(screen.getByLabelText("Tarih"), { target: { value: todayIso() } });
    expect(konum.search).toBe("?sekme=x");
    a.unmount();
    kur([`${PATHS.adminNewDeliveryBoard}?tarih=2026-08-16`, `${PATHS.adminNewDeliveryBoard}?tarih=2026-08-17`]);
    expect(screen.getByLabelText("Tarih")).toHaveValue("2026-08-17");
    git(-1);
    await waitFor(() => expect(screen.getByLabelText("Tarih")).toHaveValue("2026-08-16"));
    expect(son(useDeliveryBoard)).toEqual(["2026-08-16", true]);
    git(1);
    await waitFor(() => expect(screen.getByLabelText("Tarih")).toHaveValue("2026-08-17"));
    expect(son(useDeliveryBoard)).toEqual(["2026-08-17", true]);
  });

  it("sürükle-bırak gerçek payload üretir; sürükleme sırasında tur şeritleri işaretlenir; drag end ve tarih değişimi state'i temizler", async () => {
    kur();
    expect(turSeridi(42)).not.toHaveStyle({ outline: `1px dashed ${"rgb(255, 153, 0)"}` });
    fireEvent.dragStart(havuzSatiri(501), { dataTransfer: dt() });
    await waitFor(() => expect(turSeridi(42).style.outline).toContain("dashed"));
    expect(turSeridi(77).style.outline).toContain("dashed");
    fireEvent.drop(turSeridi(42), { dataTransfer: dt() });
    await waitFor(() => expect(m.ekle).toHaveBeenCalledTimes(1));
    expect(m.ekle).toHaveBeenCalledWith({ runId: 42, orderIds: [501] });
    await waitFor(() => expect(turSeridi(42).style.outline).toBe(""));
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByText("Sipariş #501 Tur #42'e eklendi.")).toBeInTheDocument();
    // Drag end state'i temizler: bırakma isteği üretmez.
    fireEvent.dragStart(havuzSatiri(503), { dataTransfer: dt() });
    fireEvent.dragEnd(havuzSatiri(503));
    fireEvent.drop(turSeridi(42), { dataTransfer: dt() });
    await act(async () => { await Promise.resolve(); });
    expect(m.ekle).toHaveBeenCalledTimes(1);
    // Tarih değişimi sürüklemeyi temizler.
    fireEvent.dragStart(havuzSatiri(503), { dataTransfer: dt() });
    fireEvent.change(screen.getByLabelText("Tarih"), { target: { value: "2026-08-16" } });
    fireEvent.drop(turSeridi(42), { dataTransfer: dt() });
    await act(async () => { await Promise.resolve(); });
    expect(m.ekle).toHaveBeenCalledTimes(1);
  });

  it("klavye/dokunma 'Tura ekle' aynı payload'ı üretir; hedef tur seçilebilir; hata satırda görünür ve yeniden denenir", async () => {
    kur();
    // Varsayılan hedef ilk tur (id artan: 42).
    fireEvent.click(ekleDugmesi(501));
    await waitFor(() => expect(m.ekle).toHaveBeenCalledWith({ runId: 42, orderIds: [501] }));
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Sipariş zaten turda" } } }); await Promise.resolve(); });
    expect(await within(havuzSatiri(501)).findByText("Sipariş zaten turda")).toBeInTheDocument();
    await turSec(501, "Tur #77 · Doblo");
    fireEvent.click(ekleDugmesi(501));
    await waitFor(() => expect(m.ekle).toHaveBeenCalledTimes(2));
    expect(m.ekle).toHaveBeenLastCalledWith({ runId: 77, orderIds: [501] });
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    await waitFor(() => expect(within(havuzSatiri(501)).queryByText("Sipariş zaten turda")).not.toBeInTheDocument());
  });

  it("yazma koordinasyonu: aynı sipariş çift gönderilmez; aynı tura farklı siparişler sıralı; ilk hata kuyruğu durdurmaz; farklı turlar paralel", async () => {
    kur();
    fireEvent.click(ekleDugmesi(501));
    fireEvent.click(ekleDugmesi(501));
    await waitFor(() => expect(m.ekle).toHaveBeenCalledTimes(1));
    // Aynı tura ikinci sipariş: sıraya alınır, ilk bitmeden gitmez.
    fireEvent.click(ekleDugmesi(502));
    await act(async () => { await Promise.resolve(); });
    expect(m.ekle).toHaveBeenCalledTimes(1);
    // Farklı tur: paralel çıkar.
    await turSec(503, "Tur #77 · Doblo");
    fireEvent.click(ekleDugmesi(503));
    await waitFor(() => expect(m.ekle).toHaveBeenCalledTimes(2));
    expect(m.ekle).toHaveBeenLastCalledWith({ runId: 77, orderIds: [503] });
    // İlk halka hata verse de kuyruktaki ikinci sipariş gönderilir.
    await act(async () => { sozler.shift()!.rej({ response: { status: 500, data: { detail: "Sunucu hatası" } } }); await Promise.resolve(); });
    await waitFor(() => expect(m.ekle).toHaveBeenCalledTimes(3));
    expect(m.ekle).toHaveBeenLastCalledWith({ runId: 42, orderIds: [502] });
    expect(await within(havuzSatiri(501)).findByText("Sunucu hatası")).toBeInTheDocument();
    // Kilit kesin bırakılır: 42 zinciri boşalınca aynı sipariş yeniden gönderilebilir.
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    fireEvent.click(ekleDugmesi(501));
    await waitFor(() => expect(m.ekle).toHaveBeenCalledTimes(4));
    expect(m.ekle).toHaveBeenLastCalledWith({ runId: 42, orderIds: [501] });
  });

  it("kapasite: açık tavan aşılınca uyarı görünür ama istek yine gider; null tavanda uyarı hesaplanmaz; uyarı tarih değişince temizlenir", async () => {
    // Doblo max_stops=3, aktif durak 2 → +1 = 3, aşmıyor; max_stops=2 yaparsak aşar.
    vi.mocked(useVehicles).mockReturnValue(sonuc([arac({ max_stops: 2 }), ARACLAR[1]]));
    kur();
    expect(screen.queryByTestId("kapasite-uyarisi-77")).not.toBeInTheDocument();
    // Zaten 2/2 dolu; +1 aşar.
    await turSec(501, "Tur #77 · Doblo");
    fireEvent.click(ekleDugmesi(501));
    // Uyarıya rağmen istek GİTTİ (D-12); kalıcı uyarı başarıdan sonra yazılır.
    await waitFor(() => expect(m.ekle).toHaveBeenCalledWith({ runId: 77, orderIds: [501] }));
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByTestId("kapasite-uyarisi-77")).toBeInTheDocument();
    expect(within(screen.getByTestId("kapasite-uyarisi-77")).getByText(/Ekleme engellenmedi: karar operatörün/)).toBeInTheDocument();
    // Sınırsız tavanlı araçta (max_stops=null) uyarı hiç doğmaz.
    fireEvent.click(ekleDugmesi(503));
    await waitFor(() => expect(m.ekle).toHaveBeenLastCalledWith({ runId: 42, orderIds: [503] }));
    expect(screen.queryByTestId("kapasite-uyarisi-42")).not.toBeInTheDocument();
    expect(screen.queryByText(/sınırsız/i)).not.toBeInTheDocument();
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("Tarih"), { target: { value: "2026-08-16" } });
    await waitFor(() => expect(screen.queryByTestId("kapasite-uyarisi-77")).not.toBeInTheDocument());
  });

  it("optimize: dağıtılabilir sayısı, onay metni, aynı tick çift onay tek mutation, pending'de kapanmaz, hata açık kalır, başarı metinleri ve uyarı temizliği", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    // 504 konumlu ama sözü ileri tarihli: sayıya girmez.
    const dugme = screen.getByRole("button", { name: /Günü Optimize Et \(2\)/ });
    expect(dugme).toHaveAttribute("title", "2 konumlu sipariş dağıtım için değerlendirilecek.");
    await u.click(dugme);
    expect(await screen.findByText("2 konumlu sipariş aktif filo araçlarına dağıtılmak üzere değerlendirilecek ve turlar optimize edilecek. Araç kapasitesine sığmayan siparişler havuzda kalabilir; mevcut planlı turlara durak eklenebilir.")).toBeInTheDocument();
    await u.dblClick(onayDugmesi(/Turları kur/));
    expect(m.optimize).toHaveBeenCalledTimes(1);
    expect(m.optimize).toHaveBeenCalledWith(todayIso());
    // Pending'de Vazgeç kapatmaz.
    await u.click(onayDugmesi(/Vazgeç/));
    expect(onayGorunur()).toBe(true);
    await act(async () => { sozler.pop()!.rej({ response: { status: 500, data: { detail: "Rota servisi kapalı" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Rota servisi kapalı")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi(/Turları kur/)).not.toHaveClass("ant-btn-loading"));
    await u.click(onayDugmesi(/Turları kur/));
    expect(m.optimize).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res([{ id: 1 }, { id: 2 }]); await Promise.resolve(); });
    expect(await screen.findByText("Gün 2 araca bölüştürüldü.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
    // Tek tur metni.
    await u.click(screen.getByRole("button", { name: /Günü Optimize Et/ }));
    await u.click(onayDugmesi(/Turları kur/));
    await act(async () => { sozler.pop()!.res([{ id: 9 }]); await Promise.resolve(); });
    expect(await screen.findByText("Günün turu kuruldu ve optimize edildi.")).toBeInTheDocument();
  });

  it("optimize düğmesi: yükleniyor / yüklenemedi / konumlu sipariş yok nedenleriyle kapalı", async () => {
    vi.mocked(useDeliveryBoard).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    let dugme = screen.getByRole("button", { name: /Günü Optimize Et/ });
    expect(dugme).toBeDisabled();
    expect(dugme).toHaveAttribute("title", "Tahta yükleniyor.");
    a.unmount();
    const refetch = vi.fn();
    vi.mocked(useDeliveryBoard).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Tahta çöktü" } } }, refetch }));
    const b = kur();
    dugme = screen.getByRole("button", { name: /Günü Optimize Et/ });
    expect(dugme).toBeDisabled();
    expect(dugme).toHaveAttribute("title", "Tahta yüklenemedi: dağıtılacak sipariş sayısı bilinmiyor.");
    expect(screen.getByText("Tahta çöktü")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Tahta çöktü").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    b.unmount();
    vi.mocked(useDeliveryBoard).mockReturnValue(sonuc({ unassigned: [HAVUZ[1]], runs: TURLAR }));
    kur();
    dugme = screen.getByRole("button", { name: /Günü Optimize Et/ });
    expect(dugme).toBeDisabled();
    expect(dugme).toHaveAttribute("title", "Dağıtılacak konumlu sipariş yok.");
  });

  it("optimize adayı: ileri söz tarihli sipariş bugünkü sayıya ve onay metnine girmez; tarih o güne ilerletilince girer", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur([`${PATHS.adminNewDeliveryBoard}?tarih=2026-08-15`]);
    expect(screen.getByRole("button", { name: /Günü Optimize Et \(1\)/ })).toHaveAttribute("title", "1 konumlu sipariş dağıtım için değerlendirilecek.");
    fireEvent.change(screen.getByLabelText("Tarih"), { target: { value: "2026-08-16" } });
    expect(screen.getByRole("button", { name: /Günü Optimize Et \(2\)/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tarih"), { target: { value: "2099-01-01" } });
    const dugme = screen.getByRole("button", { name: /Günü Optimize Et \(3\)/ });
    await u.click(dugme);
    expect(await screen.findByText(/^3 konumlu sipariş aktif filo araçlarına/)).toBeInTheDocument();
    await u.click(onayDugmesi(/Vazgeç/));
    expect(m.optimize).not.toHaveBeenCalled();
  });

  it("optimize araç kapısı: yükleniyor / bilgi yüklenemedi / aktif araç yok nedenleri; önbellekli veri + tazeleme hatasında açık kalır; board içeriği görünmeye devam eder", () => {
    vi.mocked(useVehicles).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    expect(screen.getByRole("button", { name: /Günü Optimize Et/ })).toHaveAttribute("title", "Araçlar yükleniyor.");
    expect(screen.getByTestId("tur-77")).toBeInTheDocument();
    a.unmount();
    vi.mocked(useVehicles).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x") }));
    const b = kur();
    expect(screen.getByRole("button", { name: /Günü Optimize Et/ })).toHaveAttribute("title", "Aktif araç bilgisi yüklenemedi.");
    expect(screen.getByTestId("havuz-siparis-501")).toBeInTheDocument();
    b.unmount();
    vi.mocked(useVehicles).mockReturnValue(sonuc([arac({ is_active: false }), arac({ id: 2, is_active: false })]));
    const c = kur();
    expect(screen.getByRole("button", { name: /Günü Optimize Et/ })).toHaveAttribute("title", "Aktif araç yok.");
    c.unmount();
    // Önbellekli veri + tazeleme hatası: uyarı görünür ama optimize açık.
    vi.mocked(useVehicles).mockReturnValue(sonuc(ARACLAR, { isError: true, error: new Error("x") }));
    kur();
    expect(screen.getByText(/Araç bilgisi güncellenemedi/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Günü Optimize Et/ })).toBeEnabled();
  });

  it("kapasite uyarısı yalnız BAŞARILI eklemede kalıcı: hata sonrası POST çıkmış olsa da uyarı silinir, yeniden deneme başarınca görünür", async () => {
    vi.mocked(useVehicles).mockReturnValue(sonuc([arac({ max_stops: 2 }), ARACLAR[1]]));
    kur();
    await turSec(501, "Tur #77 · Doblo");
    fireEvent.click(ekleDugmesi(501));
    // Pending: geçici durum görünür, kalıcı uyarı henüz yok.
    expect(await screen.findByTestId("kapasite-bekleyen-77")).toBeInTheDocument();
    expect(screen.queryByTestId("kapasite-uyarisi-77")).not.toBeInTheDocument();
    await waitFor(() => expect(m.ekle).toHaveBeenCalledWith({ runId: 77, orderIds: [501] }));
    // Hata: istek gitti (D-12) ama kalıcı uyarı KALMAZ.
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Sipariş zaten turda" } } }); await Promise.resolve(); });
    expect(await within(havuzSatiri(501)).findByText("Sipariş zaten turda")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("kapasite-bekleyen-77")).not.toBeInTheDocument());
    expect(screen.queryByTestId("kapasite-uyarisi-77")).not.toBeInTheDocument();
    // Yeniden deneme başarırsa uyarı görünür.
    fireEvent.click(ekleDugmesi(501));
    await waitFor(() => expect(m.ekle).toHaveBeenCalledTimes(2));
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    expect(await screen.findByTestId("kapasite-uyarisi-77")).toBeInTheDocument();
  });

  it("aynı tura sıralanmış iki ekleme: birinin hatası diğerinin uyarısını yanlış silmez", async () => {
    vi.mocked(useVehicles).mockReturnValue(sonuc([arac({ max_stops: 2 }), ARACLAR[1]]));
    kur();
    await turSec(501, "Tur #77 · Doblo");
    await turSec(502, "Tur #77 · Doblo");
    fireEvent.click(ekleDugmesi(501));
    fireEvent.click(ekleDugmesi(502));
    await waitFor(() => expect(m.ekle).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("kapasite-bekleyen-77")).toBeInTheDocument();
    // İlk ekleme BAŞARIR → kalıcı uyarı; ikinci ekleme hata verse de uyarı kalır.
    await act(async () => { sozler.shift()!.res(undefined); await Promise.resolve(); });
    await waitFor(() => expect(m.ekle).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("kapasite-uyarisi-77")).toBeInTheDocument();
    await act(async () => { sozler.shift()!.rej({ response: { status: 409, data: { detail: "Olmadı" } } }); await Promise.resolve(); });
    await waitFor(() => expect(screen.queryByTestId("kapasite-bekleyen-77")).not.toBeInTheDocument());
    expect(screen.getByTestId("kapasite-uyarisi-77")).toBeInTheDocument();
  });

  it("optimize ile ekleme çapraz kilitli: optimize sürerken ekleme başlamaz, ekleme kuyruğu varken optimize başlamaz", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    // Ekleme sürerken optimize kapalı ve nedenli.
    fireEvent.click(ekleDugmesi(501));
    await waitFor(() => expect(m.ekle).toHaveBeenCalledTimes(1));
    const optimizeDugmesi = screen.getByRole("button", { name: /Günü Optimize Et/ });
    expect(optimizeDugmesi).toBeDisabled();
    expect(optimizeDugmesi).toHaveAttribute("title", "Tura sipariş ekleniyor; bitince deneyin.");
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByRole("button", { name: /Günü Optimize Et/ })).toBeEnabled());
    // Optimize sürerken ekleme kapalı, nedenli ve sürükleme de istek üretmez.
    await u.click(screen.getByRole("button", { name: /Günü Optimize Et/ }));
    await u.click(onayDugmesi(/Turları kur/));
    expect(m.optimize).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(ekleDugmesi(503)).toBeDisabled());
    expect(ekleDugmesi(503)).toHaveAttribute("title", "Gün optimize ediliyor; bitince deneyin.");
    expect(havuzSatiri(503)).not.toHaveAttribute("draggable", "true");
    fireEvent.drop(turSeridi(42), { dataTransfer: dt() });
    await act(async () => { await Promise.resolve(); });
    expect(m.ekle).toHaveBeenCalledTimes(1);
    await act(async () => { sozler.pop()!.res([{ id: 5 }]); await Promise.resolve(); });
    await waitFor(() => expect(ekleDugmesi(503)).toBeEnabled());
  });

  it("çapraz kilit onay ANINDA da doğrulanır: pencere açıkken başlayan ekleme optimize mutation'ını engeller", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0, delay: null });
    kur();
    await u.click(screen.getByRole("button", { name: /Günü Optimize Et/ }));
    expect(await screen.findByText(/konumlu sipariş aktif filo araçlarına dağıtılmak üzere/)).toBeInTheDocument();
    // Pencere açıkken ekleme başlar (düğme henüz kapalı değildi).
    fireEvent.click(ekleDugmesi(501));
    await waitFor(() => expect(m.ekle).toHaveBeenCalledTimes(1));
    await u.click(onayDugmesi(/Turları kur/));
    expect(m.optimize).not.toHaveBeenCalled();
    expect(onayGorunur()).toBe(true);
    expect((await screen.findAllByText("Tura sipariş ekleniyor; bitince deneyin.")).length).toBeGreaterThan(0);
    // Ekleme bitince aynı pencereden yeniden denenebilir.
    await act(async () => { sozler.pop()!.res(undefined); await Promise.resolve(); });
    await u.click(onayDugmesi(/Turları kur/));
    await waitFor(() => expect(m.optimize).toHaveBeenCalledTimes(1));
  });

  it("araçlar destek sorgusu: veri yok + hata → mesaj ve yalnız kendi refetch'i; önbellek + tazeleme hatası → uyarı ve etiketler kalır; yükleniyor durumu", async () => {
    const aracRefetch = vi.fn();
    const tahtaRefetch = vi.fn();
    vi.mocked(useVehicles).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch: aracRefetch }));
    vi.mocked(useDeliveryBoard).mockReturnValue(sonuc({ unassigned: HAVUZ, runs: TURLAR }, { refetch: tahtaRefetch }));
    const a = kur();
    expect(screen.getByText("Araçlar yüklenemedi.")).toBeInTheDocument();
    // Tahta verisi gizlenmez; araç etiketi yedeğe düşer, sahte kapasite üretilmez.
    expect(within(turSeridi(77)).getByText("Sunucu Etiketi")).toBeInTheDocument();
    expect(within(turSeridi(77)).getByText("2 durak · varsayılan tavan")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Araçlar yüklenemedi.").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(aracRefetch).toHaveBeenCalledTimes(1);
    expect(tahtaRefetch).not.toHaveBeenCalled();
    a.unmount();
    vi.mocked(useVehicles).mockReturnValue(sonuc(ARACLAR, { isError: true, error: new Error("x"), refetch: aracRefetch }));
    const b = kur();
    expect(screen.getByText(/Araç bilgisi güncellenemedi/)).toBeInTheDocument();
    expect(within(turSeridi(77)).getByText("Doblo")).toBeInTheDocument();
    expect(within(turSeridi(77)).getByText("2/3 durak")).toBeInTheDocument();
    b.unmount();
    vi.mocked(useVehicles).mockReturnValue(sonuc(undefined, { isPending: true }));
    kur();
    expect(screen.getByText(/Araçlar yükleniyor/)).toBeInTheDocument();
    expect(within(turSeridi(77)).getByText("Sunucu Etiketi")).toBeInTheDocument();
  });

  it("rota, menü yaprağı (sıra korunur), izin, selectedKey/openKeys", () => {
    expect(PATHS.adminNewDeliveryBoard).toBe("/yonetim-yeni/dagitim/tahta");
    expect(ROUTES.adminNewDeliveryBoard).toBe(PATHS.adminNewDeliveryBoard);
    const grup = PANEL_MENU.find((g) => g.key === "dagitim");
    expect(grup?.children?.map((c) => c.label)).toEqual(["Bugün", "Siparişler", "Turlar", "Performans", "Kuryeler", "Tahta", "Araçlar"]);
    // Dağıtım modülü kapandı: grubun her yaprağı gerçek rotaya bağlı.
    expect(grup?.children?.every((c) => Boolean(c.path))).toBe(true);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryBoard)).toMatchObject({ label: "Tahta", requiredPermission: "delivery" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewDeliveryBoard)).toEqual({ selectedKey: "dagitim-tahta", openKeys: ["dagitim"] });
    expect(izinBeyaniniKarsilarMi(["delivery.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryBoard)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryBoard)!)).toBe(false);
  });
});
