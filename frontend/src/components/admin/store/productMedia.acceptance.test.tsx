/**
 * Ürün galerisi yönetimi — GERÇEK istek gövdesi üzerinden kabul matrisi.
 *
 * Bu yüzey var olmadan önce çoklu görsel uçları API katmanında yazılıydı ama
 * hiçbir yerden çağrılmıyordu. Buradaki yalancı yeşil sınıfı da aynı: düğme
 * DOM'da görünür, tıklanır, HİÇBİR İSTEK GİTMEZ. Bu yüzden hiçbir iddia
 * "element var mı" ile yetinmez; her biri axios'a düşen isteğin metodunu,
 * yolunu ve GÖVDESİNİ okur.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { ProductMediaManager } from "@/components/admin/store/ProductMediaManager";
import { useToastStore } from "@/store/toastStore";
import type { ProductDetailOut, ProductImageOut } from "@/types";

import type { AxiosRequestConfig } from "axios";

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

let istekler: Istek[] = [];
let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    let body: Record<string, unknown> | null = null;
    if (typeof config.data === "string") {
      try {
        body = JSON.parse(config.data);
      } catch {
        body = null;
      }
    }
    istekler.push({
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      body,
    });
    return {
      data: urun(),
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useToastStore.setState({ toasts: [] });
});

function gorsel(id: number, over: Partial<ProductImageOut> = {}): ProductImageOut {
  return { id, url: `https://ornek/${id}.webp`, sort_order: id, ...over };
}

function urun(images: ProductImageOut[] = []): ProductDetailOut {
  return {
    id: 42,
    slug: "ornek",
    title: "Örnek Ürün",
    kind: "PHYSICAL",
    seller_type: "PLATFORM",
    price: "100.00",
    currency: "TRY",
    in_stock: true,
    rating_count: 0,
    cover_url: "https://ornek/kapak.webp",
    images,
  } as ProductDetailOut;
}

function sar(product: ProductDetailOut) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProductMediaManager product={product} />
    </QueryClientProvider>
  );
}

/** Bir uca giden SON istek. */
function sonIstek(parca: string, method?: string): Istek | undefined {
  return [...istekler]
    .reverse()
    .find(
      (i) =>
        i.url.includes(parca) && (method ? i.method === method.toLowerCase() : true)
    );
}

describe("ürün galerisi yönetimi", () => {
  it("galeri boşken yönlendirici bir boş durum gösterir", () => {
    sar(urun([]));
    expect(screen.getByText(/Henüz galeri görseli yok/)).toBeTruthy();
  });

  it("görselleri sıra numarasıyla listeler", () => {
    sar(urun([gorsel(1), gorsel(2), gorsel(3)]));
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("sağa alma, TAKAS EDİLMİŞ tam sırayı sunucuya gönderir", async () => {
    sar(urun([gorsel(11), gorsel(22), gorsel(33)]));

    fireEvent.click(screen.getByRole("button", { name: "1. görseli sağa al" }));

    await waitFor(() => {
      expect(sonIstek("/images/reorder", "patch")).toBeTruthy();
    });
    const istek = sonIstek("/images/reorder", "patch")!;
    expect(istek.url).toContain("/store/admin/products/42/images/reorder");
    // Yalnız takas edilen ikisi değil, TAM sıra gitmeli: sunucu eksikleri sona
    // alır ve kısmi dizi sessizce yeniden sıralama üretirdi.
    expect(istek.body).toEqual({ image_ids: [22, 11, 33] });
  });

  it("ilk görselde sola, son görselde sağa alma kapalıdır", () => {
    sar(urun([gorsel(11), gorsel(22)]));
    expect(
      (screen.getByRole("button", { name: "1. görseli sola al" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "2. görseli sağa al" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("silme TEK tıkla olmaz; önce onay ister", async () => {
    sar(urun([gorsel(11)]));

    fireEvent.click(screen.getByRole("button", { name: "Sil" }));

    // Onay adımı görünür ve HENÜZ istek gitmemiştir.
    expect(screen.getByText("Silinsin mi?")).toBeTruthy();
    expect(istekler.filter((i) => i.method === "delete")).toHaveLength(0);
  });

  it("onaydan sonra silme isteği gider", async () => {
    sar(urun([gorsel(11)]));

    fireEvent.click(screen.getByRole("button", { name: "Sil" }));
    fireEvent.click(screen.getByRole("button", { name: "Sil" }));

    await waitFor(() => {
      expect(sonIstek("/images/11", "delete")).toBeTruthy();
    });
    expect(sonIstek("/images/11", "delete")!.url).toContain(
      "/store/admin/products/42/images/11"
    );
  });

  it("vazgeçince silme isteği GİTMEZ", async () => {
    sar(urun([gorsel(11)]));

    fireEvent.click(screen.getByRole("button", { name: "Sil" }));
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));

    expect(screen.queryByText("Silinsin mi?")).toBeNull();
    expect(istekler.filter((i) => i.method === "delete")).toHaveLength(0);
  });

  it("alt metin değiştiyse blur'da kaydedilir", async () => {
    sar(urun([gorsel(11, { alt_text: "eski" })]));

    const alan = screen.getByLabelText("1. görselin alt metni");
    fireEvent.change(alan, { target: { value: "arka kapak" } });
    fireEvent.blur(alan);

    await waitFor(() => {
      expect(sonIstek("/images/11", "patch")).toBeTruthy();
    });
    expect(sonIstek("/images/11", "patch")!.body).toEqual({ alt_text: "arka kapak" });
  });

  it("alt metin DEĞİŞMEDİYSE istek gitmez", () => {
    sar(urun([gorsel(11, { alt_text: "arka kapak" })]));

    const alan = screen.getByLabelText("1. görselin alt metni");
    fireEvent.blur(alan);

    expect(istekler.filter((i) => i.method === "patch")).toHaveLength(0);
  });

  it("her galeri görselinin adlandırılmış bir alt metin alanı vardır", () => {
    sar(urun([gorsel(11), gorsel(22)]));
    expect(screen.getByLabelText("1. görselin alt metni")).toBeTruthy();
    expect(screen.getByLabelText("2. görselin alt metni")).toBeTruthy();
  });
});
