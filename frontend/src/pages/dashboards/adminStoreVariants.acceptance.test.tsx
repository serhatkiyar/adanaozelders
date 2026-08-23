// Faz 2 · Varyant admin arayüzü — UI kabul testleri (gerçek DOM + gerçek istek gövdesi).
//
// `adminStorePanel.acceptance.test.tsx` sözleşme dosyasıdır ve düzenlenmez;
// varyant yüzeyi bu AYRI dosyada aynı harness deseniyle (İP-4/İP-12: axios
// adapter'ı değiştirilir, GERÇEKTEN gönderilen gövde doğrulanır) test edilir.
//
// Kanıtlanan davranışlar:
//   V-1 Varyant bölümü ürün formunda var; eksen adları SÖZLÜKTEN açılır menü
//       olarak gelir (serbest metin girişi YOK).
//   V-2 Kitap kategorisi seçilince varyant bölümü kaybolur, açıklama gelir.
//   V-3 Grup + değer + barkod ile kayıt, alanları GERÇEK POST gövdesinde taşır.
//   V-4 Grup seçilince kardeş listesi (grup üyeleri) görünür.
//   V-5 "Varyant türet" gerçek derive-variant isteğini doğru gövdeyle atar.
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

function magaza() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ROUTES.adminStoreProducts]}>
        <Routes>
          <Route path={ROUTES.adminStoreProducts} element={<AdminStore />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

const KATEGORILER = [
  { id: 10, slug: "sinav-kitaplari", name: "Sınav Kitapları", parent_id: null, sort_order: 0, product_count: 3 },
  { id: 11, slug: "yks-kitaplari", name: "YKS Kitapları", parent_id: 10, sort_order: 0, product_count: 3 },
  { id: 20, slug: "kirtasiye", name: "Kırtasiye", parent_id: null, sort_order: 1, product_count: 5 },
];

const CONFIG = {
  axes: ["Renk", "Ebat", "Uç Kalınlığı", "Çizgi Tipi", "Yaprak Sayısı", "Kapak Tipi", "Gramaj", "Paket Adedi"],
  book_root_slugs: ["kitap", "sinav-kitaplari", "okula-yardimci"],
};

const GRUP = { id: 7, title: "Fosforlu Kalem", option1_name: "Renk", option2_name: null, member_count: 2 };
const GRUP_DETAY = {
  ...GRUP,
  members: [
    { id: 101, title: "Fosforlu Kalem - Sarı", option1_value: "Sarı", option2_value: null, variant_sort: 0, price: "45.00", stock: 12, status: "ACTIVE", sku: "FZK-000101", barcode: "8690001" },
    { id: 102, title: "Fosforlu Kalem - Pembe", option1_value: "Pembe", option2_value: null, variant_sort: 1, price: "45.00", stock: 3, status: "ACTIVE", sku: "FZK-000102", barcode: "8690002" },
  ],
};

function temelSunucu() {
  sunucu("/store/config", { data: { low_stock_threshold: 5 } }, "get");
  sunucu("/store/book-facets", { data: { publisher: [], author: [], cover_type: [] } }, "get");
  sunucu("/store/admin/products", { data: [], headers: { "x-total-count": "0" } }, "get");
  sunucu("/store/categories", { data: KATEGORILER }, "get");
  sunucu("/store/admin/variant-config", { data: CONFIG }, "get");
  sunucu("/store/admin/variant-groups", { data: [GRUP] }, "get");
  sunucu(`/store/admin/variant-groups/${GRUP.id}`, { data: GRUP_DETAY }, "get");
}

async function formuAc() {
  fireEvent.click(await screen.findByRole("button", { name: "Yeni ürün" }));
  await screen.findByLabelText("Ürün adı");
}

async function varyantBolumunuAc() {
  // Düzenleme modunda bölüm zaten açık başlar (üyelikli ürün) ama modal verisi
  // async gelir — "kapalı" ile "henüz yüklenmedi" karışmasın diye önce kısa
  // süre açık hâli beklenir; gelmezse toggle'a basılır (oluşturma modu).
  try {
    await screen.findByLabelText("Varyant grubu", {}, { timeout: 1500 });
    return;
  } catch {
    fireEvent.click(
      await screen.findByRole("button", { name: /Varyantlar \(renk, ebat…\)/ })
    );
    await screen.findByLabelText("Varyant grubu");
  }
}

async function grupSec(id: number) {
  // Seçenekler async yüklenir; option DOM'a gelmeden change no-op olur
  // (jsdom değeri ""ya çevirir) — önce option beklenir.
  await screen.findByRole("option", { name: /Fosforlu Kalem \(/ });
  fireEvent.change(screen.getByLabelText("Varyant grubu"), {
    target: { value: String(id) },
  });
}

describe("V-1 · eksen adları sözlükten açılır menü", () => {
  it("yeni grup satırındaki eksen seçenekleri variant-config'ten gelir; serbest metin girişi yoktur", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    magaza();
    await formuAc();
    await varyantBolumunuAc();

    fireEvent.change(screen.getByLabelText("Varyant grubu"), {
      target: { value: "__yeni__" },
    });
    const eksen1 = (await screen.findByLabelText("1. eksen")) as HTMLSelectElement;
    const adlar = Array.from(eksen1.options).map((o) => o.textContent);
    for (const beklenen of CONFIG.axes) {
      expect(adlar).toContain(beklenen);
    }
    // Select'tir, input değil: sözlük dışı ad YAZILAMAZ.
    expect(eksen1.tagName).toBe("SELECT");
  });

  it("grup oluşturma gerçek POST gövdesini sözlük adıyla atar", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/variant-groups", { status: 201, data: { ...GRUP, id: 8, member_count: 0 } }, "post");
    magaza();
    await formuAc();
    await varyantBolumunuAc();

    fireEvent.change(screen.getByLabelText("Varyant grubu"), {
      target: { value: "__yeni__" },
    });
    fireEvent.change(
      await screen.findByLabelText("Grup adı"),
      { target: { value: "Spiralli Defter" } }
    );
    fireEvent.change(screen.getByLabelText("1. eksen"), { target: { value: "Ebat" } });
    fireEvent.change(screen.getByLabelText("2. eksen (opsiyonel)"), {
      target: { value: "Çizgi Tipi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grubu oluştur" }));

    await waitFor(() => {
      const istek = sonIstek("/store/admin/variant-groups", "post");
      expect(istek).toBeDefined();
      expect(istek!.body).toMatchObject({
        title: "Spiralli Defter",
        option1_name: "Ebat",
        option2_name: "Çizgi Tipi",
      });
    });
  });
});

describe("V-2 · kitap kategorisinde varyant alanları kapalı", () => {
  it("kitap kökü altındaki kategori seçilince bölüm kaybolur ve açıklama gelir", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    magaza();
    await formuAc();
    // Önce kırtasiyede bölüm var…
    expect(
      screen.getByRole("button", { name: /Varyantlar \(renk, ebat…\)/ })
    ).toBeTruthy();
    // …kitap yaprağı (YKS Kitapları → kökü sinav-kitaplari) seçilince yok.
    // Kategori seçenekleri async yüklenir; option gelmeden change no-op olur.
    await screen.findByRole("option", { name: "YKS Kitapları" });
    fireEvent.change(screen.getByLabelText(/^Kategori/), { target: { value: "11" } });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Varyantlar \(renk, ebat…\)/ })
      ).toBeNull();
    });
    expect(
      screen.getByText(/Kitap kategorisinde varyant açılamaz/)
    ).toBeTruthy();
  });
});

describe("V-3 · varyant alanları gerçek POST gövdesinde", () => {
  it("grup + değer + barkod ürün oluşturma isteğiyle gider", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { status: 201, data: { id: 999 } }, "post");
    magaza();
    await formuAc();

    fireEvent.change(screen.getByLabelText("Ürün adı"), {
      target: { value: "Fosforlu Kalem - Turuncu" },
    });
    fireEvent.change(screen.getByLabelText("Fiyat (TL)"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("KDV oranı (%)"), {
      target: { value: "20" },
    });
    await screen.findByRole("option", { name: "Kırtasiye" });
    fireEvent.change(screen.getByLabelText(/^Kategori/), {
      target: { value: "20" },
    });
    await varyantBolumunuAc();
    await grupSec(GRUP.id);
    fireEvent.change(
      await screen.findByLabelText("Barkod"),
      { target: { value: "8690099" } }
    );
    fireEvent.change(screen.getByLabelText("Renk"), {
      target: { value: "Turuncu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ürünü ekle" }));

    await waitFor(() => {
      const istek = sonIstek("/store/admin/products", "post");
      expect(istek).toBeDefined();
      expect(istek!.body).toMatchObject({
        variant_group_id: GRUP.id,
        option1_value: "Turuncu",
        barcode: "8690099",
      });
    });
  });

  it("barkodsuz gruplu kayıt istek atmadan formda reddedilir", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    magaza();
    await formuAc();
    fireEvent.change(screen.getByLabelText("Ürün adı"), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByLabelText("Fiyat (TL)"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("KDV oranı (%)"), {
      target: { value: "20" },
    });
    await varyantBolumunuAc();
    await grupSec(GRUP.id);
    fireEvent.change(await screen.findByLabelText("Renk"), {
      target: { value: "Turuncu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ürünü ekle" }));

    // İP-A6 · KASITLI DEĞİŞİKLİK: hata artık toast'ta DEĞİL, ALANIN altında.
    // Gerekçe (İP-A2 hata yönlendirme sözleşmesi): alan doğrulama hatası genel
    // kanala gitmez — kullanıcı hangi kutuyu düzelteceğini kutunun kendisinde
    // görmeli. Korunan davranış aynı ve asıl iddia da odur: istek GİTMEZ.
    const barkod = (await screen.findByLabelText("Barkod")) as HTMLInputElement;
    await waitFor(() => expect(barkod.getAttribute("aria-invalid")).toBe("true"));
    const mesajId = barkod.getAttribute("aria-describedby");
    expect(mesajId).toBeTruthy();
    expect(document.getElementById(mesajId!)?.textContent).toMatch(/barkod/i);
    // Alan hatası genel kanala SIZMAZ.
    expect(useToastStore.getState().toasts.some((t) => /barkod/i.test(t.message))).toBe(false);
    expect(sonIstek("/store/admin/products", "post")).toBeUndefined();
  });
});

describe("V-4 · kardeş listesi", () => {
  it("grup seçilince üyeler değer + fiyatla listelenir", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    magaza();
    await formuAc();
    await varyantBolumunuAc();
    await grupSec(GRUP.id);
    await screen.findByText("Gruptaki varyantlar");
    expect(screen.getByText(/Fosforlu Kalem - Sarı/)).toBeTruthy();
    expect(screen.getByText(/Fosforlu Kalem - Pembe/)).toBeTruthy();
  });
});

describe("V-5 · varyant türetme", () => {
  it("düzenlenen gruplu üründe türet formu gerçek derive-variant isteğini atar", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    const kayit = {
      id: 101,
      slug: "fosforlu-sari",
      title: "Fosforlu Kalem - Sarı",
      kind: "PHYSICAL",
      seller_type: "PLATFORM",
      price: "45.00",
      tax_rate: "0.2000",
      currency: "TRY",
      in_stock: true,
      stock: 12,
      rating_count: 0,
      status: "ACTIVE",
      images: [],
      variant_group_id: GRUP.id,
      option1_value: "Sarı",
      variant_sort: 0,
      barcode: "8690001",
      category_id: 20,
    };
    sunucu("/store/admin/products", { data: [kayit], headers: { "x-total-count": "1" } }, "get");
    sunucu("/store/admin/products/101", { data: kayit }, "get");
    sunucu("/store/admin/products/101/derive-variant", {
      status: 201,
      data: { ...kayit, id: 103, title: "Fosforlu Kalem - Mavi", status: "DRAFT" },
    }, "post");
    // Düzenleme modalındaki StockLedgerPanel gerçek uçlarını çağırır; jenerik
    // `[]` fallback'i `.map` ile çöker ve tüm modal render'ı düşerdi.
    sunucu(/stock-movements/, { data: { items: [], total: 0, limit: 10, offset: 0 } }, "get");
    sunucu(/stock-verify/, { data: { consistent: true, problems: [], product_id: 101 } }, "get");
    magaza();

    // Yük altındaki bekleme bütçesi (İP-A7d2 · Görev 5). Ürün listesi
    // sorgusu paralel yük altında 1000 ms'lik varsayılanın dibine değiyor;
    // ölçüm ve gerekçe `adminHakedisGoc.acceptance.test.tsx`in başında.
    // MASAÜSTÜ tablosuna daraltıldı (İP-B2): `renderMobileRow` bağlandığı
    // için aynı satırın aksiyonları hem tabloda hem mobil kartta basılıyor.
    // İDDİA DEĞİŞMEDİ — hangi yüzeyden tıklandığı bu testin konusu değil,
    // konusu türetme isteğinin gerçekten gitmesi.
    fireEvent.click(
      within(await screen.findByRole("table", {}, { timeout: 4000 })).getByRole("button", {
        name: "Düzenle",
      })
    );
    await varyantBolumunuAc();
    fireEvent.click(
      await screen.findByRole("button", { name: /Bu üründen yeni varyant türet/ })
    );
    fireEvent.change(await screen.findByLabelText("Yeni Renk"), {
      target: { value: "Mavi" },
    });
    fireEvent.change(screen.getByLabelText("Yeni barkod"), {
      target: { value: "8690003" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Türet" }));

    await waitFor(() => {
      const istek = sonIstek("/derive-variant", "post");
      expect(istek).toBeDefined();
      expect(istek!.body).toMatchObject({
        option1_value: "Mavi",
        barcode: "8690003",
      });
    });
  });
});
