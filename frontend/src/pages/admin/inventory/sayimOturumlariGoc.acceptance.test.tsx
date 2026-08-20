/**
 * İP-A7d3 · göç dalgası 3 · ekran (3): `CountSessionsPage`.
 *
 * Haritadaki yeri: bir pencere durumu + **SK-4 sınıfı** (pencerede üç alanlı
 * form, bekçi HİÇ çağrılmıyor) + **kilitli karar ihlali** (`disabled={!gecerli}`)
 * + elle liste/sayfalama/`useSearchParams`.
 *
 * Mevcut davranışın kabul testleri `inventoryScreens.acceptance` dosyasında
 * ZATEN var (liste alanları, filtre isteği, yetki, sayfalama); bu dosya onları
 * TEKRAR ETMEZ. Buradaki iddialar yalnız göçün getirdiği sözleşmeye aittir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import CountSessionsPage from "@/pages/admin/inventory/CountSessionsPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";
import { adsizKontroller } from "@/test-utils/alanAdlari";

import type { AxiosRequestConfig } from "axios";

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}
type Yanit = { status?: number; data: unknown };

let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit }[] = [];
let istekler: Istek[] = [];
let eskiAdapter: unknown;

function sunucu(desen: string | RegExp, yanit: Yanit, method?: string) {
  rotalar.unshift({
    esles: (i) => {
      const yol = i.url.split("?")[0];
      return (
        (method ? i.method === method.toLowerCase() : true) &&
        (typeof desen === "string" ? yol.includes(desen) : desen.test(yol))
      );
    },
    yanit,
  });
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  rotalar = [];
  istekler = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    // Filtreler axios `params` nesnesinde taşınır, `url`de DEĞİL. Sorgu burada
    // birleştirilmezse "süzgeç gerçekten isteğe kondu mu" iddiası BOŞLUKTA
    // geçerdi — ve "uydurma değer elendi" iddiası da yalancı yeşil olurdu.
    const sorgu = new URLSearchParams(
      Object.entries((config.params ?? {}) as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => [k, String(v)] as [string, string])
    ).toString();
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url) + (sorgu ? `?${sorgu}` : ""),
      body: config.data && typeof config.data === "string" ? JSON.parse(config.data) : null,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota ? rota.yanit : { data: { items: [], total: 0 } };
    const status = ham.status ?? 200;
    if (status >= 400) {
      const hata = new Error("istek basarisiz") as Error & {
        isAxiosError: boolean;
        response: unknown;
        config: unknown;
      };
      hata.isAxiosError = true;
      hata.response = { status, data: ham.data, headers: {}, config };
      hata.config = config;
      throw hata;
    }
    return { data: ham.data, status, statusText: "OK", headers: {}, config } as never;
  };
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: {
      id: 1,
      role_id: 1,
      admin_permissions: ["inventory.view", "inventory.count"],
    } as never,
  });
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  useToastStore.setState({ toasts: [] });
});

/** `api/inventory.ts::CountSessionOut` */
const OTURUM = (over: Record<string, unknown> = {}) => ({
  id: 7,
  code: "SAY-2027-0007",
  status: "REVIEW",
  scope: "MANUAL",
  created_by_admin_id: 1,
  created_at: "2027-01-05T09:00:00Z",
  started_at: null,
  reviewed_at: null,
  applied_at: null,
  reviewed_by_admin_id: null,
  applied_by_admin_id: null,
  note: null,
  cancel_reason: null,
  line_count: 2,
  uncounted_line_count: 0,
  has_stale: false,
  ...over,
});

function liste(kayitlar: unknown[] = [OTURUM()]) {
  sunucu("count-sessions", { data: { items: kayitlar, total: kayitlar.length } }, "get");
}

function sar(adres = ROUTES.adminInventoryCounts) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[adres]}>
        <Routes>
          <Route path={ROUTES.adminInventoryCounts} element={<CountSessionsPage />} />
          <Route path={ROUTES.adminInventoryCount(":id")} element={<p>SAYIM DETAYI</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function pencere(): HTMLElement {
  const p = document.querySelector('[role="dialog"]');
  if (!p) throw new Error("pencere yok");
  return p as HTMLElement;
}

async function pencereyiAc() {
  liste([]);
  sar();
  fireEvent.click((await screen.findAllByRole("button", { name: "Yeni sayım" }))[0]);
  await screen.findByRole("dialog");
}

/* ═════════ S-1 · pencere ortak yüzeyden gelir (KIRMIZI) ═════════ */

describe("S-1 · yeni sayım penceresi ortak düzenleme yüzeyinde", () => {
  it("pencere role=dialog + aria-modal taşır", async () => {
    await pencereyiAc();
    expect(pencere().getAttribute("aria-modal")).toBe("true");
  });

  it("TEMİZ formda ESC kapatır", async () => {
    await pencereyiAc();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("KİRLİ formda kapatma ÖNCE SORAR (SK-4 sınıfı)", async () => {
    await pencereyiAc();
    fireEvent.change(within(pencere()).getByLabelText(/^Not/), {
      target: { value: "Depo rafı 3 sayılacak" },
    });
    await act(async () => {});
    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

/* ═════════ S-2 · tüm koşullu dallar + alan adları (KIRMIZI) ═════════ */

describe("S-2 · üç kapsam dalı da render edilir, alanların adı vardır", () => {
  it("MANUAL dalı — ürün seçici görünür, alanlar adlı", async () => {
    await pencereyiAc();
    const p = pencere();
    expect(within(p).getByLabelText("Kapsam")).toBeTruthy();
    expect(within(p).getByLabelText(/^Not/)).toBeTruthy();
    expect(adsizKontroller(p).map((a) => a.html)).toEqual([]);
  });

  it("CATEGORY dalı — kategori numarası alanı adlı", async () => {
    await pencereyiAc();
    fireEvent.change(within(pencere()).getByLabelText("Kapsam"), {
      target: { value: "CATEGORY" },
    });
    await act(async () => {});
    const p = pencere();
    expect(within(p).getByLabelText("Kategori numarası")).toBeTruthy();
    expect(adsizKontroller(p).map((a) => a.html)).toEqual([]);
  });

  it("ALL dalı — ne ürün seçici ne kategori alanı kalır, alanlar yine adlı", async () => {
    await pencereyiAc();
    fireEvent.change(within(pencere()).getByLabelText("Kapsam"), { target: { value: "ALL" } });
    await act(async () => {});
    const p = pencere();
    expect(within(p).queryByLabelText("Kategori numarası")).toBeNull();
    expect(adsizKontroller(p).map((a) => a.html)).toEqual([]);
  });
});

/* ═════════ S-3 · gönder kapısı (KIRMIZI — kilitli karar ihlali) ═════════ */

describe("S-3 · 'Oturumu aç' geçerlilikle KAPANMAZ", () => {
  it("MANUAL kapsamda ürün seçilmemişken düğme AÇIK kalır", async () => {
    await pencereyiAc();
    const gonder = within(pencere()).getByRole("button", { name: "Oturumu aç" });
    expect((gonder as HTMLButtonElement).disabled).toBe(false);
  });

  it("ürünsüz MANUAL gönderiminde istek GİTMEZ, hata ALANDA çıkar", async () => {
    await pencereyiAc();
    fireEvent.click(within(pencere()).getByRole("button", { name: "Oturumu aç" }));

    expect(await within(pencere()).findByText("En az bir ürün seçin.")).toBeTruthy();
    expect(istekler.some((i) => i.method === "post" && i.url.includes("count-sessions"))).toBe(
      false
    );
  });

  it("geçersiz CATEGORY gönderiminde hata KATEGORİ alanında çıkar, odak oraya gider", async () => {
    await pencereyiAc();
    fireEvent.change(within(pencere()).getByLabelText("Kapsam"), {
      target: { value: "CATEGORY" },
    });
    await act(async () => {});
    fireEvent.click(within(pencere()).getByRole("button", { name: "Oturumu aç" }));

    const alan = within(pencere()).getByLabelText("Kategori numarası");
    await waitFor(() => expect(alan.getAttribute("aria-invalid")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(alan));
    expect(istekler.some((i) => i.method === "post")).toBe(false);
  });

  it("ALL kapsamı ürün seçmeden GÖNDERİLİR (ters prova)", async () => {
    // Yukarıdaki üç test, gönderim her hâlde engellenseydi de geçerdi.
    await pencereyiAc();
    sunucu("count-sessions", { status: 201, data: OTURUM({ status: "DRAFT" }) }, "post");
    fireEvent.change(within(pencere()).getByLabelText("Kapsam"), { target: { value: "ALL" } });
    await act(async () => {});
    fireEvent.click(within(pencere()).getByRole("button", { name: "Oturumu aç" }));

    await waitFor(() => {
      const yazma = istekler.find((i) => i.method === "post" && i.url.includes("count-sessions"));
      expect(yazma, "gönderim hiç yapılmadı").toBeTruthy();
      expect(yazma!.body!.scope).toBe("ALL");
      expect(yazma!.body!.product_ids).toBeUndefined();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sunucunun 422'si alanın altına yazılır", async () => {
    await pencereyiAc();
    sunucu(
      "count-sessions",
      { status: 422, data: { detail: [{ loc: ["body", "note"], msg: "Not çok uzun" }] } },
      "post"
    );
    fireEvent.change(within(pencere()).getByLabelText("Kapsam"), { target: { value: "ALL" } });
    await act(async () => {});
    fireEvent.click(within(pencere()).getByRole("button", { name: "Oturumu aç" }));
    expect(await within(pencere()).findByText("Not çok uzun")).toBeTruthy();
  });
});

/* ═════════ S-4 · liste ortak DataTable'a geçti ═════════ */

describe("S-4 · liste, satır tıklaması ve boş durum ayrımı", () => {
  it("satıra tıklamak detaya götürür", async () => {
    liste();
    sar();
    const kart = await screen.findByTestId("session-row-7");
    fireEvent.click(kart);
    expect(await screen.findByText("SAYIM DETAYI")).toBeTruthy();
  });

  it("satırı açan denetimin erişilebilir adı OTURUM KODUDUR (SK-5)", async () => {
    liste();
    sar();
    await screen.findByTestId("session-row-7");
    expect(
      screen.getByRole("button", { name: "SAY-2027-0007 — sayım oturumu" })
    ).toBeTruthy();
  });

  it("kod hâlâ GERÇEK bir bağlantıdır (yeni sekmede açılabilir)", async () => {
    liste();
    sar();
    await screen.findByTestId("session-row-7");
    const baglantilar = screen.getAllByRole("link", { name: "SAY-2027-0007" });
    expect(baglantilar.length).toBeGreaterThan(0);
    expect(baglantilar[0].getAttribute("href")).toContain("/7");
  });

  it("SÜZGEÇ eşleşmediğinde çıkış yolu verilir (boş durum ikiye ayrıldı)", async () => {
    liste([]);
    sar(`${ROUTES.adminInventoryCounts}?durum=APPLIED`);
    expect(await screen.findByText("Bu durumda oturum yok")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Süzgeci temizle" })).toBeTruthy();
  });

  it("HİÇ oturum yokken davet metni çıkar, 'Süzgeci temizle' ÇIKMAZ", async () => {
    liste([]);
    sar();
    expect(await screen.findByText("Henüz sayım oturumu açılmadı")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Süzgeci temizle" })).toBeNull();
  });

  it("adresteki durum süzgeci ekranı ORADA açar (paylaşılabilir)", async () => {
    liste([]);
    sar(`${ROUTES.adminInventoryCounts}?durum=CANCELLED`);
    await waitFor(() => {
      const g = istekler.find((i) => i.url.includes("count-sessions"));
      expect(g, "liste isteği hiç gitmedi").toBeTruthy();
      expect(g!.url).toContain("status=CANCELLED");
    });
    expect((screen.getByLabelText(/Duruma göre/) as HTMLSelectElement).value).toBe("CANCELLED");
  });

  it("adresteki UYDURMA durum değeri ELENİR (beyaz liste)", async () => {
    liste([]);
    sar(`${ROUTES.adminInventoryCounts}?durum=drop_table`);
    await waitFor(() => {
      const g = istekler.find((i) => i.url.includes("count-sessions"));
      expect(g, "liste isteği hiç gitmedi").toBeTruthy();
      expect(g!.url).not.toContain("drop_table");
    });
  });

  it("liste hatası boş durumdan AYRI gösterilir", async () => {
    sunucu("count-sessions", { status: 500, data: { detail: "patladi" } }, "get");
    sar();
    // ── İP-A7d5 · Görev 3: bu bütçe YENİ ama borç ESKİ ──
    //
    // Bu satırın bütçesi yoktu ve olması gerekmiyor sanılıyordu. Gerçekte
    // `operatorPanel`/`operatorBalance` dosyalarındaki
    // `configure({ asyncUtilTimeout: 5_000 })` aynı vitest işçisinde SONRA
    // koşan her dosyaya sızıyordu (gerekçe: `test-utils/beklemeButcesi.ts`);
    // sızıntı kalkınca ihtiyaç görünür oldu: tohum 5001'de bu iddia
    // "Unable to find /Yeniden dene/i" ile kırmızı düştü.
    //
    // Ölçülen (üst sınır, tam suite yükü): bu dosyanın en yavaş beklemesi
    // 802 ms — yani varsayılan 1000 ms'nin DİBİNDE. Gecikme üretim kodunda
    // değil: sahte adapter anında dönüyor, ekran hata durumuna düşene kadar
    // geçen süre vitest işçilerinin CPU paylaşımından geliyor.
    expect(
      await screen.findByRole("button", { name: /Yeniden dene/i }, { timeout: 3000 })
    ).toBeTruthy();
    expect(screen.queryByText("Henüz sayım oturumu açılmadı")).toBeNull();
  });
});
