import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { DagitimTurlari, SAYFA_BOYUTU, sayfaNo, tarihSuzgeci } from "@/panel/pages/dagitim/DagitimTurlari";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { useDeliveryRunArchive, useDeliveryRuns } from "@/hooks/useDelivery";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { DeliveryRun } from "@/types";

vi.mock("@/hooks/useDelivery", () => ({
  useDeliveryRuns: vi.fn(),
  useDeliveryRunArchive: vi.fn(),
}));

const durak = (status: string) => ({ id: Math.random(), status }) as never;
const tur = (ek: Partial<DeliveryRun> = {}): DeliveryRun =>
  ({ id: 1, run_date: "2026-09-12", vehicle_id: 10, vehicle: "Lada", status: "PLANNED", created_at: "", depot_lat: null, depot_lng: null, courier: null, stops: [], ...ek }) as DeliveryRun;
const DOLU = tur({ id: 5, run_date: "2026-09-12", status: "DONE", courier: { id: 2, name: "Ali Kurye" } as never, stops: [durak("DELIVERED"), durak("FAILED"), durak("PENDING")], total_distance_km: 12.5 });
const BOS = tur({ id: 4, run_date: "2026-09-11", status: "ACTIVE", vehicle: "Fiat" });
const YIRMI = Array.from({ length: SAYFA_BOYUTU }, (_, i) => tur({ id: 100 + i }));

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
function agac(yol = PATHS.adminNewDeliveryRuns) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewDeliveryRuns} element={<><DagitimTurlari /><Konum /></>} />
            <Route path={PATHS.adminNewDeliveryRunDetail} element={<><div>Yeni tur detayı</div><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = (yol?: string) => render(agac(yol));
const tarihAlani = () => screen.getByLabelText("Tarihe göre filtrele") as HTMLInputElement;

beforeEach(() => {
  vi.mocked(useDeliveryRuns).mockReset().mockReturnValue(sonuc([DOLU]));
  vi.mocked(useDeliveryRunArchive).mockReset().mockReturnValue(sonuc([DOLU, BOS]));
  izin("delivery.view");
});

describe("saf kurallar", () => {
  it("tarihSuzgeci yalnız gerçek ISO gün; sayfaNo yalnız pozitif tam sayı", () => {
    expect(tarihSuzgeci("2026-09-12")).toBe("2026-09-12");
    for (const h of [null, "", "abc", "2026-02-30", "2026-13-01", "1e3", "20260912", 5]) expect(tarihSuzgeci(h)).toBeNull();
    expect(sayfaNo(3)).toBe(3);
    expect(sayfaNo("2")).toBe(2);
    for (const h of [0, -1, 1.5, "abc", "1e3", "0x10", " 2", "-2", null, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(sayfaNo(h)).toBe(1);
  });
});

describe("DagitimTurlari", () => {
  it("delivery.view yokken AccessDenied ve iki sorgu da kapalı", () => {
    izin("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(son(useDeliveryRuns)).toEqual([undefined, false]);
    expect(son(useDeliveryRunArchive)).toEqual([0, SAYFA_BOYUTU, false]);
  });

  it("tarihsiz arşiv: yalnız archive sorgusu; satır alanları, geçici eski detay href'i, satır tıklaması; iç içe a/button yok; not görünür", () => {
    kur();
    expect(screen.getByRole("heading", { name: "Turlar" })).toBeInTheDocument();
    expect(son(useDeliveryRunArchive)).toEqual([0, SAYFA_BOYUTU, true]);
    expect(son(useDeliveryRuns)).toEqual([undefined, false]);
    const a = within(screen.getByTestId("tur-5"));
    expect(a.getByText(/12 Eyl/)).toBeInTheDocument();
    expect(a.getByRole("link", { name: "Tur #5" })).toHaveAttribute("href", ROUTES.adminNewDeliveryRun(5));
    expect(a.getByText("Lada")).toBeInTheDocument();
    expect(a.getByText("Ali Kurye")).toBeInTheDocument();
    expect(a.getByText(/2\/3 durak/)).toBeInTheDocument();
    expect(a.getByText(/1 başarısız/)).toBeInTheDocument();
    expect(a.getByText("12,5 km")).toBeInTheDocument();
    expect(a.getByText("Tamamlandı")).toBeInTheDocument();
    const b = within(screen.getByTestId("tur-4"));
    expect(b.getByText("Kurye atanmadı")).toBeInTheDocument();
    expect(b.queryByText(/durak/)).not.toBeInTheDocument();
    expect(b.queryByText(/km/)).not.toBeInTheDocument();
    expect(b.getByText("Sahada")).toBeInTheDocument();
    expect(screen.getByText(/Turlar en yeni tarihten eskiye sıralanır/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filtreyi kaldır" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("a button, button a, a a, button button")).toHaveLength(0);
    // Sunucu sırası korunur.
    expect([...document.querySelectorAll('[data-testid^="tur-"]')].map((e) => e.getAttribute("data-testid"))).toEqual(["tur-5", "tur-4"]);
    // Değiştirici tuşlu tıklama satırı yönlendirmez (gerçek bağlantı davranışı korunur).
    fireEvent.click(b.getByText("Fiat"), { ctrlKey: true });
    fireEvent.click(b.getByText("Fiat"), { shiftKey: true });
    expect(screen.getByTestId("konum")).toHaveTextContent(PATHS.adminNewDeliveryRuns);
    fireEvent.click(b.getByText("Fiat"));
    expect(screen.getByTestId("konum")).toHaveTextContent(ROUTES.adminNewDeliveryRun(4));
    expect(screen.getByText("Yeni tur detayı")).toBeInTheDocument();
  });

  it("geçerli tarih: yalnız tarih sorgusu; arşiv kapalı; Filtreyi kaldır arşive ve sayfa 1'e döner; tarih modunda eski sayfa sorguyu etkilemez", async () => {
    kur(`${PATHS.adminNewDeliveryRuns}?tarih=2026-09-12&sayfa=4`);
    expect(son(useDeliveryRuns)).toEqual(["2026-09-12", true]);
    expect(son(useDeliveryRunArchive)).toEqual([3, SAYFA_BOYUTU, false]);
    expect(tarihAlani().value).toBe("2026-09-12");
    expect(screen.getByTestId("tur-5")).toBeInTheDocument();
    expect(screen.queryByText(/Sayfa \d/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Filtreyi kaldır" }));
    await waitFor(() => expect(son(useDeliveryRunArchive)).toEqual([0, SAYFA_BOYUTU, true]));
    expect(son(useDeliveryRuns)).toEqual([undefined, false]);
    expect(screen.getByTestId("konum")).not.toHaveTextContent("tarih=");
    expect(screen.getByTestId("konum")).not.toHaveTextContent("sayfa=");
  });

  it("geçersiz/gerçek olmayan tarih sunucuya gitmez, arşiv modu kullanılır", () => {
    for (const kotu of ["2026-02-30", "1e3", "abc", "2026-13-01"]) {
      const r = kur(`${PATHS.adminNewDeliveryRuns}?tarih=${kotu}`);
      expect(son(useDeliveryRuns)).toEqual([undefined, false]);
      expect(son(useDeliveryRunArchive)).toEqual([0, SAYFA_BOYUTU, true]);
      expect(tarihAlani().value).toBe("");
      r.unmount();
    }
  });

  it("tarih değişimi URL'ye yazılır ve sayfa 1'e sıfırlar; geri/ileri tarih alanı ve etkin sorguyu eşler", async () => {
    kur(`${PATHS.adminNewDeliveryRuns}?sayfa=3`);
    expect(son(useDeliveryRunArchive)).toEqual([2, SAYFA_BOYUTU, true]);
    fireEvent.change(tarihAlani(), { target: { value: "2026-09-11" } });
    await waitFor(() => expect(son(useDeliveryRuns)).toEqual(["2026-09-11", true]));
    expect(screen.getByTestId("konum")).toHaveTextContent("tarih=2026-09-11");
    expect(screen.getByTestId("konum")).not.toHaveTextContent("sayfa=");
    await userEvent.click(screen.getByRole("button", { name: "geri" }));
    await waitFor(() => expect(son(useDeliveryRunArchive)).toEqual([2, SAYFA_BOYUTU, true]));
    expect(tarihAlani().value).toBe("");
    expect(son(useDeliveryRuns)).toEqual([undefined, false]);
    expect(screen.getByText("Sayfa 3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ileri" }));
    await waitFor(() => expect(son(useDeliveryRuns)).toEqual(["2026-09-11", true]));
    expect(tarihAlani().value).toBe("2026-09-11");
    expect(son(useDeliveryRunArchive)).toEqual([0, SAYFA_BOYUTU, false]);
  });

  it("arşiv sayfalaması: ?sayfa ayrıştırma, daha yeni/eski, sayfa 1'de daha yeni yok, kısa sayfa son sayfa", async () => {
    vi.mocked(useDeliveryRunArchive).mockReturnValue(sonuc(YIRMI));
    const a = kur(`${PATHS.adminNewDeliveryRuns}?sayfa=1e3`);
    expect(son(useDeliveryRunArchive)).toEqual([0, SAYFA_BOYUTU, true]);
    expect(screen.getByText("Sayfa 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Daha yeni/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Daha eski/ }));
    await waitFor(() => expect(son(useDeliveryRunArchive)).toEqual([1, SAYFA_BOYUTU, true]));
    expect(screen.getByTestId("konum")).toHaveTextContent("sayfa=2");
    expect(screen.getByText("Sayfa 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Daha yeni/ }));
    await waitFor(() => expect(son(useDeliveryRunArchive)).toEqual([0, SAYFA_BOYUTU, true]));
    a.unmount();
    // Kısa sayfa = son sayfa: "Daha eski" yok, "Daha yeni" var.
    vi.mocked(useDeliveryRunArchive).mockReturnValue(sonuc([DOLU]));
    kur(`${PATHS.adminNewDeliveryRuns}?sayfa=2`);
    expect(screen.getByRole("button", { name: /Daha yeni/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Daha eski/ })).not.toBeInTheDocument();
  });

  it("tam 20 satırdan sonra boş arşiv sayfası: Arşivin sonu ve Daha yeni dönüşü; ilk sayfa boş: Henüz tur yok; tarih modunda boş: Bu tarihte tur yok", async () => {
    vi.mocked(useDeliveryRunArchive).mockReturnValue(sonuc([]));
    const a = kur(`${PATHS.adminNewDeliveryRuns}?sayfa=2`);
    expect(screen.getByText("Arşivin sonu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Daha eski/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Daha yeni/ }));
    await waitFor(() => expect(son(useDeliveryRunArchive)).toEqual([0, SAYFA_BOYUTU, true]));
    expect(screen.getByText("Henüz tur yok")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Daha yeni|Daha eski/ })).not.toBeInTheDocument();
    a.unmount();
    vi.mocked(useDeliveryRuns).mockReturnValue(sonuc([]));
    kur(`${PATHS.adminNewDeliveryRuns}?tarih=2026-09-12`);
    expect(screen.getByText("Bu tarihte tur yok")).toBeInTheDocument();
    expect(screen.queryByText(/Sayfa \d/)).not.toBeInTheDocument();
  });

  it("hata + yalnız etkin sorgunun Tekrar dene'si; yükleniyor", async () => {
    const arsivRefetch = vi.fn();
    const gunRefetch = vi.fn();
    vi.mocked(useDeliveryRunArchive).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Arşiv çöktü" } } }, refetch: arsivRefetch }));
    vi.mocked(useDeliveryRuns).mockReturnValue(sonuc(undefined, { refetch: gunRefetch }));
    const a = kur();
    expect(screen.getByText("Arşiv çöktü")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(arsivRefetch).toHaveBeenCalledTimes(1);
    expect(gunRefetch).not.toHaveBeenCalled();
    a.unmount();
    vi.mocked(useDeliveryRuns).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Gün çöktü" } } }, refetch: gunRefetch }));
    vi.mocked(useDeliveryRunArchive).mockReturnValue(sonuc(undefined, { refetch: arsivRefetch }));
    const b = kur(`${PATHS.adminNewDeliveryRuns}?tarih=2026-09-12`);
    expect(screen.getByText("Gün çöktü")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(gunRefetch).toHaveBeenCalledTimes(1);
    expect(arsivRefetch).toHaveBeenCalledTimes(1);
    b.unmount();
    vi.mocked(useDeliveryRunArchive).mockReturnValue(sonuc(undefined, { isPending: true }));
    kur();
    expect(screen.getByText("Turlar yükleniyor…")).toBeInTheDocument();
    expect(screen.queryByText(/Sayfa \d/)).not.toBeInTheDocument();
  });

  it("rota, menü yaprağı, izin, selectedKey/openKeys", () => {
    expect(PATHS.adminNewDeliveryRuns).toBe("/yonetim-yeni/dagitim/turlar");
    expect(ROUTES.adminNewDeliveryRuns).toBe(PATHS.adminNewDeliveryRuns);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryRuns)).toMatchObject({ label: "Turlar", requiredPermission: "delivery" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewDeliveryRuns)).toEqual({ selectedKey: "dagitim-turlar", openKeys: ["dagitim"] });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewDeliveryOrders)).toEqual({ selectedKey: "dagitim-siparisler", openKeys: ["dagitim"] });
    expect(izinBeyaniniKarsilarMi(["delivery.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryRuns)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewDeliveryRuns)!)).toBe(false);
  });
});
