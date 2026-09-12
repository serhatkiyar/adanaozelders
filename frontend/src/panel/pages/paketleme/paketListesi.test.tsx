import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { PaketListesi, satirEtiketi, zamanDamgasi } from "@/panel/pages/paketleme/PaketListesi";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { usePackageLabels, usePackages, useRepackPackage, useUnpackPackage } from "@/hooks/usePacking";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { Package } from "@/types/packing";

vi.mock("@/hooks/usePacking", () => ({
  usePackages: vi.fn(),
  useRepackPackage: vi.fn(),
  useUnpackPackage: vi.fn(),
  usePackageLabel: vi.fn(() => ({ data: undefined, isLoading: true, isError: false })),
  usePackageLabels: vi.fn(() => []),
}));

const repack = vi.fn();
const unpack = vi.fn();
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];

function paket(ek: Partial<Package> = {}): Package {
  return {
    id: 1, order_id: 501, package_no: 1, code: "PKT-000001", status: "PACKED", qr_payload: "PKG1:1:tok", items_fingerprint: "fp",
    packed_at: "2026-09-10T10:00:00Z", packed_by_admin_id: 1, handed_over_at: null, handed_to_courier_id: null, handed_over_by_actor: null,
    delivered_at: null, returned_at: null, return_note: null, void_at: null, void_reason: null, unpacked_at: null, created_at: "2026-09-09T09:00:00Z",
    created_by: "ORDER", origin_package_id: null,
    items: [{ id: 1, order_item_id: 1, product_id: 1, sku: "A", barcode: null, title: "Kitap", expected_qty: 1, scanned_qty: 1 }] as never,
    ...ek,
  } as Package;
}
const HAZIR = paket();
const ACIK = paket({ id: 2, code: "PKT-000002", status: "OPEN", packed_at: null, items: [] as never });
const DONMUS = paket({ id: 3, code: "PKT-000003", status: "RETURNED", returned_at: "2026-09-11T08:00:00Z" });
const BOZULACAK = paket({ id: 4, code: "PKT-000004", status: "VOID", void_at: "2026-09-11T09:00:00Z" });
const BOZULDU = paket({ id: 5, code: "PKT-000005", status: "VOID", void_at: "2026-09-11T09:00:00Z", unpacked_at: "2026-09-11T10:00:00Z" });
const GERI = paket({ id: 6, code: "PKT-000006", status: "RETURN_PENDING", handed_over_at: "2026-09-11T07:00:00Z" });
const HEPSI = [HAZIR, ACIK, DONMUS, BOZULACAK, BOZULDU, GERI];

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const sonSorgu = () => vi.mocked(usePackages).mock.calls.at(-1);

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}

function Konum() {
  const git = useNavigate();
  const k = useLocation();
  return (
    <>
      <output data-testid="konum">{`${k.pathname}${k.search}`}</output>
      <button type="button" onClick={() => git(-1)}>geri</button>
    </>
  );
}

function agac(yol = PATHS.adminNewPackingPackages) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewPackingPackages} element={<><PaketListesi /><Konum /></>} />
            <Route path={PATHS.adminPackingPackage} element={<><div>Eski paket detayı</div><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = (yol?: string) => render(agac(yol));
// Onay düğmesi: satırdaki aynı adlı düğmeyle karışmasın diye görünür son onay modalı içinden.
const onayDugmesi = (ad: RegExp) => {
  const modal = [...document.querySelectorAll(".ant-modal-confirm")].filter((m) => !m.classList.contains("ant-zoom-leave")).at(-1) as HTMLElement;
  return within(modal).getByRole("button", { name: ad });
};
const onayGorunur = () => [...document.querySelectorAll(".ant-modal-confirm")].some((m) => {
  const wrap = m.closest(".ant-modal-wrap") as HTMLElement | null;
  return Boolean(wrap && wrap.style.display !== "none" && !m.classList.contains("ant-zoom-leave"));
});

beforeEach(() => {
  repack.mockReset();
  unpack.mockReset();
  sozler.length = 0;
  repack.mockImplementation(() => new Promise((res, rej) => { sozler.push({ res, rej }); }));
  unpack.mockImplementation(() => new Promise((res, rej) => { sozler.push({ res, rej }); }));
  vi.mocked(usePackages).mockReset().mockReturnValue(sonuc({ items: HEPSI, total: 6, limit: 20, offset: 0 }));
  vi.mocked(useRepackPackage).mockReturnValue({ mutateAsync: repack, isPending: false } as never);
  vi.mocked(useUnpackPackage).mockReturnValue({ mutateAsync: unpack, isPending: false } as never);
  vi.mocked(usePackageLabels).mockClear();
  izin("packing.view", "packing.pack", "packing.manage");
});

describe("saf yardımcılar", () => {
  it("satır etiketi ve tek zaman damgası", () => {
    expect(satirEtiketi(GERI)).toBe("Geri bekleniyor");
    expect(satirEtiketi(BOZULACAK)).toBe("Bozulacak");
    expect(satirEtiketi(BOZULDU)).toBe("Bozuldu");
    expect(satirEtiketi(HAZIR)).toBe("Hazır");
    expect(zamanDamgasi(HAZIR)).toMatch(/^paketlendi · /);
    expect(zamanDamgasi(ACIK)).toMatch(/^açıldı · /);
    expect(zamanDamgasi(DONMUS)).toMatch(/^depoya alındı · /);
    expect(zamanDamgasi(GERI)).toMatch(/^kuryeye verildi · /);
    expect(zamanDamgasi(BOZULACAK)).toMatch(/^vazgeçildi · /);
    expect(zamanDamgasi(BOZULDU)).toMatch(/^bozuldu · /);
    expect(zamanDamgasi(paket({ status: "PACKED", packed_at: null }))).toBeNull();
  });
});

describe("PaketListesi", () => {
  it("satırlar: kod (eski detay linki), sipariş/kalem/damga, durum etiketi; aksiyonlar yalnız doğru durumda", () => {
    kur();
    expect(screen.getByRole("heading", { name: "Paketler" })).toBeInTheDocument();
    expect(sonSorgu()).toEqual([{ status: undefined, orderId: undefined, limit: 20, offset: 0 }, true]);
    expect(screen.getByRole("link", { name: "PKT-000001" })).toHaveAttribute("href", ROUTES.adminPackingPackage(1));
    expect(screen.getByText(/Sipariş #501 · 1 kalem · paketlendi ·/)).toBeInTheDocument();
    expect(screen.getByText("Geri bekleniyor")).toBeInTheDocument();
    expect(screen.getByText("Bozulacak")).toBeInTheDocument();
    expect(screen.getByText("Bozuldu")).toBeInTheDocument();
    expect(screen.getByText("Paketleniyor")).toBeInTheDocument();
    // Etiket yalnız PACKED/RETURNED; repack yalnız RETURNED; bozuldu yalnız VOID+unpacked_at yok
    expect(screen.getAllByRole("button", { name: "Etiket" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Yeniden paketle" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Bozuldu olarak işaretle" })).toHaveLength(1);
    expect(screen.getByText("1 - 6 / 6 Paket")).toBeInTheDocument();
  });

  it("izin üçlüsü: view yoksa AccessDenied + enabled=false; view-only etiket var, yönetim yok; pack yönetim açmaz", () => {
    izin("packing.pack", "packing.manage");
    const a = kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(sonSorgu()?.[1]).toBe(false);
    a.unmount();

    izin("packing.view");
    const b = kur();
    expect(screen.getByText(/packing\.manage izni gerekir/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Etiket" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Yeniden paketle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bozuldu olarak işaretle" })).not.toBeInTheDocument();
    b.unmount();

    izin("packing.view", "packing.pack");
    kur();
    expect(screen.queryByRole("button", { name: "Yeniden paketle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bozuldu olarak işaretle" })).not.toBeInTheDocument();
  });

  it("URL süzgeçleri: durum beyaz listesi (constructor/toString/__proto__ sunucuya gitmez), sipariş, sayfa, boyut", () => {
    // Sayfa 2'nin geçerli kalması için toplam sayfa boyutundan büyük olmalı (aksi hâlde son sayfaya çekilir).
    vi.mocked(usePackages).mockReturnValue(sonuc({ items: HEPSI, total: 45, limit: 10, offset: 10 }));
    const a = kur(`${PATHS.adminNewPackingPackages}?durum=RETURNED&siparis=501&sayfa=2&boyut=10`);
    expect(sonSorgu()).toEqual([{ status: "RETURNED", orderId: 501, limit: 10, offset: 10 }, true]);
    a.unmount();
    for (const kotu of ["constructor", "toString", "__proto__", "drop_table"]) {
      const r = kur(`${PATHS.adminNewPackingPackages}?durum=${kotu}&siparis=abc&sayfa=-3&boyut=999`);
      expect(sonSorgu()).toEqual([{ status: undefined, orderId: undefined, limit: 20, offset: 0 }, true]);
      r.unmount();
    }
  });

  it("filtre değişince sayfa 1 ve seçim temizlenir; geri tuşu URL, sorgu ve kontrolü eşler", async () => {
    vi.mocked(usePackages).mockReturnValue(sonuc({ items: HEPSI, total: 45, limit: 20, offset: 20 }));
    kur(`${PATHS.adminNewPackingPackages}?sayfa=2`);
    await userEvent.click(screen.getByRole("checkbox", { name: "PKT-000001 etiketini seç" }));
    expect(screen.getByRole("button", { name: /Seçili 1 etiketi yazdır/ })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Filtre" }));
    await userEvent.click(await screen.findByRole("combobox", { name: "Durum" }));
    await userEvent.click(await screen.findByTitle("Depoda"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("durum=RETURNED"));
    expect(screen.getByTestId("konum")).not.toHaveTextContent("sayfa=");
    expect(sonSorgu()).toEqual([{ status: "RETURNED", orderId: undefined, limit: 20, offset: 0 }, true]);
    expect(screen.getByRole("button", { name: /Seçili 0 etiketi yazdır/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "PKT-000001 etiketini seç" })).not.toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "geri" }));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("sayfa=2"));
    expect(sonSorgu()).toEqual([{ status: undefined, orderId: undefined, limit: 20, offset: 20 }, true]);
  });

  it("sayfalama: boyut seçenekleri 10/20/50; veri azalınca son geçerli sayfaya çekilir", async () => {
    vi.mocked(usePackages).mockReturnValue(sonuc({ items: HEPSI, total: 45, limit: 20, offset: 0 }));
    const a = kur();
    await userEvent.click(screen.getByRole("combobox", { name: "Satır Adedi" }));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["10", "20", "50"]);
    await userEvent.click(screen.getByTitle("50"));
    await waitFor(() => expect(sonSorgu()).toEqual([{ status: undefined, orderId: undefined, limit: 50, offset: 0 }, true]));
    a.unmount();

    vi.mocked(usePackages).mockReturnValue(sonuc({ items: HEPSI, total: 30, limit: 20, offset: 20 }));
    kur(`${PATHS.adminNewPackingPackages}?sayfa=9`);
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent("sayfa=2"));
    expect(screen.queryByText(/paket yok|paket açılmadı/)).not.toBeInTheDocument();
  });

  it("toplu etiket: seçim yalnız basılabilir satırlarda; etiket verisi yalnız yazdır isteğinde çekilir", async () => {
    kur();
    expect(screen.getByRole("checkbox", { name: "PKT-000002 etiketini seç" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "PKT-000006 etiketini seç" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Seçili 0 etiketi yazdır/ })).toBeDisabled();
    expect(vi.mocked(usePackageLabels)).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("checkbox", { name: "PKT-000001 etiketini seç" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "PKT-000003 etiketini seç" }));
    await userEvent.click(screen.getByRole("button", { name: /Seçili 2 etiketi yazdır/ }));
    await waitFor(() => expect(vi.mocked(usePackageLabels)).toHaveBeenCalledWith([1, 3]));
  });

  it("yeniden paketle: onay hedefi sabit, çift onay tek istek, pending'de kapanmaz, 409 açık kalır ve yeniden denenir, başarı", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Yeniden paketle" }));
    expect(await screen.findByText(/PKT-000003 yeniden dağıtıma girer\. Kutunun üstündeki etiket GEÇERLİ kalır/)).toBeInTheDocument();
    await userEvent.dblClick(onayDugmesi(/^Yeniden paketle$/));
    await userEvent.click(onayDugmesi(/Yeniden paketle/));
    expect(repack).toHaveBeenCalledTimes(1);
    expect(repack).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole("button", { name: "İptal" }));
    expect(onayGorunur()).toBe(true);
    await act(async () => {
      sozler[0].rej({ response: { status: 409, data: { detail: "Paket zaten dağıtımda" } } });
      await Promise.resolve();
    });
    expect(await screen.findByText("Paket zaten dağıtımda")).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi(/Yeniden paketle/)).not.toHaveClass("ant-btn-loading"));
    await userEvent.click(onayDugmesi(/Yeniden paketle/));
    expect(repack).toHaveBeenCalledTimes(2);
    expect(repack).toHaveBeenLastCalledWith(3);
    await act(async () => {
      sozler[1].res({ ...DONMUS, status: "PACKED" });
      await Promise.resolve();
    });
    expect(await screen.findByText("Paket yeniden dağıtıma hazır.")).toBeInTheDocument();
    await waitFor(() => expect(onayGorunur()).toBe(false));
  });

  it("bozuldu damgası: stok yazmadığı açıklaması, 403 gerçek hata, yeniden deneme ve başarı", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Bozuldu olarak işaretle" }));
    expect(await screen.findByText(/PKT-000004 kutusunun fiziksel olarak açıldığını .* Bu damga stok hareketi YAZMAZ/)).toBeInTheDocument();
    await userEvent.dblClick(onayDugmesi(/^Bozuldu$/));
    expect(unpack).toHaveBeenCalledTimes(1);
    expect(unpack).toHaveBeenCalledWith(4);
    await act(async () => {
      sozler[0].rej({ response: { status: 403, data: { detail: "Bu işlem için yetkin yok." } } });
      await Promise.resolve();
    });
    expect(await screen.findByText(/yetkin yok/)).toBeInTheDocument();
    expect(onayGorunur()).toBe(true);
    await waitFor(() => expect(onayDugmesi(/Bozuldu/)).not.toHaveClass("ant-btn-loading"));
    await userEvent.click(onayDugmesi(/Bozuldu/));
    expect(unpack).toHaveBeenCalledTimes(2);
    await act(async () => {
      sozler[1].res({ ...BOZULACAK, unpacked_at: "2026-09-12T00:00:00Z" });
      await Promise.resolve();
    });
    expect(await screen.findByText("Kutu bozuldu olarak işaretlendi.")).toBeInTheDocument();
  });

  it("satır tıklaması eski detaya gider; link ve aksiyon hücresi satırı tetiklemez; iç içe a/button yok", async () => {
    kur();
    const link = screen.getByRole("link", { name: "PKT-000001" });
    expect(link.closest("button")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Yeniden paketle" }));
    expect(screen.getByTestId("konum")).toHaveTextContent(PATHS.adminNewPackingPackages);
    await userEvent.click(screen.getByText("Geri bekleniyor"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent(ROUTES.adminPackingPackage(6)));
    expect(screen.getByText("Eski paket detayı")).toBeInTheDocument();
  });

  it("boş (filtresiz/filtreli), hata + Tekrar dene, yükleniyor", async () => {
    vi.mocked(usePackages).mockReturnValue(sonuc({ items: [], total: 0, limit: 20, offset: 0 }));
    const a = kur();
    expect(screen.getByText("Henüz paket açılmadı")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Süzgeci temizle" })).not.toBeInTheDocument();
    a.unmount();
    const b = kur(`${PATHS.adminNewPackingPackages}?durum=VOID`);
    expect(screen.getByText("Bu süzgeçte paket yok")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Süzgeci temizle" }));
    await waitFor(() => expect(screen.getByTestId("konum")).not.toHaveTextContent("durum="));
    b.unmount();

    const refetch = vi.fn();
    vi.mocked(usePackages).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { data: { detail: "Liste servisi yanıt vermedi" } } }, refetch }));
    const c = kur();
    expect(screen.getByText("Liste servisi yanıt vermedi")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
    c.unmount();

    vi.mocked(usePackages).mockReturnValue(sonuc(undefined, { isPending: true }));
    kur();
    expect(screen.queryByText("Henüz paket açılmadı")).not.toBeInTheDocument();
  });

  it("menü: Paketleme → Paketler gerçek rota (packing), Kuyruk korunur, Geri Dönüş path'siz; seçili/açık anahtarlar", () => {
    expect(PATHS.adminNewPackingPackages).toBe("/yonetim-yeni/paketleme/paketler");
    expect(ROUTES.adminNewPackingPackages).toBe(PATHS.adminNewPackingPackages);
    const grup = PANEL_MENU.find((m) => m.key === "paketleme")!;
    expect(grup.children?.map((c) => [c.key, Boolean(c.path)])).toEqual([["paketleme-kuyruk", true], ["paketleme-paketler", true], ["paketleme-geri-donus", false]]);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewPackingPackages)).toMatchObject({ label: "Paketler", requiredPermission: "packing" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewPackingPackages)).toEqual({ selectedKey: "paketleme-paketler", openKeys: ["paketleme"] });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewPacking)).toEqual({ selectedKey: "paketleme-kuyruk", openKeys: ["paketleme"] });
    expect(izinBeyaniniKarsilarMi(["packing.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewPackingPackages)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewPackingPackages)!)).toBe(false);
    within(document.body);
  });
});
