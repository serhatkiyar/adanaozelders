import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { PaketlemeDetayi, paketKimligi, sonucBasligi, vazgecebilir } from "@/panel/pages/paketleme/PaketlemeDetayi";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { scanResultMessage } from "@/lib/packing";
import {
  useCompletePackage,
  usePackage,
  usePackageLabel,
  useScanPackageItem,
  useSplitPackage,
  useUndoPackageScan,
  useVoidPackage,
} from "@/hooks/usePacking";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { Package, PackageItem } from "@/types/packing";

vi.mock("@/hooks/usePacking", () => ({
  usePackage: vi.fn(),
  usePackageLabel: vi.fn(),
  useScanPackageItem: vi.fn(),
  useUndoPackageScan: vi.fn(),
  useCompletePackage: vi.fn(),
  useVoidPackage: vi.fn(),
  useSplitPackage: vi.fn(),
}));

const scan = vi.fn();
const undo = vi.fn();
const complete = vi.fn();
const voidFn = vi.fn();
const split = vi.fn();
const sozler: { res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
const ertelenmis = () => new Promise((res, rej) => { sozler.push({ res, rej }); });

const KALEM_A: PackageItem = { id: 1, order_item_id: 9001, product_id: 11, sku: "FZK-000011", barcode: "8690000000011", title: "Palme TYT Matematik", expected_qty: 2, scanned_qty: 0, remaining: 2 };
const KALEM_B: PackageItem = { id: 2, order_item_id: 9002, product_id: 12, sku: null, barcode: null, title: "345 AYT Fizik", expected_qty: 1, scanned_qty: 1, remaining: 0 };

function paket(ek: Partial<Package> = {}): Package {
  return {
    id: 77, order_id: 501, package_no: 1, code: "PKT-000077", status: "OPEN", qr_payload: "PKG1:77:tok", items_fingerprint: "fp",
    packed_at: null, packed_by_admin_id: null, handed_over_at: null, handed_to_courier_id: null, handed_over_by_actor: null,
    delivered_at: null, returned_at: null, return_note: null, void_at: null, void_reason: null, unpacked_at: null,
    created_at: "2026-09-01T10:00:00Z", created_by: "ORDER", origin_package_id: null, promised_delivery_date: null,
    items: [KALEM_A, KALEM_B], ...ek,
  };
}
const ACIK = paket();
const TAMAM = paket({ items: [{ ...KALEM_A, scanned_qty: 2, remaining: 0 }, KALEM_B] });

const sonuc = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;
const sonSorgu = () => vi.mocked(usePackage).mock.calls.at(-1);
const tarama = (result: string, p: Package = ACIK) => ({ ...p, result, qty_delta: 0, order_item_id: null, replayed: false });

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}
function Konum() {
  return <output data-testid="konum">{`${useLocation().pathname}${useLocation().search}`}</output>;
}
function agac(yol = ROUTES.adminNewPackingPackage(77)) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={PATHS.adminNewPackingPackage} element={<><PaketlemeDetayi /><Konum /></>} />
            <Route path={PATHS.adminNewPackingPackages} element={<><div>Paketler listesi</div><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = (yol?: string) => render(agac(yol));

const kutu = () => screen.getByLabelText("Barkod veya SKU okut") as HTMLInputElement;
const cekmece = () => {
  const acik = [...document.querySelectorAll(".ant-drawer-open")];
  return acik[acik.length - 1] as HTMLElement;
};
const cekmeceAcikMi = () => document.querySelector(".ant-drawer-open") !== null;
// AntD yükleniyor simgesi jsdom'da çıkış animasyonunda takılı kalabilir ("loading" adı öne eklenir); ad sonuna göre eşleşir.
const cekmeceDugmesi = (ad: string) => within(cekmece().querySelector(".ant-drawer-footer") as HTMLElement).getByRole("button", { name: new RegExp(`${ad}$`) });

beforeEach(() => {
  for (const f of [scan, undo, complete, voidFn, split]) f.mockReset().mockImplementation(ertelenmis);
  sozler.length = 0;
  vi.mocked(usePackage).mockReset().mockReturnValue(sonuc(ACIK));
  vi.mocked(usePackageLabel).mockReset().mockReturnValue(sonuc(undefined, { isPending: true }));
  vi.mocked(useScanPackageItem).mockReturnValue({ mutateAsync: scan, isPending: false } as never);
  vi.mocked(useUndoPackageScan).mockReturnValue({ mutateAsync: undo, isPending: false } as never);
  vi.mocked(useCompletePackage).mockReturnValue({ mutateAsync: complete, isPending: false } as never);
  vi.mocked(useVoidPackage).mockReturnValue({ mutateAsync: voidFn, isPending: false } as never);
  vi.mocked(useSplitPackage).mockReturnValue({ mutateAsync: split, isPending: false } as never);
  izin("packing.view", "packing.pack", "packing.manage");
});

describe("saf kurallar", () => {
  it("paketKimligi katı: yalnız düz pozitif tam sayı", () => {
    expect(paketKimligi("77")).toBe(77);
    for (const h of [undefined, "", "0", "-1", "abc", "1e3", "0x10", "42.0", " 5", "5 ", String(Number.MAX_SAFE_INTEGER + 1)]) expect(paketKimligi(h)).toBeNull();
  });
  it("vazgeçme kapısı: OPEN → pack; PACKED/RETURNED → pack + manage; diğerleri kapalı", () => {
    expect(vazgecebilir("OPEN", true, false)).toBe(true);
    expect(vazgecebilir("OPEN", false, true)).toBe(false);
    expect(vazgecebilir("PACKED", true, false)).toBe(false);
    expect(vazgecebilir("PACKED", false, true)).toBe(false);
    expect(vazgecebilir("PACKED", true, true)).toBe(true);
    expect(vazgecebilir("RETURNED", true, true)).toBe(true);
    for (const d of ["HANDED_OVER", "RETURN_PENDING", "DELIVERED", "VOID", "YENI"]) expect(vazgecebilir(d, true, true)).toBe(false);
  });
  it("sonuç başlığı bilinmeyen kodda onaylamaz", () => {
    expect(sonucBasligi("OK")).toBe("Okutuldu");
    expect(sonucBasligi("SOMETHING")).toBe("Kabul edilmedi");
  });
});

describe("PaketlemeDetayi", () => {
  it("geçersiz kimlikte sorgu kapalı, açık hata ve listeye dönüş; view yoksa AccessDenied ve sorgu kapalı", async () => {
    kur(`/yonetim-yeni/paketleme/paket/abc`);
    expect(sonSorgu()).toEqual([null, false]);
    expect(screen.getByText("Paket adresi geçersiz. Paketler listesinden yeniden açın.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Paketler listesine dön" }));
    expect(screen.getByTestId("konum")).toHaveTextContent(PATHS.adminNewPackingPackages);

    izin("packing.pack", "packing.manage");
    kur();
    expect(sonSorgu()).toEqual([77, false]);
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
  });

  it("yükleniyor, 404 ve hata + Tekrar dene", async () => {
    vi.mocked(usePackage).mockReturnValue(sonuc(undefined, { isPending: true }));
    const a = kur();
    expect(screen.getByText("Paket yükleniyor…")).toBeInTheDocument();
    a.unmount();
    vi.mocked(usePackage).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 404 } } }));
    const b = kur();
    expect(screen.getByText("Paket bulunamadı")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paketler listesine dön" })).toBeInTheDocument();
    b.unmount();
    const refetch = vi.fn();
    vi.mocked(usePackage).mockReturnValue(sonuc(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Sunucu patladı" } } }, refetch }));
    kur();
    expect(screen.getByText("Sunucu patladı")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("başlık alanları, sipariş bağlantısı, kalem satırları ve otomatik odak; etiket verisi yalnız istenince", () => {
    kur();
    expect(sonSorgu()).toEqual([77, true]);
    expect(screen.getByRole("heading", { name: "PKT-000077" })).toBeInTheDocument();
    expect(screen.getByText("Paketleniyor")).toBeInTheDocument();
    expect(screen.getByText("1 / 3 okutuldu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#501" })).toHaveAttribute("href", `${PATHS.adminNewPackingPackages}?siparis=501`);
    expect(screen.getByText(/1\. paket/)).toBeInTheDocument();
    const a = within(screen.getByTestId("satir-9001"));
    expect(a.getByText("Palme TYT Matematik")).toBeInTheDocument();
    expect(a.getByText("FZK-000011 · 8690000000011")).toBeInTheDocument();
    expect(a.getByText(/\/ 2 adet/)).toHaveTextContent("0 / 2 adet");
    expect(a.getByRole("button", { name: "Elle doğrula" })).toBeInTheDocument();
    expect(a.queryByRole("button", { name: "Geri al" })).not.toBeInTheDocument();
    const b = within(screen.getByTestId("satir-9002"));
    expect(b.getByText("SKU yok")).toBeInTheDocument();
    expect(b.getByText(/\/ 1 adet · tamam/)).toHaveTextContent("1 / 1 adet · tamam");
    expect(b.getByRole("button", { name: "Geri al" })).toBeInTheDocument();
    expect(b.queryByRole("button", { name: "Elle doğrula" })).not.toBeInTheDocument();
    expect(kutu()).toHaveFocus();
    // OPEN paket basılamaz → etiket düğmesi yok ve etiket verisi çekilmez.
    expect(screen.queryByRole("button", { name: /Etiketi yazdır/ })).not.toBeInTheDocument();
    expect(vi.mocked(usePackageLabel)).not.toHaveBeenCalled();
  });

  it("izin üçlüsü: view-only tamamen salt okunur; pack ile okutma/kapatma; PACKED vazgeç yalnız pack+manage; etiket isteğe bağlı", async () => {
    izin("packing.view");
    const a = kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Barkod veya SKU okut")).not.toBeInTheDocument();
    for (const ad of ["Elle doğrula", "Geri al", "Paketi tamamla", "Kalanı sonraya ayır", "Paketten vazgeç"]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    a.unmount();

    izin("packing.view", "packing.pack");
    const b = kur();
    expect(kutu()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paketi tamamla" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kalanı sonraya ayır" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paketten vazgeç" })).toBeInTheDocument();
    b.unmount();

    vi.mocked(usePackage).mockReturnValue(sonuc(paket({ status: "PACKED", items: TAMAM.items, packed_at: "2026-09-02T10:00:00Z" })));
    const c = kur();
    expect(screen.getByText(/"Hazır" durumunda; okutma ve kapatma yalnız/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paketten vazgeç" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kalanı sonraya ayır" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Barkod veya SKU okut")).not.toBeInTheDocument();
    expect(vi.mocked(usePackageLabel)).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Etiketi yazdır" }));
    await waitFor(() => expect(vi.mocked(usePackageLabel)).toHaveBeenCalledWith(77));
    c.unmount();

    izin("packing.view", "packing.pack", "packing.manage");
    kur();
    expect(screen.getByRole("button", { name: "Paketten vazgeç" })).toBeInTheDocument();
    vi.mocked(usePackage).mockReturnValue(sonuc(paket({ status: "HANDED_OVER" })));
  });

  it("durum kapıları: HANDED_OVER/VOID'de hiçbir aksiyon yok; kalemsiz paket kapatılamaz; fazla okutma uyarısı", () => {
    vi.mocked(usePackage).mockReturnValue(sonuc(paket({ status: "HANDED_OVER" })));
    const a = kur();
    for (const ad of ["Paketten vazgeç", "Kalanı sonraya ayır", "Paketi tamamla", "Elle doğrula", "Geri al"]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    a.unmount();

    vi.mocked(usePackage).mockReturnValue(sonuc(paket({ items: [] })));
    const b = kur();
    expect(screen.getByText("Pakette hiç kalem yok.")).toBeInTheDocument();
    expect(screen.getByText("Pakette hiç kalem yok; boş paket kapatılamaz.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paketi tamamla" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Kalanı sonraya ayır" })).not.toBeInTheDocument();
    b.unmount();

    vi.mocked(usePackage).mockReturnValue(sonuc(paket({ items: [{ ...KALEM_A, scanned_qty: 3 }, KALEM_B] })));
    kur();
    expect(screen.getByText("Veri tutarsızlığı: beklenenden fazla okutulmuş satır var")).toBeInTheDocument();
    expect(screen.getByText(/“Palme TYT Matematik”: beklenen 2, okutulan 3/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paketi tamamla" })).toBeEnabled();
  });

  it("tarama: altı sonuç + bilinmeyen sonuç lib metinleriyle; sayaç yalnız sunucu paketinden; kod temizlenir, odak döner", async () => {
    kur();
    const beklenen: [string, string, string][] = [
      ["OK", "Okutuldu", "success"], ["OK_MANUAL", "Elle doğrulandı", "warning"], ["WRONG_SKU", "Yanlış ürün", "error"],
      ["OVER_QTY", "Fazla adet", "error"], ["ALREADY_COMPLETE", "Paket zaten tamam", "error"], ["UNSCANNABLE", "Okutulamaz satır", "error"],
      ["NEW_CODE", "Kabul edilmedi", "error"],
    ];
    for (const [kodu, baslik, ton] of beklenen) {
      fireEvent.change(kutu(), { target: { value: `KOD-${kodu}` } });
      fireEvent.submit(kutu().closest("form") as HTMLFormElement);
      expect(scan).toHaveBeenLastCalledWith({ packageId: 77, payload: { code: `KOD-${kodu}`, idempotency_key: expect.stringMatching(/^pkg-/) } });
      await act(async () => { sozler.pop()!.res(tarama(kodu)); await Promise.resolve(); });
      const uyari = (await screen.findByText(baslik)).closest(".ant-alert") as HTMLElement;
      expect(uyari).toHaveClass(`ant-alert-${ton}`);
      expect(within(uyari).getByText(scanResultMessage(kodu))).toBeInTheDocument();
      expect(kutu().value).toBe("");
      expect(kutu()).toHaveFocus();
    }
    // Yerel sayaç yok: sunucu aynı paketi döndürdüğü için ekran 1 / 3'te kalır.
    expect(screen.getByText("1 / 3 okutuldu")).toBeInTheDocument();
    expect(scan).toHaveBeenCalledTimes(7);
  });

  it("tarama anahtarı: aynı kod ağ hatasında korunur, başarı sonrası yenilenir, kod değişince yenilenir; aynı tick tek istek; boş kod istek atmaz", async () => {
    kur();
    fireEvent.submit(kutu().closest("form") as HTMLFormElement);
    expect(scan).not.toHaveBeenCalled();
    fireEvent.change(kutu(), { target: { value: "ABC" } });
    const form = kutu().closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(scan).toHaveBeenCalledTimes(1);
    const ilkAnahtar = scan.mock.calls[0][0].payload.idempotency_key;
    await act(async () => { sozler.pop()!.rej({ response: { status: 500, data: { detail: "Ağ koptu" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Gönderilemedi")).toBeInTheDocument();
    expect(screen.getByText("Ağ koptu")).toBeInTheDocument();
    expect(kutu().value).toBe("ABC");
    fireEvent.submit(form);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(scan.mock.calls[1][0].payload.idempotency_key).toBe(ilkAnahtar);
    await act(async () => { sozler.pop()!.res(tarama("OK")); await Promise.resolve(); });
    await screen.findByText("Okutuldu");
    fireEvent.change(kutu(), { target: { value: "ABC" } });
    fireEvent.submit(form);
    expect(scan.mock.calls[2][0].payload.idempotency_key).not.toBe(ilkAnahtar);
    await act(async () => { sozler.pop()!.rej(new Error("x")); await Promise.resolve(); });
    fireEvent.change(kutu(), { target: { value: "XYZ" } });
    fireEvent.submit(form);
    expect(scan.mock.calls[3][0].payload.idempotency_key).not.toBe(scan.mock.calls[2][0].payload.idempotency_key);
  });

  it("elle doğrula: gerekçe zorunlu ve ≤200, payload manual/manual_reason/order_item_id, anahtar satıra bağlı ve hata sonrası korunur, pencere açık kalır, başarıda kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    kur();
    await u.click(within(screen.getByTestId("satir-9001")).getByRole("button", { name: "Elle doğrula" }));
    expect(await screen.findByText(/“Palme TYT Matematik” satırı koddan okutulmadan kapatılacak/)).toBeInTheDocument();
    await u.click(cekmeceDugmesi("Elle doğrula"));
    expect(screen.getByRole("alert")).toHaveTextContent("Gerekçe zorunludur.");
    expect(scan).not.toHaveBeenCalled();
    const alan = screen.getByLabelText("Gerekçe");
    expect(alan).toHaveFocus();
    expect(alan).toHaveAttribute("maxlength", "200");
    await u.type(alan, "Barkod yırtık");
    await u.dblClick(cekmeceDugmesi("Elle doğrula"));
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenLastCalledWith({ packageId: 77, payload: { manual: true, manual_reason: "Barkod yırtık", order_item_id: 9001, idempotency_key: expect.stringMatching(/^pkg-/) } });
    const anahtar = scan.mock.calls[0][0].payload.idempotency_key;
    // Pending'de kapatma yutulur.
    await u.click(cekmeceDugmesi("Vazgeç"));
    expect(cekmeceAcikMi()).toBe(true);
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Satır zaten tamam" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Satır zaten tamam")).toBeInTheDocument();
    expect(cekmeceAcikMi()).toBe(true);
    expect(alan).toHaveValue("Barkod yırtık");
    await u.click(cekmeceDugmesi("Elle doğrula"));
    expect(scan).toHaveBeenCalledTimes(2);
    expect(scan.mock.calls[1][0].payload.idempotency_key).toBe(anahtar);
    await act(async () => { sozler.pop()!.res(tarama("OK_MANUAL")); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(screen.getByText("Elle doğrulandı")).toBeInTheDocument();
    expect(kutu()).toHaveFocus();
    // Aynı satır yeniden açılınca anahtar YENİ (önceki iş kesinleşti).
    await u.click(within(screen.getByTestId("satir-9001")).getByRole("button", { name: "Elle doğrula" }));
    await u.type(await screen.findByLabelText("Gerekçe"), "Tekrar");
    await u.click(cekmeceDugmesi("Elle doğrula"));
    expect(scan.mock.calls[2][0].payload.idempotency_key).not.toBe(anahtar);
  });

  it("geri al: yalnız scanned_qty > 0, gerekçe + sabit anahtar, kirli kapatma onay ister, hata açık kalır, başarıda kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    kur();
    await u.click(within(screen.getByTestId("satir-9002")).getByRole("button", { name: "Geri al" }));
    expect(await screen.findByText(/“345 AYT Fizik” satırından bir adet düşülecek/)).toBeInTheDocument();
    // Temiz form doğrudan kapanır.
    await u.click(cekmeceDugmesi("Vazgeç"));
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    await u.click(within(screen.getByTestId("satir-9002")).getByRole("button", { name: "Geri al" }));
    await u.type(await screen.findByLabelText("Gerekçe"), "Yanlış kutu");
    await u.click(cekmeceDugmesi("Vazgeç"));
    expect((await screen.findAllByText("Kaydedilmemiş değişiklikler var")).length).toBeGreaterThan(0);
    await u.click(screen.getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(cekmeceAcikMi()).toBe(true);
    await u.dblClick(cekmeceDugmesi("Geri al"));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenLastCalledWith({ packageId: 77, payload: { order_item_id: 9002, reason: "Yanlış kutu", idempotency_key: expect.stringMatching(/^pkg-/) } });
    const anahtar = undo.mock.calls[0][0].payload.idempotency_key;
    await act(async () => { sozler.pop()!.rej({ response: { status: 403, data: { detail: "Yetkin yok" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Yetkin yok")).toBeInTheDocument();
    expect(cekmeceAcikMi()).toBe(true);
    await u.click(cekmeceDugmesi("Geri al"));
    expect(undo.mock.calls[1][0].payload.idempotency_key).toBe(anahtar);
    await act(async () => { sozler.pop()!.res(tarama("OK")); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("Okutma geri alındı.")).toBeInTheDocument();
  });

  it("tamamla: engelde kapalı ve eksik adet açıklaması; hazırda aynı tick tek istek; 409 STALE ekranda kalır ve yeniden denenir; başarı", async () => {
    const a = kur();
    expect(screen.getByRole("button", { name: "Paketi tamamla" })).toBeDisabled();
    expect(screen.getByText(/Paketi kapatmak için 2 adet daha okutulmalı/)).toBeInTheDocument();
    a.unmount();

    vi.mocked(usePackage).mockReturnValue(sonuc(TAMAM));
    kur();
    expect(screen.getByText("Bütün kalemler doğrulandı. Kutuyu kapatıp etiketini yapıştırın.")).toBeInTheDocument();
    const dugme = screen.getByRole("button", { name: "Paketi tamamla" });
    expect(dugme).toBeEnabled();
    fireEvent.click(dugme);
    fireEvent.click(dugme);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(77);
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Kalem listesi değişti (STALE)" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Paket kapatılamadı")).toBeInTheDocument();
    expect(screen.getByText(/Kalem listesi değişti \(STALE\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paketi tamamla" }));
    expect(complete).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res({ ...TAMAM, status: "PACKED" }); await Promise.resolve(); });
    expect(await screen.findByText("PKT-000077 paketlendi.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Paket kapatılamadı")).not.toBeInTheDocument());
  });

  it("vazgeç: gerekçe zorunlu, aynı tick tek istek, 403 açık kalır ve yeniden denenir, başarıda kapanır", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    kur();
    await u.click(screen.getByRole("button", { name: "Paketten vazgeç" }));
    expect(await screen.findByText(/Kutu bozulur, içerik rafa döner/)).toBeInTheDocument();
    await u.click(cekmeceDugmesi("Paketten vazgeç"));
    expect(voidFn).not.toHaveBeenCalled();
    await u.type(screen.getByLabelText("Gerekçe"), "Sipariş iptal");
    await u.dblClick(cekmeceDugmesi("Paketten vazgeç"));
    expect(voidFn).toHaveBeenCalledTimes(1);
    expect(voidFn).toHaveBeenCalledWith({ packageId: 77, reason: "Sipariş iptal" });
    await act(async () => { sozler.pop()!.rej({ response: { status: 403, data: { detail: "packing.manage gerekir" } } }); await Promise.resolve(); });
    expect(await screen.findByText("packing.manage gerekir")).toBeInTheDocument();
    expect(cekmeceAcikMi()).toBe(true);
    await u.click(cekmeceDugmesi("Paketten vazgeç"));
    expect(voidFn).toHaveBeenCalledTimes(2);
    await act(async () => { sozler.pop()!.res(paket({ status: "VOID" })); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("PKT-000077 paketinden vazgeçildi.")).toBeInTheDocument();
  });

  it("bölme: gerçek doğrulamalar (hiç seçim yok / kutu boşalır / satır tavanı), tarih boş → null, hata seçim açık kalır, çift gönderim tek istek, başarı", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    kur();
    await u.click(screen.getByRole("button", { name: "Kalanı sonraya ayır" }));
    expect(await screen.findByText(/PKT-000077 kutusundan bugün gönderilemeyecek kalemleri seçin/)).toBeInTheDocument();
    await u.click(cekmeceDugmesi("Sonraki teslimata ayır"));
    expect(screen.getByRole("alert")).toHaveTextContent("Sonraki teslimata ayrılacak en az bir kalem seç.");
    expect(split).not.toHaveBeenCalled();
    const alanA = screen.getByLabelText("Palme TYT Matematik sonraya adet");
    const alanB = screen.getByLabelText("345 AYT Fizik sonraya adet");
    fireEvent.change(alanA, { target: { value: "2" } });
    fireEvent.change(alanB, { target: { value: "1" } });
    await u.click(cekmeceDugmesi("Sonraki teslimata ayır"));
    expect(screen.getByRole("alert")).toHaveTextContent("Kutuda hiç kalem kalmıyor");
    expect(split).not.toHaveBeenCalled();
    fireEvent.change(alanA, { target: { value: "5" } });
    fireEvent.change(alanB, { target: { value: "0" } });
    fireEvent.blur(alanA);
    await u.click(cekmeceDugmesi("Sonraki teslimata ayır"));
    // InputNumber tavanı 2'ye çeker ya da şema reddeder: her iki hâlde 5 sunucuya GİTMEZ.
    expect(split.mock.calls.every((c) => c[0].payload.lines.every((l: { quantity: number }) => l.quantity <= 2))).toBe(true);
    if (sozler.length > 0) await act(async () => { sozler.pop()!.rej(new Error("iptal")); await Promise.resolve(); });
    split.mockClear();
    fireEvent.change(alanA, { target: { value: "1" } });
    fireEvent.change(alanB, { target: { value: "0" } });
    await u.dblClick(cekmeceDugmesi("Sonraki teslimata ayır"));
    expect(split).toHaveBeenCalledTimes(1);
    expect(split).toHaveBeenCalledWith({ packageId: 77, payload: { lines: [{ order_item_id: 9001, quantity: 1 }], promised_date: null } });
    await act(async () => { sozler.pop()!.rej({ response: { status: 409, data: { detail: "Okutulmuş adet ayrılamaz" } } }); await Promise.resolve(); });
    expect(await screen.findByText("Okutulmuş adet ayrılamaz")).toBeInTheDocument();
    expect(cekmeceAcikMi()).toBe(true);
    expect(alanA).toHaveValue("1");
    fireEvent.change(screen.getByLabelText(/İkinci teslimat için tahmini tarih/), { target: { value: "2026-10-01" } });
    await u.click(cekmeceDugmesi("Sonraki teslimata ayır"));
    expect(split).toHaveBeenLastCalledWith({ packageId: 77, payload: { lines: [{ order_item_id: 9001, quantity: 1 }], promised_date: "2026-10-01" } });
    await act(async () => { sozler.pop()!.res(paket({ id: 78, code: "PKT-000078", package_no: 2 })); await Promise.resolve(); });
    await waitFor(() => expect(cekmeceAcikMi()).toBe(false));
    expect(await screen.findByText("Kalan kalemler PKT-000078 paketine ayrıldı (2. teslimat).")).toBeInTheDocument();
  });

  it("rota, menü takma adı, izin, selectedKey/openKeys", () => {
    expect(PATHS.adminNewPackingPackage).toBe("/yonetim-yeni/paketleme/paket/:id");
    expect(ROUTES.adminNewPackingPackage(77)).toBe("/yonetim-yeni/paketleme/paket/77");
    const yol = ROUTES.adminNewPackingPackage(77);
    expect(rotaIzniBul(PANEL_MENU, yol)).toMatchObject({ label: "Paketler", requiredPermission: "packing" });
    expect(seciliMenuDurumu(PANEL_MENU, yol)).toEqual({ selectedKey: "paketleme-paketler", openKeys: ["paketleme"] });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewPackingPackages)).toEqual({ selectedKey: "paketleme-paketler", openKeys: ["paketleme"] });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewPacking)).toEqual({ selectedKey: "paketleme-kuyruk", openKeys: ["paketleme"] });
    expect(izinBeyaniniKarsilarMi(["packing.view"], rotaIzniBul(PANEL_MENU, yol)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, yol)!)).toBe(false);
  });
});
