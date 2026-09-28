// Admin paneli · izin tutarlılığı ve gezinme regresyonları.
//
// Ölçülen kusurlar:
//   1. Mağaza menü öğesi `products.view | content.view` istiyor, sayfa ise
//      products/suppliers/orders/returns/coupons alanlarına bakıyordu: içerik
//      yetkilisi menüden 403'e düşüyor, sipariş sorumlusu Mağaza'yı hiç görmüyordu.
//   2. `/yonetim/magaza` her zaman Ürünler'e gidiyordu; ürün yetkisi olmayan
//      yönetici kendi sekmesi yerine "erişim yok" görüyordu.
//   3. Genel Bakış izne bakmıyordu: `dashboard.view` yoksa 403 "yüklenemedi"
//      olarak görünüyor, izinsiz alanların kartları 403 ekranına götürüyordu.
//   4. Eşleşmeyen `/yonetim/...` adresi admin kabuğunun dışında public 404'tü.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { apiClient } from "@/api/axios";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { ADMIN_NAV_ITEMS } from "@/components/admin/layout/adminNavigation";
import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
import AdminStore from "@/pages/dashboards/AdminStore";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

// Tam `App` testinde `ProtectedRoute` `/auth/me`i bu hook'tan okur.
const mevcutKullanici = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: mevcutKullanici.user, isLoading: false, isError: false }),
}));

let istekler: string[] = [];
let yanitlar: Record<string, unknown> = {};
let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  yanitlar = {};
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const yol = String(config.url).split("?")[0];
    istekler.push(yol);
    const anahtar = Object.keys(yanitlar).find((k) => yol.includes(k));
    return { data: anahtar ? yanitlar[anahtar] : [], status: 200, statusText: "OK", headers: {}, config } as never;
  };
});

afterEach(() => {
  cleanup();
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  mevcutKullanici.user = null;
});

function izinVer(...kodlar: string[]) {
  const user = { id: 1, role_id: 1, admin_permissions: kodlar };
  mevcutKullanici.user = user;
  useAuthStore.setState({ token: "test-token", isAuthenticated: true, user: user as never });
}

function Konum() {
  return <output data-testid="konum">{useLocation().pathname}</output>;
}

function sar(yol: string, element: React.ReactElement, rotalar: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Routes>
          {rotalar.map((r) => <Route key={r} path={r} element={<>{element}<Konum /></>} />)}
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Menüdeki görünürlük kuralı (kenar çubuğu, Ctrl+K ve G+M aynı kuralı uygular). */
function menudeGorunur(label: string, izinler: string[]) {
  const oge = ADMIN_NAV_ITEMS.find((i) => i.label === label)!;
  const kodlar = Array.isArray(oge.requiredPermission) ? oge.requiredPermission : [oge.requiredPermission!];
  return kodlar.some((k) => izinler.includes(k));
}

describe("Mağaza · menü ve sayfa aynı izin kuralı", () => {
  it("yalnız içerik yetkilisi Mağaza'yı menüde görmez ve sayfa da kapalıdır", () => {
    expect(menudeGorunur("Mağaza", ["content.view", "content.manage"])).toBe(false);
    izinVer("content.view", "content.manage");
    sar(ROUTES.adminStoreRoot, <AdminStore />, [ROUTES.adminStoreRoot]);
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeTruthy();
  });

  it.each(["orders.view", "returns.view", "coupons.view", "suppliers.view", "products.view"])(
    "yalnız %s taşıyan yönetici Mağaza'yı menüde görür",
    (kod) => {
      expect(menudeGorunur("Mağaza", [kod])).toBe(true);
    }
  );

  it("sipariş sorumlusu /yonetim/magaza'da Siparişler'e yönlenir, 403 kutusu görmez", async () => {
    izinVer("orders.view");
    sar(ROUTES.adminStoreRoot, <AdminStore />, [ROUTES.adminStoreRoot, ROUTES.adminStoreOrders]);
    expect((await screen.findByTestId("konum")).textContent).toBe(ROUTES.adminStoreOrders);
    expect(screen.queryByText(ERISIM_REDDEDILDI_BASLIK)).toBeNull();
    expect(istekler.some((y) => y.includes("/admin/products"))).toBe(false);
  });

  it("ürün yetkilisi için kök yine Ürünler'e gider", async () => {
    izinVer("products.view", "orders.view");
    sar(ROUTES.adminStoreRoot, <AdminStore />, [ROUTES.adminStoreRoot, ROUTES.adminStoreProducts]);
    expect((await screen.findByTestId("konum")).textContent).toBe(ROUTES.adminStoreProducts);
  });
});

describe("Genel Bakış · kart ve sorgular izne bağlı", () => {
  const OZET = {
    new_clients: 0, previous_new_clients: 0, new_tutors: 0, previous_new_tutors: 0,
    new_orders: 0, previous_new_orders: 0, pending_tutors: 0, pending_diplomas: 0,
    open_reports: 3, disputed_bookings: 0, active_bookings: 0, open_demands: 0,
    paid_orders: 0, pending_returns: 0, low_stock_products: 0, pending_libraries: 0,
    active_delivery_runs: 0, period_audit_logs: 0,
  };

  it("dashboard.view yoksa erişim yok gösterilir ve özet istenmez", () => {
    izinVer("delivery.view");
    sar(ROUTES.admin, <AdminDashboardPage />, [ROUTES.admin]);
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeTruthy();
    expect(screen.queryByText(/yüklenemedi/i)).toBeNull();
    expect(istekler.some((y) => y.includes("/admin/dashboard"))).toBe(false);
    expect(istekler.some((y) => y.includes("/admin/revenue"))).toBe(false);
  });

  it("izni olmayan alanın kartı gizlenir, para bölümü payments.view olmadan istenmez", async () => {
    yanitlar["/admin/dashboard"] = OZET;
    izinVer("dashboard.view", "bookings.view");
    sar(ROUTES.admin, <AdminDashboardPage />, [ROUTES.admin]);

    const kuyruk = (await screen.findByRole("heading", { name: "Operasyon kuyrukları" })).closest("section")!;
    expect(within(kuyruk).getByText("İhtilaflı rezervasyonlar")).toBeTruthy();
    expect(within(kuyruk).queryByText("Açık şikâyetler")).toBeNull();
    expect(within(kuyruk).queryByText("Düşük stok")).toBeNull();
    expect(istekler.some((y) => y.includes("/admin/revenue"))).toBe(false);
  });

  it("hiçbir kuyruk alanı izni yoksa kuyruk bölümü hiç basılmaz", async () => {
    yanitlar["/admin/dashboard"] = OZET;
    izinVer("dashboard.view");
    sar(ROUTES.admin, <AdminDashboardPage />, [ROUTES.admin]);
    expect(await screen.findByRole("heading", { name: "Dönem hareketi" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Operasyon kuyrukları" })).toBeNull();
  });
});

describe("Eşleşmeyen /yonetim adresi · kabuk içinde 404", () => {
  it("gerçek App rotalarında /yonetim/xyz admin menüsüyle birlikte 'Sayfa bulunamadı' gösterir", async () => {
    izinVer("users.view");
    window.history.pushState({}, "", "/yonetim/boyle-bir-sayfa-yok");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <HelmetProvider>
        <QueryClientProvider client={qc}>
          <App />
        </QueryClientProvider>
      </HelmetProvider>
    );
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(await screen.findByRole("heading", { name: "Sayfa bulunamadı" })).toBeTruthy();
    // Kabuğun kanıtı: yönetim menüsü aynı ekranda.
    expect(screen.getByRole("navigation", { name: "Yönetim menüsü" })).toBeTruthy();
    expect(window.location.pathname).toBe("/yonetim/boyle-bir-sayfa-yok");
  });
});
