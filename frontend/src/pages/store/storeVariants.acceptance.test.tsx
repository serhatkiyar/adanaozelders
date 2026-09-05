// Faz 3a · Vitrin varyant yüzeyi — UI kabul testleri (gerçek DOM + gerçek istek).
//
// Kanıtlanan davranışlar:
//   S-1 Detayda kardeş seçici: eksen adı GRUPTAN gelir, aktif üye işaretli,
//       tükenen üye listede kalır ve kardeşin sayfasına giden GERÇEK bir link
//       taşır.
//
//       GÜNCELLEME (eksen bazlı seçici): seçici artık kartezyen çarpımı düz
//       listeleyen bir şerit değil, EKSEN BAŞINA bir ızgaradır. Link semantiği
//       ve `aria-current` KORUNDU — iddiaların özü aynı; değişen, "Sarı / M"
//       gibi birleşik etiket yerine eksenin kendi değerinin yazılması ve
//       durumun (tükendi / bu seçimde yok) ERİŞİLEBİLİR ADDA taşınması.
//   S-2 Grupsuz üründe seçici çizilmez (mevcut detay birebir).
//   S-3 Mağaza filtresinde varyant ekseni facet kutusu veriden gelir ve seçim
//       GERÇEKTEN giden isteğe `variant=Eksen:Değer` olarak yansır.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Yük altındaki bekleme bütçesi — gerekçe `ticketsPaymentGate.test.tsx`te
 * (İP-A6b · Görev 5 · BULGU-10). Global `asyncUtilTimeout` kaldırıldı; bütçe
 * yalnız gerçekten yük-bağımlı olan bu iki dosyada, çağrı yerinde duruyor.
 */
const YUK = { timeout: 4000 };
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import ProductDetailPage from "@/pages/store/ProductDetailPage";
import StorePage from "@/pages/store/StorePage";
import { PATHS } from "@/lib/routes";
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

function sonIstek(parca: string): Istek | undefined {
  return [...istekler].reverse().find((i) => i.url.split("?")[0].includes(parca));
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
      // Dizi paramları TEKRARLI anahtar olarak kaydet — üretimdeki
      // paramsSerializer(indexes:null) davranışının aynası; tek string'e
      // katlamak "variant gerçekten çoklu gitti mi" sorusunu ölçülemez kılar.
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

const VARYANTLAR = {
  group_id: 7,
  title: "Fosforlu Kalem",
  option1_name: "Renk",
  option2_name: null,
  members: [
    { id: 101, slug: "fosforlu-sari", title: "Fosforlu Kalem - Sarı", option1_value: "Sarı", option2_value: null, variant_sort: 0, in_stock: true, price: "45.00" },
    { id: 102, slug: "fosforlu-pembe", title: "Fosforlu Kalem - Pembe", option1_value: "Pembe", option2_value: null, variant_sort: 1, in_stock: false, price: "45.00" },
  ],
};

function urunDetayi(over: Record<string, unknown> = {}) {
  return {
    id: 101,
    slug: "fosforlu-sari",
    title: "Fosforlu Kalem - Sarı",
    kind: "PHYSICAL",
    seller_type: "PLATFORM",
    price: "45.00",
    currency: "TRY",
    in_stock: true,
    stock: 12,
    rating_count: 0,
    status: "ACTIVE",
    images: [],
    variants: VARYANTLAR,
    ...over,
  };
}

function detaySunucusu(urun: Record<string, unknown>) {
  sunucu("/store/config", { data: { low_stock_threshold: 5 } }, "get");
  sunucu("/store/categories", { data: [] }, "get");
  sunucu("/store/delivery-info", { data: null }, "get");
  // DİKKAT sıra/desen: "/store/products" düz metni detay URL'sini de içerir;
  // liste rotası regex ile SONA sabitlenir, detay regex'i en son kaydedilir
  // (unshift → ilk denenen) ki detay isteği liste fixture'ına düşmesin.
  sunucu(/\/store\/products$/, { data: [] }, "get"); // ilgili ürünler rayı
  sunucu(/\/reviews\/distribution$/, { data: { count: 0, average: null, distribution: {} } }, "get");
  sunucu(/\/reviews$/, { data: [] }, "get");
  sunucu(/\/store\/products\/[^/]+$/, { data: urun }, "get");
}

function detayAc(slug = "fosforlu-sari") {
  return sar(`/magaza/urun/${slug}`, PATHS.storeProduct, <ProductDetailPage />);
}

describe("S-1 · detayda kardeş seçici", () => {
  it("eksen adı gruptan gelir; üyeler kardeş sayfasına giden gerçek link", async () => {
    detaySunucusu(urunDetayi());
    detayAc();
    await screen.findByRole("heading", { name: "Fosforlu Kalem - Sarı" }, YUK);
    // Eksen ızgarası grubun option1_name'iyle adlandırılır ve SEÇİLİ DEĞERİN
    // adı başlıkta yazılıdır ("Renk: Sarı") — 40 değerin altına 40 etiket
    // sığmaz, tek satır hem seçiliyi hem keşfi taşır.
    const izgara = screen.getByRole("group", { name: /Renk/ });
    expect(izgara.textContent).toContain("Sarı");

    // Seçim bir GEZİNMEDİR: kardeşin kendi slug'ı, kendi kanonik URL'i var.
    const pembe = screen.getByRole("link", { name: /Pembe/ });
    expect(pembe.getAttribute("href")).toBe("/magaza/urun/fosforlu-pembe");
  });

  it("aktif üye işaretli; tükenen üye listede kalır ve durumu ADINDA taşır", async () => {
    detaySunucusu(urunDetayi());
    detayAc();
    await screen.findByRole("heading", { name: "Fosforlu Kalem - Sarı" }, YUK);

    const sari = screen.getByRole("link", { name: /Sarı/ });
    expect(sari.getAttribute("aria-current")).toBe("page");

    // Tükenen kardeş GİZLENMEZ. Durum yalnız üstü çizili stille değil,
    // erişilebilir adla da taşınır: ekran okuyucu "soluk"u görmez ve renk
    // tek başına bilgi taşıyamaz (WCAG 1.4.1).
    const pembe = screen.getByRole("link", { name: /Pembe/ });
    expect(pembe.getAttribute("aria-label")).toContain("tükendi");
    expect(pembe.getAttribute("aria-current")).toBeNull();
  });
});

describe("S-2 · grupsuz üründe seçici yok", () => {
  it("variants null ise eksen başlığı çizilmez", async () => {
    detaySunucusu(urunDetayi({ variants: null }));
    detayAc();
    await screen.findByRole("heading", { name: "Fosforlu Kalem - Sarı" }, YUK);
    expect(screen.queryByText("Renk")).toBeNull();
  });
});

describe("S-4 · listede grup kartı (Faz 3b)", () => {
  it("variant_count>1 kartı 'başlayan' fiyat + Seçenekleri Gör linki basar; sepete ekle YOK", async () => {
    sunucu("/store/config", { data: { low_stock_threshold: 5 } }, "get");
    sunucu("/store/categories", { data: [] }, "get");
    sunucu("/store/book-facets", { data: { publisher: [], author: [], cover_type: [], variant_axes: {} } }, "get");
    sunucu(/\/store\/products$/, {
      data: [
        {
          id: 101, slug: "fosforlu-sari", title: "Fosforlu Kalem - Sarı",
          kind: "PHYSICAL", seller_type: "PLATFORM", price: "50.00",
          currency: "TRY", in_stock: true, stock: 0, rating_count: 0,
          status: "ACTIVE", variant_group_id: 7, variant_count: 3,
          group_min_price: "30.00",
        },
        {
          id: 200, slug: "tekil-defter", title: "Tekil Defter",
          kind: "PHYSICAL", seller_type: "PLATFORM", price: "40.00",
          currency: "TRY", in_stock: true, stock: 3, rating_count: 0,
          status: "ACTIVE", variant_count: 1,
        },
      ],
    }, "get");
    sar(`${PATHS.store}?q=kalem`, PATHS.store, <StorePage />);

    // Grup kartı: min fiyat + "başlayan" + seçime yönlendiren GERÇEK link.
    const link = await screen.findByRole("link", { name: /Seçenekleri Gör \(3\)/ }, YUK);
    expect(link.getAttribute("href")).toBe("/magaza/urun/fosforlu-sari");
    expect(screen.getByText(/'den başlayan/)).toBeTruthy();
    // Tekil kartta sepete ekle sürer; grup kartında buton yok (tek buton kaldı).
    expect(screen.getAllByRole("button", { name: "Sepete Ekle" })).toHaveLength(1);
  });
});

describe("S-3 · mağaza facet'i", () => {
  it("varyant ekseni kutusu veriden gelir; seçim GERÇEK isteğe variant paramı olarak yansır", async () => {
    sunucu("/store/config", { data: { low_stock_threshold: 5 } }, "get");
    sunucu("/store/categories", { data: [] }, "get");
    sunucu("/store/book-facets", {
      data: {
        publisher: [],
        author: [],
        cover_type: [],
        variant_axes: { Renk: [{ value: "Sarı", count: 3 }, { value: "Pembe", count: 1 }] },
      },
    }, "get");
    sunucu("/store/products", { data: [] }, "get");
    // Filtre paneli yalnız filtreleme modunda görünür → q ile gir.
    sar(`${PATHS.store}?q=kalem`, PATHS.store, <StorePage />);

    const kutu = await screen.findByText("Renk", undefined, YUK);
    expect(kutu).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Sarı/ }));
    await waitFor(() => {
      const istek = sonIstek("/store/products");
      expect(istek).toBeDefined();
      expect(istek!.params.getAll("variant")).toEqual(["Renk:Sarı"]);
    }, YUK);
  });
});
