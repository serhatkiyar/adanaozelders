// P2 — vitrin TEK NESİL: sessiz fallback yerine görünür düşüş.
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.
//
// ## Neden
//
// `/magaza` üç kademeli bir fallback taşıyordu: kanonik bloklar yoksa eski
// hero (G2) + eski bölümler (G3), o da yoksa koda gömülü ürün şeritleri.
// Sektör ayrımı net: "graceful degradation" operatörün kısıtlı modu BİLDİĞİ,
// kasıtlı ve GÖRÜNÜR bir yetenek azalmasıdır; "silent fallback" ise hatayı
// operatörden ve izlemeden gizleyen görünmez bir kod yolu değişimidir.
// Bizimki ikincisiydi — üstelik daha kötüsü: aynı sayfanın eski kopyasını
// değil, BAŞKA BİR NESLİN içeriğini basıyordu. Bir bozukluk günlerce
// yaşayabilir ve kimse fark etmezdi.
//
// Bu proje aynı dersi rota katmanında bir kez öğrendi (CLAUDE.md: "VROOM
// düşerse geriler — ama artık SESSİZCE değil: devre kesici + /health raporu
// + üretimde ERROR log"). Vitrin de aynı doktrine giriyor.
//
// ## Testin ayırt ediciliği
//
// "Hata durumunda bir şey göründü mü" diye sormak YETMEZ: eski fallback de
// bir şey gösteriyordu. Bu yüzden iki iddia AYRI AYRI kurulur:
//   1. hata yüzeyi GERÇEKTEN basılıyor (kullanıcı kayboluş yaşamıyor),
//   2. eski nesil uçlarına istek DOĞMUYOR ve eski bileşenler DOM'da YOK.
// İkincisi olmadan test, fallback geri gelse bile yeşil kalırdı.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import StorePage from "@/pages/store/StorePage";

import type { AxiosRequestConfig } from "axios";

/** Bu turda GERÇEKTEN çağrılan uçlar. */
let istekler: string[] = [];
let eskiAdapter: unknown;
/** `/store/home` bu turda hata mı dönsün? */
let anaSayfaHata = false;

const KANONIK_HOME = {
  id: 1,
  slug: "ana-sayfa",
  page_type: "HOME",
  state: "LIVE",
  revision: {
    id: 9,
    blocks: [
      {
        id: 1,
        block_key: "b1",
        block_type: "RICH_TEXT",
        title: "Kanonik Bölüm",
        description: "",
        link_label: "",
        link_url: null,
        config: { content: "merhaba" },
        is_active: true,
        sort_order: 0,
        products: [],
        categories: [],
        warnings: [],
      },
    ],
  },
};

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  anaSayfaHata = false;
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    istekler.push(url.split("?")[0]);
    if (url.includes("/store/home") && !url.includes("home-sections")) {
      if (anaSayfaHata) {
        // Gerçek arıza: sunucu 500 veriyor.
        throw Object.assign(new Error("sunucu hatası"), {
          isAxiosError: true,
          response: { status: 500, data: {}, headers: {}, config },
        });
      }
      return { data: KANONIK_HOME, status: 200, statusText: "OK", headers: {}, config } as never;
    }
    return { data: [], status: 200, statusText: "OK", headers: {}, config } as never;
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
        <MemoryRouter initialEntries={["/magaza"]}>
          <StorePage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

/** Ölmesi planlanan nesillerin public uçları. */
const ESKI_UCLAR = [
  "/store/hero-slides",
  "/store/home-sections",
  "/store/showcase-cards",
  "/duyuru-seridi/aktif",
];

describe("vitrin tek nesil", () => {
  it("kanonik bloklar basilir", async () => {
    sar();
    expect(await screen.findByText("Kanonik Bölüm")).toBeTruthy();
  });

  it("kanonik akis calisirken ESKI nesil uclarina istek DOGMAZ", async () => {
    sar();
    await screen.findByText("Kanonik Bölüm");
    const eskiCagrilar = istekler.filter((u) =>
      ESKI_UCLAR.some((uc) => u.includes(uc)),
    );
    // Kaynak taramasi yetmez: hook'lar KOSULSUZ calistigi icin render
    // edilmeyen bir dal bile istek doguruyordu (olculdu: her yuklemede
    // /store/home-sections cagriliyordu).
    expect(eskiCagrilar).toEqual([]);
  });

  it("ana sayfa hata verirse GORUNUR bir hata yuzeyi basilir", async () => {
    anaSayfaHata = true;
    sar();
    const uyari = await screen.findByRole("alert");
    expect(uyari.textContent).toMatch(/vitrin|yüklenemedi|görüntülenemiyor/i);
  });

  it("ana sayfa hata verse DE eski nesle SESSIZCE dusulmez", async () => {
    anaSayfaHata = true;
    sar();
    await screen.findByRole("alert");
    await waitFor(() => {
      const eskiCagrilar = istekler.filter((u) =>
        ESKI_UCLAR.some((uc) => u.includes(uc)),
      );
      expect(eskiCagrilar).toEqual([]);
    });
  });
});
