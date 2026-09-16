import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MusteriListesi } from "@/panel/pages/musteriler/MusteriListesi";
import { useAdminUsers } from "@/hooks/useAdmin";
import { formatDateTime } from "@/lib/datetime";
import { rolEtiketi } from "@/lib/roles";
import { ROLE_IDS } from "@/types";
import type { AdminUserOut } from "@/types";
import { PATHS, ROUTES } from "@/lib/routes";

function Konum() {
  return <output data-testid="konum">{useLocation().pathname}</output>;
}

vi.mock("@/hooks/useAdmin", () => ({
  useAdminUsers: vi.fn(),
}));

const mockUseAdminUsers = vi.mocked(useAdminUsers);

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MusteriListesi />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Gerçek `AdminUserOut` alan adlarıyla — bkz. `frontend/src/types/index.ts`.
// API'de `phone` YOK; bu ekran uydurmaz.
const musteri = (parca: Partial<AdminUserOut> = {}): AdminUserOut =>
  ({
    id: 1,
    first_name: "Ahmet",
    last_name: "Yılmaz",
    full_name: "Ahmet Yılmaz",
    email: "ahmet@example.com",
    role: "CLIENT",
    is_active: true,
    created_at: "2026-09-10T11:30:00Z",
    ...parca,
  }) as AdminUserOut;

describe("MusteriListesi", () => {
  it("ad gerçek bir bağlantıdır (client detayı); satırın kalanına tıklamak da detaya gider", async () => {
    mockUseAdminUsers.mockReturnValue({ data: { items: [musteri({ id: 7 })], total: 1 }, isPending: false, isError: false, refetch: vi.fn() } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[PATHS.adminNewCustomers]}>
          <Routes>
            <Route path={PATHS.adminNewCustomers} element={<><MusteriListesi /><Konum /></>} />
            <Route path={PATHS.adminNewCustomer} element={<><div>Detay</div><Konum /></>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: "Ahmet Yılmaz" })).toHaveAttribute("href", ROUTES.adminNewCustomer("client", 7));
    expect(screen.queryByText(/telefon/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("ahmet@example.com"));
    expect(screen.getByTestId("konum")).toHaveTextContent(ROUTES.adminNewCustomer("client", 7));
  });

  it("ad soyad, e-posta, rol ve kayıt tarihini listeler", () => {
    mockUseAdminUsers.mockReturnValue({
      data: { items: [musteri()], total: 1 },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>);

    kur();

    expect(screen.getByText("Ahmet Yılmaz")).toBeInTheDocument();
    expect(screen.getByText("ahmet@example.com")).toBeInTheDocument();
    expect(screen.getByText(rolEtiketi(ROLE_IDS.CLIENT))).toBeInTheDocument();
    expect(screen.getByText(formatDateTime("2026-09-10T11:30:00Z"))).toBeInTheDocument();
  });

  it("pasif müşteride 'Pasif' durumu gösterir", () => {
    mockUseAdminUsers.mockReturnValue({
      data: { items: [musteri({ is_active: false })], total: 1 },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>);

    kur();

    expect(screen.getByText("Pasif")).toBeInTheDocument();
  });

  it("rol etiketi `lib/roles.ts` TEK KAYNAĞINDAN gelir — elle yazılmaz", () => {
    // Sunucu her zaman `role: "CLIENT"` filtreli istek alır ama API tipi
    // (`AdminUserRole`) üç değeri de taşır; ekran GERÇEK `role` alanını okur,
    // "her zaman Üye" diye sabitlemez. Farklı bir rol geldiğinde doğru
    // etikete dönmesi, eşlemenin `roles.ts`ten geldiğini kanıtlar.
    mockUseAdminUsers.mockReturnValue({
      data: { items: [musteri({ role: "TUTOR" })], total: 1 },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>);

    kur();

    expect(screen.getByText(rolEtiketi(ROLE_IDS.TUTOR))).toBeInTheDocument();
  });

  it("yüklenirken (henüz veri/hata yokken) boş durumu göstermez", () => {
    mockUseAdminUsers.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>);

    kur();

    expect(screen.queryByText("Henüz müşteri yok")).not.toBeInTheDocument();
    expect(screen.queryByText("Müşteriler yüklenemedi.")).not.toBeInTheDocument();
  });

  it("hata varken hata mesajını gösterir, boş durumu göstermez", () => {
    mockUseAdminUsers.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("network"),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>);

    kur();

    expect(screen.getByText("Müşteriler yüklenemedi.")).toBeInTheDocument();
    expect(screen.queryByText("Henüz müşteri yok")).not.toBeInTheDocument();
  });

  it("tekrar dene tıklanınca refetch çağrılır", async () => {
    const refetch = vi.fn();
    mockUseAdminUsers.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("network"),
      refetch,
    } as unknown as ReturnType<typeof useAdminUsers>);

    kur();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("liste boşken 'Henüz müşteri yok' gösterir", () => {
    mockUseAdminUsers.mockReturnValue({
      data: { items: [], total: 0 },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAdminUsers>);

    kur();

    expect(screen.getByText("Henüz müşteri yok")).toBeInTheDocument();
  });

  describe("sunucu sayfalaması (gerçek offset, sabit role: CLIENT filtresi)", () => {
    const birinciSayfa = Array.from({ length: 20 }, (_, i) =>
      musteri({ id: i + 1, full_name: `Müşteri ${i + 1}`, email: `musteri${i + 1}@example.com` }),
    );

    it("2. sayfaya geçilince useAdminUsers'a GERÇEK offset ile (yeni bir istek şekliyle) çağrılır", () => {
      mockUseAdminUsers.mockReturnValue({
        data: { items: birinciSayfa, total: 45 },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminUsers>);

      kur();
      mockUseAdminUsers.mockClear();

      fireEvent.click(screen.getByTitle("2"));

      expect(mockUseAdminUsers.mock.calls.at(-1)?.[0]).toMatchObject({
        role: "CLIENT",
        limit: 20,
        offset: 20,
      });
    });

    it("`toplam` sunucunun GERÇEK total değerini yansıtır — mevcut sayfadaki satır sayısını değil", () => {
      mockUseAdminUsers.mockReturnValue({
        data: { items: birinciSayfa, total: 130 },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminUsers>);

      kur();

      expect(screen.getByText(/130/)).toBeInTheDocument();
    });
  });

  describe("arama (sunucuya GERÇEK giden `q`, gecikmeli)", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("hızlı yazılan birkaç karakter API'ye tek istekle (gecikmiş değerle) gider", () => {
      mockUseAdminUsers.mockReturnValue({
        data: { items: [], total: 0 },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminUsers>);

      kur();
      const kutu = screen.getByPlaceholderText("Tabloda arama yapın");

      fireEvent.change(kutu, { target: { value: "z" } });
      fireEvent.change(kutu, { target: { value: "ze" } });
      fireEvent.change(kutu, { target: { value: "zeynep" } });

      expect((kutu as HTMLInputElement).value).toBe("zeynep");
      expect(mockUseAdminUsers.mock.calls.at(-1)?.[0]).toMatchObject({ q: undefined, role: "CLIENT" });

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(mockUseAdminUsers.mock.calls.at(-1)?.[0]).toMatchObject({ q: "zeynep", role: "CLIENT" });
    });

    it("arama sunucuda GERÇEK çalıştığı için sahte kapsam uyarısı YOK", () => {
      // Sonuç DOLU tutulur ki `BosDurumu`nun (kendi meşru `role="status"`ü,
      // bkz. `Durum.tsx`) devreye girip iddiayı yanlış pozitif yapması
      // engellensin — burada sınanan `ListePage.uyari` slotunun HİÇ
      // kullanılmadığı (arama gerçek olduğu için sahte bir kapsam uyarısına
      // gerek kalmadığı).
      mockUseAdminUsers.mockReturnValue({
        data: { items: [musteri({ full_name: "Zeynep Kaya" })], total: 1 },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminUsers>);

      kur();
      const kutu = screen.getByPlaceholderText("Tabloda arama yapın");

      fireEvent.change(kutu, { target: { value: "zeynep" } });
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("arama başlarken sayfa 1'e döner (eski sayfadaki offset sunucuya sızmaz)", () => {
      mockUseAdminUsers.mockReturnValue({
        data: { items: Array.from({ length: 20 }, (_, i) => musteri({ id: i + 1 })), total: 45 },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useAdminUsers>);

      kur();
      fireEvent.click(screen.getByTitle("2"));
      mockUseAdminUsers.mockClear();

      const kutu = screen.getByPlaceholderText("Tabloda arama yapın");
      fireEvent.change(kutu, { target: { value: "zeynep" } });
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(mockUseAdminUsers.mock.calls.at(-1)?.[0]).toMatchObject({ q: "zeynep", offset: 0 });
    });
  });
});
