/**
 * P3 · Panelin davranışı KAYIT DEFTERİNİN BİR FONKSİYONUDUR.
 *
 * Karakterizasyon testi (`landingBlockEditor.characterization.test.tsx`)
 * bugünkü 7 tipi ADIYLA sabitler — regresyon nöbetçisidir. Bu dosya farklı
 * bir şey yapar: iddiaları `BLOK_SEMASI` üzerinde DÖNGÜYLE kurar. Yani
 * şemaya sekizinci bir giriş eklendiği anda kapsam kendiliğinden genişler.
 *
 * Paketin vaadi tam olarak buydu: "yeni blok tipi eklemek = tek dosyaya tek
 * giriş". Bir sözleşme ancak onu ölçen bir test varsa vaattir; yoksa yalnız
 * bir yorum satırıdır.
 *
 * Ölçülen iki şey:
 *   1. Palet, şemadaki HER tipi (adı ve açıklamasıyla) listeler.
 *   2. Bir blok seçilince editör YALNIZ o tipin beyan ettiği alanları çizer;
 *      başka tiplerin alanları GÖRÜNMEZ. (Şemadan üretilen editörde en kolay
 *      kaçan hata, bir alanın yanlış tipte de çizilmesidir.)
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { LandingPagesManager } from "@/components/admin/store/LandingPagesManager";
import { BLOK_SEMASI, BLOK_TIPLERI, medyaAlani } from "@/lib/storeBlockSchema";

import type { AxiosRequestConfig } from "axios";

let eskiAdapter: unknown;

const KATEGORILER = [
  { id: 3, name: "Kitaplar", slug: "kitaplar", parent_id: null, is_active: true },
];
const KOLEKSIYONLAR = [
  { id: 7, name: "Çok satanlar", description: "", is_active: true, matched_count: 5 },
];

/** Şemadaki HER tip için bir blok — liste elle tutulmaz. */
const BLOKLAR = BLOK_TIPLERI.map((tip, i) => ({
  id: i + 1,
  block_key: `k-${tip}`,
  block_type: tip,
  title: `${tip} başlık`,
  description: "",
  link_label: "",
  link_url: null,
  config: BLOK_SEMASI[tip].varsayilanConfig(),
  product_set_id: null,
  product_set_revision_id: null,
  is_active: true,
  sort_order: i * 10,
  products: [],
  categories: [],
  warnings: [],
}));

const ONIZLEME = {
  id: 1,
  slug: "ana-sayfa",
  internal_name: "Mağaza Ana Sayfası",
  page_type: "HOME",
  is_archived: false,
  state: "DRAFT",
  revision: {
    id: 5,
    page_id: 1,
    version: 5,
    status: "DRAFT",
    title: "Mağaza",
    seo_title: "Mağaza",
    seo_description: "",
    og_image_url: null,
    blocks: BLOKLAR,
  },
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
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    const cevap = (data: unknown) =>
      ({ data, status: 200, statusText: "OK", headers: {}, config }) as never;
    if ((config.method ?? "get").toLowerCase() === "put")
      return cevap({ ...ONIZLEME.revision, version: 6 });
    if (url.includes("/preview/")) return cevap(ONIZLEME);
    if (url.endsWith("/pages")) return cevap(SAYFALAR);
    if (url.includes("/revisions")) return cevap([ONIZLEME.revision]);
    if (url.includes("/media")) return cevap([]);
    if (url.includes("/product-sets")) return cevap(KOLEKSIYONLAR);
    if (url.includes("/categories")) return cevap(KATEGORILER);
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

async function blokSec(tip: string) {
  await waitFor(
    () => {
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(`${tip} başlık`) }),
      );
      expect(screen.getByDisplayValue(`${tip} başlık`)).toBeTruthy();
    },
    { timeout: 4000 },
  );
}

/** Şemadaki tüm görsel-olmayan alan etiketleri (çakışma tespiti için). */
const TUM_ETIKETLER = new Set(
  BLOK_TIPLERI.flatMap((tip) =>
    BLOK_SEMASI[tip].alanlar
      .filter((alan) => alan.tur !== "medya")
      .map((alan) => alan.etiket),
  ),
);

describe("şema sürücüsü", () => {
  it("palet şemadaki HER tipi listeler", async () => {
    sar();
    await screen.findByText(/Sayfadaki bölümler/i);
    for (const tip of BLOK_TIPLERI) {
      const tanim = BLOK_SEMASI[tip];
      expect(screen.getAllByText(tanim.ad).length).toBeGreaterThan(0);
      expect(screen.getAllByText(tanim.aciklama).length).toBeGreaterThan(0);
    }
  });

  for (const tip of BLOK_TIPLERI) {
    const tanim = BLOK_SEMASI[tip];
    it(`${tip} yalnız beyan ettiği alanları çizer`, async () => {
      sar();
      await blokSec(tip);
      const kok = screen.getByRole("article");

      const kendiEtiketleri = new Set(
        tanim.alanlar
          .filter((alan) => alan.tur !== "medya")
          .map((alan) => alan.etiket),
      );
      for (const etiket of kendiEtiketleri) {
        expect(
          within(kok).getByText(new RegExp(`^${etiket}$`)),
        ).toBeTruthy();
      }
      // Başka tiplerin alanları BURADA OLMAMALI.
      for (const etiket of TUM_ETIKETLER) {
        if (kendiEtiketleri.has(etiket)) continue;
        expect(within(kok).queryByText(new RegExp(`^${etiket}$`))).toBeNull();
      }

      // Görsel alanı: şema ne diyorsa panel onu yapmalı.
      const gorsel = medyaAlani(tip);
      const dugme = within(kok).queryByRole("button", {
        name: /Görsel(i)? (ekle|değiştir)/i,
      });
      if (gorsel) expect(dugme).toBeTruthy();
      else expect(dugme).toBeNull();
    });
  }

  it("kopyalanamaz olarak beyan edilen blok kopyalanamaz", async () => {
    const tekiller = BLOK_TIPLERI.filter(
      (tip) => !BLOK_SEMASI[tip].kopyalanabilir,
    );
    // Bugün yalnız RECENTLY_VIEWED tekil; liste şemadan geldiği için yeni bir
    // tekil blok eklenirse bu iddia kendiliğinden onu da kapsar.
    expect(tekiller.length).toBeGreaterThan(0);
    sar();
    for (const tip of tekiller) {
      await blokSec(tip);
      const kok = screen.getByRole("article");
      expect(within(kok).queryByRole("button", { name: "Kopyala" })).toBeNull();
    }
  });
});
