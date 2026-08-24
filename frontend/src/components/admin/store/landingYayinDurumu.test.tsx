/**
 * P4 · "Kaydettim" ile "yayınladım" AYNI ŞEY DEĞİL — panel bunu söylemeli.
 *
 * ## Neden
 *
 * P0 denetimi iki şey ölçtü:
 *
 *   1. Otomatik kayıt şeridi "Tüm değişiklikler kaydedildi" diyordu. Bu cümle
 *      doğru ama YANILTICI: kaydedilen şey TASLAKTIR, canlı mağaza
 *      değişmemiştir. Yönetici "kaydettim, oldu" sanıp yayınlamayı
 *      atlayabilir — ve bunu ancak müşteri fark eder.
 *   2. Her "şimdi yayınla" yeni bir revizyon VE yeni bir yayın penceresi
 *      üretiyor. Canlı sayfada 9 sürüm çipi ve 13 satırlık yayın takvimi
 *      birikmişti; hepsi aynı günün dakikaları (01:42, 01:43, 01:47…).
 *      Editör için okunabilir bir geçmiş değil, log dökümü.
 *
 * ## Ölçülen sözleşme
 *
 * Ekranda HER ZAMAN iki ayrı gerçek görünür: canlıda ne var, elimdeki taslak
 * ne durumda. Geçmiş (sona ermiş yayınlar, eski sürümler) varsayılan olarak
 * KAPALI durur ama SAYISIYLA görünür — gizlemek değil, katlamak.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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
  title: "Bölüm",
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

const REVIZYONLAR = [
  { id: 10, page_id: 1, version: 10, status: "DRAFT", title: "Mağaza", blocks: [BLOK] },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: 9 - i,
    page_id: 1,
    version: 9 - i,
    status: "PUBLISHED",
    title: "Mağaza",
    blocks: [BLOK],
  })),
];

/** Biri yayında, biri planlı, on biri sona ermiş — canlı veriyle aynı şekil. */
const YAYINLAR = [
  { id: 100, page_id: 1, revision_id: 9, starts_at: "2026-08-23T22:49:37Z", ends_at: null, state: "LIVE" },
  { id: 101, page_id: 1, revision_id: 10, starts_at: "2026-09-01T09:00:00Z", ends_at: null, state: "UPCOMING" },
  ...Array.from({ length: 11 }, (_, i) => ({
    id: 200 + i,
    page_id: 1,
    revision_id: i + 1,
    starts_at: `2026-08-23T01:4${i % 10}:00Z`,
    ends_at: `2026-08-23T01:5${i % 10}:00Z`,
    state: "ENDED" as const,
  })),
];

const ONIZLEME = {
  id: 1,
  slug: "ana-sayfa",
  internal_name: "Mağaza Ana Sayfası",
  page_type: "HOME",
  is_archived: false,
  state: "LIVE",
  revision: REVIZYONLAR[0],
};

const SAYFALAR = [
  {
    id: 1,
    internal_name: "Mağaza Ana Sayfası",
    slug: "ana-sayfa",
    page_type: "HOME",
    is_archived: false,
    state: "LIVE",
    latest_revision_id: 10,
    published_revision_id: 9,
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
      return cevap(REVIZYONLAR[0]);
    if (url.includes("/preview/")) return cevap(ONIZLEME);
    if (url.endsWith("/pages")) return cevap(SAYFALAR);
    if (url.includes("/publications")) return cevap(YAYINLAR);
    if (url.includes("/revisions")) return cevap(REVIZYONLAR);
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

describe("taslak ile yayın ayrımı", () => {
  it("durum şeridi CANLIDA ne olduğunu ve TASLAĞIN durumunu AYRI AYRI söyler", async () => {
    sar();
    const serit = await screen.findByTestId("yayin-durum-seridi");
    // Canlı taraf: hangi sürüm yayında.
    expect(within(serit).getByText(/Yayında/)).toBeTruthy();
    expect(within(serit).getByText(/v9/)).toBeTruthy();
    // Taslak tarafı: "kaydedildi" cümlesi TASLAĞA ait olduğunu söylemeli.
    // Yalnız "Tüm değişiklikler kaydedildi" demek yanıltıcıydı: kaydedilen
    // şey taslaktır, canlı mağaza değişmemiştir.
    expect(within(serit).getByText(/Taslak/)).toBeTruthy();
  });

  it("yayınlanmamış değişiklik olduğunu AÇIKÇA söyler", async () => {
    sar();
    const serit = await screen.findByTestId("yayin-durum-seridi");
    expect(within(serit).getByText(/yayınlanmamış|yayına alınmamış/i)).toBeTruthy();
  });

  it("sona ermiş yayınlar varsayılan olarak LİSTELENMEZ, sayısıyla katlanır", async () => {
    sar();
    await screen.findByTestId("yayin-durum-seridi");
    // Yayında ve planlı olan görünür.
    // TEST KUSURU NOTU (ölçüldü): satırlara duruma göre FARKLI testid
    // vermek, cevabı testid'e kodlar — sona ermiş kayıtlar açık listeye
    // sızsa bile "yayin-satiri" sayısı değişmez ve mutasyon YAKALANMAZ.
    // Bütün satırlar aynı testid'i taşır; durum ayrı bir nitelikte ölçülür.
    const acikListe = screen.getByTestId("yayin-acik-liste");
    const satirlar = within(acikListe).getAllByTestId("yayin-satiri");
    expect(satirlar).toHaveLength(2);
    expect(satirlar.map((s) => s.getAttribute("data-durum"))).toEqual([
      "LIVE",
      "UPCOMING",
    ]);
    // 11 sona ermiş kayıt açık listede DEĞİL; ama sayısı görünür.
    expect(screen.getByText(/Sona ermiş yayınlar \(11\)/)).toBeTruthy();
  });

  it("eski sürümler varsayılan olarak açık listede DEĞİL, sayısıyla katlanır", async () => {
    sar();
    await screen.findByTestId("yayin-durum-seridi");
    // Canlı sayfada 9 çip birikmişti; artık geçmiş katlanır.
    expect(screen.getByText(/Sürüm geçmişi \(10\)/)).toBeTruthy();
    // jsdom `<details>`in gizlemesini uygulamaz: kapalı olsa da içerik DOM'da
    // sorgulanabilir. Bu yüzden "yok mu" diye sormak YANLIŞ iddiadır —
    // ölçülmesi gereken şey çiplerin KATLANMIŞ bir bölümün içinde olduğudur.
    const cip = screen.getByRole("button", { name: /^v1 ·/ });
    const katlanan = cip.closest("details");
    expect(katlanan).toBeTruthy();
    expect(katlanan?.hasAttribute("open")).toBe(false);
  });
});
