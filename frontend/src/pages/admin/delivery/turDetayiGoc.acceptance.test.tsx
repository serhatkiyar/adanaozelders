/**
 * İP-A7d3 · göç dalgası 3 · ekran (6): `DeliveryRunDetailPage`.
 *
 * Haritadaki yeri: **5 ham düğme + 1 pencere durumu** ve A7d2'nin dalga 3 için
 * adıyla önerdiği ekran. Getirdiği YENİ YAZIM: **sürükle-bırak sıralama**
 * (HTML5 dnd, kütüphanesiz) — daha önce göç eden hiçbir ekranda yoktu.
 *
 * Ekranın hiç davranış testi YOKTU (`ip19Filo`/`ip19Denetim` tur KURMA ekranını
 * ölçüyor, tur DETAYINI değil). Bu yüzden dosyanın ilk bölümü göçün kırmaması
 * gereken davranışı sabitler.
 *
 * ## Kayda geçen sınır
 *
 * Bu ekranın penceresi bir `ConfirmDialog`tır — içinde YAZILAN bir şey yoktur.
 * "Kirli formda kapatma sorar" iddiası burada anlamsızdır ve yazılmadı; onun
 * yerine pencerenin ortak yüzeyden geldiği ve ekranın pencere durumu tutmadığı
 * ölçülür.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import DeliveryRunDetailPage from "@/pages/admin/delivery/DeliveryRunDetailPage";
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
    const ham = rota ? rota.yanit : { data: [] };
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
      admin_permissions: ["delivery.view", "delivery.manage"],
    } as never,
  });
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  useToastStore.setState({ toasts: [] });
});

/** `types/index.ts::DeliveryStop` */
const DURAK = (id: number, sequence: number, over: Record<string, unknown> = {}) => ({
  id,
  run_id: 3,
  order_id: 500 + id,
  sequence,
  status: "PENDING",
  qr_payload: `${id}:tok`,
  recipient: `Müşteri ${id}`,
  phone: "0555 000 00 00",
  address: `Sokak ${id}, Çukurova`,
  lat: 37.0 + id / 100,
  lng: 35.3 + id / 100,
  items: [{ title: "Kitap", quantity: 1 }],
  order_total: "150.00",
  delivery_pref: null,
  delivery_pref_note: null,
  eta: null,
  detour_km: null,
  is_outlier: false,
  otp_sent_at: null,
  delivered_at: null,
  proof: null,
  photo_url: null,
  courier_note: null,
  promised_delivery_date: null,
  ...over,
});

/** `types/index.ts::DeliveryRun` */
const TUR = (over: Record<string, unknown> = {}, duraklar = [DURAK(11, 1), DURAK(12, 2)]) => ({
  id: 3,
  run_date: "2026-08-20",
  vehicle_id: 9,
  vehicle: "Corolla",
  status: "PLANNED",
  notes: null,
  started_at: null,
  completed_at: null,
  created_at: "2026-08-20T06:00:00Z",
  depot_lat: 37.0,
  depot_lng: 35.3,
  optimized_at: null,
  optimize_provider: null,
  total_distance_km: null,
  total_duration_seconds: null,
  route_geometry: null,
  courier: null,
  ...over,
  stops: duraklar,
});

function turSunucusu(t: unknown = TUR()) {
  sunucu(/\/delivery\/runs\/\d+$/, { data: t }, "get");
}

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ROUTES.adminDeliveryRun(3)]}>
        <Routes>
          <Route path={ROUTES.adminDeliveryRun(":id")} element={<DeliveryRunDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function yazmalar(): Istek[] {
  return istekler.filter((i) => i.method !== "get");
}

/**
 * İptal penceresini AÇAN düğme.
 *
 * Erişilebilir adı "İptal"dir (`title="Turu iptal et"` adı EZMEZ — metin
 * içeriği varken `title` yalnız ipucu olarak kullanılır). Pencerenin İÇİNDEKİ
 * onay düğmesinin adı "Turu iptal et"tir; ikisi karıştırılmasın diye açan
 * düğme burada tek yerden bulunur.
 */
async function turuIptalTetikle(): Promise<HTMLElement> {
  return screen.findByRole("button", { name: "İptal" });
}

/**
 * jsdom `DataTransfer`ı UYGULAMAZ.
 *
 * Üretim kodu `e.dataTransfer.effectAllowed = "move"` yazar ve gerçek
 * tarayıcıda `dragstart` olayının `dataTransfer`ı DAİMA vardır — yani kod
 * doğru. Ama `fireEvent.dragStart(el)` jsdom'da `dataTransfer`sız bir olay
 * üretir ve işleyici YAKALANMAMIŞ bir `TypeError` fırlatır: test yeşil kalır
 * (hata olaydan sonra atılır), Vitest onu "unhandled error" diye raporlar ve
 * "false positive" uyarısı verir.
 *
 * İlk yazımda bu tuzağa DÜŞÜLDÜ ve ancak karışık tohum koşumu görünür etti.
 * Doğru çözüm üretim kodunu gevşetmek (`?.`) değil, testin gerçek olayı
 * TAKLİT ETMESİDİR.
 */
function surukleBaslat(el: Element) {
  fireEvent.dragStart(el, {
    dataTransfer: { effectAllowed: "", setData: () => {}, getData: () => "" },
  });
}

/* ═════════ T-1 · mevcut davranış korunur ═════════ */

describe("T-1 · tur detayı ve durak listesi", () => {
  it("duraklar sıra numarasına göre listelenir", async () => {
    turSunucusu(TUR({}, [DURAK(12, 2), DURAK(11, 1)]));
    sar();
    await screen.findByText("Sokak 11, Çukurova");
    const adresler = screen
      .getAllByText(/^Sokak \d+, Çukurova$/)
      .map((e) => e.textContent);
    expect(adresler).toEqual(["Sokak 11, Çukurova", "Sokak 12, Çukurova"]);
  });

  it("tur bulunamazsa hata yüzeyi çıkar (boş liste gibi görünmez)", async () => {
    sunucu(/\/delivery\/runs\/\d+$/, { status: 404, data: { detail: "yok" } }, "get");
    sar();
    expect(await screen.findByText("Tur bulunamadı")).toBeTruthy();
  });

  it("YÖNETME izni yokken sıralama denetimleri basılmaz", async () => {
    useAuthStore.setState({
      token: "t",
      isAuthenticated: true,
      user: { id: 1, role_id: 1, admin_permissions: ["delivery.view"] } as never,
    });
    turSunucusu();
    sar();
    await screen.findByText("Sokak 11, Çukurova");
    expect(screen.queryByRole("button", { name: /yukarı taşı/i })).toBeNull();
  });
});

/* ═════════ T-2 · sıralama denetimleri (YENİ YAZIM) ═════════ */

describe("T-2 · sıralama: ok düğmeleri ve sürükle-bırak AYNI mutasyona düşer", () => {
  it("ok düğmelerinin erişilebilir adları durak sırasını taşır", async () => {
    turSunucusu();
    sar();
    await screen.findByText("Sokak 11, Çukurova");
    expect(screen.getByRole("button", { name: "Durak 1 aşağı taşı" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Durak 2 yukarı taşı" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Durak 1 turdan çıkar" })).toBeTruthy();
  });

  it("ilk durağın 'yukarı taşı' düğmesi KAPALIDIR (sınır)", async () => {
    turSunucusu();
    sar();
    await screen.findByText("Sokak 11, Çukurova");
    const yukari = screen.getByRole("button", { name: "Durak 1 yukarı taşı" });
    expect((yukari as HTMLButtonElement).disabled).toBe(true);
  });

  it("'aşağı taşı' GERÇEKTEN yeni sırayı sunucuya gönderir", async () => {
    turSunucusu();
    sunucu(/\/delivery\/runs\/\d+\/reorder/, { data: TUR() }, "put");
    sar();
    await screen.findByText("Sokak 11, Çukurova");
    fireEvent.click(screen.getByRole("button", { name: "Durak 1 aşağı taşı" }));

    await waitFor(() => {
      const yazma = yazmalar().find((i) => i.url.includes("/reorder"));
      expect(yazma, "sıralama isteği hiç gitmedi").toBeTruthy();
      expect(yazma!.body!.stop_ids).toEqual([12, 11]);
    });
  });

  it("SÜRÜKLE-BIRAK aynı sırayı üretir (ok düğmesiyle tutarlı)", async () => {
    // Yeni yazımın çekirdek iddiası: iki farklı giriş yolu (klavye/dokunma ve
    // fare sürüklemesi) TEK bir mutasyonda buluşur ve aynı gövdeyi yazar.
    turSunucusu();
    sunucu(/\/delivery\/runs\/\d+\/reorder/, { data: TUR() }, "put");
    sar();
    const ilk = (await screen.findByText("Sokak 11, Çukurova")).closest("li")!;
    const ikinci = screen.getByText("Sokak 12, Çukurova").closest("li")!;

    surukleBaslat(ilk);
    fireEvent.dragOver(ikinci);
    fireEvent.drop(ikinci);

    await waitFor(() => {
      const yazma = yazmalar().find((i) => i.url.includes("/reorder"));
      expect(yazma, "sürükle-bırak sıralama isteği hiç gitmedi").toBeTruthy();
      expect(yazma!.body!.stop_ids).toEqual([12, 11]);
    });
  });

  it("kendi üstüne bırakmak istek ÜRETMEZ (ters prova)", async () => {
    turSunucusu();
    sunucu(/\/delivery\/runs\/\d+\/reorder/, { data: TUR() }, "put");
    sar();
    const ilk = (await screen.findByText("Sokak 11, Çukurova")).closest("li")!;

    surukleBaslat(ilk);
    fireEvent.drop(ilk);

    await waitFor(() => expect(screen.getByText("Sokak 12, Çukurova")).toBeTruthy());
    expect(yazmalar().filter((i) => i.url.includes("/reorder"))).toHaveLength(0);
  });
});

/* ═════════ T-3 · pencere ortak yüzeyden gelir (KIRMIZI) ═════════ */

describe("T-3 · iptal penceresi ortak yüzeyde, ekran pencere durumu tutmaz", () => {
  it("pencere role=dialog + aria-modal taşır", async () => {
    turSunucusu();
    sar();
    fireEvent.click(await turuIptalTetikle());
    const p = await screen.findByRole("dialog");
    expect(p.getAttribute("aria-modal")).toBe("true");
  });

  it("ESC pencereyi kapatır (yazılan bir şey yok — bekçi devreye girmez)", async () => {
    turSunucusu();
    sar();
    fireEvent.click(await turuIptalTetikle());
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("onay GERÇEKTEN iptal isteği gönderir", async () => {
    turSunucusu();
    sunucu(/\/delivery\/runs\/\d+\/cancel/, { data: TUR({ status: "CANCELLED" }) }, "post");
    sar();
    fireEvent.click(await turuIptalTetikle());
    const p = await screen.findByRole("dialog");
    fireEvent.click(within(p).getByRole("button", { name: "Turu iptal et" }));
    await waitFor(() =>
      expect(yazmalar().some((i) => i.url.includes("/cancel"))).toBe(true)
    );
  });
});

/* ═════════ T-4 · ham düğme kalmadı + alan adları ═════════ */

describe("T-4 · ekranda ham düğme yok, kontroller adlı", () => {
  it("PLANNED dalında hiçbir form kontrolü adsız değil", async () => {
    turSunucusu();
    const { container } = sar();
    await screen.findByText("Sokak 11, Çukurova");
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("OPTİMİZE EDİLMİŞ dalında harita şeridi açılır/kapanır ve durumu beyan eder", async () => {
    turSunucusu(
      TUR({
        optimized_at: "2026-08-20T07:00:00Z",
        optimize_provider: "vroom",
        total_distance_km: 12.4,
        total_duration_seconds: 3600,
      })
    );
    const { container } = sar();
    const gizle = await screen.findByRole("button", { name: "Haritayı gizle" });
    // `aria-expanded`: göç sırasında eklendi — düğme bir aksiyon değil, bir
    // açma/kapama denetimi ve durumunu ekran okuyucuya söylemeliydi.
    expect(gizle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(gizle);
    const goster = await screen.findByRole("button", { name: "Haritayı göster" });
    expect(goster.getAttribute("aria-expanded")).toBe("false");
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("AKTİF turda da hiçbir kontrol adsız değil", async () => {
    turSunucusu(TUR({ status: "ACTIVE", started_at: "2026-08-20T07:30:00Z" }));
    const { container } = sar();
    await screen.findByText("Sokak 11, Çukurova");
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });
});
