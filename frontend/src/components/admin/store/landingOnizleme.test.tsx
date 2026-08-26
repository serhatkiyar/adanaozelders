/**
 * P5 · Yan yana canlı önizleme.
 *
 * ## Neden
 *
 * Önizleme bugüne kadar "yeni sekmede aç" düğmesiydi: yönetici düzenliyor,
 * sekme değiştiriyor, geri dönüyor. Sektör deseni yan yana çalışmaktır
 * (Sanity Presentation, Storyblok görsel editör): solda form, sağda gerçek
 * sayfa, kaydettikçe tazelenir.
 *
 * Tıkla-düzenle (içeriğe gömülü kaynak damgası ile sayfadaki öğeden ilgili
 * alana atlama) BİLİNÇLİ olarak KAPSAM DIŞI: ayrı bir katman ve ayrı bir
 * paket.
 *
 * ## Ölçülen sözleşme
 *
 *   • Önizleme açılabilir ve açılınca GERÇEK sayfayı gösteren bir çerçeve
 *     basılır (erişilebilir adı olan bir `iframe`).
 *   • Çerçeve doğru sayfanın önizleme adresini yükler.
 *   • Taslak kaydedildiğinde çerçeve TAZELENİR — aksi hâlde yan yana
 *     önizleme yanlış bir şey gösterir ki bu, hiç önizleme olmamasından
 *     daha kötüdür.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { LandingPagesManager } from "@/components/admin/store/LandingPagesManager";

import type { AxiosRequestConfig } from "axios";

let eskiAdapter: unknown;

const BLOK = {
  id: 1,
  block_key: "b1",
  block_type: "RICH_TEXT",
  title: "Bölüm başlık",
  description: "",
  link_label: "",
  link_url: null,
  config: { content: "merhaba" },
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
  seo_title: "Mağaza",
  seo_description: "",
  og_image_url: null,
  blocks: [BLOK],
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
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    const cevap = (data: unknown) =>
      ({ data, status: 200, statusText: "OK", headers: {}, config }) as never;
    if ((config.method ?? "get").toLowerCase() === "put")
      return cevap({ ...REVIZYON, version: 6 });
    if (url.includes("/preview/")) return cevap(ONIZLEME);
    if (url.endsWith("/pages")) return cevap(SAYFALAR);
    if (url.includes("/revisions")) return cevap([REVIZYON]);
    if (url.includes("/publications")) return cevap([]);
    if (url.includes("/media")) return cevap([]);
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

async function onizlemeyiAc() {
  // Bütçe ŞART: panel monte olurken beş sorgu birden çözülüyor ve tam suite
  // paralel yükünde varsayılan 1000 ms yetmiyor (ölçüldü — bu test tek
  // başına geçip suite içinde düştü). Diğer panel-mount kabul testleriyle
  // aynı hizada.
  const dugme = await screen.findByRole(
    "button",
    { name: /Önizlemeyi (aç|göster)/i },
    { timeout: 4000 },
  );
  fireEvent.click(dugme);
  return screen.findByTitle(/canlı önizleme/i);
}

describe("yan yana önizleme", () => {
  it("kapalıyken çerçeve YOK; açılınca gerçek sayfa çerçevesi basılır", async () => {
    sar();
    await screen.findByRole(
      "button",
      { name: /Önizlemeyi (aç|göster)/i },
      { timeout: 4000 },
    );
    // Varsayılan KAPALI: her panel açılışında bir sayfa daha yüklemek
    // gereksiz; yönetici istediğinde açar.
    expect(screen.queryByTitle(/canlı önizleme/i)).toBeNull();

    const cerceve = await onizlemeyiAc();
    expect(cerceve.tagName.toLowerCase()).toBe("iframe");
  });

  it("çerçeve DOĞRU sayfanın önizlemesini yükler", async () => {
    sar();
    const cerceve = await onizlemeyiAc();
    // Sayfa kimliği ŞART: yalnız "bir iframe var" demek yanlış sayfayı
    // gösteren bir önizlemeyi de geçerdi.
    expect(cerceve.getAttribute("src")).toMatch(/\/yonetim\/magaza\/onizleme\/1/);
  });

  it("taslak kaydedilince çerçeve TAZELENİR", async () => {
    sar();
    const cerceve = await onizlemeyiAc();
    const ilkAdres = cerceve.getAttribute("src");

    const girdi = await screen.findByDisplayValue("Bölüm başlık");
    fireEvent.change(girdi, { target: { value: "Yeni başlık" } });

    // Otomatik kayıt 900 ms sonra; ardından çerçeve yeni sürümü göstermeli.
    await waitFor(
      () => expect(cerceve.getAttribute("src")).not.toBe(ilkAdres),
      { timeout: 4000 },
    );
  });
});
