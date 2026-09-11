import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SiparisListesi } from "@/panel/pages/siparisler/SiparisListesi";
import { useAdminOrders } from "@/hooks/useStore";
import { formatTL } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { orderStatusLabel } from "@/lib/orderStatus";
import type { OrderOut } from "@/types";

vi.mock("@/hooks/useStore", () => ({
  useAdminOrders: vi.fn(),
}));

const mockUseAdminOrders = vi.mocked(useAdminOrders);

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
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

  describe("arama (istemci tarafında, sunucu q desteklemiyor)", () => {
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
  });
});
