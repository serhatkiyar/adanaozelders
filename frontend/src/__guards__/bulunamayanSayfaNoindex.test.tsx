/**
 * Detay sayfalarında `noindex` YALNIZ kayıt gerçekten yokken (teknik SEO
 * denetimi, 28 Eyl 2026).
 *
 * Blog yazısı, ürün, kütüphane, eğitmen profili ve kök ilan/ders adresi SPA'dır:
 * kaldırılmış/olmayan kayıt HTTP 200 ile açılır ve "bulunamadı" yazar. Denetimde
 * bu ekranlar meta basmıyordu (yumuşak 404, ana sayfanın jenerik başlığıyla
 * dizinlenebilirdi); düzeltme `noindex` ekledi. İkinci tur: `noindex` her hata
 * dalına basılıyordu — geçici bir 5xx/ağ kopması Googlebot'un çizimine denk
 * gelirse GEÇERLİ sayfa dizinden düşerdi. Sözleşme (`lib/seo.ts::detayDurumu`):
 *
 *   404            → noindex VAR
 *   500 / ağ hatası → noindex YOK (hata ekranı aynen kalır, meta uydurulmaz)
 *   başarı          → noindex YOK
 *
 * Her durumda aynı bekleme yapılır (ekran işareti + Helmet'in rAF'teki head
 * yazımı); 404 satırının noindex'i GÖRMESİ, beklemenin "yok" iddialarında da
 * yeterli olduğunu kanıtlar.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { AxiosError, type AxiosRequestConfig } from "axios";
import type { ReactElement } from "react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { PATHS } from "@/lib/routes";
import { bulunamadiMi, detayDurumu } from "@/lib/seo";
import LibraryDetail from "@/pages/LibraryDetail";
import PublicTutorProfile from "@/pages/PublicTutorProfile";
import BlogPostPage from "@/pages/blog/BlogPostPage";
import KokAdres from "@/pages/seo/KokAdres";
import ProductDetailPage from "@/pages/store/ProductDetailPage";

type Kip = "404" | "500" | "ag" | "basari";

const EGITMEN = {
  id: 42,
  display_name: "Ali",
  headline: "Seyhan LGS matematik dersleri",
  hourly_rate: 300,
  subjects: [],
  districts: [],
  rating_avg: 0,
  rating_count: 0,
  first_lesson_free: false,
};

interface Sayfa {
  ad: string;
  yol: string;
  desen: string;
  oge: ReactElement;
  /** Sayfanın kaydı getiren ana ucu; hata kiplerinde YALNIZ bu düşer. */
  ana: RegExp;
  /** Başarılı yanıtta ana uç ne döner (url → veri; eşleşmezse `[]`). */
  basari: (url: string) => unknown;
  /** Hata ekranının işareti (bulunamadı/geçici hata aynı ekranı çizer). */
  hataIsareti: RegExp;
  /** Başarı ekranının işareti. */
  basariIsareti: RegExp;
}

const SAYFALAR: Sayfa[] = [
  {
    ad: "blog yazısı",
    yol: "/blog/sinav-haftasi",
    desen: PATHS.blogPost,
    oge: <BlogPostPage />,
    ana: /^\/blog\/posts\/[^/]+$/,
    basari: (url) =>
      url.startsWith("/blog/posts/")
        ? {
            id: 1,
            slug: "sinav-haftasi",
            title: "Sınav haftası planı",
            excerpt: "Kısa özet",
            body_html: "<p>Gövde</p>",
            tags: [],
            published_at: "2026-09-01T00:00:00Z",
            cover_image_url: null,
            seo_title: null,
            seo_description: null,
          }
        : undefined,
    hataIsareti: /Yazı bulunamadı/,
    basariIsareti: /Sınav haftası planı/,
  },
  {
    ad: "ürün",
    yol: "/magaza/urun/fosforlu-sari",
    desen: PATHS.storeProduct,
    oge: <ProductDetailPage />,
    ana: /^\/store\/products\/[^/]+$/,
    basari: (url) =>
      /\/store\/products\/[^/]+$/.test(url)
        ? {
            id: 101,
            slug: "fosforlu-sari",
            title: "Fosforlu Kalem",
            kind: "PHYSICAL",
            seller_type: "PLATFORM",
            price: "45.00",
            currency: "TRY",
            in_stock: true,
            stock: 12,
            rating_count: 0,
            status: "ACTIVE",
            images: [],
            variants: null,
          }
        : url.endsWith("/reviews/distribution")
          ? { count: 0, average: null, distribution: {} }
          : url === "/store/config"
            ? { low_stock_threshold: 5, shipping_free_threshold: "500.0", shipping_flat_fee: "49.9" }
            : url === "/store/delivery-info"
              ? null
              : undefined,
    hataIsareti: /Ürün bulunamadı/,
    basariIsareti: /Fosforlu Kalem/,
  },
  {
    ad: "kütüphane",
    yol: "/kutuphaneler/merkez",
    desen: PATHS.library,
    oge: <LibraryDetail />,
    ana: /^\/libraries\/merkez$/,
    basari: (url) =>
      url === "/libraries/merkez"
        ? {
            id: 1,
            slug: "merkez",
            name: "Merkez Kütüphanesi",
            district: "Seyhan",
            city: "Adana",
            is_active: true,
            amenities: [],
            photos: [],
            hours: [],
            rating_avg: 0,
            rating_count: 0,
          }
        : url.endsWith("/reviews/distribution")
          ? null
          : undefined,
    hataIsareti: /Tüm kütüphaneler/,
    basariIsareti: /Merkez Kütüphanesi/,
  },
  {
    ad: "eğitmen profili (eski adres)",
    yol: "/egitmenler/ali-42",
    desen: PATHS.tutor,
    oge: <PublicTutorProfile />,
    ana: /^\/tutors\/42$/,
    basari: (url) =>
      url === "/tutors/42"
        ? EGITMEN
        : url.includes("distribution")
          ? null
          : undefined,
    hataIsareti: /Öğretmen bulunamadı/,
    basariIsareti: /Seyhan LGS matematik dersleri/,
  },
  {
    ad: "kök ilan adresi",
    yol: "/seyhan-lgs-matematik",
    desen: "/:kokSlug",
    oge: <KokAdres />,
    ana: /^\/seo\/sayfa$/,
    basari: (url) =>
      url === "/seo/sayfa"
        ? {
            tur: "ilan",
            yol: "/seyhan-lgs-matematik",
            tutor_id: 42,
            url_slug: "seyhan-lgs-matematik",
            baslik: "Seyhan LGS matematik dersleri | Adana Matematik Özel Ders",
            aciklama: "Ali, Seyhan'da matematik özel dersi veriyor.",
            kirintilar: [],
            json_ld: [],
          }
        : url === "/tutors/42"
          ? EGITMEN
          : url.includes("distribution")
            ? null
            : undefined,
    hataIsareti: /Aradığınız sayfa bulunamadı/,
    basariIsareti: /Seyhan LGS matematik dersleri/,
  },
];

let eskiAdapter: unknown;
let kip: Kip = "404";
let sayfa: Sayfa = SAYFALAR[0];

function hata(config: AxiosRequestConfig, durum: number | null): AxiosError {
  if (durum === null) {
    return new AxiosError("Network Error", "ERR_NETWORK", config as never);
  }
  const yanit = {
    data: { detail: durum === 404 ? "Bulunamadı." : "Sunucu hatası." },
    status: durum,
    statusText: String(durum),
    headers: {},
    config,
  };
  return new AxiosError(String(durum), "ERR_BAD_RESPONSE", config as never, null, yanit as never);
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url).split("?")[0];
    const ana = sayfa.ana.test(url);
    // Hata kiplerinde YALNIZ sayfanın ana ucu düşer; yan uçlar boş döner.
    if (ana && kip === "404") throw hata(config, 404);
    if (ana && kip === "500") throw hata(config, 500);
    if (ana && kip === "ag") throw hata(config, null);
    return {
      data: kip === "basari" ? (sayfa.basari(url) ?? []) : [],
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
});

function ciz(s: Sayfa) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[s.yol]}>
          <Routes>
            <Route path={s.desen} element={s.oge} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

const robots = () =>
  document.head.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";

/** Helmet head'i requestAnimationFrame'de yazar; iki kare bekle. */
const headYazildi = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

describe.each(SAYFALAR)("$ad", (s) => {
  it.each<[Kip, boolean]>([
    ["404", true],
    ["500", false],
    ["ag", false],
    ["basari", false],
  ])("%s → noindex: %s", async (k, beklenen) => {
    kip = k;
    sayfa = s;
    ciz(s);
    // Ekran işareti ya başlıkta ya gövdede; ikisinden biri görünene dek bekle.
    await screen.findAllByText(k === "basari" ? s.basariIsareti : s.hataIsareti);
    await headYazildi();
    expect(robots().includes("noindex")).toBe(beklenen);
  });
});

describe("detayDurumu", () => {
  const e404 = hata({}, 404);
  const e500 = hata({}, 500);
  const eAg = hata({}, null);

  it("durumları ayırır", () => {
    expect(detayDurumu({ isLoading: true, data: undefined, error: null })).toBe("loading");
    expect(detayDurumu({ isLoading: false, data: { id: 1 }, error: null })).toBe("success");
    expect(detayDurumu({ isLoading: false, data: undefined, error: e404 })).toBe("not_found");
    expect(detayDurumu({ isLoading: false, data: undefined, error: e500 })).toBe("temporary_error");
    expect(detayDurumu({ isLoading: false, data: undefined, error: eAg })).toBe("temporary_error");
    // Sorgu hiç açılmadı (geçersiz id/slug): adres bir kayda çıkmıyor.
    expect(detayDurumu({ isLoading: false, data: undefined, error: null })).toBe("not_found");
  });

  it("yalnız 404/410 'bulunamadı' sayılır", () => {
    expect(bulunamadiMi(e404)).toBe(true);
    expect(bulunamadiMi(hata({}, 410))).toBe(true);
    expect(bulunamadiMi(e500)).toBe(false);
    expect(bulunamadiMi(eAg)).toBe(false);
    expect(bulunamadiMi(new Error("x"))).toBe(false);
  });
});
