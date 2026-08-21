// Tedarikçi paneli — GERÇEK DOM davranışı.
//
// `StockLedgerPanel.test.tsx` deseni: gerçek render, gerçek istekler (axios
// adapter üzerinden gözlenir). Ölçülen şey yöneticinin EKRANDA gördüğü sonuç.
//
// Bu panelin üç sessiz hata sınıfı var ve üçü de tip sistemiyle yakalanamaz:
//
// 1. **Token kutusu mevcut değeri ön-doldurursa** sır ekranda görünür — ve
//    forma dokunmadan kaydeden yönetici onu geri gönderir.
// 2. **`suppliers.manage` yokken düğmeler görünürse** kullanıcı tıklar, 403
//    alır ve panelin bozuk olduğunu düşünür. Salt-okunur yüzey açıkça
//    söylenmeli (`ReadOnlyNotice` deseni).
// 3. **Son hata gösterilmezse** senkron günlerce durur ve hiç kimse fark etmez;
//    vitrindeki "stokta" bilgisi bayatlar. Bu, paketin en pahalı sessiz hatası.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/api/axios";
import { SupplierPanel } from "@/components/admin/store/SupplierPanel";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

type Istek = {
  url: string;
  method: string;
  data: unknown;
  params: Record<string, unknown>;
};

let istekler: Istek[] = [];
let eskiAdapter: unknown;
let yanitlar: Array<[RegExp, unknown]> = [];

const TEDARIKCI = {
  id: 3,
  provider: "yildirim",
  name: "Yıldırım Dağıtım",
  is_enabled: true,
  base_url: "https://b2b.yildirimdagitim.com/api/vitrin",
  has_token: true,
  token_expires_at: "2026-12-01T00:00:00+00:00",
  stock_interval_seconds: 60,
  price_interval_seconds: 21600,
  last_stock_sync_ok_at: "2026-08-22T09:00:00+00:00",
  last_price_sync_ok_at: "2026-08-22T06:00:00+00:00",
  last_error: null as string | null,
  last_error_at: null as string | null,
  consecutive_failures: 0,
  cooldown_until: null as string | null,
  linked_count: 12,
  unmatched_count: 4,
};

function sar(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

function izinVer(izinler: string[]) {
  useAuthStore.setState({
    user: { id: 1, role_id: 1, admin_permissions: izinler } as never,
  });
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  yanitlar = [[/suppliers$/, [TEDARIKCI]], [/products/, []]];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    istekler.push({
      url,
      method: String(config.method ?? "get").toLowerCase(),
      data: typeof config.data === "string" ? JSON.parse(config.data) : config.data,
      params: (config.params ?? {}) as Record<string, unknown>,
    });
    const eslesme = yanitlar.find(([re]) => re.test(url));
    return {
      data: eslesme ? eslesme[1] : {},
      status: 200,
      statusText: "OK",
      headers: { "x-total-count": "0" },
      config,
    } as never;
  };
  izinVer(["suppliers.view", "suppliers.manage"]);
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null } as never);
  vi.restoreAllMocks();
});

// ── Durum şeridi ──

describe("durum", () => {
  it("son başarılı senkron zamanını gösterir", async () => {
    sar(<SupplierPanel />);
    await waitFor(() => expect(screen.getByText(/Yıldırım Dağıtım/)).toBeTruthy());
    expect(screen.getByTestId("tedarikci-durum")).toBeTruthy();
    expect(screen.getByTestId("son-stok-senkronu").textContent).toBeTruthy();
  });

  it("son hatayı GÖRÜNÜR biçimde bildirir", async () => {
    yanitlar = [
      [
        /suppliers$/,
        [
          {
            ...TEDARIKCI,
            last_error: "Yıldırım sunucusuna ulaşılamadı (502)",
            last_error_at: "2026-08-22T09:30:00+00:00",
            consecutive_failures: 3,
          },
        ],
      ],
      [/products/, []],
    ];
    sar(<SupplierPanel />);
    await waitFor(() =>
      expect(screen.getByText(/ulaşılamadı \(502\)/)).toBeTruthy(),
    );
  });

  it("devre kesici açıkken beklemede olduğunu söyler", async () => {
    yanitlar = [
      [
        /suppliers$/,
        [
          {
            ...TEDARIKCI,
            cooldown_until: new Date(Date.now() + 600_000).toISOString(),
            consecutive_failures: 4,
          },
        ],
      ],
      [/products/, []],
    ];
    sar(<SupplierPanel />);
    await waitFor(() => expect(screen.getByTestId("devre-kesici")).toBeTruthy());
  });

  it("token yoksa uyarır", async () => {
    yanitlar = [
      [/suppliers$/, [{ ...TEDARIKCI, has_token: false, token_expires_at: null }]],
      [/products/, []],
    ];
    sar(<SupplierPanel />);
    await waitFor(() => expect(screen.getByTestId("token-durumu")).toBeTruthy());
    expect(screen.getByTestId("token-durumu").textContent).toMatch(/girilmemiş|yok/i);
  });

  it("token yakında dolacaksa uyarır", async () => {
    const yakin = new Date(Date.now() + 3 * 86_400_000).toISOString();
    yanitlar = [
      [/suppliers$/, [{ ...TEDARIKCI, token_expires_at: yakin }]],
      [/products/, []],
    ];
    sar(<SupplierPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("token-durumu").textContent).toMatch(/3 gün/),
    );
  });
});

// ── Yetki ──

describe("yetki", () => {
  it("yalnız görüntüleme izniyle yazma düğmeleri GİZLENİR", async () => {
    izinVer(["suppliers.view"]);
    sar(<SupplierPanel />);
    await waitFor(() => expect(screen.getByText(/Yıldırım Dağıtım/)).toBeTruthy());

    expect(screen.queryByRole("button", { name: /stoğu senkronla/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /kaydet/i })).toBeNull();
    // Sessizce gizlemek yetmez: kullanıcı neden düzenleyemediğini bilmeli.
    expect(screen.getByTestId("salt-okunur")).toBeTruthy();
  });

  it("yönetim izniyle düğmeler görünür", async () => {
    sar(<SupplierPanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stoğu senkronla/i })).toBeTruthy(),
    );
    expect(screen.queryByTestId("salt-okunur")).toBeNull();
  });
});

// ── Token kutusu ──

describe("token kutusu", () => {
  it("mevcut token ASLA ön-doldurulmaz", async () => {
    sar(<SupplierPanel />);
    const kutu = await screen.findByLabelText(/API token/i);
    expect((kutu as HTMLTextAreaElement).value).toBe("");
    // Ekranın hiçbir yerinde token benzeri bir dizi görünmemeli.
    expect(document.body.textContent).not.toMatch(/eyJhbG/);
  });
});

// ── Elle senkron ──

describe("elle senkron", () => {
  it("düğme gerçek isteği üretir", async () => {
    const kullanici = userEvent.setup();
    sar(<SupplierPanel />);
    const dugme = await screen.findByRole("button", { name: /stoğu senkronla/i });
    await kullanici.click(dugme);

    await waitFor(() => {
      const istek = istekler.find((i) => i.url.includes("/sync"));
      expect(istek).toBeTruthy();
      expect(istek?.method).toBe("post");
      expect((istek?.data as { scope: string }).scope).toBe("stock");
    });
  });
});

// ── Eşleşmemiş favoriler ──

describe("eşleşmemiş favoriler", () => {
  const EŞLEŞMEMİŞ = {
    id: 91,
    external_code: "ÇINARDEF 11003",
    name: "Çınar Okul Defteri A5",
    brand: "ÇINAR",
    barcode: "8695894110038",
    barcode_valid: true,
    unit_name: "Düzine",
    stock_qty: "12.500",
    cost_gross: "168.30",
    quarantine_flags: ["BIRIM_ADET_DEGIL"],
    product_id: null,
    product: null,
    link_source: null,
    is_favorite: true,
  };

  it("bağlanmamış satırları listeler ve birim uyarısını gösterir", async () => {
    yanitlar = [
      [/suppliers\/\d+\/products/, [EŞLEŞMEMİŞ]],
      [/suppliers$/, [TEDARIKCI]],
    ];
    sar(<SupplierPanel />);
    await waitFor(() =>
      expect(screen.getByText(/Çınar Okul Defteri A5/)).toBeTruthy(),
    );
    // Birim adet değilse "12,5" sayısı tek başına yanıltıcıdır.
    expect(screen.getByText(/Düzine/)).toBeTruthy();
  });

  it("eşleşmemişler için linked=false query'si gönderilir", async () => {
    sar(<SupplierPanel />);
    await waitFor(() => {
      const istek = istekler.find((i) => i.url.includes("/products"));
      expect(istek).toBeTruthy();
    });
    const istek = istekler.find((i) => i.url.includes("/products"))!;
    // Axios parametreleri `config.params`'ta taşır; URL dizgisine bakmak
    // filtre düşse bile yeşil kalan bir test üretirdi.
    expect(istek.params.linked).toBe(false);
  });
});
