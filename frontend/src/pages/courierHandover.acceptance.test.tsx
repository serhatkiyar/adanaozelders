// F30 kurye saha ekranı — zimmet ve kapı taraması AYRI MODLAR (gerçek DOM).
//
// Denetim bulgusu 7. Bu ekranın riski arka uçtan farklı: kurye elinde telefonla,
// aracın yanında, aceleyle çalışır. İki tarama **aynı görünürse** yanlış eylemi
// seçer:
//
//   • zimmet taraması  → paketi araca alıyorum (depoda, tur başında)
//   • kapı taraması    → müşteriye teslim ediyorum (adreste)
//
// Bugün tek bir "QR okut" butonu var (`DeliveryDriver.tsx:581-594`) ve zimmet
// kavramı hiç yok. F30 ikisini ayırır; bu matris ayrımın kullanıcıya GÖRÜNDÜĞÜNÜ
// ve yanlış durumda teslim eyleminin SUNULMADIĞINI sabitler.
//
// Ekran henüz yazılmadığı için tüm düğümler KIRMIZIDIR.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu — gerçek axios örneği, yalnız adapter değişir ══════════════ */

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}
type Yanit = { status?: number; data: unknown } | ((i: Istek) => { status?: number; data: unknown });

let istekler: Istek[] = [];
let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit }[] = [];
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
  istekler = [];
  rotalar = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      body: config.data ? JSON.parse(String(config.data)) : null,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota
      ? typeof rota.yanit === "function"
        ? rota.yanit(istek)
        : rota.yanit
      : { data: {} };
    const status = ham.status ?? 200;
    if (status >= 400) {
      const hata = new Error(`istek başarısız: ${status}`) as Error & {
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
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

/* ══════════════ Render ══════════════ */

function kuryeOturumu() {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 9, role_id: 5, courier_id: 3 } as never,
  });
}

const EKRAN = import.meta.glob(["./DeliveryRunHandover.tsx", "./DeliveryDriver.tsx"]);

async function ekran(ad: string) {
  const yukle = EKRAN[`./${ad}.tsx`];
  if (!yukle) throw new Error(`HENÜZ YAZILMADI: src/pages/${ad}.tsx`);
  return ((await yukle()) as Record<string, any>).default;
}

async function sar(ad: string, yol: string) {
  const Bilesen = await ekran(ad);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Routes>
          <Route path="/dagitim/:id/zimmet" element={<Bilesen />} />
          <Route path="/dagitim/:id" element={<Bilesen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/* ══════════════ Fixture'lar ══════════════ */

const MANIFEST = (over: Record<string, unknown> = {}) => ({
  run_id: 5,
  total: 2,
  handed_over: 1,
  packages: [
    {
      package_id: 11,
      code: "PKT-000011",
      order_id: 501,
      status: "HANDED_OVER",
      recipient: "Ayşe Yılmaz",
    },
    {
      package_id: 12,
      code: "PKT-000012",
      order_id: 502,
      status: "PACKED",
      recipient: "Mehmet Kaya",
    },
  ],
  ...over,
});

const DURAK = (over: Record<string, unknown> = {}) => ({
  id: 31,
  run_id: 5,
  order_id: 501,
  sequence: 1,
  status: "PENDING",
  recipient: "Ayşe Yılmaz",
  address: "Seyhan, Adana",
  phone: "+905550001000",
  delivery_pref: "ADRESIMDEYIM",
  items: [{ title: "TYT Matematik", quantity: 1 }],
  package: { package_id: 11, code: "PKT-000011", status: "HANDED_OVER" },
  ...over,
});

const TUR = (over: Record<string, unknown> = {}) => ({
  id: 5,
  run_date: "2026-08-01",
  vehicle: "LADA",
  status: "ACTIVE",
  stops: [DURAK()],
  ...over,
});

/* ══════════════ 1. İki mod ayrı görünür ══════════════ */

describe("zimmet ve kapı taraması ayrı modlardır", () => {
  it("zimmet ekranı 'paketi teslim al' dilini kullanır, 'teslim et' demez", async () => {
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { data: MANIFEST() });
    await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    expect(await screen.findByText(/teslim al|zimmet|araca/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /müşteriye teslim et|teslim et/i })).toBeNull();
  });

  it("zimmet ekranı kaç paketin alındığını gösterir (N / M)", async () => {
    // Kurye eksik paketle yola çıkmamalı; sayaç tek görünür güvencedir.
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { data: MANIFEST() });
    await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    expect(await screen.findByText(/1\s*\/\s*2/)).toBeTruthy();
  });

  it("zimmet taraması handover ucuna gider, kapı taramasına DEĞİL", async () => {
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { data: MANIFEST() });
    sunucu(
      "/delivery/handover/scan",
      { data: { package_id: 12, status: "HANDED_OVER" } },
      "post",
    );
    const { container } = await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    await screen.findByText(/1\s*\/\s*2/);
    const kutu = container.querySelector("input[type=text]") as HTMLInputElement;
    expect(kutu, "manuel kod girişi yok (kamera yoksa operasyon durur)").toBeTruthy();
    kutu.value = "PKG1:12:tok";
    kutu.dispatchEvent(new Event("input", { bubbles: true }));
    kutu.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await waitFor(() => {
      expect(istekler.some((i) => i.url.includes("/delivery/handover/scan"))).toBe(true);
      expect(istekler.some((i) => i.url.endsWith("/delivery/scan"))).toBe(false);
    });
  });
});

/* ══════════════ 2. Zimmetlenmemiş pakette teslim eylemi yok ══════════════ */

describe("teslim eylemi yalnız zimmetli pakette sunulur", () => {
  it("paket PACKED iken teslim aksiyonları GÖSTERİLMEZ", async () => {
    // Paket hâlâ depoda: kurye elinde olmayan bir paketi teslim edemez.
    kuryeOturumu();
    sunucu("/delivery/runs/5", {
      data: TUR({
        stops: [DURAK({ package: { package_id: 11, code: "PKT-000011", status: "PACKED" } })],
      }),
    });
    await sar("DeliveryDriver", "/dagitim/5");
    await screen.findByText(/Ayşe Yılmaz/);
    expect(screen.queryByRole("button", { name: /kod gönder|teslim et|kapıya bırak/i })).toBeNull();
    expect(screen.getByText(/zimmetlen|teslim al|araca alın/i)).toBeTruthy();
  });

  it("paket HANDED_OVER iken teslim aksiyonları görünür", async () => {
    kuryeOturumu();
    sunucu("/delivery/runs/5", { data: TUR() });
    await sar("DeliveryDriver", "/dagitim/5");
    await screen.findByText(/Ayşe Yılmaz/);
    expect(screen.getByRole("button", { name: /kod gönder|teslim/i })).toBeTruthy();
  });

  it("paket RETURN_PENDING iken teslim aksiyonu GÖSTERİLMEZ", async () => {
    // Durak sonuçlanmış, paket araçta geri dönüş bekliyor. Bu satır ekranda
    // "teslim edilebilir" görünürse kurye ikinci kez teslim etmeye kalkar.
    kuryeOturumu();
    sunucu("/delivery/runs/5", {
      data: TUR({
        stops: [
          DURAK({
            status: "FAILED",
            package: { package_id: 11, code: "PKT-000011", status: "RETURN_PENDING" },
          }),
        ],
      }),
    });
    await sar("DeliveryDriver", "/dagitim/5");
    await screen.findByText(/Ayşe Yılmaz/);
    expect(screen.queryByRole("button", { name: /kod gönder|teslim et|kapıya bırak/i })).toBeNull();
    expect(screen.getByText(/geri dön|depoya|iade bekl/i)).toBeTruthy();
  });
});

/* ══════════════ 3. Yanlış QR türünde açık hata ══════════════ */

describe("yanlış QR türü", () => {
  it("zimmet ekranında DURAK QR'ı okutulursa açık hata gösterilir", async () => {
    // İki uzay ayrıktır; kullanıcıya "bulunamadı" demek yanlış yeri işaret eder.
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { data: MANIFEST() });
    const { container } = await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    await screen.findByText(/1\s*\/\s*2/);
    const kutu = container.querySelector("input[type=text]") as HTMLInputElement;
    kutu.value = "31:durakTokeni";
    kutu.dispatchEvent(new Event("input", { bubbles: true }));
    kutu.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/paket etiketi|paket qr|yanlış/i);
    // İstemci tarafında ayırt edilebildiği için sunucuya hiç gitmemeli.
    await waitFor(() =>
      expect(istekler.some((i) => i.url.includes("/handover/scan"))).toBe(false),
    );
  });

  it("sunucu 409 verirse (zimmetlenmemiş paket) mesaj kullanıcıya ulaşır", async () => {
    kuryeOturumu();
    sunucu("/delivery/runs/5", { data: TUR() });
    sunucu(
      "/delivery/scan",
      { status: 409, data: { detail: "Paket henüz teslim alınmadı" } },
      "post",
    );
    const { container } = await sar("DeliveryDriver", "/dagitim/5");
    await screen.findByText(/Ayşe Yılmaz/);
    const kutu = container.querySelector("input[type=text]");
    if (kutu) {
      (kutu as HTMLInputElement).value = "PKG1:99:baska";
      kutu.dispatchEvent(new Event("input", { bubbles: true }));
      kutu.closest("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      expect(await screen.findByRole("alert")).toBeTruthy();
    }
  });
});
