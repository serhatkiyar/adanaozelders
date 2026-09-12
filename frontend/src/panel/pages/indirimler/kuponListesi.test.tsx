import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { KuponListesi } from "@/panel/pages/indirimler/KuponListesi";
import { PANEL_MENU, izinBeyaniniKarsilarMi, menuyuIzneGoreSuz, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import { useCoupons, useCreateCoupon, useDeleteCoupon, useUpdateCoupon } from "@/hooks/useStore";
import { kuponGovdesi } from "@/lib/storeCouponForm";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { Coupon } from "@/types";

vi.mock("@/hooks/useStore", () => ({
  useCoupons: vi.fn(),
  useCreateCoupon: vi.fn(),
  useUpdateCoupon: vi.fn(),
  useDeleteCoupon: vi.fn(),
}));

const mockListe = vi.mocked(useCoupons);
const olustur = vi.fn();
const guncelle = vi.fn();
const silAsync = vi.fn();

const KUPON: Coupon = {
  id: 5, code: "YAZ20", discount_type: "PERCENT", discount_value: "20.00", min_subtotal: "150.00",
  max_uses: 100, per_user_limit: 1, used_count: 7, is_active: true,
};
const PASIF: Coupon = { ...KUPON, id: 6, code: "SABIT50", discount_type: "FIXED", discount_value: "50.00", max_uses: null, per_user_limit: null, is_active: false };
const cokKupon = (n: number): Coupon[] => Array.from({ length: n }, (_, i) => ({ ...KUPON, id: 100 + i, code: `K${i + 1}` }));
const yanit422 = (alan: string, msg: string) => ({ response: { status: 422, data: { detail: [{ loc: ["body", alan], msg }] } } });

function agac() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={[PATHS.adminNewCoupons]}>
          <KuponListesi />
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>
  );
}
const kur = () => render(agac());

function izinVer(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}

const liste = (data: unknown, ek: object = {}) => ({ data, isPending: false, isError: false, refetch: vi.fn(), ...ek }) as never;
const onay = async () => {
  const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
  await within(dialog).findAllByText("Kaydedilmemiş değişiklikler var");
  return dialog;
};

async function cekmeceAc() {
  await userEvent.click(screen.getByRole("button", { name: /Kupon Ekle/ }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  olustur.mockClear();
  guncelle.mockClear();
  silAsync.mockReset();
  silAsync.mockResolvedValue(undefined);
  mockListe.mockReturnValue(liste([KUPON, PASIF]));
  vi.mocked(useCreateCoupon).mockReturnValue({ mutate: olustur, isPending: false } as never);
  vi.mocked(useUpdateCoupon).mockReturnValue({ mutate: guncelle, isPending: false } as never);
  vi.mocked(useDeleteCoupon).mockReturnValue({ mutateAsync: silAsync, isPending: false } as never);
  izinVer("coupons.view", "coupons.manage");
});

describe("KuponListesi", () => {
  it("gerçek kolonlar; yüzde ve sabit para biçimi; hiçbir yerde Düzenle yok", async () => {
    kur();
    expect(screen.getByRole("heading", { name: "Kuponlar" })).toBeInTheDocument();
    for (const b of ["Kod", "İndirim", "Minimum sepet", "Kullanım", "Kişi başı", "Durum"]) {
      expect(screen.getByRole("columnheader", { name: b })).toBeInTheDocument();
    }
    const satir = screen.getByText("YAZ20").closest("tr")!;
    expect(within(satir).getByText("%20")).toBeInTheDocument();
    expect(within(satir).getByText("7 / 100")).toBeInTheDocument();
    expect(within(satir).getByText("Aktif")).toBeInTheDocument();
    const pasif = screen.getByText("SABIT50").closest("tr")!;
    expect(within(pasif).getAllByRole("cell")[1]).toHaveTextContent("50 TL");
    expect(within(pasif).getAllByRole("cell")[2]).toHaveTextContent("150 TL");
    expect(within(pasif).getByText("Pasif")).toBeInTheDocument();
    expect(within(pasif).getByText("—")).toBeInTheDocument();
    expect(mockListe).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole("button", { name: "YAZ20 aksiyonları" }));
    const ogeler = (await screen.findAllByRole("menuitem")).map((m) => m.textContent);
    expect(ogeler).toEqual(["Devre dışı bırak", "Sil"]);
    expect(screen.queryByText(/Düzenle/)).not.toBeInTheDocument();
  });

  it("başlangıç 20 satır, istemci sayfalaması; veri azalınca son geçerli sayfaya döner", async () => {
    mockListe.mockReturnValue(liste(cokKupon(45)));
    const { rerender } = kur();
    expect(screen.getAllByRole("row")).toHaveLength(21);
    expect(screen.getByText("1 - 20 / 45 Kupon")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("3"));
    expect(screen.getByText("41 - 45 / 45 Kupon")).toBeInTheDocument();
    expect(screen.getByText("K41")).toBeInTheDocument();

    mockListe.mockReturnValue(liste(cokKupon(25)));
    rerender(agac());
    await waitFor(() => expect(screen.getByText("21 - 25 / 25 Kupon")).toBeInTheDocument());
    expect(screen.getByText("K21")).toBeInTheDocument();
    expect(screen.queryByText("Henüz kupon yok")).not.toBeInTheDocument();
    // State gerçekten 2'ye çekildi: veri yeniden artınca 3. sayfaya sıçramaz.
    mockListe.mockReturnValue(liste(cokKupon(45)));
    rerender(agac());
    expect(screen.getByText("21 - 40 / 45 Kupon")).toBeInTheDocument();
    expect(screen.getByText("K21")).toBeInTheDocument();
    expect(screen.queryByText("K41")).not.toBeInTheDocument();
  });

  it("oluşturma: zod kuralları alanlara düşer, ilk alana odak; gövde kuponGovdesi ile birebir", async () => {
    kur();
    const cekmece = await cekmeceAc();
    const gonder = within(cekmece).getByRole("button", { name: "Kupon oluştur" });
    expect(gonder).not.toBeDisabled();
    const kod = within(cekmece).getByLabelText("Kod");
    const deger = within(cekmece).getByLabelText("Değer");
    const minSepet = within(cekmece).getByLabelText("Minimum sepet");
    const maks = within(cekmece).getByLabelText("Maksimum kullanım (isteğe bağlı)");
    const kisi = within(cekmece).getByLabelText("Kişi başı limit (isteğe bağlı)");

    await userEvent.click(gonder);
    expect(await within(cekmece).findByText("Kupon kodu zorunlu.")).toBeInTheDocument();
    expect(within(cekmece).queryByText("Kupon kodu boşluk içeremez.")).not.toBeInTheDocument();
    await waitFor(() => expect(kod).toHaveFocus());
    expect(olustur).not.toHaveBeenCalled();

    await userEvent.type(kod, "yaz 10");
    await userEvent.click(gonder);
    expect(await within(cekmece).findByText("Kupon kodu boşluk içeremez.")).toBeInTheDocument();

    await userEvent.clear(kod);
    await userEvent.type(kod, "kis10");
    await userEvent.clear(deger);
    await userEvent.type(deger, "0");
    await userEvent.click(gonder);
    expect(await within(cekmece).findByText("İndirim değeri sıfırdan büyük olmalı.")).toBeInTheDocument();
    await waitFor(() => expect(deger).toHaveFocus());

    await userEvent.clear(deger);
    await userEvent.type(deger, "150");
    await userEvent.click(gonder);
    expect(await within(cekmece).findByText("Yüzde indirimi 100'ü aşamaz.")).toBeInTheDocument();

    await userEvent.clear(deger);
    await userEvent.type(deger, "15");
    await userEvent.clear(minSepet);
    await userEvent.type(minSepet, "-5");
    await userEvent.type(maks, "2.5");
    await userEvent.clear(kisi);
    await userEvent.type(kisi, "0");
    await userEvent.click(gonder);
    expect(await within(cekmece).findByText("Minimum sepet negatif olamaz.")).toBeInTheDocument();
    expect(within(cekmece).getByText(/Maksimum kullanım boş bırakılabilir/)).toBeInTheDocument();
    expect(within(cekmece).getByText(/Kişi başı limit boş bırakılabilir/)).toBeInTheDocument();
    expect(olustur).not.toHaveBeenCalled();

    await userEvent.clear(minSepet);
    await userEvent.clear(maks);
    await userEvent.clear(kisi);
    await userEvent.type(kisi, "3");
    await userEvent.click(gonder);
    await waitFor(() => expect(olustur).toHaveBeenCalledTimes(1));
    const beklenen = kuponGovdesi({ kod: "kis10", indirimTuru: "PERCENT", indirimDegeri: "15", minSepet: "", maksKullanim: "", kisiBasi: "3" });
    expect(olustur.mock.calls[0][0]).toEqual(beklenen);
    expect(beklenen).toEqual({ code: "KIS10", discount_type: "PERCENT", discount_value: 15, min_subtotal: 0, max_uses: null, per_user_limit: 3, is_active: true });

    act(() => olustur.mock.calls[0][1].onSuccess());
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).not.toBeInTheDocument();
  });

  it("sabit indirim: yüzde sınırı uygulanmaz ve tür gövdeye gider", async () => {
    kur();
    const cekmece = await cekmeceAc();
    await userEvent.type(within(cekmece).getByLabelText("Kod"), "SABIT");
    await userEvent.click(within(cekmece).getByRole("combobox", { name: "İndirim türü" }));
    await userEvent.click(await screen.findByTitle("Sabit TL"));
    const deger = within(cekmece).getByLabelText("Değer");
    await userEvent.clear(deger);
    await userEvent.type(deger, "250");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Kupon oluştur" }));
    await waitFor(() => expect(olustur).toHaveBeenCalledTimes(1));
    expect(olustur.mock.calls[0][0]).toMatchObject({ code: "SABIT", discount_type: "FIXED", discount_value: 250 });
  });

  it("422 alana düşer ve odaklanır; 409/genel hata Alert'te; pencere ve girdiler korunur", async () => {
    kur();
    const cekmece = await cekmeceAc();
    const kod = within(cekmece).getByLabelText("Kod");
    await userEvent.type(kod, "TEKRAR");
    const gonder = within(cekmece).getByRole("button", { name: "Kupon oluştur" });
    await userEvent.click(gonder);
    await waitFor(() => expect(olustur).toHaveBeenCalledTimes(1));

    act(() => olustur.mock.calls[0][1].onError(yanit422("per_user_limit", "Kişi başı limit çok yüksek")));
    act(() => olustur.mock.calls[0][1].onSettled());
    expect(await within(cekmece).findByText("Kişi başı limit çok yüksek")).toBeInTheDocument();
    await waitFor(() => expect(within(cekmece).getByLabelText("Kişi başı limit (isteğe bağlı)")).toHaveFocus());
    expect(within(cekmece).queryByRole("alert")).not.toBeInTheDocument();

    act(() => olustur.mock.calls[0][1].onError({ response: { status: 409, data: { detail: "Bu kod zaten var" } } }));
    expect(await within(cekmece).findByRole("alert")).toHaveTextContent("Bu kod zaten var");
    act(() => olustur.mock.calls[0][1].onError(yanit422("constructor", "sahte")));
    expect(await within(cekmece).findByRole("alert")).toHaveTextContent("sahte");
    act(() => olustur.mock.calls[0][1].onError(new Error("Network Error")));
    expect(within(cekmece).getByRole("alert")).toHaveTextContent(/Kupon oluşturulamadı|Network/);
    expect(kod).toHaveValue("TEKRAR");
    expect(cekmece).toBeInTheDocument();
  });

  it("iki hızlı tıklama tek POST üretir; aynı tick'te kapatma yutulur; onSettled sonrası kapatma ve yeniden gönderim mümkün", async () => {
    kur();
    const cekmece = await cekmeceAc();
    await userEvent.type(within(cekmece).getByLabelText("Kod"), "HIZLI");
    const gonder = within(cekmece).getByRole("button", { name: "Kupon oluştur" });
    await userEvent.dblClick(gonder);
    await waitFor(() => expect(olustur).toHaveBeenCalledTimes(1));

    // Mutation pending render'ı gelmeden (mock isPending=false) kapatma: senkron kilit tutar.
    const onayAdedi = document.querySelectorAll(".ant-modal-confirm").length;
    await userEvent.click(within(cekmece).getByRole("button", { name: "Vazgeç" }));
    await userEvent.click(within(cekmece).getByRole("button", { name: /Close|Kapat/ }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    expect(document.querySelectorAll(".ant-modal-confirm")).toHaveLength(onayAdedi);

    act(() => olustur.mock.calls[0][1].onError(new Error("x")));
    act(() => olustur.mock.calls[0][1].onSettled());
    await userEvent.click(gonder);
    await waitFor(() => expect(olustur).toHaveBeenCalledTimes(2));
    act(() => olustur.mock.calls[1][1].onSettled());
    // Kilit bırakıldı: kirli kapatma yeniden onay ister ve silme kapatır.
    await userEvent.click(within(cekmece).getByRole("button", { name: "Vazgeç" }));
    await userEvent.click(within(await onay()).getByRole("button", { name: "Değişiklikleri sil" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
  });

  it("temiz form doğrudan kapanır; kirli form onay ister; pending iken kapanmaz", async () => {
    kur();
    let cekmece = await cekmeceAc();
    await userEvent.click(within(cekmece).getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Kupon Ekle/ }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).not.toBeNull());
    cekmece = document.querySelector(".ant-drawer-open .ant-drawer-content") as HTMLElement;
    await userEvent.type(within(cekmece).getByLabelText("Kod"), "KIRLI");
    await userEvent.click(within(cekmece).getByRole("button", { name: "Vazgeç" }));
    await userEvent.click(within(await onay()).getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    expect(within(cekmece).getByLabelText("Kod")).toHaveValue("KIRLI");
    await userEvent.click(within(cekmece).getByRole("button", { name: /Close|Kapat/ }));
    await userEvent.click(within(await onay()).getByRole("button", { name: "Değişiklikleri sil" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());

    vi.mocked(useCreateCoupon).mockReturnValue({ mutate: olustur, isPending: true } as never);
    kur();
    await userEvent.click(screen.getAllByRole("button", { name: /Kupon Ekle/ }).at(-1)!);
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).not.toBeNull());
    const acik = document.querySelector(".ant-drawer-open .ant-drawer-content") as HTMLElement;
    const onayAdedi = document.querySelectorAll(".ant-modal-confirm").length;
    await userEvent.click(within(acik).getByRole("button", { name: "Vazgeç" }));
    await userEvent.click(within(acik).getByRole("button", { name: /Close|Kapat/ }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    // Pending: ne kapandı ne yeni onay penceresi açıldı.
    expect(document.querySelectorAll(".ant-modal-confirm")).toHaveLength(onayAdedi);
  });

  it("Devre dışı bırak / Etkinleştir doğru is_active yaması; çift tıkta tek PATCH; hata mesajı gerçek", async () => {
    kur();
    await userEvent.click(screen.getByRole("button", { name: "YAZ20 aksiyonları" }));
    const oge = await screen.findByRole("menuitem", { name: "Devre dışı bırak" });
    await userEvent.dblClick(oge);
    expect(guncelle).toHaveBeenCalledTimes(1);
    expect(guncelle.mock.calls[0][0]).toEqual({ id: 5, payload: { is_active: false } });
    act(() => guncelle.mock.calls[0][1].onError({ response: { status: 400, data: { detail: "Kupon kilitli" } } }));
    expect(await screen.findByText("Kupon kilitli")).toBeInTheDocument();

    // Kilit satır bazlı: A beklerken B'nin geçişi engellenmez.
    await userEvent.click(screen.getByRole("button", { name: "SABIT50 aksiyonları" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Etkinleştir" }));
    expect(guncelle).toHaveBeenCalledTimes(2);
    expect(guncelle.mock.calls[1][0]).toEqual({ id: 6, payload: { is_active: true } });

    // A sonuçlanmadan yeniden tıklama istek üretmez; sonuçlanınca yeniden denenebilir.
    await userEvent.click(screen.getByRole("button", { name: "YAZ20 aksiyonları" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Devre dışı bırak" }));
    expect(guncelle).toHaveBeenCalledTimes(2);
    act(() => guncelle.mock.calls[0][1].onSettled());
    await userEvent.click(screen.getByRole("button", { name: "YAZ20 aksiyonları" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Devre dışı bırak" }));
    expect(guncelle).toHaveBeenCalledTimes(3);
  });

  it("Sil: onay ister; hata halinde modal açık kalır ve yeniden denenebilir; başarıda kapanır", async () => {
    silAsync.mockRejectedValueOnce({ response: { status: 500, data: { detail: "Sunucu hatası" } } });
    kur();
    await userEvent.click(screen.getByRole("button", { name: "YAZ20 aksiyonları" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sil" }));
    expect(await screen.findByText("YAZ20 kuponu silinecek.")).toBeInTheDocument();
    expect(silAsync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Kuponu sil/ }));
    await waitFor(() => expect(silAsync).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Sunucu hatası")).toBeInTheDocument();
    expect(screen.getByText("YAZ20 kuponu silinecek.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Kuponu sil/ })).not.toHaveClass("ant-btn-loading"));
    await userEvent.click(screen.getByRole("button", { name: /Kuponu sil/ }));
    await waitFor(() => expect(silAsync).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Kupon silindi.")).toBeInTheDocument();
    const onayModal = screen.getByText("YAZ20 kuponu silinecek.").closest(".ant-modal-wrap") as HTMLElement;
    // Kapanış: jsdom animasyon sonunu tetiklemez; kapanış animasyonuna girmesi (zoom-leave) ya da gizlenmesi yeter.
    await waitFor(() => {
      const kapaniyor = onayModal.querySelector(".ant-modal")?.classList.contains("ant-zoom-leave");
      expect(!onayModal.isConnected || onayModal.style.display === "none" || kapaniyor).toBe(true);
    });
  });

  it("yalnız coupons.view: dolu/boş/hata durumlarında salt okunur notu var, yazma yüzeyi yok", async () => {
    izinVer("coupons.view");
    const not = /yalnız görüntüleme yetkiniz var/;
    let r = kur();
    expect(screen.getByText(not)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kupon Ekle/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /aksiyonları/ })).not.toBeInTheDocument();
    r.unmount();

    mockListe.mockReturnValue(liste([]));
    r = kur();
    expect(screen.getByText("Henüz kupon yok")).toBeInTheDocument();
    expect(screen.getByText(not)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kupon Ekle/ })).not.toBeInTheDocument();
    r.unmount();

    const refetch = vi.fn();
    mockListe.mockReturnValue(liste(undefined, { isError: true, error: new Error("x"), refetch }));
    kur();
    expect(screen.getByText("Kuponlar yüklenemedi.")).toBeInTheDocument();
    expect(screen.getByText(not)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("izin yoksa AccessDenied ve useCoupons(false)", () => {
    izinVer("orders.view");
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(mockListe).toHaveBeenLastCalledWith(false);
  });

  it("Kupon Ekle: dolu listede yalnız başlıkta, boş listede yalnız boş durumda tek düğme", async () => {
    const dolu = kur();
    expect(screen.getAllByRole("button", { name: /Kupon Ekle/ })).toHaveLength(1);
    dolu.unmount();

    mockListe.mockReturnValue(liste([]));
    kur();
    expect(screen.getByText("Henüz kupon yok")).toBeInTheDocument();
    const dugmeler = screen.getAllByRole("button", { name: /Kupon Ekle/ });
    expect(dugmeler).toHaveLength(1);
    await userEvent.click(dugmeler[0]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("menü: İndirimler grubu, Kuponlar coupons izniyle bağlı, seçili/açık anahtarlar; Ayarlar ve Tanımlamalar bozulmadı", () => {
    expect(PATHS.adminNewCoupons).toBe("/yonetim-yeni/indirimler/kuponlar");
    expect(ROUTES.adminNewCoupons).toBe(PATHS.adminNewCoupons);
    const indirimler = PANEL_MENU.find((m) => m.key === "indirimler")!;
    expect(indirimler.icon).toBe("percentage");
    expect(indirimler.path).toBeUndefined();
    expect(indirimler.requiredPermission).toBeUndefined();
    expect(indirimler.children?.map((c) => c.label)).toEqual(["Kampanyalar", "Kuponlar", "Öne Çıkarmalar"]);
    expect(indirimler.children?.filter((c) => c.path)).toHaveLength(1);
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewCoupons)).toMatchObject({ label: "Kuponlar", requiredPermission: "coupons" });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewCoupons)).toEqual({ selectedKey: "kuponlar", openKeys: ["indirimler"] });
    expect(izinBeyaniniKarsilarMi(["coupons.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewCoupons)!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["products.view"], rotaIzniBul(PANEL_MENU, PATHS.adminNewCoupons)!)).toBe(false);
    const gorunur = menuyuIzneGoreSuz(PANEL_MENU, ["products.view"]).find((m) => m.key === "indirimler");
    expect(gorunur?.children?.map((c) => c.key)).toEqual(["kampanyalar", "one-cikarmalar"]);
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewAuditLogs)).toEqual({ selectedKey: "denetim-kayitlari", openKeys: ["ayarlar"] });
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewSuppliers)).toEqual({ selectedKey: "tanimlamalar", openKeys: ["urunler"] });
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewDefinitions)?.requiredAnyPermissions).toEqual(["products", "suppliers"]);
  });
});
