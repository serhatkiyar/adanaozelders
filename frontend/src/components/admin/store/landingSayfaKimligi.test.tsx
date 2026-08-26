/**
 * Sayfa kimliği (ad · adres · arşiv) düzenlenebilmeli.
 *
 * ## Neden
 *
 * Bir kampanya sayfası oluşturulduktan sonra adı, URL'i ve arşiv durumu
 * DEĞİŞTİRİLEMİYORDU. Yazım hatası yapan yönetici sayfayı düzeltemiyor,
 * kopya açmak zorunda kalıyordu (canlı veride `okula-donus` ve
 * `okula-donus-2` yan yana duruyor).
 *
 * Bu bir eksik özellik DEĞİL, dördüncü kez görülen "yetenek var, yüzey yok"
 * desenidir:
 *   • backend `PATCH /pages/{id}` (`LandingPageIdentityUpdate`) VAR,
 *   • slug değişince eski adresi yeni adrese taşıyan 308 yönlendirmesi VAR,
 *   • `api/storeMerchandising.ts::updateLandingPageIdentity` YAZILMIŞ,
 *   • ama hiçbir yerden ÇAĞRILMIYOR; hook yok, panelde alan yok.
 * Canlı veritabanında `store_landing_page_redirects` tablosu BOŞ — yani
 * yönlendirme mekanizması hiç çalışmamış.
 *
 * ## Ölçülen sözleşme
 *
 *   • Ad ve adres düzenlenebilir; kaydetmek GERÇEKTEN `PATCH` gönderir.
 *   • Adres değiştirilirken eski adresin yönlendirileceği SÖYLENİR — yönetici
 *     "bağlantılarım kırılacak mı" sorusunu tahmin etmek zorunda kalmaz.
 *   • Arşivleme ayrı bir eylemdir ve ne anlama geldiği yazılıdır.
 *   • Kimlik TASLAKTAN AYRI kaydedilir: taslak otomatik kaydedilir, adres
 *     değişikliği ise açık bir onayla gider (yanlışlıkla URL değiştirmek
 *     paylaşılmış bağlantıları etkiler).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { LandingPagesManager } from "@/components/admin/store/LandingPagesManager";

import type { AxiosRequestConfig } from "axios";

let patchler: { url: string; govde: any }[] = [];
let eskiAdapter: unknown;

const REVIZYON = {
  id: 5,
  page_id: 2,
  version: 5,
  status: "DRAFT",
  title: "Kampanya",
  seo_title: "",
  seo_description: "",
  og_image_url: null,
  blocks: [],
};

const SAYFA = {
  id: 2,
  internal_name: "Mağaza Okula Dönüş",
  slug: "okula-donus",
  page_type: "CAMPAIGN",
  is_archived: false,
  state: "DRAFT",
  latest_revision_id: 5,
  latest_version: 5,
  published_revision_id: null,
  has_unpublished_changes: true,
  updated_at: "2026-08-24T00:00:00Z",
};

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  patchler = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    const yontem = (config.method ?? "get").toLowerCase();
    const cevap = (data: unknown) =>
      ({ data, status: 200, statusText: "OK", headers: {}, config }) as never;
    if (yontem === "patch") {
      patchler.push({
        url,
        govde:
          typeof config.data === "string" ? JSON.parse(config.data) : config.data,
      });
      return cevap(SAYFA);
    }
    if (yontem === "put") return cevap({ ...REVIZYON, version: 6 });
    if (url.includes("/preview/"))
      return cevap({ ...SAYFA, revision: REVIZYON });
    if (url.endsWith("/pages")) return cevap([SAYFA]);
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
          <LandingPagesManager pageType="CAMPAIGN" />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

async function kimlikAlanlari() {
  const ad = await screen.findByLabelText(/sayfa adı/i, undefined, {
    timeout: 4000,
  });
  const adres = screen.getByLabelText(/adres/i);
  return { ad, adres };
}

describe("sayfa kimliği düzenleme", () => {
  it("mevcut ad ve adres düzenlenebilir alanlarda gelir", async () => {
    sar();
    const { ad, adres } = await kimlikAlanlari();
    expect((ad as HTMLInputElement).value).toBe("Mağaza Okula Dönüş");
    expect((adres as HTMLInputElement).value).toBe("okula-donus");
  });

  it("kaydetmek GERÇEKTEN PATCH gönderir", async () => {
    sar();
    const { ad, adres } = await kimlikAlanlari();
    fireEvent.change(ad, { target: { value: "Okula Dönüş 2027" } });
    fireEvent.change(adres, { target: { value: "okula-donus-2027" } });
    fireEvent.click(screen.getByRole("button", { name: /adresi ve adı kaydet/i }));

    await waitFor(() => expect(patchler.length).toBe(1), { timeout: 4000 });
    expect(patchler[0].url).toContain("/pages/2");
    expect(patchler[0].govde).toMatchObject({
      internal_name: "Okula Dönüş 2027",
      slug: "okula-donus-2027",
    });
  });

  it("adres değişince eski bağlantıların yönlendirileceği SÖYLENİR", async () => {
    sar();
    const { adres } = await kimlikAlanlari();
    fireEvent.change(adres, { target: { value: "yeni-adres" } });
    // Yönetici "paylaştığım bağlantılar kırılacak mı" sorusunu tahmin etmek
    // zorunda kalmamalı.
    expect(await screen.findByText(/eski adres.*yönlendir/i)).toBeTruthy();
  });

  it("arşivleme ayrı bir eylemdir ve ne yaptığı yazılıdır", async () => {
    sar();
    await kimlikAlanlari();
    const dugme = screen.getByRole("button", { name: /arşivle/i });
    fireEvent.click(dugme);
    await waitFor(() => expect(patchler.length).toBe(1), { timeout: 4000 });
    expect(patchler[0].govde).toMatchObject({ is_archived: true });
  });

  it("kimlik TASLAKTAN ayrı kaydedilir: alan değişikliği kendiliğinden PATCH atmaz", async () => {
    sar();
    const { adres } = await kimlikAlanlari();
    fireEvent.change(adres, { target: { value: "kazara-yazildi" } });
    // Taslak 900 ms'de bir otomatik kaydedilir; adres öyle DEĞİL. Yanlışlıkla
    // URL değiştirmek paylaşılmış bağlantıları etkiler, açık onay ister.
    await new Promise((r) => setTimeout(r, 1500));
    expect(patchler).toHaveLength(0);
  });
});
