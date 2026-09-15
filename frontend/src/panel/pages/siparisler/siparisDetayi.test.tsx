import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { SiparisDetayi, siparisKimligi } from "@/panel/pages/siparisler/SiparisDetayi";
import { SiparisListesi } from "@/panel/pages/siparisler/SiparisListesi";
import { PANEL_MENU, izinBeyaniniKarsilarMi, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { PATHS, ROUTES } from "@/lib/routes";
import * as hooks from "@/hooks/useStore";
import * as api from "@/api/store";
import { useAuthStore } from "@/store/authStore";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { MISSING_ITEMS_TEXT } from "@/lib/orderItems";
import type { OrderOut } from "@/types";

vi.mock("@/hooks/useStore", () => ({
  useAdminOrder: vi.fn(),
  useAdminOrders: vi.fn(),
  useInvalidateAdminStore: vi.fn(),
}));
vi.mock("@/api/store", () => ({
  shipOrder: vi.fn(),
  deliverOrder: vi.fn(),
  refundOrder: vi.fn(),
}));

const invalidate = vi.fn();

function siparis(ek: Partial<OrderOut> = {}): OrderOut {
  return {
    id: 42,
    order_no: "4827-1930-5612",
    status: "PAID",
    payment_status: "PAID",
    subtotal: "300",
    shipping_fee: "50",
    discount: "20",
    coupon_code: "YAZ20",
    total: "330",
    currency: "TRY",
    has_physical: true,
    ship_recipient: "Ayşe Yılmaz",
    ship_phone: "05551112233",
    ship_address: "Atatürk Cad. 5",
    ship_city: "Adana",
    ship_district: "Çukurova",
    ship_in_zone: true,
    promised_delivery_date: "2026-09-12T13:00:00Z",
    delivery_pref: "KOMSUYA",
    delivery_pref_note: "Daire 3",
    postpone_count: 1,
    tracking_no: null,
    track_token: "tok123",
    return_status: null,
    delivered_at: null,
    return_deadline: null,
    created_at: "2026-09-10T10:00:00Z",
    items: [
      { id: 1, product_id: 10, title: "9. Sınıf Matematik", unit_price: "150", quantity: 2, kind: "PHYSICAL", seller_type: "PLATFORM" },
    ],
    ...ek,
  } as OrderOut;
}

const veri = (data: OrderOut | undefined, ek: object = {}) =>
  vi.mocked(hooks.useAdminOrder).mockReturnValue({ data, isPending: false, isError: false, error: null, refetch: vi.fn(), ...ek } as never);
const sonEnabled = () => vi.mocked(hooks.useAdminOrder).mock.calls.at(-1)?.[1];

function izin(...perms: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: perms } as never });
}

function Konum() {
  return <output data-testid="konum">{useLocation().pathname}</output>;
}

function kur(id: string | number = 42) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <PanelProvider>
          <MemoryRouter initialEntries={[`/yonetim-yeni/siparisler/${id}`]}>
            <Routes>
              <Route path={PATHS.adminNewOrders} element={<><SiparisListesi /><Konum /></>} />
              <Route path={PATHS.adminNewReturns} element={<><div>İadeler ekranı</div><Konum /></>} />
              <Route path={PATHS.adminNewOrderDetail} element={<><SiparisDetayi /><Konum /></>} />
            </Routes>
          </MemoryRouter>
        </PanelProvider>
      </QueryClientProvider>,
    ),
  };
}

const onay = async () => {
  const d = (await screen.findAllByRole("dialog")).at(-1)!;
  await within(d).findAllByText("Kaydedilmemiş değişiklikler var");
  return d;
};

beforeEach(() => {
  vi.mocked(api.shipOrder).mockReset().mockResolvedValue(siparis({ status: "SHIPPED", tracking_no: "TRK-1" }));
  vi.mocked(api.deliverOrder).mockReset().mockResolvedValue(siparis({ status: "DELIVERED" }));
  vi.mocked(api.refundOrder).mockReset().mockResolvedValue(siparis({ status: "REFUNDED", payment_status: "REFUNDED" }));
  invalidate.mockReset();
  vi.mocked(hooks.useInvalidateAdminStore).mockReturnValue(invalidate);
  vi.mocked(hooks.useAdminOrders).mockReturnValue({ data: { items: [siparis()], total: 1, limit: 20 }, isPending: false, isError: false, error: null, refetch: vi.fn() } as never);
  vi.mocked(hooks.useAdminOrder).mockReset();
  izin("orders.view", "orders.manage");
});

describe("siparisKimligi", () => {
  it("yalnız düz pozitif güvenli tam sayı geçerli", () => {
    expect(siparisKimligi("42")).toBe(42);
    for (const ham of ["abc", "-1", "1e3", "0x10", "42.0", " 42", "42 ", "0", "", undefined, String(Number.MAX_SAFE_INTEGER + 1)]) {
      expect(siparisKimligi(ham)).toBeNull();
    }
  });
});

describe("SiparisDetayi", () => {
  it("tekil useAdminOrder ile yüklenir; özet, kalemler, ödeme ve kargo alanları basılır", () => {
    veri(siparis());
    kur();
    expect(vi.mocked(hooks.useAdminOrder)).toHaveBeenLastCalledWith(42, true);
    expect(vi.mocked(hooks.useAdminOrders)).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "4827-1930-5612" })).toBeInTheDocument();
    expect(screen.getByText("Hazırlanacak")).toBeInTheDocument();
    expect(screen.getAllByText("Ayşe Yılmaz").length).toBe(2);
    expect(screen.getByText("9. Sınıf Matematik")).toBeInTheDocument();
    expect(screen.getByText("Fiziksel · Ürün #10")).toBeInTheDocument();
    expect(screen.getAllByText("300 TL").length).toBe(2);
    expect(screen.getByText("50 TL")).toBeInTheDocument();
    expect(screen.getByText("-20 TL")).toBeInTheDocument();
    expect(screen.getByText("YAZ20")).toBeInTheDocument();
    expect(screen.getAllByText("330 TL").length).toBe(2);
    expect(screen.getByText("TRY")).toBeInTheDocument();
    expect(screen.getByText("Ödendi")).toBeInTheDocument();
    expect(screen.getByText("05551112233")).toBeInTheDocument();
    expect(screen.getByText("Atatürk Cad. 5")).toBeInTheDocument();
    expect(screen.getByText("Çukurova / Adana")).toBeInTheDocument();
    expect(screen.getByText("Cıncık bölgesi (kendi filo)")).toBeInTheDocument();
    expect(screen.getByText(/Daire 3/)).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kargo takibini aç" })).toHaveAttribute("href", "/kargo-takip/tok123");
    expect(screen.getByRole("button", { name: "Kargoya ver" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "İade et" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Teslim edildi" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /İptal/ })).not.toBeInTheDocument();
  });

  it("geçersiz kimlik: sorgu kapalı, açık hata ve Listeye dön", async () => {
    veri(undefined);
    kur("abc");
    expect(sonEnabled()).toBe(false);
    expect(screen.getByText("Geçersiz sipariş bağlantısı.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Listeye dön" }));
    expect(screen.getByTestId("konum")).toHaveTextContent(ROUTES.adminNewOrders);
  });

  it("izinsizde AccessDenied ve enabled=false; yalnız view: salt okunur şerit, aksiyon yok", () => {
    izin();
    veri(undefined);
    const ilk = kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    expect(sonEnabled()).toBe(false);
    ilk.unmount();

    izin("orders.view");
    veri(siparis({ status: "SHIPPED" }));
    kur();
    expect(sonEnabled()).toBe(true);
    for (const ad of ["Kargoya ver", "Teslim edildi", "İade et"]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
  });

  it("yükleniyor, 404 ve genel hata + Tekrar dene ayrı", async () => {
    veri(undefined, { isPending: true });
    const ilk = kur();
    expect(screen.getByText("Sipariş yükleniyor…")).toBeInTheDocument();
    ilk.unmount();

    veri(undefined, { isError: true, error: { response: { status: 404, data: { detail: "Sipariş bulunamadı" } } } });
    const ikinci = kur();
    expect(screen.getByText("Sipariş bulunamadı")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listeye dön" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tekrar dene" })).not.toBeInTheDocument();
    ikinci.unmount();

    const refetch = vi.fn();
    veri(undefined, { isError: true, error: { response: { status: 500, data: { detail: "Sunucu hatası" } } }, refetch });
    kur();
    expect(screen.getByText("Sunucu hatası")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("dijital sipariş notu, eksik kalem metni ve iade bağlantısı yeni rotaya", async () => {
    veri(siparis({ status: "REFUNDED", payment_status: "REFUNDED", has_physical: false, ship_recipient: null, return_status: "APPROVED", items: [] }));
    kur();
    for (const ad of ["Kargoya ver", "Teslim edildi", "İade et"]) expect(screen.queryByRole("button", { name: ad })).not.toBeInTheDocument();
    expect(screen.getByText("Dijital sipariş; kargo ve teslimat adımı yok.")).toBeInTheDocument();
    expect(screen.getByText(/^Onaylandı ·/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "İade taleplerine git" })).toHaveAttribute("href", ROUTES.adminNewReturns);
    expect(screen.getByText(MISSING_ITEMS_TEXT)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "İade taleplerine git" }));
    expect(screen.getByText("İadeler ekranı")).toBeInTheDocument();
  });

  it("Kargoya ver: boş takip → null, dolu → trim; başarıda kapanır ve invalidation; çift tık tek istek", async () => {
    veri(siparis());
    const { qc } = kur();
    await userEvent.click(screen.getByRole("button", { name: "Kargoya ver" }));
    const pencere = await screen.findByRole("dialog");
    await userEvent.dblClick(within(pencere).getByRole("button", { name: /Kargola/ }));
    await waitFor(() => expect(api.shipOrder).toHaveBeenCalledTimes(1));
    expect(api.shipOrder).toHaveBeenCalledWith(42, null);
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    expect(qc.getQueryData<OrderOut>(["store", "admin", "orders", "detail", 42])?.status).toBe("SHIPPED");

    veri(siparis({ status: "PAID" }));
    await userEvent.click(screen.getByRole("button", { name: "Kargoya ver" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).not.toBeNull());
    // Kilit pencere yeniden açılırken sıfırlanır: ikinci gönderim MÜMKÜN olmalı.
    const acik = document.querySelector(".ant-drawer-open .ant-drawer-content") as HTMLElement;
    await userEvent.type(within(acik).getByLabelText(/Takip no/), "  TRK-9  ");
    await userEvent.click(within(acik).getByRole("button", { name: /Kargola/ }));
    await waitFor(() => expect(api.shipOrder).toHaveBeenLastCalledWith(42, "TRK-9"));
  });

  it("Kargoya ver: istek ÇÖZÜLDÜKTEN sonra gelen ikinci tık da istek açmaz (kilit başarıda bırakılmaz)", async () => {
    // CI'da yük altında görülen yarışın birebir provası: `dblClick`in iki tıkı arasında
    // mutasyon çözülüyor. Kilit `onSettled`de bırakılsaydı ikinci tık ikinci kargo
    // isteği açardı — bekleme/timeout eklemeden, sırayı ELLE kurarak ölçülür.
    veri(siparis());
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Kargoya ver" }));
    const pencere = await screen.findByRole("dialog");
    const kargola = within(pencere).getByRole("button", { name: /Kargola/ });
    await userEvent.click(kargola);
    // Birinci istek tamamen sonuçlanır (başarı + pencere kapanışı akışı).
    await waitFor(() => expect(api.shipOrder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    // Aynı düğmeye ikinci tık: pencere kapanış render'ını beklemeden.
    fireEvent.click(kargola);
    await act(async () => { await Promise.resolve(); });
    expect(api.shipOrder).toHaveBeenCalledTimes(1);
  });

  it("Kargoya ver: hata pencerede, takip no korunur, yeniden gönderilebilir; kirli/temiz kapatma", async () => {
    vi.mocked(api.shipOrder).mockRejectedValueOnce({ response: { data: { detail: "Stok yetersiz" } } });
    veri(siparis());
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Kargoya ver" }));
    const pencere = await screen.findByRole("dialog");
    // Boş pencere doğrudan kapanır
    await userEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Kargoya ver" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).not.toBeNull());
    const acik = document.querySelector(".ant-drawer-open .ant-drawer-content") as HTMLElement;
    await userEvent.type(within(acik).getByLabelText(/Takip no/), "TRK-1");
    await userEvent.click(within(acik).getByRole("button", { name: /Kargola/ }));
    expect(await within(acik).findByText("Stok yetersiz")).toBeInTheDocument();
    expect(within(acik).getByLabelText(/Takip no/)).toHaveValue("TRK-1");
    // Kirli kapatma onay ister, devam et açık bırakır
    await userEvent.click(within(acik).getByRole("button", { name: "Vazgeç" }));
    await userEvent.click(within(await onay()).getByRole("button", { name: "Düzenlemeye devam et" }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    // Yeniden gönderim başarılı
    await userEvent.click(within(acik).getByRole("button", { name: /Kargola/ }));
    await waitFor(() => expect(api.shipOrder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
  });

  it("Kargoya ver: gönderim sürerken hiçbir kapatma yolu çalışmaz", async () => {
    let coz: (o: OrderOut) => void = () => {};
    vi.mocked(api.shipOrder).mockImplementationOnce(() => new Promise((r) => { coz = r; }));
    veri(siparis());
    kur();
    await userEvent.click(screen.getByRole("button", { name: "Kargoya ver" }));
    const pencere = await screen.findByRole("dialog");
    await userEvent.click(within(pencere).getByRole("button", { name: /Kargola/ }));
    await waitFor(() => expect(api.shipOrder).toHaveBeenCalledTimes(1));
    await userEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    await userEvent.click(within(pencere).getByRole("button", { name: /Close|Kapat/ }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    act(() => coz(siparis({ status: "SHIPPED" })));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
  });

  it("Teslim edildi: onay ister; hatada modal açık kalır ve yeniden denenir; başarıda kapanır ve tazelenir; çift onay tek istek", async () => {
    let reddet: (e: unknown) => void = () => {};
    vi.mocked(api.deliverOrder).mockImplementationOnce(() => new Promise((_, r) => { reddet = r; }));
    veri(siparis({ status: "SHIPPED", tracking_no: "TRK-1" }));
    kur();
    expect(screen.getByText("Kargoda")).toBeInTheDocument();
    expect(screen.getByText("TRK-1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Teslim edildi" }));
    expect((await screen.findAllByText("Siparişi teslim edildi işaretle")).length).toBeGreaterThan(0);
    expect(api.deliverOrder).not.toHaveBeenCalled();
    await userEvent.dblClick(screen.getByRole("button", { name: /Teslim edildi olarak işaretle/ }));
    await waitFor(() => expect(api.deliverOrder).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: /Teslim edildi olarak işaretle/ }));
    expect(api.deliverOrder).toHaveBeenCalledTimes(1);
    act(() => reddet({ response: { data: { detail: "Kurye teslimi kapatmadı" } } }));
    expect(await screen.findByText("Kurye teslimi kapatmadı")).toBeInTheDocument();
    const modalDugme = await screen.findByRole("button", { name: /Teslim edildi olarak işaretle/ });
    await waitFor(() => expect(modalDugme).not.toHaveClass("ant-btn-loading"));
    expect(invalidate).not.toHaveBeenCalled();

    await userEvent.click(modalDugme);
    await waitFor(() => expect(api.deliverOrder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const wrap = screen.getByText(/siparişi teslim edilmiş sayılacak/).closest(".ant-modal-wrap") as HTMLElement;
    await waitFor(() => {
      const kapaniyor = wrap.querySelector(".ant-modal")?.classList.contains("ant-zoom-leave");
      expect(!wrap.isConnected || wrap.style.display === "none" || kapaniyor).toBe(true);
    });
  });

  it("İade et: kısa gerekçe istek atmaz ve odaklanır; geçerli gerekçe trim ile gider; gerekçe istek anında sabit; çift tık tek istek", async () => {
    let coz: (o: OrderOut) => void = () => {};
    vi.mocked(api.refundOrder).mockImplementationOnce(() => new Promise((r) => { coz = r; }));
    veri(siparis({ status: "DELIVERED" }));
    kur();
    await userEvent.click(screen.getByRole("button", { name: "İade et" }));
    const pencere = await screen.findByRole("dialog");
    await userEvent.type(within(pencere).getByLabelText("İade gerekçesi"), "ab");
    await userEvent.click(within(pencere).getByRole("button", { name: /^İade et$/ }));
    expect(within(pencere).getByRole("alert")).toHaveTextContent("En az 3 karakter yazın.");
    expect(within(pencere).getByLabelText("İade gerekçesi")).toHaveFocus();
    expect(api.refundOrder).not.toHaveBeenCalled();

    await userEvent.clear(within(pencere).getByLabelText("İade gerekçesi"));
    await userEvent.type(within(pencere).getByLabelText("İade gerekçesi"), "  Hasarlı ürün  ");
    await userEvent.dblClick(within(pencere).getByRole("button", { name: /İade et/ }));
    await waitFor(() => expect(api.refundOrder).toHaveBeenCalledTimes(1));
    expect(api.refundOrder).toHaveBeenCalledWith(42, "Hasarlı ürün");
    // İstek sürerken kapatma yok; gerekçe değişse de gönderilen sabit
    await userEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    expect(document.querySelector(".ant-drawer-open")).not.toBeNull();
    act(() => coz(siparis({ status: "REFUNDED", payment_status: "REFUNDED" })));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
    expect(api.refundOrder).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("İade et: hata pencerede ve gerekçe korunur; kirli kapatma onayı; sil ile kapanır", async () => {
    vi.mocked(api.refundOrder).mockRejectedValueOnce({ response: { data: { detail: "Ödeme sağlayıcı yanıt vermedi" } } });
    veri(siparis({ status: "DELIVERED" }));
    kur();
    await userEvent.click(screen.getByRole("button", { name: "İade et" }));
    const pencere = await screen.findByRole("dialog");
    await userEvent.type(within(pencere).getByLabelText("İade gerekçesi"), "Hasarlı ürün");
    await userEvent.click(within(pencere).getByRole("button", { name: /^İade et$/ }));
    expect(await within(pencere).findByText("Ödeme sağlayıcı yanıt vermedi")).toBeInTheDocument();
    expect(within(pencere).getByLabelText("İade gerekçesi")).toHaveValue("Hasarlı ürün");
    await userEvent.click(within(pencere).getByRole("button", { name: /Close|Kapat/ }));
    await userEvent.click(within(await onay()).getByRole("button", { name: "Değişiklikleri sil" }));
    await waitFor(() => expect(document.querySelector(".ant-drawer-open")).toBeNull());
  });
});

describe("Sipariş listesi bağlantısı ve rota/menü", () => {
  it("Sipariş No gerçek Link; satır hücresine tıklama detaya SPA gezinmesi yapar", async () => {
    veri(siparis());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PanelProvider>
          <MemoryRouter initialEntries={[PATHS.adminNewOrders]}>
            <Routes>
              <Route path={PATHS.adminNewOrders} element={<><SiparisListesi /><Konum /></>} />
              <Route path={PATHS.adminNewOrderDetail} element={<><SiparisDetayi /><Konum /></>} />
            </Routes>
          </MemoryRouter>
        </PanelProvider>
      </QueryClientProvider>,
    );
    const link = screen.getByRole("link", { name: "4827-1930-5612" });
    expect(link).toHaveAttribute("href", ROUTES.adminNewOrder(42));
    expect(link.closest("button")).toBeNull();
    await userEvent.click(screen.getByText("Ayşe Yılmaz"));
    await waitFor(() => expect(screen.getByTestId("konum")).toHaveTextContent(ROUTES.adminNewOrder(42)));
    expect(screen.getByRole("heading", { name: "4827-1930-5612" })).toBeInTheDocument();
  });

  it("iadeler statik rotası :id olarak yorumlanmaz; menü seçimi ve izinler", () => {
    expect(PATHS.adminNewOrderDetail).toBe("/yonetim-yeni/siparisler/:id");
    expect(ROUTES.adminNewOrder(7)).toBe("/yonetim-yeni/siparisler/7");
    veri(undefined);
    kur("iadeler");
    expect(screen.getByText("İadeler ekranı")).toBeInTheDocument();
    expect(vi.mocked(hooks.useAdminOrder)).not.toHaveBeenCalled();

    expect(seciliMenuDurumu(PANEL_MENU, ROUTES.adminNewOrder(42))).toEqual({ selectedKey: "siparis-listesi", openKeys: ["siparisler"] });
    expect(rotaIzniBul(PANEL_MENU, ROUTES.adminNewOrder(42))).toMatchObject({ label: "Siparişler", requiredPermission: "orders" });
    expect(izinBeyaniniKarsilarMi(["orders.view"], rotaIzniBul(PANEL_MENU, ROUTES.adminNewOrder(42))!)).toBe(true);
    expect(izinBeyaniniKarsilarMi(["returns.view"], rotaIzniBul(PANEL_MENU, ROUTES.adminNewOrder(42))!)).toBe(false);
    expect(seciliMenuDurumu(PANEL_MENU, PATHS.adminNewReturns)).toEqual({ selectedKey: "iadeler", openKeys: ["siparisler"] });
    expect(rotaIzniBul(PANEL_MENU, PATHS.adminNewReturns)).toMatchObject({ label: "İadeler", requiredPermission: "returns" });
  });
});
