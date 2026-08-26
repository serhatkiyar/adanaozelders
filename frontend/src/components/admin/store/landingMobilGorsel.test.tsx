/**
 * Mobil görsel alanı — render ve backend hazırdı, PANEL hiç açmıyordu.
 *
 * ## Neden
 *
 * `StoreLandingBlocks` hero/kart görsellerinde `<source media="(max-width:
 * 767px)" srcSet={mobile_image_url}>` basıyor, backend `_validate_block`
 * bu alanı doğruluyor ve tip tanımında var. Ama yönetici paneli alanı HİÇ
 * göstermiyordu: yani mobil görsel özelliği uçtan uca yazılmış, tek eksik
 * onu kullanma imkânıydı.
 *
 * Ölçülen etkisi somut: canlı ana sayfada hero metni GÖRSELİN İÇİNE gömülü
 * ve masaüstü görseli telefonda kırpıldığı için başlık okunmuyordu
 * ("Alışverişi / çeye Uygun / htiyaçları" — gerçek Chrome, 390 px).
 *
 * Bu, bu turda üçüncü kez görülen desendir (uyarılar panelde ölüydü, ölü
 * `composeLandingDraftPreview`): yetenek var, yüzey yok.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { LandingPagesManager } from "@/components/admin/store/LandingPagesManager";

import type { AxiosRequestConfig } from "axios";

let kaydedilen: any[] = [];
let eskiAdapter: unknown;

const MEDYA = [
  {
    id: 1,
    image_url: "http://localhost:9000/avatars/store-hero/masaustu.webp",
    alt_text: "masaüstü",
    width: 1600,
    height: 600,
    content_type: "image/webp",
    byte_size: 1000,
  },
  {
    id: 2,
    image_url: "http://localhost:9000/avatars/store-hero/mobil.webp",
    alt_text: "mobil",
    width: 800,
    height: 1000,
    content_type: "image/webp",
    byte_size: 900,
  },
];

const HERO = {
  id: 1,
  block_key: "hero",
  block_type: "HERO_CAROUSEL",
  title: "Hero başlık",
  description: "",
  link_label: "",
  link_url: null,
  config: {
    slides: [
      {
        image_url: MEDYA[0].image_url,
        mobile_image_url: null,
        alt_text: "masaüstü",
        fit: "cover",
      },
    ],
  },
  product_set_id: null,
  product_set_revision_id: null,
  is_active: true,
  sort_order: 0,
  products: [],
  categories: [],
  warnings: [],
};

const REVIZYON = {
  id: 5,
  page_id: 1,
  version: 5,
  status: "DRAFT",
  title: "Mağaza",
  seo_title: "",
  seo_description: "",
  og_image_url: null,
  blocks: [HERO],
};

const ONIZLEME = {
  id: 1,
  slug: "ana-sayfa",
  internal_name: "Mağaza Ana Sayfası",
  page_type: "HOME",
  is_archived: false,
  state: "DRAFT",
  revision: REVIZYON,
};

const SAYFALAR = [
  {
    id: 1,
    internal_name: "Mağaza Ana Sayfası",
    slug: "ana-sayfa",
    page_type: "HOME",
    is_archived: false,
    state: "DRAFT",
    latest_revision_id: 5,
    published_revision_id: null,
    has_unpublished_changes: true,
    updated_at: "2026-08-24T00:00:00Z",
  },
];

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  kaydedilen = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    const cevap = (data: unknown) =>
      ({ data, status: 200, statusText: "OK", headers: {}, config }) as never;
    if ((config.method ?? "get").toLowerCase() === "put") {
      kaydedilen.push(
        typeof config.data === "string" ? JSON.parse(config.data) : config.data,
      );
      return cevap({ ...REVIZYON, version: 6 });
    }
    if (url.includes("/preview/")) return cevap(ONIZLEME);
    if (url.endsWith("/pages")) return cevap(SAYFALAR);
    if (url.includes("/revisions")) return cevap([REVIZYON]);
    if (url.includes("/publications")) return cevap([]);
    if (url.includes("/media")) return cevap(MEDYA);
    if (url.includes("/product-sets")) return cevap([]);
    if (url.includes("/categories")) return cevap([]);
    return cevap([]);
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
});

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LandingPagesManager pageType="HOME" />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

describe("mobil görsel alanı", () => {
  it("her görsel öğesi için mobil görsel seçilebilir", async () => {
    sar();
    const dugme = await screen.findByRole(
      "button",
      { name: /1\. medya mobil görseli/i },
      { timeout: 4000 },
    );
    fireEvent.click(dugme);

    // Seçenek ÖLÇÜSÜYLE seçilir: "/mobil/i" hem "+ Mobil görsel" düğmesine
    // hem medya kutusuna uyuyor ve testi belirsiz bırakıyordu.
    const secenek = await screen.findByRole("button", { name: /800 × 1000/ });
    fireEvent.click(secenek);

    await waitFor(() => expect(kaydedilen.length).toBeGreaterThan(0), {
      timeout: 4000,
    });
    const slayt = kaydedilen.at(-1).blocks[0].config.slides[0];
    // Mobil adres YAZILMALI ve masaüstü adresi BOZULMAMALI.
    expect(slayt.mobile_image_url).toBe(MEDYA[1].image_url);
    expect(slayt.image_url).toBe(MEDYA[0].image_url);
  });

  it("seçili mobil görsel kaldırılabilir", async () => {
    sar();
    const dugme = await screen.findByRole(
      "button",
      { name: /1\. medya mobil görseli/i },
      { timeout: 4000 },
    );
    fireEvent.click(dugme);
    fireEvent.click(await screen.findByRole("button", { name: /800 × 1000/ }));
    await waitFor(() => expect(kaydedilen.length).toBeGreaterThan(0), {
      timeout: 4000,
    });

    kaydedilen = [];
    fireEvent.click(
      await screen.findByRole("button", { name: /1\. medya mobil görselini kaldır/i }),
    );
    await waitFor(() => expect(kaydedilen.length).toBeGreaterThan(0), {
      timeout: 4000,
    });
    expect(kaydedilen.at(-1).blocks[0].config.slides[0].mobile_image_url).toBeNull();
  });
});
