// İP-A5 · `AdminStore` BÖLME SONDASI — bölmeden ÖNCE yazıldı.
//
// ## Neden bu dosya var
//
// İP-A5 `AdminStore.tsx`'i (2216 satır) mekanik olarak bölüyor. Bölmenin
// davranış değiştirmediğini KANITLAMANIN yolu, bölünmüş hâli test etmek
// değildir — o yalnız bölünmüş hâlin çalıştığını gösterir. Bu yüzden bu sonda
// bölmeden ÖNCE yazıldı, ÖNCE yeşil koştu ve bölme sırasında AĞ görevi gördü.
//
// ## Ne ölçüyor (ve neyi ölçmüyor)
//
// Mevcut kabul testleri (`adminStorePanel`, `adminStoreVariants`,
// `adminStoreLabels`, `adminStoreDigitalGate`, `adminStoreCategoryTax`,
// `adminSafetyStates`) ekranın İÇ davranışlarını zaten sıkı tutuyor: gerçek
// sorgu parametreleri, gerçek POST gövdeleri, onay penceresi sözleşmesi.
// Ama hepsi ekranı DOĞRUDAN bir alt-rotada render ediyor — hiçbiri
// **sekmeler arası geçişi** ve **pencerelerin açılıp kapanmasını** aynı
// oturumda sürmüyor. Bölmenin kırabileceği şey tam olarak budur: düzenleyici
// bileşen ile bölümler arasındaki bağ.
//
// Bu yüzden sonda dört akışı sürer:
//   S-1  altı sekme arasında GERÇEK gezinme (NavLink tıklaması → panel değişir)
//   S-2  onay penceresi aç/kapa (ürün silme) — kapanınca istek GİTMEZ
//   S-3  düzenleme penceresi aç/kapa (`EditProductModal`) — detay isteği gider
//   S-4  liste gerçekten sunucudan gelir (limit/offset ile) ve satırları basar
//
// Bunlar "element var mı" testi değildir: her düğümde ya gerçek bir istek ya
// da gerçek bir DOM sonucu okunur.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminStore from "@/pages/dashboards/AdminStore";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu (İP-4/İP-12 deseni) ══════════════ */

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

function istekleri(parca: string, method = "get"): Istek[] {
  return istekler.filter(
    (i) => i.method === method && i.url.split("?")[0].includes(parca)
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
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
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

/** Mağazanın altı sekmesinin HEPSİ kayıtlı: NavLink tıklaması gerçekten gezer. */
function magaza(baslangic: string = ROUTES.adminStoreProducts) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[baslangic]}>
        <Routes>
          {[
            ROUTES.adminStoreProducts,
            ROUTES.adminStoreCategories,
            ROUTES.adminStoreOrders,
            ROUTES.adminStoreReturns,
            ROUTES.adminStoreCoupons,
            ROUTES.adminStoreStock,
          ].map((yol) => (
            <Route key={yol} path={yol} element={<AdminStore />} />
          ))}
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

const URUN_A = {
  id: 5,
  title: "Palme TYT Matematik Soru Bankası",
  price: "250.00",
  kind: "PHYSICAL",
  status: "ACTIVE",
  seller_type: "PLATFORM",
  cover_url: null,
  stock: 12,
  author: "Komisyon",
  publisher: "Palme",
  isbn: "9786051234567",
};

const URUN_B = {
  id: 6,
  title: "Karekök AYT Fizik Soru Bankası",
  price: "310.00",
  kind: "PHYSICAL",
  status: "HIDDEN",
  seller_type: "PLATFORM",
  cover_url: null,
  stock: 0,
};

const URUN_A_DETAY = {
  ...URUN_A,
  description: "Yeni müfredata uygun.",
  category_id: null,
  compare_at_price: null,
  tax_rate: "0.20",
  page_count: 480,
  variant_group_id: null,
};

const KATEGORI = { id: 3, name: "Deneme Kitapları", product_count: 4 };

const SIPARIS = {
  id: 77,
  total: "250.00",
  status: "SHIPPED",
  payment_status: "PAID",
  has_physical: true,
  ship_address: "Ceyhan / Adana",
  ship_recipient: "Ayşe Y.",
  created_at: "2027-04-01T09:00:00+00:00",
  items: [{ id: 1 }],
};

const IADE = {
  id: 12,
  order_id: 77,
  status: "PENDING",
  reason: "Kitap hasarlı geldi",
  admin_note: null,
  created_at: "2027-04-02T09:00:00+00:00",
  order: { total: "250.00", ship_recipient: "Ayşe Y.", ship_address: "Ceyhan / Adana" },
};

const KUPON = {
  id: 2,
  code: "OKULA-DONUS",
  discount_type: "PERCENT",
  discount_value: 15,
  min_subtotal: "100.00",
  max_uses: 50,
  used_count: 3,
  per_user_limit: 1,
  is_active: true,
};

/** Altı sekmenin hepsini besleyen sunucu. */
function tamSunucu() {
  sunucu("/store/categories", { data: [KATEGORI] }, "get");
  sunucu("/store/config", { data: { low_stock_threshold: 5 } }, "get");
  sunucu("/store/book-facets", { data: { publisher: [], author: [] } }, "get");
  sunucu(
    "/store/admin/products",
    { data: [URUN_A, URUN_B], headers: { "x-total-count": "2" } },
    "get"
  );
  // Detay listeden SONRA kayıtlı: eşleşme sırası son kaydedilenden başlar.
  sunucu(/\/store\/admin\/products\/5$/, { data: URUN_A_DETAY }, "get");
  sunucu("/store/admin/orders", { data: [SIPARIS] }, "get");
  sunucu("/store/admin/returns", { data: [IADE] }, "get");
  sunucu("/store/admin/coupons", { data: [KUPON] }, "get");
}

function tamYetki() {
  izinVer(
    "products.view",
    "products.manage",
    "orders.view",
    "orders.manage",
    "returns.view",
    "returns.manage",
    "coupons.view",
    "coupons.manage"
  );
}

async function urunSatiri(baslik: string): Promise<HTMLElement> {
  const hucre = await screen.findByText(baslik);
  const satir = hucre.closest("tr, div.rounded-xl");
  if (!satir) throw new Error(`"${baslik}" için satır bulunamadı`);
  return satir as HTMLElement;
}

/* ═════════════════════ S-1 · Sekme geçişleri ═════════════════════ */

describe("S-1 · altı sekme arasında gerçek gezinme", () => {
  it("her sekme tıklaması KENDİ panelini basar (düzenleyici bağı sağlam)", async () => {
    tamYetki();
    tamSunucu();
    magaza();

    // Ürünler (başlangıç)
    expect(await screen.findByText(URUN_A.title)).toBeTruthy();

    // → Kategoriler
    fireEvent.click(screen.getByRole("link", { name: "Kategoriler" }));
    expect(await screen.findByText(/Deneme Kitapları/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Kategori adı")).toBeTruthy();
    expect(screen.queryByText(URUN_A.title)).toBeNull();

    // → Siparişler
    fireEvent.click(screen.getByRole("link", { name: "Siparişler" }));
    expect(await screen.findByText("#77")).toBeTruthy();
    expect(screen.getByText("Ayşe Y.")).toBeTruthy();

    // → İadeler
    fireEvent.click(screen.getByRole("link", { name: "İadeler" }));
    expect(await screen.findByText("Kitap hasarlı geldi")).toBeTruthy();

    // → Kuponlar
    fireEvent.click(screen.getByRole("link", { name: "Kuponlar" }));
    expect(await screen.findByText("OKULA-DONUS")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Yeni kupon" })).toBeTruthy();

    // → Ürünler (geri)
    fireEvent.click(screen.getByRole("link", { name: "Ürünler" }));
    expect(await screen.findByText(URUN_A.title)).toBeTruthy();
  });

  it("izinsiz sekme çubuğa HİÇ girmez (bölme yetki kapısını taşımadı)", async () => {
    izinVer("products.view");
    tamSunucu();
    magaza();

    expect(await screen.findByText(URUN_A.title)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kategoriler" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Siparişler" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Kuponlar" })).toBeNull();
  });
});

/* ═════════════════════ S-2 · Onay penceresi aç/kapa ═════════════════════ */

describe("S-2 · onay penceresi açılır ve kapanır", () => {
  it("'Sil' pencereyi açar, vazgeçmek KAPATIR ve DELETE göndermez", async () => {
    tamYetki();
    tamSunucu();
    magaza();

    const satir = await urunSatiri(URUN_A.title);
    fireEvent.click(within(satir).getByRole("button", { name: "Sil" }));

    const pencere = await screen.findByRole("dialog");
    expect(within(pencere).getByText(/katalogdan kaldırılacak/)).toBeTruthy();
    expect(istekleri("/store/admin/products", "delete")).toHaveLength(0);

    fireEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(istekleri("/store/admin/products", "delete")).toHaveLength(0);
  });
});

/* ═════════════════════ S-3 · Düzenleme penceresi aç/kapa ═════════════════════ */

describe("S-3 · düzenleme penceresi açılır ve kapanır", () => {
  it("'Düzenle' detay isteğini atar ve formu basar; 'Kapat' pencereyi kaldırır", async () => {
    tamYetki();
    tamSunucu();
    magaza();

    const satir = await urunSatiri(URUN_A.title);
    fireEvent.click(within(satir).getByRole("button", { name: "Düzenle" }));

    expect(await screen.findByText("Ürünü düzenle")).toBeTruthy();
    // Form GERÇEK detay yanıtıyla dolar (pencere yalnız görünmüyor, veri de akıyor).
    await waitFor(() =>
      expect(screen.getByDisplayValue(URUN_A.title)).toBeTruthy()
    );
    expect(istekleri("/store/admin/products/5")).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Kapat" }));
    await waitFor(() =>
      expect(screen.queryByText("Ürünü düzenle")).toBeNull()
    );
    // Liste ekranda kalmalı: pencere kapanınca panel çökmez.
    expect(screen.getByText(URUN_A.title)).toBeTruthy();
  });
});

/* ═════════════════════ S-4 · Listeleme ═════════════════════ */

describe("S-4 · ürün listesi sunucudan gelir", () => {
  it("istek limit/offset taşır ve dönen İKİ satır da tabloda basılır", async () => {
    tamYetki();
    tamSunucu();
    magaza();

    expect(await screen.findByText(URUN_A.title)).toBeTruthy();
    expect(screen.getByText(URUN_B.title)).toBeTruthy();

    const liste = istekleri("/store/admin/products").filter(
      (i) => !/\/products\/\d+$/.test(i.url.split("?")[0])
    );
    expect(liste.length).toBeGreaterThan(0);
    expect(liste[0].params.get("limit")).toBeTruthy();
    expect(liste[0].params.get("offset")).toBe("0");
  });
});
