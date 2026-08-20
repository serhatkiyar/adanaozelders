/**
 * İP-A7d3 · göç dalgası 3 · ekran (4): `CountSessionDetailPage`.
 *
 * Haritadaki yeri: tabanın **en yoğun pencere durumu kalemi** (3 bağ) ve bu
 * dalganın "yeni bir yazım" gereksinimini karşılayan ekran — SATIR BAŞINA ayrı
 * bir form. Daha önce göç eden hiçbir ekranda satır içinde, sunucu verisiyle
 * yeniden sıfırlanan bir form yoktu.
 *
 * Ayrıca iki kilitli karar ihlali taşıyordu:
 *   • satır "Kaydet" düğmesi geçerlilikle KAPANIYORDU;
 *   • "Ürün ekle" geçersiz girdide SESSİZCE hiçbir şey yapmıyordu
 *     (`if (!idler.length) return;`) — doğrulama değil, gizlenmiş hata.
 *
 * Mevcut davranışın kabul testleri `inventoryScreens.acceptance` dosyasında
 * zaten var (kova/miktar kavramları, yetki, idempotency); bu dosya onları
 * tekrar etmez.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import CountSessionDetailPage from "@/pages/admin/inventory/CountSessionDetailPage";
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
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      body: config.data && typeof config.data === "string" ? JSON.parse(config.data) : null,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota ? rota.yanit : { data: {} };
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
      admin_permissions: ["inventory.view", "inventory.count", "inventory.apply"],
    } as never,
  });
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  useToastStore.setState({ toasts: [] });
});

/** `api/inventory.ts::CountLineOut` */
const SATIR = (over: Record<string, unknown> = {}) => ({
  id: 101,
  product_id: 5,
  product_name: "Palme TYT Matematik Soru Bankası",
  product_sku: "FZK-000005",
  bucket: "SALEABLE",
  status: "COUNTED",
  system_qty_snapshot: 8,
  reserved_qty_snapshot: 2,
  counted_qty: 8,
  difference: 0,
  counted_at: "2027-03-03T10:00:00+00:00",
  counted_by_admin_id: 1,
  stale_reason: null,
  resolved_by_admin_id: null,
  resolved_at: null,
  resolution_note: null,
  note: null,
  applied_movement_id: null,
  ...over,
});

/** `api/inventory.ts::CountSessionDetailOut` */
const DETAY = (over: Record<string, unknown> = {}, satirlar: unknown[] = [SATIR()]) => ({
  id: 7,
  code: "SAY-2027-0007",
  status: "IN_PROGRESS",
  scope: "MANUAL",
  category_id: null,
  note: null,
  created_by_admin_id: 1,
  created_at: "2027-03-03T09:00:00+00:00",
  started_at: "2027-03-03T09:05:00+00:00",
  submitted_at: null,
  reviewed_by_admin_id: null,
  reviewed_at: null,
  applied_by_admin_id: null,
  applied_at: null,
  cancelled_by_admin_id: null,
  cancelled_at: null,
  cancel_reason: null,
  line_count: 1,
  uncounted_line_count: 0,
  has_stale: false,
  ...over,
  lines: satirlar,
});

function detaySunucusu(d: unknown = DETAY()) {
  sunucu(/count-sessions\/\d+$/, { data: d }, "get");
}

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ROUTES.adminInventoryCount(7)]}>
        <Routes>
          <Route path={ROUTES.adminInventoryCount(":id")} element={<CountSessionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Yalnız GET olmayan (yazma) istekler. */
function yazmalar(): Istek[] {
  return istekler.filter((i) => i.method !== "get");
}

/* ═════════ D-1 · satır içi sayım formu (YENİ YAZIM) ═════════ */

describe("D-1 · satır sayım formu — düğme geçerlilikle KAPANMAZ", () => {
  it("ondalıklı miktarda düğme AÇIK kalır, istek GİTMEZ, hata ALANDA çıkar", async () => {
    detaySunucusu();
    sar();
    const alan = await screen.findByLabelText(/Sayılan miktar/);
    fireEvent.change(alan, { target: { value: "12.5" } });
    await act(async () => {});

    const kaydet = screen.getByRole("button", { name: "Kaydet" }) as HTMLButtonElement;
    expect(kaydet.disabled).toBe(false);
    fireEvent.click(kaydet);

    await waitFor(() => expect(alan.getAttribute("aria-invalid")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(alan));
    expect(yazmalar()).toHaveLength(0);
  });

  it("BOŞ miktar '0 sayıldı' sayılmaz — gönderilmez, sebebi yazılır", async () => {
    detaySunucusu();
    sar();
    const alan = await screen.findByLabelText(/Sayılan miktar/);
    fireEvent.change(alan, { target: { value: "" } });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    expect(await screen.findByText("Sayılan miktarı yazın.")).toBeTruthy();
    expect(yazmalar()).toHaveLength(0);
  });

  it("NEGATİF miktar gönderilmez", async () => {
    detaySunucusu();
    sar();
    const alan = await screen.findByLabelText(/Sayılan miktar/);
    fireEvent.change(alan, { target: { value: "-3" } });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    expect(await screen.findByText("Miktar negatif olamaz.")).toBeTruthy();
    expect(yazmalar()).toHaveLength(0);
  });

  it("geçerli miktar GÖNDERİLİR (ters prova — üstteki üçü boşlukta geçmesin)", async () => {
    detaySunucusu();
    sunucu(/count-sessions\/\d+\/lines\/\d+/, { data: DETAY() });
    sar();
    const alan = await screen.findByLabelText(/Sayılan miktar/);
    fireEvent.change(alan, { target: { value: "6" } });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(yazmalar().length).toBeGreaterThan(0));
    expect(String(yazmalar()[0].body?.counted_qty)).toBe("6");
  });

  it("alan SUNUCU değerini gösterir ve formu KİRLİ bırakmaz", async () => {
    // Sıfırlama `reset` ile yapılır; `setValue` alanı kirli bırakır ve
    // kullanıcı hiçbir şey yazmamışken kirli form bekçisini uyandırırdı
    // (`beforeunload` her yenilemede uyarı gösterirdi).
    detaySunucusu();
    sar();
    const alan = (await screen.findByLabelText(/Sayılan miktar/)) as HTMLInputElement;
    expect(alan.value).toBe("8");

    const temiz = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(temiz);
    expect(temiz.defaultPrevented).toBe(false);
  });
});

/* ═════════ D-2 · üç pencere de ortak yüzeyden gelir (KIRMIZI) ═════════ */

describe("D-2 · pencere durumu ekranda yaşamaz", () => {
  it("'Farkları uygula' penceresi role=dialog + aria-modal taşır", async () => {
    detaySunucusu(DETAY({ status: "REVIEW" }, [SATIR({ counted_qty: 6, difference: -2 })]));
    sar();
    fireEvent.click(await screen.findByRole("button", { name: "Farkları uygula" }));
    const p = await screen.findByRole("dialog");
    expect(p.getAttribute("aria-modal")).toBe("true");
    expect(within(p).getByText(/stok defterine yazılacak/)).toBeTruthy();
  });

  it("'Farkları uygula' penceresi ESC ile kapanır (yazılan bir şey yok)", async () => {
    detaySunucusu(DETAY({ status: "REVIEW" }, [SATIR({ counted_qty: 6, difference: -2 })]));
    sar();
    fireEvent.click(await screen.findByRole("button", { name: "Farkları uygula" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("İPTAL gerekçesi penceresinde KİRLİ formda kapatma ÖNCE SORAR (SK-7)", async () => {
    // `ReasonDialog` ortak katmanda onarıldı; bu ekran o onarımın çağrı yeri
    // başına kanıtıdır — bir sayım oturumunun iptali geri alınamaz.
    detaySunucusu();
    sar();
    fireEvent.click(await screen.findByRole("button", { name: "Oturumu iptal et" }));
    const alan = await screen.findByRole("textbox", { name: "İptal gerekçesi" });
    fireEvent.change(alan, { target: { value: "Sayım yanlış başladı" } });
    await act(async () => {});

    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
  });

  it("AÇIKLAMA penceresi doğru satıra bağlanır ve gövde o satırı taşır", async () => {
    detaySunucusu(DETAY({}, [SATIR({ status: "STALE", stale_reason: "STOCK_MOVED" })]));
    sunucu(/count-sessions\/\d+\/lines\/\d+\/resolve/, { data: DETAY() }, "post");
    sar();
    fireEvent.click(await screen.findByRole("button", { name: "Açıklama ekle" }));
    const alan = await screen.findByRole("textbox", { name: "Açıklama" });
    fireEvent.change(alan, { target: { value: "Raf sayımı tekrarlandı" } });
    fireEvent.click(screen.getByRole("button", { name: "Açıklamayı kaydet" }));

    await waitFor(() => {
      const yazma = yazmalar().find((i) => i.url.includes("/resolve"));
      expect(yazma, "açıklama isteği hiç gitmedi").toBeTruthy();
      expect(yazma!.url).toContain("/101/");
    });
  });
});

/* ═════════ D-3 · "Ürün ekle" sessiz return'ü kalktı (KIRMIZI) ═════════ */

describe("D-3 · ürün ekleme geçersiz girdide SESSİZ kalmaz", () => {
  it("harf içeren girdide hata ALANDA çıkar, istek GİTMEZ", async () => {
    detaySunucusu(DETAY({ status: "DRAFT", started_at: null }));
    sar();
    const alan = await screen.findByLabelText("Ürün ekle");
    fireEvent.change(alan, { target: { value: "12a" } });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));

    expect(await screen.findByText(/Yalnız pozitif ürün numaraları/)).toBeTruthy();
    expect(yazmalar()).toHaveLength(0);
  });

  it("BOŞ girdide de sebep yazılır", async () => {
    detaySunucusu(DETAY({ status: "DRAFT", started_at: null }));
    sar();
    await screen.findByLabelText("Ürün ekle");
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));
    expect(await screen.findByText("Ürün numarası yazın.")).toBeTruthy();
    expect(yazmalar()).toHaveLength(0);
  });

  it("geçerli numaralar GÖNDERİLİR ve alan temizlenir (ters prova)", async () => {
    detaySunucusu(DETAY({ status: "DRAFT", started_at: null }));
    sunucu(/count-sessions\/\d+\/products/, { data: DETAY({ status: "DRAFT" }) }, "post");
    sar();
    const alan = (await screen.findByLabelText("Ürün ekle")) as HTMLInputElement;
    fireEvent.change(alan, { target: { value: "12, 34" } });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));

    await waitFor(() =>
      expect(yazmalar().some((i) => i.url.includes("/products"))).toBe(true)
    );
    await waitFor(() => expect(alan.value).toBe(""));
  });
});

/* ═════════ D-4 · tüm koşullu dallar + alan adları (KIRMIZI) ═════════ */

describe("D-4 · her FSM dalı render edilir, her alanın adı vardır", () => {
  it("TASLAK dalı — ürün ekleme formu adlı", async () => {
    detaySunucusu(DETAY({ status: "DRAFT", started_at: null }));
    const { container } = sar();
    await screen.findByLabelText("Ürün ekle");
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("SAYIM SÜRÜYOR dalı — satır sayım alanı adlı", async () => {
    detaySunucusu(DETAY({ status: "IN_PROGRESS" }));
    const { container } = sar();
    await screen.findByLabelText(/Sayılan miktar/);
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("İNCELEMEDE dalı — sayım alanı kalkar, uygula düğmesi gelir", async () => {
    detaySunucusu(DETAY({ status: "REVIEW" }));
    const { container } = sar();
    await screen.findByRole("button", { name: "Farkları uygula" });
    expect(screen.queryByLabelText(/Sayılan miktar/)).toBeNull();
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("UYGULANDI dalı — salt okunur, hiçbir yazma denetimi yok", async () => {
    detaySunucusu(DETAY({ status: "APPLIED", applied_at: "2027-03-03T12:00:00+00:00" }));
    const { container } = sar();
    await screen.findByText("SAY-2027-0007");
    expect(screen.queryByLabelText(/Sayılan miktar/)).toBeNull();
    expect(screen.queryByLabelText("Ürün ekle")).toBeNull();
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("BAYAT satır dalı — açıklama düğmesi ve gerekçe metni görünür", async () => {
    detaySunucusu(DETAY({}, [SATIR({ status: "STALE", stale_reason: "STOCK_MOVED" })]));
    const { container } = sar();
    await screen.findByRole("button", { name: "Açıklama ekle" });
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });
});
