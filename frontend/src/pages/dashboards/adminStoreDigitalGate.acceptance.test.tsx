// Dijital ürün tuzağı — admin ürün formunun DIGITAL seçeneği (gerçek DOM).
//
// Neden var: `digital_products_live` bayrağı kapalıyken oluşturulan dijital
// ürün kaydediliyor, vitrine çıkıyor, satılamıyor (checkout 503) ve `kind`
// trigger'ı yüzünden DÜZELTİLEMİYORDU. Sunucu tarafı kapı
// `tests/integration/test_digital_create_gate_pg.py`'de; burada kullanıcı
// 503'e kadar yürümesin diye formun kendisi sınanır.
//
// Kanıtlanan davranışlar:
//   G-1 Bayrak kapalıyken DIGITAL seçeneği SEÇİLEMEZ ve sebebi yazıyla söylenir.
//   G-2 Bayrak açıkken seçenek serbesttir (kapı bir yasak değil, bayrağın aynası).
//   G-3 Uygunluk bilgisi hiç gelmezse seçenek KAPALI kalır (fail-closed).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminStore from "@/pages/dashboards/AdminStore";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu (İP-12 harness'inin kopyası) ══════════════ */

interface Istek {
  method: string;
  url: string;
  params: URLSearchParams;
  body: Record<string, unknown> | null;
}

type Yanit =
  | { status?: number; data: unknown; headers?: Record<string, string> }
  | ((istek: Istek) => { status?: number; data: unknown; headers?: Record<string, string> });

let istekler: Istek[] = [];
let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit }[] = [];
let eskiAdapter: unknown;

function sunucu(desen: string | RegExp, yanit: Yanit, method?: string) {
  rotalar.unshift({
    esles: (i) => {
      const yol = i.url.split("?")[0];
      return (
        (method ? i.method === method.toLowerCase() : true) &&
        (typeof desen === "string" ? yol.includes(desen) : desen.test(yol))
      );
    },
    yanit,
  });
}

function sonIstek(parca: string, method?: string): Istek | undefined {
  return [...istekler]
    .reverse()
    .find(
      (i) =>
        i.url.split("?")[0].includes(parca) && (method ? i.method === method : true)
    );
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  rotalar = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const gomulu = String(config.url).split("?")[1] ?? "";
    const params = new URLSearchParams(gomulu);
    for (const [k, v] of Object.entries(
      (config.params ?? {}) as Record<string, unknown>
    )) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) {
        for (const öğe of v) params.append(k, String(öğe));
      } else {
        params.set(k, String(v));
      }
    }
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      params,
      body: config.data ? JSON.parse(String(config.data)) : null,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota
      ? typeof rota.yanit === "function"
        ? rota.yanit(istek)
        : rota.yanit
      : { data: [] };
    const status = ham.status ?? 200;
    if (status >= 400) {
      const hata = new Error(`istek başarısız: ${status}`) as Error & {
        isAxiosError: boolean;
        response: unknown;
        config: unknown;
      };
      hata.isAxiosError = true;
      hata.response = { status, data: ham.data, headers: {}, config };
      hata.config = config;
      throw hata;
    }
    return {
      data: ham.data,
      status,
      statusText: "OK",
      headers: ham.headers ?? {},
      config,
    } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  useToastStore.setState({ toasts: [] });
});

function izinVer(...kodlar: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

function sar(yol: string, rota: string, element: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Routes>
          <Route path={rota} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

const KATEGORILER = [
  { id: 30, slug: "kirtasiye", name: "Kırtasiye", parent_id: null, sort_order: 0, product_count: 5, default_tax_rate: null, effective_tax_rate: null },
];

/** `uygunluk === null` → uç hiç cevap vermemiş gibi davranır (fail-closed yolu). */
function temelSunucu(uygunluk: { digital_products_open: boolean } | null) {
  sunucu("/store/config", { data: { low_stock_threshold: 5 } }, "get");
  sunucu("/store/book-facets", { data: { publisher: [], author: [], cover_type: [] } }, "get");
  sunucu("/store/admin/products", { data: [], headers: { "x-total-count": "0" } }, "get");
  sunucu("/store/categories", { data: KATEGORILER }, "get");
  sunucu("/store/admin/variant-config", { data: { axes: [], book_root_slugs: ["kitap"] } }, "get");
  sunucu("/store/admin/variant-groups", { data: [] }, "get");
  sunucu(
    "/payments/availability",
    uygunluk === null
      ? { status: 503, data: { detail: "kapalı" } }
      : { data: { branches: [{ branch: "store", open: true, flag_enabled: true, blockers: [] }], ...uygunluk } },
    "get"
  );
}

async function formuAc() {
  fireEvent.click(await screen.findByRole("button", { name: "Yeni ürün" }));
  await screen.findByLabelText("Ürün adı");
  await screen.findByRole("option", { name: "Kırtasiye" });
}

function dijitalSecenek(): HTMLOptionElement {
  return screen.getByRole("option", { name: "Dijital ürün" }) as HTMLOptionElement;
}

describe("G-1 · bayrak kapalıyken DIGITAL seçilemez", () => {
  it("seçenek devre dışıdır ve sebebi yazıyla söylenir", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu({ digital_products_open: false });
    sar(ROUTES.adminStoreProducts, ROUTES.adminStoreProducts, <AdminStore />);
    await formuAc();

    await waitFor(() => expect(dijitalSecenek().disabled).toBe(true));
    // Devre dışı bir kutu tek başına sessizdir; yönetici NEDEN olduğunu görmeli.
    expect(screen.getByText(/dijital ürün satışı kapalı/i)).toBeTruthy();
    // Fiziksel seçenek etkilenmez — asıl iş odur.
    expect((screen.getByRole("option", { name: "Fiziksel ürün" }) as HTMLOptionElement).disabled).toBe(false);
  });
});

describe("G-2 · bayrak açıkken seçenek serbest", () => {
  it("kapı bir yasak değil, bayrağın aynasıdır", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu({ digital_products_open: true });
    sar(ROUTES.adminStoreProducts, ROUTES.adminStoreProducts, <AdminStore />);
    await formuAc();

    await waitFor(() => expect(dijitalSecenek().disabled).toBe(false));
    expect(screen.queryByText(/dijital ürün satışı kapalı/i)).toBeNull();
  });
});

describe("G-3 · bilgi yoksa fail-closed", () => {
  it("uygunluk ucu patlarsa seçenek KAPALI kalır", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu(null);
    sar(ROUTES.adminStoreProducts, ROUTES.adminStoreProducts, <AdminStore />);
    await formuAc();

    // "Bilmiyorum" hâlinde seçeneği açık bırakmak, düzeltilemeyen bir ürün
    // açtırırdı; ödeme yüzeylerindeki fail-closed kuralının aynısı.
    await waitFor(() => expect(dijitalSecenek().disabled).toBe(true));
  });
});
