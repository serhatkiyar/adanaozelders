// Faz 4 · Kategori bazlı varsayılan KDV — UI kabul testleri (gerçek DOM +
// gerçek istek gövdesi; İP-12 harness deseni, sözleşme dosyasına dokunulmaz).
//
// MUTLAK KURAL: bu dosyada GERÇEK bir KDV oranı yazılmaz (mali müşavir onayı
// bekleniyor). Aşağıdaki TEST_* sabitleri bilinçli olarak gerçek dışıdır.
//
// Kanıtlanan davranışlar:
//   K-1 Kategori seçilince KDV alanı kategorinin (miras çözülmüş) varsayılanıyla
//       ÖN-DOLAR — yüzde olarak. (Negatif kontrol hedefi.)
//   K-2 Kullanıcının ELLE yazdığı oran kategori değişiminde EZİLMEZ.
//   K-3 Ön-dolan değer ürün seviyesinde ezilebilir; POST gövdesinde kullanıcının
//       oranı gider (kategori varsayılanı değil).
//   K-4 Varsayılansız kategoride alan boş kalır (bugünkü davranış birebir).
//   K-5 Kategori panelinden varsayılan KDV atanır/temizlenir — gerçek PATCH
//       gövdesi doğrulanır.
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

// TEST DEĞERLERİ — gerçek KDV oranı DEĞİLDİR (mali müşavir onayı bekleniyor).
const TEST_ORAN = "0.1234";      // form yüzdesi: 12.34
const TEST_YUZDE = "12.34";
const TEST_ORAN_ELLE = "43.21";  // kullanıcının elle yazdığı yüzde

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
        i.url.split("?")[0].includes(parca) &&
        (method ? i.method === method : true)
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

function sayfa(yol: string) {
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
          <Route path={yol} element={<AdminStore />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

const KATEGORILER = [
  // Kök: TEST oranlı varsayılan; yaprak: kendi değeri YOK, effective miras.
  { id: 30, slug: "kirtasiye", name: "Kırtasiye", parent_id: null, sort_order: 0, product_count: 2, default_tax_rate: TEST_ORAN, effective_tax_rate: TEST_ORAN },
  { id: 31, slug: "kalemler", name: "Kalemler", parent_id: 30, sort_order: 0, product_count: 1, default_tax_rate: null, effective_tax_rate: TEST_ORAN },
  { id: 40, slug: "oransiz", name: "Oransız Bölüm", parent_id: null, sort_order: 1, product_count: 0, default_tax_rate: null, effective_tax_rate: null },
];

function temelSunucu() {
  sunucu("/store/config", { data: { low_stock_threshold: 5 } }, "get");
  sunucu("/store/book-facets", { data: { publisher: [], author: [], cover_type: [] } }, "get");
  sunucu("/store/admin/products", { data: [], headers: { "x-total-count": "0" } }, "get");
  sunucu("/store/categories", { data: KATEGORILER }, "get");
  sunucu("/store/admin/variant-config", { data: { axes: [], book_root_slugs: [] } }, "get");
  sunucu("/store/admin/variant-groups", { data: [] }, "get");
}

async function formuAc() {
  fireEvent.click(await screen.findByRole("button", { name: "Yeni ürün" }));
  await screen.findByLabelText("Ürün adı");
  await screen.findByRole("option", { name: "Kalemler" });
}

function kdvAlani(): HTMLInputElement {
  return screen.getByLabelText("KDV oranı (%)") as HTMLInputElement;
}

describe("K-1 · kategori varsayılanı KDV alanını ön-doldurur", () => {
  it("miraslı yaprak seçilince alan yüzdeyle dolar", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sayfa(ROUTES.adminStoreProducts);
    await formuAc();
    expect(kdvAlani().value).toBe("");
    fireEvent.change(screen.getByLabelText(/^Kategori/), { target: { value: "31" } });
    await waitFor(() => expect(kdvAlani().value).toBe(TEST_YUZDE));
  });
});

describe("K-2 · elle yazılan oran ezilmez", () => {
  it("kullanıcı oran yazdıktan sonra kategori değişimi alanı değiştirmez", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sayfa(ROUTES.adminStoreProducts);
    await formuAc();
    fireEvent.change(kdvAlani(), { target: { value: TEST_ORAN_ELLE } });
    fireEvent.change(screen.getByLabelText(/^Kategori/), { target: { value: "31" } });
    // Ön-doldurma çalışsaydı TEST_YUZDE olurdu; elle değer korunmalı.
    await new Promise((r) => setTimeout(r, 50));
    expect(kdvAlani().value).toBe(TEST_ORAN_ELLE);
  });
});

describe("K-3 · ürün seviyesinde ezme", () => {
  it("ön-dolan değer değiştirilirse POST gövdesinde KULLANICININ oranı gider", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { status: 201, data: { id: 990 } }, "post");
    sayfa(ROUTES.adminStoreProducts);
    await formuAc();
    fireEvent.change(screen.getByLabelText("Ürün adı"), { target: { value: "Kalem X" } });
    fireEvent.change(screen.getByLabelText("Fiyat (TL)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/^Kategori/), { target: { value: "31" } });
    await waitFor(() => expect(kdvAlani().value).toBe(TEST_YUZDE));
    fireEvent.change(kdvAlani(), { target: { value: TEST_ORAN_ELLE } });
    fireEvent.click(screen.getByRole("button", { name: "Ürünü ekle" }));
    await waitFor(() => {
      const istek = sonIstek("/store/admin/products", "post");
      expect(istek).toBeDefined();
      expect(istek!.body).toMatchObject({
        category_id: 31,
        tax_rate: (Number(TEST_ORAN_ELLE) / 100).toFixed(4),
      });
    });
  });
});

describe("K-4 · varsayılansız kategoride bugünkü davranış birebir", () => {
  it("effective NULL ise alan boş kalır (oran uydurulmaz)", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sayfa(ROUTES.adminStoreProducts);
    await formuAc();
    fireEvent.change(screen.getByLabelText(/^Kategori/), { target: { value: "40" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(kdvAlani().value).toBe("");
  });
});

describe("K-5 · kategori panelinden varsayılan atanır/temizlenir", () => {
  it("yüzde girilince gerçek PATCH gövdesi oran taşır; boş bırakmak null gönderir", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu(/\/store\/admin\/categories\/\d+$/, { data: KATEGORILER[2] }, "patch");
    sayfa(ROUTES.adminStoreCategories);

    // "Oransız Bölüm" satırında rozet "KDV —"; Düzenle → yüzde gir → Kaydet.
    await screen.findByText("Oransız Bölüm", { exact: false });
    const duzenle = screen.getAllByRole("button", { name: "Düzenle" });
    fireEvent.click(duzenle[duzenle.length - 1]); // son satır: Oransız Bölüm
    fireEvent.change(
      screen.getByLabelText("Oransız Bölüm varsayılan KDV (%)"),
      { target: { value: TEST_YUZDE } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => {
      const istek = sonIstek("/store/admin/categories/40", "patch");
      expect(istek).toBeDefined();
      expect(istek!.body).toMatchObject({ default_tax_rate: TEST_ORAN });
    });

    // Temizleme: boş bırak → null gider.
    fireEvent.click(
      screen.getAllByRole("button", { name: "Düzenle" })[0]
    ); // ilk satır: Kırtasiye (kendi değeri TEST_ORAN)
    const alan = screen.getByLabelText("Kırtasiye varsayılan KDV (%)");
    fireEvent.change(alan, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => {
      const istek = sonIstek("/store/admin/categories/30", "patch");
      expect(istek).toBeDefined();
      expect(istek!.body).toMatchObject({ default_tax_rate: null });
    });
  });
});
