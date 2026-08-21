/**
 * İP-A7d2 · Görev 3 — `PackagesPage` göç matrisi.
 *
 * ## Bu ekran dalgaya neden alındı
 *
 * A7d1'in bilinen sınırı şuydu: **`onRowClick` ile satır aksiyonunun bir arada
 * olduğu davranış (SK-1) hiçbir gerçek ekranda sınanmadı** — karar sentetik
 * bir sondayla ölçüldü. Tabandaki hiçbir ekran ikisini birlikte istemiyordu.
 *
 * Paketler listesi tam olarak bunu istiyor ve zaten istiyordu: her satır bir
 * paket DETAYINA gider (`PKT-…` bağlantısı), aynı satırda üç aksiyon var
 * (etiket bas · yeniden paketle · bozuldu) ve bir de **seçim kutusu**. Yani
 * SK-1'in koruması burada üç ayrı etkileşimli kaynak türüne karşı sınanıyor:
 * `a[href]`, `button` ve `input`.
 *
 * Ayrıca ekranın süzgeci elle `useSearchParams` ile yazılmıştı ve sayfalaması
 * kendi düğmelerini çiziyordu; ikisi de ortak katmana geçti.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import PackagesPage from "@/pages/admin/packing/PackagesPage";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu ══════════════ */

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
    // Süzgeç `params`ta taşınır, `url`de değil: tam adres burada birleşir.
    const sorgu = new URLSearchParams(
      Object.entries((config.params ?? {}) as Record<string, unknown>).map(
        ([k, v]) => [k, String(v)] as [string, string]
      )
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

const VIEW = "packing.view";
const MANAGE = "packing.manage";

/* ══════════════ Fixture ══════════════ */

const PAKET = (over: Record<string, unknown> = {}) => ({
  id: 77,
  code: "PKT-000077",
  order_id: 501,
  status: "PACKED",
  qr_payload: "PKG1:77:tok",
  created_at: "2026-08-01T08:00:00Z",
  packed_at: "2026-08-01T09:00:00Z",
  handed_over_at: null,
  returned_at: null,
  delivered_at: null,
  void_at: null,
  unpacked_at: null,
  items: [],
  ...over,
});

function sar(adres = "/yonetim/paketleme/paketler") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[adres]}>
        <Routes>
          <Route path="/yonetim/paketleme/paketler" element={<PackagesPage />} />
          <Route path="/yonetim/paketleme/paket/:id" element={<p>PAKET DETAYI</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Mobil kart bölümü — `DataTable` bunu `data-mobil-satirlar` ile işaretler. */
function mobilKap(): HTMLElement {
  const k = document.querySelector("[data-mobil-satirlar]");
  if (!k) throw new Error("mobil kart bölümü yok");
  return k as HTMLElement;
}

/* ══════════════ 1 · Mevcut davranış korunur ══════════════ */

describe("P-1 · liste, süzgeç ve durum ayrımı", () => {
  it("durum süzgeci GERÇEKTEN API sorgusuna gider", async () => {
    izinVer(VIEW);
    sunucu("/packing/packages", { data: { items: [], total: 0 } });
    sar("/yonetim/paketleme/paketler?durum=RETURN_PENDING");
    await waitFor(() => {
      const g = istekler.find((i) => i.url.includes("/packing/packages"));
      expect(g?.url).toMatch(/status=RETURN_PENDING/);
    });
  });

  it("uydurma durum değeri sunucuya GİTMEZ", async () => {
    izinVer(VIEW);
    sunucu("/packing/packages", { data: { items: [], total: 0 } });
    sar("/yonetim/paketleme/paketler?durum=__proto__");
    await waitFor(() => {
      const g = istekler.find((i) => i.url.includes("/packing/packages"));
      expect(g?.url).not.toMatch(/status=/);
    });
  });

  it("geri bekleniyor / bozulacak paketleri ayırt eder", async () => {
    izinVer(VIEW);
    sunucu("/packing/packages", {
      data: {
        items: [
          PAKET({ id: 1, code: "PKT-000001", status: "RETURN_PENDING" }),
          PAKET({ id: 2, code: "PKT-000002", status: "VOID", unpacked_at: null }),
        ],
        total: 2,
      },
    });
    sar();
    expect(await screen.findAllByText(/geri bekleniyor/i)).toBeTruthy();
    expect(screen.getAllByText(/bozulacak/i).length).toBeGreaterThan(0);
  });

  it("yönetim izni YOKSA satır aksiyonları sunulmaz", async () => {
    izinVer(VIEW);
    sunucu("/packing/packages", {
      data: { items: [PAKET({ status: "RETURNED" })], total: 1 },
    });
    sar();
    await screen.findAllByText("PKT-000077");
    expect(screen.queryByRole("button", { name: /Yeniden paketle/ })).toBeNull();
  });
});

/* ══════════════ 2 · SK-1: satır tıklaması + satır aksiyonu (KIRMIZI) ══════════════ */

describe("P-2 · satır tıklaması ile satır aksiyonu ÇAKIŞMAZ", () => {
  async function listeyiAc() {
    izinVer(VIEW, MANAGE);
    sunucu("/packing/packages", {
      data: { items: [PAKET({ status: "RETURNED" })], total: 1 },
    });
    sar();
    await screen.findAllByText("PKT-000077");
  }

  it("masaüstünde satıra tıklamak paket detayına gider", async () => {
    await listeyiAc();
    fireEvent.click(screen.getAllByText("PKT-000077")[0]);
    expect(await screen.findByText("PAKET DETAYI")).toBeTruthy();
  });

  it("satır AKSİYONUNA basmak satırı AÇMAZ (SK-1'in gerçek ekran sınavı)", async () => {
    await listeyiAc();
    // İKİ eşleşme beklenir (mobil kart + masaüstü satırı) — ÜÇ değil.
    // Üçüncüsü A7d2'de bulunan SK-5'ti: görünmez "satırı aç" düğmesi adını
    // kart içeriğinden alıyordu ve kartın aksiyon metinlerini yutuyordu.
    const dugmeler = screen.getAllByRole("button", { name: /^Yeniden paketle$/ });
    expect(dugmeler).toHaveLength(2);
    fireEvent.click(dugmeler[0]);
    // Onay penceresi açılır; satır tıklaması TETİKLENMEZ.
    expect(await screen.findByRole("heading", { name: "Yeniden dağıtıma ver" })).toBeTruthy();
    expect(screen.queryByText("PAKET DETAYI")).toBeNull();
  });

  it("seçim KUTUSUNA basmak satırı AÇMAZ", async () => {
    await listeyiAc();
    const kutu = screen.getAllByRole("checkbox", { name: /PKT-000077/ })[0];
    fireEvent.click(kutu);
    expect(screen.queryByText("PAKET DETAYI")).toBeNull();
    expect((kutu as HTMLInputElement).checked).toBe(true);
  });

  it("mobil kartta iç içe <button> YOKTUR ve aksiyon satırı açmaz", async () => {
    await listeyiAc();
    const kap = mobilKap();
    expect(kap.querySelectorAll("button button").length).toBe(0);
    fireEvent.click(within(kap).getByRole("button", { name: /^Yeniden paketle$/ }));
    expect(screen.queryByText("PAKET DETAYI")).toBeNull();
  });

  it("görünmez 'satırı aç' düğmesinin adı kartın AKSİYONLARINI içermez (SK-5)", async () => {
    await listeyiAc();
    const kap = mobilKap();
    const acDugmesi = within(kap).getByRole("button", { name: /paket detayı/i });
    const ad = acDugmesi.getAttribute("aria-label") ?? "";
    expect(ad).toContain("PKT-000077");
    // Kartın kendi aksiyonlarının metni bu düğmenin adına KARIŞMAMALI.
    expect(ad).not.toMatch(/Yeniden paketle|Etiket|Bozuldu/);
  });
});

/* ══════════════ 3 · Boş durum ayrımı (KIRMIZI) ══════════════ */

describe("P-3 · 'filtre eşleşmedi' ile 'kayıt yok' ayrı", () => {
  it("süzgeçsiz boş listede DAVET metni çıkar, çıkış yolu sunulmaz", async () => {
    izinVer(VIEW);
    sunucu("/packing/packages", { data: { items: [], total: 0 } });
    sar();
    expect(await screen.findByText("Henüz paket açılmadı")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Süzgeci temizle" })).toBeNull();
  });

  it("süzgeçli boş listede DÜZELTME metni ve çıkış yolu çıkar", async () => {
    izinVer(VIEW);
    sunucu("/packing/packages", { data: { items: [], total: 0 } });
    sar("/yonetim/paketleme/paketler?durum=RETURN_PENDING");
    expect(await screen.findByText("Bu süzgeçte paket yok")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Süzgeci temizle" })).toBeTruthy();
  });
});

/* ══════════════ 4 · Sayfalama ortak yüzeyden (KIRMIZI) ══════════════ */

describe("P-4 · sayfalama ortak tablodan gelir", () => {
  it("sayfa değişimi adrese yazılır ve isteğe offset olarak gider", async () => {
    izinVer(VIEW);
    sunucu("/packing/packages", {
      data: { items: [PAKET()], total: 120 },
    });
    sar();
    await screen.findAllByText("PKT-000077");
    fireEvent.click(screen.getByRole("button", { name: "Sonraki" }));
    await waitFor(() => {
      const sonIstek = [...istekler].reverse().find((i) => i.url.includes("/packing/packages"));
      expect(sonIstek?.url).toMatch(/offset=50/);
    });
  });
});
