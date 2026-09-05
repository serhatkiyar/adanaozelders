/**
 * Varyant matrisi — GERÇEK istek gövdesi üzerinden kabul matrisi.
 *
 * Buradaki yalancı yeşil sınıfı: tablo DOM'da görünür, "oluştur"a basılır,
 * gönderilen gövde ya eksiktir (zaten var olan kombinasyonu da içerir) ya da
 * hiç gitmez. Bu yüzden her iddia axios'a düşen isteğin gövdesini okur.
 *
 * Ayrıca KİLİTLİ KARARIN nöbeti burada: gönder düğmesi geçerlilikle
 * KAPANMAZ — basılır, sebep şeritte yazar, odak ilk eksik alana gider.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { VariantMatrixPanel } from "@/components/admin/store/VariantMatrixPanel";
import { useToastStore } from "@/store/toastStore";
import type { ProductDetailOut, VariantMatrixPreview } from "@/types";

import type { AxiosRequestConfig } from "axios";

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

let istekler: Istek[] = [];
let eskiAdapter: unknown;
let onizlemeYaniti: VariantMatrixPreview;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  onizlemeYaniti = {
    group_id: 5,
    option1_name: "Renk",
    option2_name: "Ebat",
    cells: [
      { option1_value: "Kırmızı", option2_value: "S", existing_product_id: 99 },
      { option1_value: "Kırmızı", option2_value: "M", existing_product_id: null },
      { option1_value: "Mavi", option2_value: "S", existing_product_id: null },
      { option1_value: "Mavi", option2_value: "M", existing_product_id: null },
    ],
    new_count: 3,
    existing_count: 1,
    limit: 200,
  };
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    let body: Record<string, unknown> | null = null;
    if (typeof config.data === "string") {
      try {
        body = JSON.parse(config.data);
      } catch {
        body = null;
      }
    }
    istekler.push({ method: (config.method ?? "get").toLowerCase(), url, body });
    const data = url.includes("/preview")
      ? onizlemeYaniti
      : { created: 3, product_ids: [201, 202, 203] };
    return { data, status: 200, statusText: "OK", headers: {}, config } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useToastStore.setState({ toasts: [] });
});

function urun(): ProductDetailOut {
  return {
    id: 42,
    slug: "kalem",
    title: "Fosforlu Kalem",
    kind: "PHYSICAL",
    seller_type: "PLATFORM",
    price: "34.90",
    currency: "TRY",
    in_stock: true,
    rating_count: 0,
    images: [],
    variant_group_id: 5,
    variants: {
      group_id: 5,
      title: "Fosforlu Kalem",
      option1_name: "Renk",
      option2_name: "Ebat",
      members: [],
    },
  } as unknown as ProductDetailOut;
}

function sar(product: ProductDetailOut = urun()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <VariantMatrixPanel product={product} />
    </QueryClientProvider>
  );
}

function chipEkle(eksen: string, ...degerler: string[]) {
  const alan = screen.getByLabelText(eksen);
  for (const d of degerler) {
    fireEvent.change(alan, { target: { value: d } });
    fireEvent.keyDown(alan, { key: "Enter" });
  }
}

async function onizlemeyeGec() {
  chipEkle("Renk", "Kırmızı", "Mavi");
  chipEkle("Ebat", "S", "M");
  fireEvent.click(screen.getByRole("button", { name: "Önizle" }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /varyant oluştur/ })).toBeTruthy();
  });
}

function sonIstek(parca: string): Istek | undefined {
  return [...istekler].reverse().find((i) => i.url.includes(parca));
}

describe("varyant matrisi", () => {
  it("gruplu olmayan üründe matris yerine gerekçe gösterir", () => {
    const p = { ...urun(), variants: null } as ProductDetailOut;
    sar(p);
    expect(screen.getByText(/bir varyant grubunda değil/i)).toBeTruthy();
  });

  it("eksen adları GRUPTAN gelir, sabit değil", () => {
    sar();
    expect(screen.getByLabelText("Renk")).toBeTruthy();
    expect(screen.getByLabelText("Ebat")).toBeTruthy();
  });

  it("canlı sayaç üretimden ÖNCE kaç varyant doğacağını söyler", () => {
    sar();
    chipEkle("Renk", "Kırmızı", "Mavi");
    chipEkle("Ebat", "S", "M", "L");
    expect(screen.getByText(/6 varyant/)).toBeTruthy();
    expect(screen.getByText(/\(2 × 3\)/)).toBeTruthy();
  });

  it("yapıştırılan virgüllü metin tek seferde parçalanır", () => {
    sar();
    const alan = screen.getByLabelText("Renk");
    fireEvent.paste(alan, {
      clipboardData: { getData: () => "Kırmızı, Mavi, Siyah" },
    });
    expect(screen.getByRole("button", { name: "Kırmızı değerini kaldır" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Siyah değerini kaldır" })).toBeTruthy();
  });

  it("önizleme eksen değerlerini GERÇEKTEN gönderir", async () => {
    sar();
    await onizlemeyeGec();
    const istek = sonIstek("/variant-matrix/preview")!;
    expect(istek.method).toBe("post");
    expect(istek.body).toEqual({
      option1_values: ["Kırmızı", "Mavi"],
      option2_values: ["S", "M"],
    });
  });

  it("zaten var olan kombinasyon işaretlenir ve doldurulamaz", async () => {
    sar();
    await onizlemeyeGec();
    expect(screen.getByText("Zaten var, atlanacak")).toBeTruthy();
    // Var olan satırın barkod alanı hiç çizilmez.
    expect(screen.queryByLabelText("Kırmızı / S barkodu")).toBeNull();
    expect(screen.getByLabelText("Kırmızı / M barkodu")).toBeTruthy();
  });

  it("yeni satırlar ürünün temel fiyatıyla ÖN-DOLDURULUR", async () => {
    sar();
    await onizlemeyeGec();
    expect(
      (screen.getByLabelText("Mavi / S fiyatı") as HTMLInputElement).value
    ).toBe("34.90");
  });

  it("gönder düğmesi geçerlilikle KAPANMAZ; basılınca sebep yazar ve istek GİTMEZ", async () => {
    sar();
    await onizlemeyeGec();

    const olustur = screen.getByRole("button", {
      name: /varyant oluştur/,
    }) as HTMLButtonElement;
    // Kilitli karar: ölü düğme yok.
    expect(olustur.disabled).toBe(false);

    fireEvent.click(olustur);

    expect(screen.getByRole("alert").textContent).toMatch(/barkod girin/i);
    expect(istekler.filter((i) => i.url.endsWith("/variant-matrix"))).toHaveLength(0);
  });

  it("geçersiz gönderimde odak İLK eksik barkod alanına taşınır", async () => {
    sar();
    await onizlemeyeGec();
    fireEvent.click(screen.getByRole("button", { name: /varyant oluştur/ }));
    expect(document.activeElement).toBe(screen.getByLabelText("Kırmızı / M barkodu"));
  });

  it("aynı barkod iki satırda kullanılırsa gönderim durur", async () => {
    sar();
    await onizlemeyeGec();
    for (const ad of ["Kırmızı / M", "Mavi / S", "Mavi / M"]) {
      fireEvent.change(screen.getByLabelText(`${ad} barkodu`), {
        target: { value: "8690000000001" },
      });
    }
    fireEvent.click(screen.getByRole("button", { name: /varyant oluştur/ }));

    expect(screen.getByRole("alert").textContent).toMatch(/aynı barkod/i);
    expect(istekler.filter((i) => i.url.endsWith("/variant-matrix"))).toHaveLength(0);
  });

  it("toplu fiyat tüm YENİ satırlara uygulanır", async () => {
    sar();
    await onizlemeyeGec();
    fireEvent.change(screen.getByLabelText("Tümüne fiyat uygula"), {
      target: { value: "49.90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Uygula" }));

    for (const ad of ["Kırmızı / M", "Mavi / S", "Mavi / M"]) {
      expect((screen.getByLabelText(`${ad} fiyatı`) as HTMLInputElement).value).toBe(
        "49.90"
      );
    }
  });

  it("üretim YALNIZ yeni kombinasyonları, girilen değerlerle gönderir", async () => {
    sar();
    await onizlemeyeGec();
    const barkodlar: Record<string, string> = {
      "Kırmızı / M": "8690000000001",
      "Mavi / S": "8690000000002",
      "Mavi / M": "8690000000003",
    };
    for (const [ad, kod] of Object.entries(barkodlar)) {
      fireEvent.change(screen.getByLabelText(`${ad} barkodu`), {
        target: { value: kod },
      });
    }
    fireEvent.change(screen.getByLabelText("Mavi / M stoğu"), {
      target: { value: "7" },
    });

    fireEvent.click(screen.getByRole("button", { name: /varyant oluştur/ }));

    await waitFor(() => {
      expect(sonIstek("/variant-matrix")).toBeTruthy();
    });
    const govde = istekler.find((i) => i.url.endsWith("/variant-matrix"))!.body as {
      rows: Record<string, unknown>[];
    };
    // Zaten var olan "Kırmızı / S" gövdeye GİRMEZ.
    expect(govde.rows).toHaveLength(3);
    expect(govde.rows.map((r) => `${r.option1_value} / ${r.option2_value}`)).toEqual([
      "Kırmızı / M",
      "Mavi / S",
      "Mavi / M",
    ]);
    expect(govde.rows[0]).toMatchObject({
      barcode: "8690000000001",
      price: "34.90",
      stock: 0,
    });
    expect(govde.rows[2]).toMatchObject({ stock: 7 });
  });
});
