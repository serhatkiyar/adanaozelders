import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { GECIKME_ESIGI, GeriDonusKuyrugu, kabulHatasiniDagit, sayfaNo } from "@/panel/pages/paketleme/GeriDonusKuyrugu";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { packingAccess } from "@/lib/packing";
import { useReturnInPackage, useReturnQueue } from "@/hooks/usePacking";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { ReturnQueueRow } from "@/types/packing";

vi.mock("@/hooks/usePacking", () => ({
  useReturnQueue: vi.fn(),
  useReturnInPackage: vi.fn(),
}));

const kabul = vi.fn();
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];

function satir(ek: Partial<ReturnQueueRow> = {}): ReturnQueueRow {
  return { package_id: 41, package_code: "PKT-000041", order_id: 901, courier_id: 7, courier_name: "Mehmet Kurye", handed_over_at: "2026-09-01T08:00:00Z", waiting_days: 5, ...ek };
}
const ESKI = satir();
const YENI = satir({ package_id: 42, package_code: "PKT-000042", order_id: 902, courier_id: null, courier_name: null, waiting_days: 1 });
const ESIK = satir({ package_id: 43, package_code: "PKT-000043", order_id: 903, waiting_days: GECIKME_ESIGI });

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const sonSorgu = () => vi.mocked(useReturnQueue).mock.calls.at(-1);

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}
function Konum() {
  return <output data-testid="konum">{`${useLocation().pathname}${useLocation().search}`}</output>;
}
function agac(yol = PATHS.adminNewPackingReturns) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewPackingReturns} element={<><GeriDonusKuyrugu /><Konum /></>} />
            <Route path={PATHS.adminNewPackingPackage} element={<><div>Yeni paket detayı</div><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = (yol?: string) => render(agac(yol));
const cekmeceAcikMi = () => document.querySelector(".ant-drawer-open") !== null;
// AntD yükleniyor simgesi jsdom'da çıkış animasyonunda takılı kalabilir; ad sonuna göre eşleşir.
const cekmeceDugmesi = (ad: string) => within(document.querySelector(".ant-drawer-open .ant-drawer-footer") as HTMLElement).getByRole("button", { name: new RegExp(`${ad}$`) });

beforeEach(() => {
  kabul.mockReset().mockImplementation(() => new Promise((res, rej) => { sozler.push({ res, rej }); }));
  sozler.length = 0;
  vi.mocked(useReturnQueue).mockReset().mockReturnValue(sonuc({ items: [ESKI, YENI, ESIK], total: 3, limit: 50, offset: 0 }));
  vi.mocked(useReturnInPackage).mockReturnValue({ mutateAsync: kabul, isPending: false } as never);
  izin("packing.view", "packing.pack", "packing.manage");
});

describe("saf kurallar", () => {
  it("packingAccess kademeleri birbirini ima etmez", () => {
    expect(packingAccess(["packing.manage"])).toEqual({ canView: false, canPack: false, canManage: true });
    expect(packingAccess(["packing.pack"])).toEqual({ canView: false, canPack: true, canManage: false });
    expect(packingAccess(["packing.view"])).toEqual({ canView: true, canPack: false, canManage: false });
  });
  it("sayfaNo: geçersiz/negatif/bilimsel/safe-integer dışı/boş 1'e düşer", () => {
    expect(sayfaNo("3")).toBe(3);
    for (const h of [null, "", "0", "-2", "abc", "1.5", "1e3", "0x10", " 2", String(Number.MAX_SAFE_INTEGER + 1)]) expect(sayfaNo(h)).toBe(1);
  });
  it("kabulHatasiniDagit: 422 note alana, diğerleri genele; constructor alan sayılmaz; 409 genel", () => {
    expect(kabulHatasiniDagit({ response: { status: 422, data: { detail: [{ loc: ["body", "note"], msg: "Çok uzun" }] } } }, "x")).toEqual({ alan: "Çok uzun", genel: null });
    expect(kabulHatasiniDagit({ response: { status: 422, data: { detail: [{ loc: ["body", "constructor"], msg: "y" }] } } }, "x")).toEqual({ alan: null, genel: "y" });
    expect(kabulHatasiniDagit({ response: { status: 409, data: { detail: "Paket kuryede değil" } } }, "x")).toEqual({ alan: null, genel: "Paket kuryede değil" });
  });
});

describe("GeriDonusKuyrugu", () => {
  it("gerçek satır alanları, sunucu sırası, 3 gün eşiği metinle, paket ve sipariş bağlantıları, iç içe a/button yok", () => {
    kur();
    expect(sonSorgu()).toEqual([{ limit: 50, offset: 0 }, true]);
    expect(screen.getByRole("heading", { name: "Geri dönüş" })).toBeInTheDocument();
    expect(screen.getByText("3 kutu")).toBeInTheDocument();
    const kodlar = [...document.querySelectorAll('[data-testid^="satir-"]')].map((e) => e.getAttribute("data-testid"));
    expect(kodlar).toEqual(["satir-41", "satir-42", "satir-43"]);
    const a = within(screen.getByTestId("satir-41"));
    expect(a.getByRole("link", { name: "PKT-000041" })).toHaveAttribute("href", ROUTES.adminNewPackingPackage(41));
    expect(a.getByRole("link", { name: "#901" })).toHaveAttribute("href", ROUTES.adminNewOrder(901));
    expect(a.getByText("Mehmet Kurye")).toBeInTheDocument();
    expect(a.getByText("5 gündür araçta · takip edilmeli")).toBeInTheDocument();
    expect(a.getByText("5 gündür araçta · takip edilmeli").closest(".ant-tag")).toHaveClass("ant-tag-warning");
    const b = within(screen.getByTestId("satir-42"));
    expect(b.getByText("Kurye kaydı bulunmuyor")).toBeInTheDocument();
    expect(b.getByText("1 gündür araçta")).toBeInTheDocument();
    expect(b.getByText("1 gündür araçta").closest(".ant-tag")).not.toHaveClass("ant-tag-warning");
    expect(within(screen.getByTestId("satir-43")).getByText("3 gündür araçta · takip edilmeli")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Depoya al" })).toHaveLength(3);
    expect(document.querySelectorAll("a button, button a, a a, button button")).toHaveLength(0);
  });

  it("paket kodu bağlantısı detaya gider ve başka aksiyon tetiklemez", async () => {
    kur();
    await userEvent.click(within(screen.getByTestId("satir-41")).getByRole("link", { name: "PKT-000041" }));
    expect(screen.getByTestId("konum")).toHaveTextContent(ROUTES.adminNewPackingPackage(41));
    expect(screen.getByText("Yeni paket detayı")).toBeInTheDocument();
    expect(kabul).not.toHaveBeenCalled();
    expect(cekmeceAcikMi()).toBe(false);
  });

  it("izin: view yokken enabled=false + AccessDenied; view-only ve pack-only salt okunur; manage ile Depoya al", () => {
    izin("packing.manage");
    const a = kur();
    expect(sonSorgu()).toEqual([{ limit: 50, offset: 0 }, false]);
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    a.unmount();
    izin("packing.view");
    const b = kur();
    expect(sonSorgu()).toEqual([{ limit: 50, offset: 0 }, true]);
    expect(screen.queryByRole("button", { name: "Depoya al" })).not.toBeInTheDocument();
    expect(screen.getByText(/yalnız görüntüleme yetkiniz var/)).toBeInTheDocument();
    b.unmount();
    izin("packing.view", "packing.pack");
    const c = kur();
    expect(screen.queryByRole("button", { name: "Depoya al" })).not.toBeInTheDocument();
    c.unmount();
    izin("packing.view", "packing.manage");
    kur();
    expect(screen.getAllByRole("button", { name: "Depoya al" })).toHaveLength(3);
    expect(screen.queryByText(/yalnız görüntüleme yetkiniz var/)).not.toBeInTheDocument();
  });

  it("URL sayfası: ?sayfa=3 offset 100; geçersiz değer 1; veri azalınca replace ile son sayfa", async () => {
    vi.mocked(useReturnQueue).mockReturnValue(sonuc({ items: [ESKI], total: 120, limit: 50, offset: 100 }));
    const a = kur(`${PATHS.adminNewPackingReturns}?sayfa=3`);
    expect(sonSorgu()).toEqual([{ limit: 50, offset: 100 }, true]);
    expect(screen.getByText("101 - 120 / 120 kutu")).toBeInTheDocument();
    a.unmount();
    const b = kur(`${PATHS.adminNewPackingReturns}?sayfa=1e3`);
    expect(sonSorgu()).toEqual([{ limit: 50, offset: 0 }, true]);
    b.unmount();
    vi.mocked(useReturnQueue).mockReturnValue(sonuc({ items: [ESKI], total: 60, limit: 50, offset: 50 }));
    kur(`${PATHS.adminNewPackingReturns}?sayfa=9`);
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("sayfa=2"));
    expect(screen.queryByText("Araçta bekleyen kutu bulunmuyor")).not.toBeInTheDocument();
  });

  it("boş, yükleniyor, hata + yalnız kendi Tekrar dene'si", async () => {
    vi.mocked(useReturnQueue).mockReturnValue(sonuc({ items: [], total: 0, limit: 50, offset: 0 }));
    const a = kur();
    expect(screen.getByText("Araçta bekleyen kutu bulunmuyor")).toBeInTheDocument();
    expect(screen.queryByText(/kutu$/)).not.toBeInTheDocument();
    a.unmount();
    vi.mocked(useReturnQueue).mockReturnValue(sonuc(undefined, { isPending: true }));
    const b = kur();
    expect(screen.getByText("Kuyruk yükleniyor…")).toBeInTheDocument();
    b.unmount();
    const refetch = vi.fn();
    vi.mocked(useReturnQueue).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Sunucu hatası" } } }, refetch }));
    kur();
    expect(screen.getByText("Sunucu hatası")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("depoya al: hedef sabit, boş not {} / dolu not {note}, aynı tick tek istek, pending'de kapanmaz, 422 alanda, 409 genel, yeniden deneme, başarıda kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    kur();
    await u.click(within(screen.getByTestId("satir-41")).getByRole("button", { name: "Depoya al" }));
    expect(await screen.findByText(/PKT-000041 kutusunun depoya döndüğünü onaylıyorsunuz\. Kutuyu fiziksel olarak görmeden onaylamayın\./)).toBeInTheDocument();
    expect(document.querySelector(".ant-drawer-open .ant-drawer-title")).toHaveTextContent("Kutuyu depoya al");
    // Boş not: {} ve aynı tick tek istek.
    await u.dblClick(cekmeceDugmesi("Depoya alındı"));
    expect(kabul).toHaveBeenCalledTimes(1);
    expect(kabul).toHaveBeenCalledWith({ packageId: 41, payload: {} });
    // Pending'de X / Vazgeç kapatmaz.
    await u.click(cekmeceDugmesi("Vazgeç"));
    await u.click(document.querySelector(".ant-drawer-open .ant-drawer-close") as HTMLElement);
    expect(cekmeceAcikMi()).toBe(true);
    // Liste tazelenip hedef satır değişse de hedef sabit kalır.
    vi.mocked(useReturnQueue).mockReturnValue(sonuc({ items: [YENI, ESKI], total: 2, limit: 50, offset: 0 }));
    await act(async () => { sozler.pop()!.rej({ response: { status: 422, data: { detail: [{ loc: ["body", "note"], msg: "Not en fazla 500 karakter" }] } } }); await Promise.resolve(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Not en fazla 500 karakter");
    expect(cekmeceAcikMi()).toBe(true);
    const alan = screen.getByLabelText("Not (isteğe bağlı)");
    expect(alan).toHaveAttribute("maxlength", "500");
    await u.type(alan, "  kutu ıslanmış  ");
    // Not düzenlenince eski alan hatası kalmaz.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await u.click(cekmeceDugmesi("Depoya alındı"));
    expect(kabul).toHaveBeenCalledTimes(2);
    expect(kabul).toHaveBeenLastCalledWith({ packageId: 41, payload: { note: "kutu ıslanmış" } });
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Paket kuryede değil" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Paket kuryede değil")).toBeInTheDocument();
    expect(cekmeceAcikMi()).toBe(true);
    expect(alan).toHaveValue("  kutu ıslanmış  ");
    await u.click(cekmeceDugmesi("Depoya alındı"));
    expect(kabul).toHaveBeenCalledTimes(3);
    expect(kabul).toHaveBeenLastCalledWith({ packageId: 41, payload: { note: "kutu ıslanmış" } });
    await act(async () => { sozler.pop()!.res({ id: 41, status: "RETURNED" }); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("Kutu depoya alındı.")).toBeInTheDocument();
  });

  it("kapatma: temiz pencere doğrudan kapanır; not yazılmışsa onay ister; ağ hatası pencere içinde", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    kur();
    await u.click(within(screen.getByTestId("satir-42")).getByRole("button", { name: "Depoya al" }));
    await screen.findByText(/PKT-000042 kutusunun/);
    await u.click(cekmeceDugmesi("Vazgeç"));
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    await u.click(within(screen.getByTestId("satir-42")).getByRole("button", { name: "Depoya al" }));
    await u.type(await screen.findByLabelText("Not (isteğe bağlı)"), "hasar");
    await u.click(cekmeceDugmesi("Vazgeç"));
    expect((await screen.findAllByText("Kaydedilmemiş değişiklikler var")).length).toBeGreaterThan(0);
    await u.click(screen.getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(cekmeceAcikMi()).toBe(true);
    expect(screen.getByLabelText("Not (isteğe bağlı)")).toHaveValue("hasar");
    await u.click(cekmeceDugmesi("Depoya alındı"));
    expect(kabul).toHaveBeenLastCalledWith({ packageId: 42, payload: { note: "hasar" } });
    await act(async () => { sozler.pop()!.rej(new Error("Network Error")); await Promise.resolve(); });
    await waitFor(() => expect(document.querySelector(".ant-drawer-open .ant-alert-error")).not.toBeNull());
    expect(cekmeceAcikMi()).toBe(true);
    await u.click(cekmeceDugmesi("Vazgeç"));
    // Önceki onayın kapanmış kopyası DOM'da kalabilir; son görünür onay hedeflenir.
    const onaylar = [...document.querySelectorAll(".ant-modal-confirm")].filter((m) => !m.classList.contains("ant-zoom-leave"));
    await u.click(within(onaylar[onaylar.length - 1] as HTMLElement).getByRole("button", { name: "Değişiklikleri sil" }));
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
  });

  it("gerçek isPending sırasında pencere X/Vazgeç/ESC ile kapanmaz ve ikinci gönderim çıkmaz", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    vi.mocked(useReturnInPackage).mockReturnValue({ mutateAsync: kabul, isPending: true } as never);
    kur();
    await u.click(within(screen.getByTestId("satir-41")).getByRole("button", { name: "Depoya al" }));
    await screen.findByText(/PKT-000041 kutusunun/);
    await u.click(cekmeceDugmesi("Vazgeç"));
    await u.click(document.querySelector(".ant-drawer-open .ant-drawer-close") as HTMLElement);
    await u.keyboard("{Escape}");
    await u.click(cekmeceDugmesi("Depoya alındı"));
    expect(cekmeceAcikMi()).toBe(true);
    expect(kabul).not.toHaveBeenCalled();
  });

  it("rota, menü yaprağı, izin, selectedKey/openKeys; diğer paketleme rotaları değişmedi", () => {
    expect(PATHS.adminNewPackingReturns).toBe("/yonetim-yeni/paketleme/geri-donus");
    expect(ROUTES.adminNewPackingReturns).toBe(PATHS.adminNewPackingReturns);
    expect(PATHS.adminNewPacking).toBe("/yonetim-yeni/paketleme");
    expect(PATHS.adminNewPackingPackages).toBe("/yonetim-yeni/paketleme/paketler");
    expect(PATHS.adminNewPackingPackage).toBe("/yonetim-yeni/paketleme/paket/:id");
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewPackingReturns)).toMatchObject({ label: "Geri Dönüş", requiredPermission: "packing" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewPackingReturns)).toEqual({ selectedKey: "paketleme-geri-donus", openKeys: ["paketleme"] });
    expect(seciliMenuDurumu(PANEL_MENU, ROUTES.adminNewPackingPackage(5))).toEqual({ selectedKey: "paketleme-paketler", openKeys: ["paketleme"] });
    expect(izinBeyaniniKarsilarMi(["packing.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewPackingReturns)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewPackingReturns)!)).toBe(false);
  });
});
