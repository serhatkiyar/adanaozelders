import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { DagitimPerformans, degerlendirmeSirala, kpiAraligiCoz, kpiBosMu, num, opsAraligi, opsSatirlari, paretoSirala, pct, yerelGun } from "@/panel/pages/dagitim/DagitimPerformans";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { useDeliveryKpi, useDeliveryMetrics, useRecentDeliveryFeedback } from "@/hooks/useDelivery";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { DeliveryMetrics } from "@/api/delivery";
import type { DeliveryFeedback, DeliveryKpi } from "@/types";

vi.mock("@/hooks/useDelivery", () => ({
  useDeliveryKpi: vi.fn(),
  useDeliveryMetrics: vi.fn(),
  useRecentDeliveryFeedback: vi.fn(),
}));

const METRIK: DeliveryMetrics = { on_time_rate: 0.916, first_attempt_rate: 0, stops_per_hour: 4.26, km_per_delivery: null, fail_reasons: { EVDE_YOK: 2, ADRES_SORUNU: 5, XYZ_KOD: 1 }, delivered: 41, planned: 45 };
const KPI: DeliveryKpi = {
  window_days: 30, delivered: 120, failed: 6, rescheduled: 3, delivered_count: 118, first_attempt_delivered: 100, first_attempt_rate: 0.847, on_time_delivered: 90, promised_delivered: 110, on_time_rate: 0.818,
  failure_rate: 0.05, failed_not_courier_fault: 4, fail_by_reason: { EVDE_YOK: 1, MUSTERI_TALEBI: 4, BILINMEYEN: 2 }, feedback_up: 30, feedback_down: 5, satisfaction_rate: 0.857, feedback_problems: { GEC_TESLIMAT: 3, HASARLI_PAKET: 1, GARIP: 2 },
};
const YORUM: DeliveryFeedback[] = [
  { id: 1, order_id: 501, thumbs_up: true, problem_codes: [], comment: null, source: "CLIENT", created_at: "2026-09-12T10:00:00Z" },
  { id: 2, order_id: 502, thumbs_up: false, problem_codes: ["GEC_TESLIMAT", "BILINMEYEN_KOD"], comment: "Çok geç geldi", source: "PUBLIC", created_at: "2026-09-10T08:00:00Z" },
  { id: 3, order_id: 503, thumbs_up: false, problem_codes: ["HASARLI_PAKET"], comment: "a".repeat(400), source: "CLIENT", created_at: "2026-09-11T09:30:00Z" },
  { id: 4, order_id: 504, thumbs_up: true, problem_codes: [], comment: "Teşekkürler", source: "CLIENT", created_at: "2026-09-13T07:00:00Z" },
];
const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const son = (h: unknown) => vi.mocked(h as () => unknown).mock.calls.at(-1);
const bugun = new Date();
const gunOnce = (n: number) => { const d = new Date(bugun); d.setDate(bugun.getDate() - n); return yerelGun(d); };

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}
let konum: { pathname: string; search: string } = { pathname: "", search: "" };
let git: (n: number) => void = () => {};
function Izci() {
  const l = useLocation();
  const n = useNavigate();
  konum = { pathname: l.pathname, search: l.search };
  git = n;
  return null;
}
function agac(girisler: string[] = [PATHS.adminNewDeliveryPerformance]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={girisler} initialIndex={girisler.length - 1}>
          <Izci />
          <Routes>
            <Route path={PATHS.adminNewDeliveryPerformance} element={<DagitimPerformans />} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = (girisler?: string[]) => render(agac(girisler));
const bolum = (ad: string) => within(screen.getByRole("region", { name: ad }));
// AntD Segmented: radio girdisi tıklanır.
const secenek = (grup: string, etiket: string) => within(screen.getByLabelText(grup)).getByRole("radio", { name: etiket });

beforeEach(() => {
  vi.mocked(useDeliveryMetrics).mockReset().mockReturnValue(sonuc(METRIK));
  vi.mocked(useDeliveryKpi).mockReset().mockReturnValue(sonuc(KPI));
  vi.mocked(useRecentDeliveryFeedback).mockReset().mockReturnValue(sonuc(YORUM));
  izin("delivery.view");
});

describe("saf kurallar", () => {
  it("pct/num: null → '-', gerçek 0 → %0 / 0; yüzde Math.round; tr-TR en fazla 1 ondalık", () => {
    expect(pct(null)).toBe("-");
    expect(pct(0)).toBe("%0");
    expect(pct(0.916)).toBe("%92");
    expect(pct(0.845)).toBe("%85");
    expect(num(null)).toBe("-");
    expect(num(0)).toBe("0");
    expect(num(4.26)).toBe("4,3");
    expect(num(1234.5)).toBe("1.234,5");
  });

  it("yerel takvim günü ve bugün dahil son N gün; KPI aralığı çözümü; Pareto sıralama; değerlendirme sıralaması; boş kararı", () => {
    const sabit = new Date(2026, 0, 3, 23, 30); // 3 Oca 2026 23:30 yerel — toISOString UTC'ye kayabilirdi
    expect(yerelGun(sabit)).toBe("2026-01-03");
    expect(opsAraligi(7, sabit)).toEqual({ fromDate: "2025-12-28", toDate: "2026-01-03" });
    expect(opsAraligi(30, sabit)).toEqual({ fromDate: "2025-12-05", toDate: "2026-01-03" });
    for (const [ham, beklenen] of [[7, 7], [30, 30], [90, 90], [180, 180], [1000, 30], [0, 30], [-7, 30], [NaN, 30], ["7", 30], [undefined, 30]] as const) expect(kpiAraligiCoz(ham)).toBe(beklenen);
    expect(paretoSirala({ A: 1, B: 5, C: 3 })).toEqual([["B", 5], ["C", 3], ["A", 1]]);
    expect(degerlendirmeSirala(YORUM).map((y) => y.id)).toEqual([3, 2, 4, 1]);
    expect(kpiBosMu({ ...KPI, delivered: 0, failed: 0, rescheduled: 0 })).toBe(true);
    expect(kpiBosMu({ ...KPI, delivered: 0, failed: 0, rescheduled: 1 })).toBe(false);
    expect(opsSatirlari(METRIK).map((r) => [r.key, r.value, r.bos])).toEqual([["zamaninda", "%92", false], ["ilk-deneme", "%0", false], ["durak-saat", "4,3", false], ["km-teslimat", "-", true], ["teslim-plan", "41/45", false]]);
  });
});

describe("DagitimPerformans", () => {
  it("delivery.view yokken AccessDenied ve üç sorgu da kapalı", () => {
    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(useDeliveryMetrics)).toEqual([gunOnce(6), gunOnce(0), false]);
    expect(son(useDeliveryKpi)).toEqual([30, false]);
    expect(son(useRecentDeliveryFeedback)).toEqual([50, false]);
  });

  it("operasyon metrikleri: varsayılan 7 gün gerçek from/to; 30/90 seçimi aralığı genişletir; satırlar null→'-'+'henüz veri yok', gerçek 0→%0; nedenler etiketli ve sıralı, bilinmeyen kod ham", () => {
    kur();
    expect(son(useDeliveryMetrics)).toEqual([gunOnce(6), gunOnce(0), true]);
    expect(bolum("Operasyon metrikleri").getByText(/turlardan ölçülür/)).toBeInTheDocument();
    fireEvent.click(secenek("Metrik aralığı", "30 gün"));
    expect(son(useDeliveryMetrics)).toEqual([gunOnce(29), gunOnce(0), true]);
    fireEvent.click(secenek("Metrik aralığı", "90 gün"));
    expect(son(useDeliveryMetrics)).toEqual([gunOnce(89), gunOnce(0), true]);
    // Operasyon aralığı URL'ye ve KPI sorgusuna dokunmaz.
    expect(konum.search).toBe("");
    expect(son(useDeliveryKpi)).toEqual([30, true]);
    expect(within(screen.getByTestId("ops-metrik-zamaninda")).getByText("%92")).toBeInTheDocument();
    expect(within(screen.getByTestId("ops-metrik-ilk-deneme")).getByText("%0")).toBeInTheDocument();
    expect(within(screen.getByTestId("ops-metrik-ilk-deneme")).queryByText("henüz veri yok")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("ops-metrik-durak-saat")).getByText("4,3")).toBeInTheDocument();
    expect(within(screen.getByTestId("ops-metrik-km-teslimat")).getByText("-")).toBeInTheDocument();
    expect(within(screen.getByTestId("ops-metrik-km-teslimat")).getByText("henüz veri yok")).toBeInTheDocument();
    expect(within(screen.getByTestId("ops-metrik-teslim-plan")).getByText("41/45")).toBeInTheDocument();
    const nedenler = within(screen.getByTestId("ops-nedenler"));
    const etiketler = nedenler.getAllByText(/./, { selector: "span.ant-typography" }).map((e) => e.textContent).filter((t) => t && !/^\d+$/.test(t) && t !== "Teslim edilememe nedenleri");
    expect(etiketler).toEqual(["Adres bulunamadı / pin yanlış", "Kimse evde yok", "XYZ_KOD"]);
  });

  it("KPI: URL gun=90 okunur; seçim URL'ye yazılır; 30 seçilince yalnız gun silinir, alakasız parametre korunur", () => {
    kur([`${PATHS.adminNewDeliveryPerformance}?gun=90&sekme=x`]);
    expect(son(useDeliveryKpi)).toEqual([90, true]);
    expect(secenek("Gün aralığı", "90 gün")).toBeChecked();
    expect(within(screen.getByTestId("kpi-teslim")).getByText("son 90 gün")).toBeInTheDocument();
    fireEvent.click(secenek("Gün aralığı", "7 gün"));
    expect(son(useDeliveryKpi)).toEqual([7, true]);
    expect(konum.search).toBe("?gun=7&sekme=x");
    fireEvent.click(secenek("Gün aralığı", "180 gün"));
    expect(konum.search).toBe("?gun=180&sekme=x");
    fireEvent.click(secenek("Gün aralığı", "30 gün"));
    expect(son(useDeliveryKpi)).toEqual([30, true]);
    expect(konum.search).toBe("?sekme=x");
  });

  it("KPI: geçersiz/1e3/boş/0/-7/31 URL değeri → 30; geçersiz değer sunucuya gitmez; seçici 30'u gösterir", () => {
    for (const ham of ["abc", "1e3", "", "0", "-7", "31"]) {
      const b = kur([`${PATHS.adminNewDeliveryPerformance}?gun=${ham}`]);
      expect(son(useDeliveryKpi)).toEqual([30, true]);
      expect(vi.mocked(useDeliveryKpi).mock.calls.every((c) => [7, 30, 90, 180].includes(c[0] as number))).toBe(true);
      expect(secenek("Gün aralığı", "30 gün")).toBeChecked();
      b.unmount();
    }
  });

  it("KPI: tarayıcı geri/ileri (replace yazımı yeni giriş üretmez) — seçici, URL ve sorgu aynı değeri gösterir", async () => {
    kur([`${PATHS.adminNewDeliveryPerformance}?gun=180`, `${PATHS.adminNewDeliveryPerformance}?gun=7`]);
    expect(son(useDeliveryKpi)).toEqual([7, true]);
    fireEvent.click(secenek("Gün aralığı", "90 gün"));
    expect(konum.search).toBe("?gun=90");
    await userEvent.click(document.body);
    git(-1);
    await screen.findByText("son 180 gün");
    expect(konum.search).toBe("?gun=180");
    expect(secenek("Gün aralığı", "180 gün")).toBeChecked();
    expect(son(useDeliveryKpi)).toEqual([180, true]);
    git(1);
    await screen.findByText("son 90 gün");
    expect(secenek("Gün aralığı", "90 gün")).toBeChecked();
    expect(son(useDeliveryKpi)).toEqual([90, true]);
  });

  it("KPI kartları: dört sayaç ve alt metinler, memnuniyet (dolu), sorun/neden Pareto sıralı + etiketli + bilinmeyen kod; null memnuniyet 'henüz veri yok'; null oran '-'", () => {
    const a = kur();
    expect(within(screen.getByTestId("kpi-soz")).getByText("%82")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-soz")).getByText("90/110 teslim")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-ilk")).getByText("%85")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-ilk")).getByText("100/118 sipariş")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-teslim")).getByText("120")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-teslim")).getByText("son 30 gün")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-basarisiz")).getByText("6")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-basarisiz")).getByText("4 kurye dışı")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-memnuniyet")).toHaveTextContent("👍 %86");
    expect(screen.getByTestId("kpi-memnuniyet")).toHaveTextContent("👍 30 · 👎 5");
    expect(within(screen.getByTestId("kpi-memnuniyet")).getAllByRole("img", { name: /Memnun/ })).toHaveLength(3);
    const metinler = (id: string) => within(screen.getByTestId(id)).getAllByText(/./, { selector: "span.ant-typography" }).map((e) => e.textContent!).filter((t) => !/^\d+$/.test(t));
    expect(metinler("kpi-sorunlar")).toEqual(["Bildirilen sorunlar", "Geç geldi", "GARIP", "Paket hasarlıydı"]);
    expect(metinler("kpi-nedenler")).toEqual(["Teslim edilememe nedenleri", "Müşteri sonra gel dedi", "BILINMEYEN", "Kimse evde yok"]);
    expect(screen.getByText("Baseline ölçümü: hedef konmadı, sayılar yön verir.")).toBeInTheDocument();
    a.unmount();
    vi.mocked(useDeliveryKpi).mockReturnValue(sonuc({ ...KPI, satisfaction_rate: null, on_time_rate: null, first_attempt_rate: 0, feedback_problems: {}, fail_by_reason: {} }));
    kur();
    expect(within(screen.getByTestId("kpi-memnuniyet")).getByText("henüz veri yok")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-soz")).getByText("-")).toBeInTheDocument();
    expect(within(screen.getByTestId("kpi-ilk")).getByText("%0")).toBeInTheDocument();
    expect(screen.queryByTestId("kpi-sorunlar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kpi-nedenler")).not.toBeInTheDocument();
  });

  it("KPI boş kararı: delivered+failed+rescheduled=0 → boş durum, seçici çalışmaya devam eder; değerlendirmeler yine görünür", () => {
    vi.mocked(useDeliveryKpi).mockReturnValue(sonuc({ ...KPI, delivered: 0, failed: 0, rescheduled: 0 }));
    kur([`${PATHS.adminNewDeliveryPerformance}?gun=7`]);
    expect(screen.getByText("Bu aralıkta teslimat yok")).toBeInTheDocument();
    expect(screen.getByText("Son 7 günde sonuçlanmış durak bulunmuyor. Daha geniş bir aralık deneyin.")).toBeInTheDocument();
    expect(screen.queryByTestId("kpi-soz")).not.toBeInTheDocument();
    fireEvent.click(secenek("Gün aralığı", "90 gün"));
    expect(screen.getByText("Son 90 günde sonuçlanmış durak bulunmuyor. Daha geniş bir aralık deneyin.")).toBeInTheDocument();
    expect(screen.getByTestId("degerlendirme-2")).toBeInTheDocument();
  });

  it("son değerlendirmeler: 👎 önce sonra en yeni; sipariş bağlantısı yeni Sipariş Detayı; tarih tr-TR; problem etiketleri (bilinmeyen ham) / 'Sorun bildirilmedi'; uzun yorum tam ve sarılır; iç içe a/button yok", () => {
    kur();
    const sira = [...document.querySelectorAll('[data-testid^="degerlendirme-"]')].map((e) => e.getAttribute("data-testid"));
    expect(sira).toEqual(["degerlendirme-3", "degerlendirme-2", "degerlendirme-4", "degerlendirme-1"]);
    const d2 = within(screen.getByTestId("degerlendirme-2"));
    const link = d2.getByRole("link", { name: "Sipariş #502" });
    expect(link).toHaveAttribute("href", ROUTES.adminNewOrder(502));
    expect(link.getAttribute("href")).not.toContain("?q=");
    expect(d2.getByLabelText("Memnun değil")).toHaveTextContent("👎");
    expect(d2.getByText("Geç geldi · BILINMEYEN_KOD")).toBeInTheDocument();
    expect(d2.getByText("Çok geç geldi")).toBeInTheDocument();
    expect(d2.getByText(new Date("2026-09-10T08:00:00Z").toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }))).toBeInTheDocument();
    const d1 = within(screen.getByTestId("degerlendirme-1"));
    expect(d1.getByLabelText("Memnun")).toHaveTextContent("👍");
    expect(d1.getByText("Sorun bildirilmedi")).toBeInTheDocument();
    const uzun = within(screen.getByTestId("degerlendirme-3")).getByText("a".repeat(400));
    expect(uzun).toHaveStyle({ overflowWrap: "anywhere" });
    expect(document.querySelectorAll("a button, button a, a a, button button")).toHaveLength(0);
    // Yazma yüzeyi yok: yalnız seçiciler ve bağlantılar.
    expect(screen.queryByRole("button", { name: /dışa aktar|hedef|kaydet/i })).not.toBeInTheDocument();
  });

  it("üç bölüm bağımsız: yükleniyor/hata + yalnız kendi refetch'i/boş; önbellek verisi + tazeleme hatası veriyi gizlemez", async () => {
    const opsRefetch = vi.fn();
    const kpiRefetch = vi.fn();
    const yorumRefetch = vi.fn();
    vi.mocked(useDeliveryMetrics).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Metrik servisi çöktü" } } }, refetch: opsRefetch }));
    vi.mocked(useDeliveryKpi).mockReturnValue(sonuc(undefined, { isPending: true }));
    vi.mocked(useRecentDeliveryFeedback).mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch: yorumRefetch }));
    const a = kur();
    expect(screen.getByText("Metrik servisi çöktü")).toBeInTheDocument();
    expect(screen.getByText("Göstergeler yükleniyor…")).toBeInTheDocument();
    expect(screen.getByText("Değerlendirmeler yüklenemedi.")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("Metrik servisi çöktü").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(opsRefetch).toHaveBeenCalledTimes(1);
    expect(yorumRefetch).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByText("Değerlendirmeler yüklenemedi.").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(yorumRefetch).toHaveBeenCalledTimes(1);
    expect(opsRefetch).toHaveBeenCalledTimes(1);
    a.unmount();
    vi.mocked(useDeliveryMetrics).mockReturnValue(sonuc(undefined, { isPending: true }));
    vi.mocked(useDeliveryKpi).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 503, data: { detail: "KPI kapalı" } } }, refetch: kpiRefetch }));
    vi.mocked(useRecentDeliveryFeedback).mockReturnValue(sonuc([]));
    const b = kur();
    expect(screen.getByText("Metrikler yükleniyor…")).toBeInTheDocument();
    expect(screen.getByText("KPI kapalı")).toBeInTheDocument();
    expect(screen.getByText("Henüz değerlendirme yok")).toBeInTheDocument();
    await userEvent.click(within(screen.getByText("KPI kapalı").closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(kpiRefetch).toHaveBeenCalledTimes(1);
    b.unmount();
    // Önbellek + arka plan tazeleme hatası: veri görünür, uyarı + kendi refetch'i.
    vi.mocked(useDeliveryMetrics).mockReturnValue(sonuc(METRIK, { isError: true, error: new Error("ağ"), refetch: opsRefetch }));
    vi.mocked(useDeliveryKpi).mockReturnValue(sonuc(KPI, { isError: true, error: new Error("ağ"), refetch: kpiRefetch }));
    vi.mocked(useRecentDeliveryFeedback).mockReturnValue(sonuc(YORUM, { isError: true, error: new Error("ağ"), refetch: yorumRefetch }));
    kur();
    expect(screen.getByTestId("ops-metrik-zamaninda")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-soz")).toBeInTheDocument();
    expect(screen.getByTestId("degerlendirme-2")).toBeInTheDocument();
    expect(screen.getByText(/Metrikler güncellenemedi/)).toBeInTheDocument();
    expect(screen.getByText(/Göstergeler güncellenemedi/)).toBeInTheDocument();
    expect(screen.getByText(/Değerlendirmeler güncellenemedi/)).toBeInTheDocument();
    await userEvent.click(within(screen.getByText(/Göstergeler güncellenemedi/).closest(".ant-alert") as HTMLElement).getByRole("button", { name: "Tekrar dene" }));
    expect(kpiRefetch).toHaveBeenCalledTimes(2);
    expect(opsRefetch).toHaveBeenCalledTimes(1);
  });

  it("rota, menü yaprağı (sıra korunur), izin, selectedKey/openKeys", () => {
    expect(PATHS.adminNewDeliveryPerformance).toBe("/yonetim-yeni/dagitim/performans");
    expect(ROUTES.adminNewDeliveryPerformance).toBe(PATHS.adminNewDeliveryPerformance);
    const grup = PANEL_MENU.find((g) => g.key === "dagitim");
    expect(grup?.children?.map((c) => c.label)).toEqual(["Bugün", "Siparişler", "Turlar", "Performans", "Kuryeler", "Tahta", "Araçlar"]);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryPerformance)).toMatchObject({ label: "Performans", requiredPermission: "delivery" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewDeliveryPerformance)).toEqual({ selectedKey: "dagitim-performans", openKeys: ["dagitim"] });
    expect(izinBeyaniniKarsilarMi(["delivery.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryPerformance)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryPerformance)!)).toBe(false);
  });
});
