import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PanelProvider } from "@/panel/PanelProvider";
import { EnvanterGenelBakis } from "@/panel/pages/urunler/EnvanterGenelBakis";
import { useCountSessions, useDamageEvents } from "@/hooks/useInventory";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import type { DamageEventOut } from "@/api/inventory";

vi.mock("@/hooks/useInventory", () => ({ useCountSessions: vi.fn(), useDamageEvents: vi.fn() }));

const mockSayim = vi.mocked(useCountSessions);
const mockHasar = vi.mocked(useDamageEvents);

const OLAY = {
  id: 1, product_id: 42, kind: "TRANSFER", qty: 3, source_bucket: "SELLABLE",
  reason_code: "KIRIK", note: null, actor_admin_id: 1, created_at: "2026-09-10T10:00:00Z", idempotency_key: null,
} as DamageEventOut;

const sonuc = (data: unknown, ek: object = {}) =>
  ({ data, isPending: false, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...ek }) as never;

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PanelProvider>
        <MemoryRouter initialEntries={["/yonetim-yeni/urunler/envanter"]}>
          <EnvanterGenelBakis />
        </MemoryRouter>
      </PanelProvider>
    </QueryClientProvider>,
  );
}

function oturum(izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}

beforeEach(() => {
  mockSayim.mockImplementation((p) => sonuc({ items: [], total: p.status === "IN_PROGRESS" ? 4 : 2 }));
  mockHasar.mockReturnValue(sonuc({ items: [OLAY], total: 1 }));
  oturum(["inventory.view", "inventory.count", "inventory.apply"]);
});

describe("EnvanterGenelBakis", () => {
  it("sayaçlar sunucu total'ından basılır ve yeni sayım listesine durum süzgeciyle bağlanır", () => {
    kur();
    const kart = screen.getByRole("region", { name: "Sayım durumu" });
    const suren = within(kart).getByText("Sayım sürüyor").closest("[role=listitem]") as HTMLElement;
    expect(within(suren).getByText("4")).toBeInTheDocument();
    expect(within(suren).getByRole("link")).toHaveAttribute("href", `${ROUTES.adminNewStockCounts}?durum=IN_PROGRESS`);
    const inceleme = within(kart).getByText("İnceleme bekliyor").closest("[role=listitem]") as HTMLElement;
    expect(within(inceleme).getByText("2")).toBeInTheDocument();
    expect(within(inceleme).getByRole("link")).toHaveAttribute("href", `${ROUTES.adminNewStockCounts}?durum=REVIEW`);
    expect(mockSayim).toHaveBeenCalledWith({ status: "IN_PROGRESS", limit: 1, offset: 0 }, true);
    expect(mockHasar).toHaveBeenCalledWith({ limit: 5, offset: 0 }, true);
    expect(screen.queryByText(/Salt okunur görünüm/)).not.toBeInTheDocument();
  });

  it("hasar olayları etiket, ürün, gerekçe ile listelenir; Tümü ve ilgili ekran bağlantıları doğru", () => {
    kur();
    const kart = screen.getByRole("region", { name: "Son hasar olayları" });
    expect(within(kart).getByText("Hasara ayrıldı")).toBeInTheDocument();
    expect(within(kart).getByText("Ürün #42 · 3 adet")).toBeInTheDocument();
    expect(within(kart).getByText("Kırık")).toBeInTheDocument();
    expect(within(kart).getByRole("link", { name: "Tümü" })).toHaveAttribute("href", ROUTES.adminNewDamageEvents);
    const ilgili = screen.getByRole("region", { name: "İlgili ekranlar" });
    expect(within(ilgili).getAllByRole("link")).toHaveLength(2);
    // İç içe etkileşimli öğe yok: tek <a>, içinde/dışında <button> yok.
    expect(ilgili.querySelectorAll("a button, button a")).toHaveLength(0);
    expect(within(ilgili).getByRole("link", { name: "Stok hareketleri" })).toHaveAttribute("href", ROUTES.adminNewStockMovements);
    expect(within(ilgili).getByRole("link", { name: "Denetim kayıtları" })).toHaveAttribute("href", ROUTES.adminNewAuditLogs);
  });

  it("yükleniyor: sayaç '…' basar, hasar kartı yükleniyor der; boş liste boş metni basar", () => {
    mockSayim.mockReturnValue(sonuc(undefined, { isLoading: true, isPending: true }));
    mockHasar.mockReturnValue(sonuc(undefined, { isPending: true }));
    kur();
    expect(screen.getAllByText("…")).toHaveLength(2);
    expect(screen.getByText("Hasar olayları yükleniyor…")).toBeInTheDocument();

    mockHasar.mockReturnValue(sonuc({ items: [], total: 0 }));
    kur();
    expect(screen.getByText("Henüz hasar olayı kaydedilmedi.")).toBeInTheDocument();
  });

  it("hasar hatası Tekrar dene sunar; sayaçlar '-' ile kalır", async () => {
    const refetch = vi.fn();
    mockSayim.mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x") }));
    mockHasar.mockReturnValue(sonuc(undefined, { isError: true, error: new Error("x"), refetch }));
    kur();
    expect(screen.getByText("Hasar olayları yüklenemedi.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.getAllByText("-")).toHaveLength(2);
  });

  it("yalnız inventory.view: salt okunur notu basılır", () => {
    oturum(["inventory.view"]);
    kur();
    expect(screen.getByText(/Salt okunur görünüm/)).toBeInTheDocument();
  });

  it("envanter izni yoksa 403 kutusu ve sorgular kapalı", () => {
    oturum(["products.view"]);
    kur();
    expect(screen.getByText("Bu alan için yetkiniz yok")).toBeInTheDocument();
    expect(mockHasar).toHaveBeenLastCalledWith({ limit: 5, offset: 0 }, false);
  });
});
