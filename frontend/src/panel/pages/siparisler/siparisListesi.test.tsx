import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SiparisListesi, durumCoz } from "@/panel/pages/siparisler/SiparisListesi";
import { useAdminOrders } from "@/hooks/useStore";
import { formatTL } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { orderPaymentLabel } from "@/lib/orderPayment";
import { orderStatusLabel } from "@/lib/orderStatus";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAuthStore } from "@/store/authStore";
import type { OrderOut } from "@/types";

vi.mock("@/hooks/useStore", () => ({
  useAdminOrders: vi.fn(),
}));

const mockUseAdminOrders = vi.mocked(useAdminOrders);

function izin(...perms: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: perms } as never });
}
beforeEach(() => {
  izin("orders.view", "orders.manage");
});

function kur(girisler: string[] = ["/yonetim-yeni/siparisler"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={girisler}>
        <SiparisListesi />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Gerçek `OrderOut` alan adlarıyla — bkz. `frontend/src/types/index.ts`.
// `order_no` müşteriye gösterilen kalıcı numaradır, `id` DEĞİL.
const siparis = (parca: Partial<OrderOut> = {}): OrderOut =>
  ({
    id: 1,
    order_no: "4827-1930-5612",
    status: "PAID",
    payment_status: "PAID",
    subtotal: "250.00",
    shipping_fee: "0",
    total: "250.00",
    currency: "TRY",
    has_physical: true,
    ship_recipient: "Ahmet Yılmaz",
    created_at: "2026-09-10T11:30:00Z",
    items: [],
    ...parca,
  }) as OrderOut;

describe("SiparisListesi", () => {
  it("durum süzgeci: beyaz liste, sunucuya gider, geçersiz değer düşer", () => {
    for (const [ham, beklenen] of [["PAID", "PAID"], ["SHIPPED", "SHIPPED"], ["paid", "hepsi"], ["__proto__", "hepsi"], ["", "hepsi"], [null, "hepsi"]] as const) {
      expect(durumCoz(ham)).toBe(beklenen);
    }
    mockUseAdminOrders.mockReturnValue({
      data: { items: [], total: 0, limit: 20 }, isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminOrders>);
    // Geçersiz değer sunucuya GİTMEZ.
    kur(["/yonetim-yeni/siparisler?durum=uydurma"]).unmount();
    expect(mockUseAdminOrders.mock.calls.at(-1)?.[0]).toBeUndefined();
    // Beyaz listedeki değer sunucuya gider (elde tutulan sayfayı süzmez).
    kur(["/yonetim-yeni/siparisler?durum=SHIPPED"]);
    expect(mockUseAdminOrders.mock.calls.at(-1)?.[0]).toBe("SHIPPED");
    expect(screen.getByText("Sonuç bulunamadı")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtreyi temizle" })).toBeInTheDocument();
  });

  it("ödeme ve kalem kolonları listede görünür (para ekseni durumdan ayrı)", () => {
    mockUseAdminOrders.mockReturnValue({
      data: { items: [siparis({ payment_status: "REFUNDING", status: "DELIVERED", items: [{ id: 1 }, { id: 2 }] as never })], total: 1, limit: 20 },
      isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminOrders>);
    kur();
    expect(screen.getByRole("columnheader", { name: "Ödeme" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Kalem" })).toBeInTheDocument();
    expect(screen.getByText(orderPaymentLabel("REFUNDING"))).toBeInTheDocument();
    expect(screen.getByText(orderStatusLabel("DELIVERED"))).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("orders.view yoksa AccessDenied ve sorgu HİÇ çalışmaz", () => {
    izin("products.view");
    mockUseAdminOrders.mockReturnValue({
      data: undefined, isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminOrders>);
    kur();
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
    // Dördüncü argüman `enabled`: yetkisiz oturumda istek atılmaz.
    expect(mockUseAdminOrders.mock.calls.at(-1)?.[3]).toBe(false);
  });

  it("sipariş no, müşteri, tutar, durum ve tarihi listeler", () => {
    mockUseAdminOrders.mockReturnValue({
      data: { items: [siparis()], total: 1, limit: 100 },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminOrders>);

    kur();

    expect(screen.getByText("4827-1930-5612")).toBeInTheDocument();
    expect(screen.getByText("Ahmet Yılmaz")).toBeInTheDocument();
    expect(screen.getByText(formatTL("250.00"))).toBeInTheDocument();
    expect(screen.getByText(orderStatusLabel("PAID"))).toBeInTheDocument();
    expect(screen.getByText(formatDateTime("2026-09-10T11:30:00Z"))).toBeInTheDocument();
  });

  it("dijital sipariş (alıcı adı yok) için yer tutucu metin gösterir", () => {
    mockUseAdminOrders.mockReturnValue({
      data: { items: [siparis({ id: 2, order_no: "1111-2222-3333", ship_recipient: null, has_physical: false })], total: 1, limit: 100 },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminOrders>);

    kur();

    expect(screen.getByText("Dijital sipariş")).toBeInTheDocument();
  });

  it("yüklenirken (henüz veri/hata yokken) boş durumu göstermez", () => {
    mockUseAdminOrders.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminOrders>);

    kur();

    expect(screen.queryByText("Henüz sipariş yok")).not.toBeInTheDocument();
    expect(screen.queryByText("Siparişler yüklenemedi.")).not.toBeInTheDocument();
  });

  it("hata varken hata mesajını gösterir, boş durumu göstermez", () => {
    mockUseAdminOrders.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("network"),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminOrders>);

    kur();

    expect(screen.getByText("Siparişler yüklenemedi.")).toBeInTheDocument();
    expect(screen.queryByText("Henüz sipariş yok")).not.toBeInTheDocument();
  });

  it("tekrar dene tıklanınca refetch çağrılır", async () => {
    const refetch = vi.fn();
    mockUseAdminOrders.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("network"),
      refetch,
    } as unknown as ReturnType<typeof useAdminOrders>);

    kur();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("liste boşken 'Henüz sipariş yok' gösterir", () => {
    mockUseAdminOrders.mockReturnValue({
      data: { items: [], total: 0, limit: 100 },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminOrders>);

    kur();

    expect(screen.getByText("Henüz sipariş yok")).toBeInTheDocument();
  });

  // Eski "kesilme uyarısı" bloğu (partiTavaniDoldu heuristiği, KESILME_TAVANI)
  // BU PAKETLE kaldırıldı: sayfalama artık sunucudan gerçek `offset` ile
  // gelir, dolayısıyla client tarafında biriken bir "parti"nin tavanı
  // doldu mu diye bakmaya gerek kalmadı — bkz. aşağıdaki "sunucu
  // sayfalaması" bloğu. `uyari` şeridi artık yalnız arama kapsamını
  // bildirmek için kullanılıyor (bkz. "arama" bloğu).
  describe("sunucu sayfalaması (gerçek offset)", () => {
    // 45 kayıt / sayfa boyutu 20 → en az iki sayfa, AntD Pagination "2"
    // bağlantısını render eder.
    const birinciSayfa = Array.from({ length: 20 }, (_, i) =>
      siparis({ id: i + 1, order_no: `${1000 + i}-a-b` }),
    );

    it("2. sayfaya geçilince useAdminOrders'a GERÇEK offset ile (yeni bir istek şekliyle) çağrılır", () => {
      mockUseAdminOrders.mockReturnValue({
        data: { items: birinciSayfa, total: 45, limit: 20 },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminOrders>);

      kur();
      mockUseAdminOrders.mockClear();

      fireEvent.click(screen.getByTitle("2"));

      // Argümanın ŞEKLİ iddia edilir ("çağrıldı mı" değil): statusFilter
      // hâlâ undefined, limit hâlâ sayfa boyutu (20), offset artık
      // (sayfa-1)*boyut = 20 — bkz. `api/store.ts` `listOrdersAdmin`in
      // `offset` yorumu.
      expect(mockUseAdminOrders).toHaveBeenCalledWith(undefined, 20, 20, true);
    });

    it("`toplam` sunucunun GERÇEK X-Total-Count değerini yansıtır — mevcut sayfadaki satır sayısını değil", () => {
      mockUseAdminOrders.mockReturnValue({
        data: { items: birinciSayfa, total: 130, limit: 20 },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminOrders>);

      kur();

      // `ListePage`in AntD `showTotal`ı `${bas}-${son} / ${t} kayıt` basar;
      // `t` burada 130 olmalı (sunucu toplamı), 20 (bu sayfadaki satır
      // sayısı) DEĞİL.
      expect(screen.getByText(/130/)).toBeInTheDocument();
    });

    it("gerçek sayfalamayla artık kesilme uyarısı ÇIKMAZ (arama da aktif değilken)", () => {
      mockUseAdminOrders.mockReturnValue({
        data: { items: birinciSayfa, total: 130, limit: 20 },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminOrders>);

      kur();

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("arama (istemci tarafında, sunucu `q` desteklemiyor — dürüst kapsam uyarısı)", () => {
    beforeEach(() => {
      mockUseAdminOrders.mockReturnValue({
        data: {
          items: [
            siparis({ id: 1, order_no: "4827-1930-5612", ship_recipient: "Ahmet Yılmaz" }),
            siparis({ id: 2, order_no: "9999-8888-7777", ship_recipient: "Zeynep Kaya" }),
          ],
          total: 2,
          limit: 100,
        },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminOrders>);
    });

    it("sipariş no veya müşteri adına göre listeyi filtreler", () => {
      kur();
      const kutu = screen.getByPlaceholderText("Tabloda arama yapın");

      fireEvent.change(kutu, { target: { value: "zeynep" } });

      expect(screen.getByText("Zeynep Kaya")).toBeInTheDocument();
      expect(screen.queryByText("Ahmet Yılmaz")).not.toBeInTheDocument();
    });

    it("eşleşme yoksa 'Sonuç bulunamadı' gösterir", () => {
      kur();
      const kutu = screen.getByPlaceholderText("Tabloda arama yapın");

      fireEvent.change(kutu, { target: { value: "olmayan-birisi" } });

      expect(screen.getByText("Sonuç bulunamadı")).toBeInTheDocument();
    });

    it("arama kutusuna yazılınca kapsamın YALNIZCA bu sayfa olduğunu söyleyen bir uyarı çıkar — sahte 'tüm siparişlerde arıyor' izlenimi YOK", () => {
      kur();
      const kutu = screen.getByPlaceholderText("Tabloda arama yapın");

      fireEvent.change(kutu, { target: { value: "zeynep" } });

      const uyari = screen.getByRole("status");
      expect(uyari).toHaveTextContent("sayfa");
    });

    it("arama kutusu boşken kapsam uyarısı ÇIKMAZ", () => {
      kur();

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("arama sırasında sayfa numarası SIFIRLANMAZ — arama sunucuya gitmediği için gereksiz yeniden çekime yol açmaz", () => {
      kur();
      mockUseAdminOrders.mockClear();
      const kutu = screen.getByPlaceholderText("Tabloda arama yapın");

      fireEvent.change(kutu, { target: { value: "zeynep" } });

      // Arama metin değişince bileşen yeniden render olur (`useAdminOrders`
      // tekrar çağrılır) ama offset hâlâ ilk sayfaya (0) karşılık gelmeli —
      // arama metne göre sayfayı YENİDEN 1'e atıp sunucuya gereksiz bir
      // istek attırmaz, çünkü zaten sunucuya hiç gitmiyor, yalnız elde
      // tutulan sayfayı süzer.
      const sonCagri = mockUseAdminOrders.mock.calls.at(-1);
      expect(sonCagri).toEqual([undefined, 20, 0, true]);
    });
  });
});
