import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { PaketlemeKuyrugu, sayfaNo } from "@/panel/pages/paketleme/PaketlemeKuyrugu";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { packingAccess } from "@/lib/packing";
import { MISSING_ITEMS_TEXT } from "@/lib/orderItems";
import { useOpenPackage, usePackingQueue, useRepackPackage } from "@/hooks/usePacking";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { PackingQueueRow } from "@/types/packing";

vi.mock("@/hooks/usePacking", () => ({
  usePackingQueue: vi.fn(),
  useOpenPackage: vi.fn(),
  useRepackPackage: vi.fn(),
}));

const ac = vi.fn();
const repack = vi.fn();
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];

function satir(ek: Partial<PackingQueueRow> = {}): PackingQueueRow {
  return {
    order_id: 501,
    recipient: "Ayşe Yılmaz",
    phone: "05551112233",
    address: "Atatürk Cad. 5 Çukurova/Adana",
    city: "Adana",
    district: "Çukurova",
    item_count: 3,
    items: [{ title: "9. Sınıf Matematik", quantity: 2 }, { title: "Deneme Seti", quantity: 1 }],
    promised_delivery_date: "2099-01-01",
    created_at: null,
    prepared_at: null,
    package: null,
    next_action: "OPEN_NEW_PACKAGE",
    ...ek,
  };
}
const ACIK = satir();
const DEVAM = satir({ order_id: 502, recipient: null, address: null, items: [], item_count: 0, package: { id: 77, code: "PKT-000077", status: "OPEN" }, next_action: "CONTINUE_PACKING" });
const DONMUS = satir({ order_id: 503, recipient: "Dönen Müşteri", package: { id: 78, code: "PKT-000078", status: "RETURNED" }, next_action: "REPACK_RETURNED" });
const BILINMEZ = satir({ order_id: 504, recipient: "Bilinmez Müşteri", package: { id: 79, code: "PKT-000079", status: "PACKED" }, next_action: "SOMETHING_NEW" as never });
const EKSIK = satir({ order_id: 505, recipient: "Eksik Müşteri", package: null, next_action: null });

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const sonSorgu = () => vi.mocked(usePackingQueue).mock.calls.at(-1);

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}

function Konum() {
  return <output data-testid="konum">{`${useLocation().pathname}${useLocation().search}`}</output>;
}

function agac(yol = PATHS.adminNewPacking) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewPacking} element={<><PaketlemeKuyrugu /><Konum /></>} />
            <Route path={PATHS.adminPackingPackage} element={<><div>Eski paket detayı</div><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = (yol?: string) => render(agac(yol));

beforeEach(() => {
  ac.mockReset();
  repack.mockReset();
  sozler.length = 0;
  ac.mockImplementation(() => new Promise((res, rej) => { sozler.push({ res, rej }); }));
  repack.mockImplementation(() => new Promise((res, rej) => { sozler.push({ res, rej }); }));
  vi.mocked(usePackingQueue).mockReset().mockReturnValue(sonuc({ items: [ACIK, DEVAM, DONMUS, BILINMEZ, EKSIK], total: 5 }));
  vi.mocked(useOpenPackage).mockReturnValue({ mutateAsync: ac, isPending: false } as never);
  vi.mocked(useRepackPackage).mockReturnValue({ mutateAsync: repack, isPending: false } as never);
  izin("packing.view", "packing.pack", "packing.manage");
});

describe("izin üçlüsü", () => {
  it("packingAccess kademeleri birbirini ima etmez", () => {
    expect(packingAccess(["packing.manage"])).toEqual({ canView: false, canPack: false, canManage: true });
    expect(packingAccess(["packing.pack"])).toEqual({ canView: false, canPack: true, canManage: false });
    expect(packingAccess(["packing.view"])).toEqual({ canView: true, canPack: false, canManage: false });
  });
  it("sayfaNo: geçersiz/negatif/boş 1'e düşer", () => {
    expect(sayfaNo("3")).toBe(3);
    for (const h of [null, "", "0", "-2", "abc", "1.5", "1e3", String(Number.MAX_SAFE_INTEGER + 1)]) expect(sayfaNo(h)).toBe(1);
  });
});

describe("PaketlemeKuyrugu", () => {
  it("gerçek satır alanları, ItemLines, paket rozeti ve üç bilinen eylem; bilinmeyen/eksik fail-closed", () => {
    kur();
    expect(screen.getByRole("heading", { name: "Paketleme kuyruğu" })).toBeInTheDocument();
    expect(sonSorgu()).toEqual([{ limit: 50, offset: 0 }, true]);
    expect(screen.getByText("5 sipariş")).toBeInTheDocument();
    expect(screen.getByText("Ayşe Yılmaz")).toBeInTheDocument();
    expect(screen.getByText("#501")).toBeInTheDocument();
    expect(screen.getAllByText("Atatürk Cad. 5 Çukurova/Adana")).toHaveLength(4);
    expect(screen.getAllByText(/Söz:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/9\. Sınıf Matematik/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Deneme Seti/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("3 parça")).toHaveLength(4);
    expect(screen.getByText("Alıcı bilgisi girilmemiş")).toBeInTheDocument();
    expect(screen.getByText("Adres yok")).toBeInTheDocument();
    expect(screen.getByText(MISSING_ITEMS_TEXT)).toBeInTheDocument();
    expect(screen.getByText("PKT-000077 · Paketleniyor")).toBeInTheDocument();
    expect(screen.getByText("PKT-000078 · Depoya döndü")).toBeInTheDocument();
    expect(screen.getByText("PKT-000079 · Hazır")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Paketlemeye başla" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Paketlemeye devam et" })).toHaveAttribute("href", ROUTES.adminPackingPackage(77));
    expect(screen.getByRole("button", { name: "Yeniden paketle" })).toBeInTheDocument();
    // Bilinmeyen eylem: yalnız okuma bağlantısı; eksik eylem ve paket yok: hiçbir şey
    expect(screen.getAllByRole("link", { name: "Paketi gör →" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Paketi gör →" })).toHaveAttribute("href", ROUTES.adminPackingPackage(79));
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(ac).not.toHaveBeenCalled();
    expect(repack).not.toHaveBeenCalled();
  });

  it("Paketlemeye başla: çift tık tek istek, sunucunun döndürdüğü paket ID'sine (eski detay rotası) gider", async () => {
    kur();
    await userEvent.dblClick(screen.getByRole("button", { name: "Paketlemeye başla" }));
    expect(ac).toHaveBeenCalledTimes(1);
    expect(ac).toHaveBeenCalledWith(501);
    // Başka satırın eylemi kilitlenmez
    await userEvent.click(screen.getByRole("button", { name: "Yeniden paketle" }));
    expect(repack).toHaveBeenCalledTimes(1);
    expect(repack).toHaveBeenCalledWith(78);
    await act(async () => {
      sozler[0].res({ id: 9001, code: "PKT-009001", order_id: 501, status: "OPEN" });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent(ROUTES.adminPackingPackage(9001)));
    expect(screen.getByText("Eski paket detayı")).toBeInTheDocument();
  });

  it("paket açma hatası görünür, kilit bırakılır ve yeniden denenebilir", async () => {
    kur();
    const dugme = screen.getByRole("button", { name: "Paketlemeye başla" });
    await userEvent.click(dugme);
    await act(async () => {
      sozler[0].rej({ response: { status: 409, data: { detail: "Sipariş henüz ödenmedi" } } });
      await Promise.resolve();
    });
    expect(await screen.findByText("Sipariş henüz ödenmedi")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Paketlemeye başla/ })).not.toHaveClass("ant-btn-loading"));
    await userEvent.click(screen.getByRole("button", { name: /Paketlemeye başla/ }));
    expect(ac).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("konum")).toHaveTextContent(PATHS.adminNewPacking);
  });

  it("Yeniden paketle: çift tık tek istek; başarı mesajı; 403 gerçek hata ve yeniden deneme", async () => {
    kur();
    await userEvent.dblClick(screen.getByRole("button", { name: "Yeniden paketle" }));
    expect(repack).toHaveBeenCalledTimes(1);
    await act(async () => {
      sozler[0].rej({ response: { status: 403, data: { detail: "Bu işlem için yetkin yok." } } });
      await Promise.resolve();
    });
    expect(await screen.findByText(/yetkin yok/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Yeniden paketle/ })).not.toHaveClass("ant-btn-loading"));
    await userEvent.click(screen.getByRole("button", { name: /Yeniden paketle/ }));
    expect(repack).toHaveBeenCalledTimes(2);
    await act(async () => {
      sozler[1].res({ id: 78, code: "PKT-000078", order_id: 503, status: "PACKED" });
      await Promise.resolve();
    });
    expect(await screen.findByText("Paket yeniden dağıtıma hazır.")).toBeInTheDocument();
  });

  it("izinler: pack yoksa açma/devam yok (paket varsa yalnız okuma); manage yoksa repack açıklaması; view-only salt okunur; view yoksa AccessDenied + enabled=false", () => {
    izin("packing.view", "packing.manage");
    const a = kur();
    expect(screen.queryByRole("button", { name: "Paketlemeye başla" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Paketlemeye devam et" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Paketi gör →" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Yeniden paketle" })).toBeInTheDocument();
    a.unmount();

    izin("packing.view", "packing.pack");
    const b = kur();
    expect(screen.getByRole("button", { name: "Paketlemeye başla" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yeniden paketle" })).not.toBeInTheDocument();
    expect(screen.getByText(/paket yönetimi izni gerekir/)).toBeInTheDocument();
    b.unmount();

    izin("packing.view");
    const c = kur();
    expect(screen.getByText(/yalnız görüntüleme yetkiniz var/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Ayşe Yılmaz")).toBeInTheDocument();
    c.unmount();

    izin("packing.pack", "packing.manage");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(sonSorgu()?.[1]).toBe(false);
  });

  it("URL sayfası hook offset'ine gider; geçersiz sayfa 1; veri azalınca son sayfaya çekilir; sayfalama", async () => {
    vi.mocked(usePackingQueue).mockReturnValue(sonuc({ items: [ACIK], total: 120 }));
    const ilk = kur(`${PATHS.adminNewPacking}?sayfa=3`);
    expect(sonSorgu()).toEqual([{ limit: 50, offset: 100 }, true]);
    expect(screen.getByText("101 - 120 / 120 sipariş")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("2"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("sayfa=2"));
    expect(sonSorgu()).toEqual([{ limit: 50, offset: 50 }, true]);
    ilk.unmount();

    vi.mocked(usePackingQueue).mockReturnValue(sonuc({ items: [ACIK], total: 5 }));
    const ikinci = kur(`${PATHS.adminNewPacking}?sayfa=-4`);
    expect(sonSorgu()).toEqual([{ limit: 50, offset: 0 }, true]);
    expect(screen.queryByRole("list", { name: /pagination/i })).not.toBeInTheDocument();
    ikinci.unmount();

    vi.mocked(usePackingQueue).mockReturnValue(sonuc({ items: [ACIK], total: 60 }));
    kur(`${PATHS.adminNewPacking}?sayfa=9`);
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("sayfa=2"));
    expect(screen.queryByText("Paketlenecek sipariş yok")).not.toBeInTheDocument();
  });

  it("yükleniyor, hata + kendi refetch'i ve boş durum", async () => {
    vi.mocked(usePackingQueue).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    expect(screen.getByText("Kuyruk yükleniyor…")).toBeInTheDocument();
    a.unmount();

    const refetch = vi.fn();
    vi.mocked(usePackingQueue).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { data: { detail: "Kuyruk servisi yanıt vermedi" } } }, refetch }));
    const b = kur();
    expect(screen.getByText("Kuyruk servisi yanıt vermedi")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    b.unmount();

    vi.mocked(usePackingQueue).mockReturnValue(sonuc({ items: [], total: 0 }));
    kur();
    expect(screen.getByText("Paketlenecek sipariş yok")).toBeInTheDocument();
    expect(screen.getByText("Yeni fiziksel siparişler ödendikçe burada belirir.")).toBeInTheDocument();
    expect(screen.queryByText(/sipariş$/)).not.toBeInTheDocument();
  });

  it("menü: Paketleme kök grubu (Kuyruk ve Paketler gerçek rota, Geri Dönüş yer tutucu), packing izni, seçili/açık anahtarlar", () => {
    expect(PATHS.adminNewPacking).toBe("/yonetim-yeni/paketleme");
    expect(ROUTES.adminNewPacking).toBe(PATHS.adminNewPacking);
    const grup = PANEL_MENU.find((m) => m.key === "paketleme")!;
    expect(grup.icon).toBeTruthy();
    expect(grup.path).toBeUndefined();
    expect(grup.children?.map((c) => c.label)).toEqual(["Kuyruk", "Paketler", "Geri Dönüş"]);
    expect(grup.children?.[1].path).toBe(PATHS.adminNewPackingPackages);
    expect(grup.children?.[2].path).toBeUndefined();
    expect(grup.children?.some((c) => c.children?.length)).toBe(false);
    expect(PANEL_MENU.find((m) => m.key === "dagitim")).toBeTruthy();
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewPacking)).toMatchObject({ label: "Kuyruk", requiredPermission: "packing" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewPacking)).toEqual({ selectedKey: "paketleme-kuyruk", openKeys: ["paketleme"] });
    expect(izinBeyaniniKarsilarMi(["packing.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewPacking)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewPacking)!)).toBe(false);
  });

  it("propsuz izinsiz mount kapalı: hiçbir mutasyon tetiklenmez", () => {
    kur();
    within(screen.getByRole("region", { name: "Paketleme kuyruğu" }));
    expect(ac).not.toHaveBeenCalled();
    expect(repack).not.toHaveBeenCalled();
  });
});
