// İP-12 · A12 — ürün seçici (sayım oturumu + hasar kaydı). Gerçek DOM.
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.
// Kırmızı matris commit'inde seçici henüz yoktur: ilk koşum KIRMIZIDIR.
//
// ## Neden
//
// Bugün sayım oturumu açarken yönetici "Ürün numaraları" kutusuna `12, 34, 56`
// yazıyor; hasar kaydında ise `type="number"` bir kutuya ham ürün ID'si
// giriliyor. İkisi de yöneticinin ürün numarasını BAŞKA bir ekrandan not
// etmesini gerektiriyor — ve yanlış numara sessizce yanlış ürünü sayıma alır.
// `CountSessionDetailPage`'in kendi yorumu bunu zaten kayda geçirmiş:
// "Ürün adı/SKU gösterilemiyor: sayım uçları yalnız product_id taşıyor".
//
// A12, A5'in aramasının üzerine oturur: arama varsa seçici küçük bir iştir.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import CountSessionsPage from "@/pages/admin/inventory/CountSessionsPage";
import DamageEventsPage from "@/pages/admin/inventory/DamageEventsPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";

import type { AxiosRequestConfig } from "axios";

interface Istek {
  method: string;
  url: string;
  params: URLSearchParams;
  body: Record<string, unknown> | null;
}

let istekler: Istek[] = [];
let rotalar: { esles: (i: Istek) => boolean; yanit: unknown }[] = [];
let eskiAdapter: unknown;

function sunucu(desen: string, data: unknown, method?: string) {
  rotalar.unshift({
    esles: (i) =>
      (method ? i.method === method.toLowerCase() : true) &&
      i.url.split("?")[0].includes(desen),
    yanit: data,
  });
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  rotalar = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const params = new URLSearchParams(String(config.url).split("?")[1] ?? "");
    for (const [k, v] of Object.entries(
      (config.params ?? {}) as Record<string, unknown>
    )) {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    }
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      params,
      body: config.data ? JSON.parse(String(config.data)) : null,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    return {
      data: rota ? rota.yanit : [],
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  useToastStore.setState({ toasts: [] });
});

function izinVer(...kodlar: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

function sar(yol: string, element: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Routes>
          <Route path={yol} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const GEOMETRI = {
  id: 42,
  slug: "geometri",
  title: "Geometri Soru Bankası",
  kind: "PHYSICAL",
  seller_type: "PLATFORM",
  price: "180.00",
  currency: "TRY",
  in_stock: true,
  stock: 12,
  rating_count: 0,
  status: "ACTIVE",
  author: "Ahmet Yılmaz",
  publisher: "Palme Yayınları",
  sku: "FZK-000042",
};

/** Seçiciyi arama sonucuyla besleyen sunucu. */
function aramaSunucusu(sonuc: unknown[] = [GEOMETRI]) {
  sunucu("/store/admin/products", sonuc, "get");
  // Gerçek uç `/inventory/count-sessions` — ilk yazımda `/inventory/counts`
  // varsaymıştım ve test kendi yanlış fixture'ına bakıp "istek gitmedi"
  // diyordu. Uç adı ölçülerek düzeltildi.
  sunucu("/inventory/count-sessions", [], "get");
  sunucu("/inventory/damages", [], "get");
  sunucu("/inventory/overview", {}, "get");
}

describe("S-1 · sayım oturumunda ürün ARAMAYLA seçilir", () => {
  it("ham 'ürün numaraları' kutusu KALDIRILDI", async () => {
    izinVer("inventory.view", "inventory.count");
    aramaSunucusu();

    sar(ROUTES.adminInventoryCounts, <CountSessionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /yeni sayım/i }));

    const kapsam = await screen.findByLabelText(/kapsam/i);
    fireEvent.change(kapsam, { target: { value: "MANUAL" } });

    expect(
      screen.queryByLabelText(/ürün numaraları/i),
      "ham ID kutusu duruyor — yönetici ürün numarasını başka ekrandan not " +
        "etmek zorunda ve yanlış numara sessizce yanlış ürünü sayıma alır"
    ).toBeNull();
  });

  it("aramaya yazınca ürün adı ve SKU ile aday listelenir", async () => {
    izinVer("inventory.view", "inventory.count");
    aramaSunucusu();

    sar(ROUTES.adminInventoryCounts, <CountSessionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /yeni sayım/i }));
    fireEvent.change(await screen.findByLabelText(/kapsam/i), {
      target: { value: "MANUAL" },
    });

    const arama = await screen.findByLabelText(/ürün ara/i);
    fireEvent.change(arama, { target: { value: "geometri" } });

    // Aday, ADIYLA görünmeli: seçicinin bütün amacı ID okumayı bitirmek.
    expect(await screen.findByText(/Geometri Soru Bankası/)).toBeTruthy();
    expect(
      istekler.some((i) => i.params.get("q") === "geometri"),
      "arama sunucuya gitmedi"
    ).toBe(true);
  });

  it("seçilen ürün oturuma product_ids olarak GÖNDERİLİR", async () => {
    izinVer("inventory.view", "inventory.count");
    aramaSunucusu();
    sunucu("/inventory/count-sessions", { id: 900, status: "DRAFT" }, "post");

    sar(ROUTES.adminInventoryCounts, <CountSessionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /yeni sayım/i }));
    fireEvent.change(await screen.findByLabelText(/kapsam/i), {
      target: { value: "MANUAL" },
    });
    fireEvent.change(await screen.findByLabelText(/ürün ara/i), {
      target: { value: "geometri" },
    });
    fireEvent.click(await screen.findByText(/Geometri Soru Bankası/));

    fireEvent.click(await screen.findByRole("button", { name: /oturumu aç|oluştur/i }));

    // Mutation ASENKRON: tıklamadan hemen sonra `istekler`e bakmak isteği
    // henüz yolda yakalar ve test "istek gitmedi" der (ilk yazımda tam olarak
    // bu oldu). İstek gerçekten gidene kadar beklenir.
    const gonderim = await waitFor(() => {
      const bulunan = istekler.find(
        (i) => i.method === "post" && i.url.includes("/inventory/count-sessions")
      );
      expect(bulunan, "oturum açma isteği gitmedi").toBeTruthy();
      return bulunan!;
    });
    expect(
      (gonderim.body as { product_ids?: number[] })?.product_ids,
      "seçilen ürün gövdeye girmedi"
    ).toEqual([42]);
  });
});

describe("S-2 · seçilenler görünür ve kaldırılabilir", () => {
  it("seçilen ürün listede görünür ve kaldırılınca gövdeden düşer", async () => {
    izinVer("inventory.view", "inventory.count");
    aramaSunucusu();
    sunucu("/inventory/count-sessions", { id: 901, status: "DRAFT" }, "post");

    sar(ROUTES.adminInventoryCounts, <CountSessionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /yeni sayım/i }));
    fireEvent.change(await screen.findByLabelText(/kapsam/i), {
      target: { value: "MANUAL" },
    });
    fireEvent.change(await screen.findByLabelText(/ürün ara/i), {
      target: { value: "geometri" },
    });
    fireEvent.click(await screen.findByText(/Geometri Soru Bankası/));

    // Seçilenler bölgesi: adayla karışmaması için kendi bölümünde aranır.
    const secilenler = await screen.findByRole("list", { name: /seçilen ürünler/i });
    expect(within(secilenler).getByText(/Geometri Soru Bankası/)).toBeTruthy();

    fireEvent.click(within(secilenler).getByRole("button", { name: /kaldır/i }));

    // Liste boşalınca bileşen hiç render edilmiyor; eski DOM referansı
    // (`secilenler`) koparılmış bir düğüm olarak içeriğini korur ve onun
    // üzerinden sorgu yapmak "hâlâ duruyor" der. Doğru ölçüm, bölümün
    // EKRANDAN kalkmış olmasıdır.
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: /seçilen ürünler/i })).toBeNull()
    );

    fireEvent.click(await screen.findByRole("button", { name: /oturumu aç|oluştur/i }));
    // Seçim boşken oturum açılamaz (buton disabled) — yani hiç POST gitmemeli.
    // Ölçüt bu: "kaldır" ekrandan silmekle kalmıyor, gövdeyi de boşaltıyor.
    await new Promise((r) => setTimeout(r, 50));
    const gonderim = istekler.find(
      (i) => i.method === "post" && i.url.includes("/inventory/count-sessions")
    );
    expect(
      (gonderim?.body as { product_ids?: number[] })?.product_ids ?? [],
      "kaldırılan ürün hâlâ gövdede — ekrandan silmek yetmiyor"
    ).toEqual([]);
  });
});

describe("S-3 · hasar kaydında aynı seçici", () => {
  it("ham sayı kutusu yerine arama ile ürün seçilir", async () => {
    izinVer("inventory.view", "inventory.apply");
    aramaSunucusu();

    sar(ROUTES.adminInventoryDamage, <DamageEventsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /hasara ayır/i }));

    const arama = await screen.findByLabelText(/ürün ara/i);
    fireEvent.change(arama, { target: { value: "geometri" } });
    fireEvent.click(await screen.findByText(/Geometri Soru Bankası/));

    // Seçilen ürün ADIYLA teyit edilmeli: hasar kaydı stoktan düşen yıkıcı
    // bir işlem, yanlış ürün seçimi geri alınamaz bir defter satırı üretir.
    expect(screen.getByText(/Geometri Soru Bankası/)).toBeTruthy();
  });
});
