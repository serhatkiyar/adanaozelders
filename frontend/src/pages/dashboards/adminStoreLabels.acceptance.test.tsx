// Ürün formu etiketleri — kitap dışı ürünleri de kapsayan dil (gerçek DOM).
//
// Neden var: mağaza artık yalnız kitap satmıyor (kalem, defter, dosya,
// fotokopi kağıdı). Form kitap odaklı kalmıştı: tür seçeneği "Basılı"
// yazıyordu, select'in görünür bir etiketi yoktu (kullanıcı neyin sorulduğunu
// göremiyordu) ve künye bölümü kitap dışı üründe ne olduğunu söylemiyordu.
//
// Kanıtlanan davranışlar:
//   E-1 Tür select'i erişilebilir bir adla bulunur; seçenekleri ürün türünü
//       söyler ("Fiziksel ürün"/"Dijital ürün"), kitaba özgü "Basılı" DEĞİL.
//   E-2 Künye bölümünün başlığı kitap dışı üründe ne yapılacağını söyler.
//   E-3 Kitap kategorisi seçilince künye bölümü KENDİLİĞİNDEN açılır;
//       kitap dışı kategoride kapalı kalır.
//   E-4 Kullanıcı bölümü elle kapatırsa efekt onu geri açmaz (nöbetçi: efekt
//       her render'da zorlamaz).
//   E-5 Vitrindeki müşteri filtresinde de aynı dil kullanılır.
//
// NOT: seçilen tür değerinin isteğe doğru gittiği (`kind: "PHYSICAL"`) ayrıca
// doğrulanır — etiket değişimi değeri kaydırmamalıdır.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminStore from "@/pages/dashboards/AdminStore";
import StorePage from "@/pages/store/StorePage";
import { PATHS, ROUTES } from "@/lib/routes";
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
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[yol]}>
          <Routes>
            <Route path={rota} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

// 10 = kitap kökü (variant-config'in `book_root_slugs`'ı ile eşleşir),
// 11 = onun yaprağı (miras zinciri), 30 = kitap DIŞI kırtasiye kökü.
const KATEGORILER = [
  { id: 10, slug: "kitap", name: "Kitap", parent_id: null, sort_order: 0, product_count: 3, default_tax_rate: null, effective_tax_rate: null },
  { id: 11, slug: "yks-kitaplari", name: "YKS Kitapları", parent_id: 10, sort_order: 0, product_count: 2, default_tax_rate: null, effective_tax_rate: null },
  { id: 30, slug: "kirtasiye", name: "Kırtasiye", parent_id: null, sort_order: 1, product_count: 5, default_tax_rate: null, effective_tax_rate: null },
];

function temelSunucu() {
  sunucu("/store/config", { data: { low_stock_threshold: 5 } }, "get");
  sunucu("/store/book-facets", { data: { publisher: [], author: [], cover_type: [] } }, "get");
  sunucu("/store/admin/products", { data: [], headers: { "x-total-count": "0" } }, "get");
  sunucu("/store/categories", { data: KATEGORILER }, "get");
  sunucu("/store/admin/variant-config", { data: { axes: ["Renk", "Ebat"], book_root_slugs: ["kitap"] } }, "get");
  sunucu("/store/admin/variant-groups", { data: [] }, "get");
}

async function formuAc() {
  fireEvent.click(await screen.findByRole("button", { name: "Yeni ürün" }));
  await screen.findByPlaceholderText("Ürün adı");
  await screen.findByRole("option", { name: "Kırtasiye" });
}

function turSecici(): HTMLSelectElement {
  return screen.getByLabelText("Ürün türü") as HTMLSelectElement;
}

/* ══════════════ E-1 · tür seçicisinin adı ve seçenekleri ══════════════ */

describe("E-1 · ürün türü seçicisi", () => {
  it("erişilebilir bir adı vardır ve seçenekleri kitaba özgü değildir", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sar(ROUTES.adminStoreProducts, ROUTES.adminStoreProducts, <AdminStore />);
    await formuAc();

    // Görünür/erişilebilir ad: kullanıcı neyin sorulduğunu görmeli.
    const secici = turSecici();
    expect(secici.value).toBe("PHYSICAL");

    // Seçenek metinleri ürün türünü söyler; "Basılı" kitaba özgüdür.
    expect(screen.getByRole("option", { name: "Fiziksel ürün" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Dijital ürün" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Basılı" })).toBeNull();
  });

  it("etiket değişimi DEĞERİ kaydırmaz — POST gövdesinde kind PHYSICAL gider", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { status: 201, data: { id: 991 } }, "post");
    sar(ROUTES.adminStoreProducts, ROUTES.adminStoreProducts, <AdminStore />);
    await formuAc();

    fireEvent.change(screen.getByPlaceholderText("Ürün adı"), { target: { value: "Kurşun Kalem" } });
    fireEvent.change(screen.getByPlaceholderText("Fiyat (TL)"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("KDV oranı (%)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Ürünü ekle" }));

    await waitFor(() => {
      const istek = sonIstek("/store/admin/products", "post");
      expect(istek).toBeDefined();
      expect(istek!.body).toMatchObject({ kind: "PHYSICAL", title: "Kurşun Kalem" });
    });
  });
});

/* ══════════════ E-2 · künye başlığı ══════════════ */

describe("E-2 · künye bölümünün başlığı", () => {
  it("kitap dışı üründe ne yapılacağını söyler", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sar(ROUTES.adminStoreProducts, ROUTES.adminStoreProducts, <AdminStore />);
    await formuAc();

    const baslik = screen.getByRole("button", { name: /Kitap künyesi/ });
    expect(baslik.textContent).toMatch(/kitap dışı ürünlerde boş bırakın/i);
    // Eski, ne olduğunu söylemeyen başlık kalmamalı.
    expect(screen.queryByRole("button", { name: /Künye \/ kitap bilgileri/ })).toBeNull();
  });

  it("ebat örneği kırtasiyeyi de kapsar", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sar(ROUTES.adminStoreProducts, ROUTES.adminStoreProducts, <AdminStore />);
    await formuAc();
    fireEvent.click(screen.getByRole("button", { name: /Kitap künyesi/ }));

    const ebat = screen.getByPlaceholderText(/^Ebat/) as HTMLInputElement;
    expect(ebat.placeholder).toMatch(/A4/);
  });
});

/* ══════════════ E-3/E-4 · kategoriye duyarlı açılış ══════════════ */

describe("E-3 · kitap kategorisinde künye kendiliğinden açılır", () => {
  it("kitap yaprağı seçilince Yazar alanı görünür olur", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sar(ROUTES.adminStoreProducts, ROUTES.adminStoreProducts, <AdminStore />);
    await formuAc();

    // Yeni üründe bölüm KAPALI başlar (bugünkü davranış).
    expect(screen.queryByPlaceholderText("Yazar")).toBeNull();

    // Kitap KÖKÜNÜN YAPRAĞI: zincir çözümü de kanıtlanır.
    fireEvent.change(screen.getByLabelText("Kategori"), { target: { value: "11" } });
    await waitFor(() => expect(screen.getByPlaceholderText("Yazar")).toBeTruthy());
  });

  it("kitap dışı kategoride kapalı kalır", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sar(ROUTES.adminStoreProducts, ROUTES.adminStoreProducts, <AdminStore />);
    await formuAc();

    fireEvent.change(screen.getByLabelText("Kategori"), { target: { value: "30" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByPlaceholderText("Yazar")).toBeNull();
  });
});

describe("E-4 · efekt kullanıcıyla inatlaşmaz", () => {
  it("kitap kategorisinde elle kapatılan bölüm kendiliğinden geri açılmaz", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sar(ROUTES.adminStoreProducts, ROUTES.adminStoreProducts, <AdminStore />);
    await formuAc();

    fireEvent.change(screen.getByLabelText("Kategori"), { target: { value: "10" } });
    await waitFor(() => expect(screen.getByPlaceholderText("Yazar")).toBeTruthy());

    // Kullanıcı kapatır; başka bir alana dokunmak (yeniden render) onu
    // geri açmamalı — aksi hâlde bölüm kapatılamaz olurdu.
    fireEvent.click(screen.getByRole("button", { name: /Kitap künyesi/ }));
    expect(screen.queryByPlaceholderText("Yazar")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Ürün adı"), { target: { value: "Deneme" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByPlaceholderText("Yazar")).toBeNull();
  });
});

/* ══════════════ E-5 · vitrindeki müşteri filtresi ══════════════ */

describe("E-5 · vitrin tür filtresi", () => {
  it("kitaba özgü 'Basılı' yerine ürün türünü söyleyen etiket kullanır", async () => {
    sunucu("/store/config", { data: { low_stock_threshold: 5 } }, "get");
    sunucu("/store/categories", { data: [] }, "get");
    sunucu("/store/book-facets", { data: { publisher: [], author: [], cover_type: [] } }, "get");
    sunucu("/store/products", { data: [] }, "get");
    // Filtre paneli yalnız filtreleme modunda görünür → q ile gir.
    sar(`${PATHS.store}?q=kalem`, PATHS.store, <StorePage />);

    await screen.findByRole("button", { name: "Fiziksel ürün" });
    expect(screen.getByRole("button", { name: "Dijital ürün" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Basılı" })).toBeNull();
  });
});
