// F30 paketleme ekranları — UI KABUL MATRİSİ (gerçek DOM).
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ. Bir iddia
// uygulamaya uydurmak için zayıflatılacaksa gerekçesi ayrı başlıkta raporlanır.
//
// Paketin ilk commit'i olduğu için ekranlar henüz YOKTUR: ilk koşum kırmızıdır.
//
// Neden saf test yetmez: `lib/packing.ts` kuralları doğru olsa bile arayüzün
// onları kullanmaması mümkündür — özellikle **tarama reddi**, çünkü uç 200
// döner (sözleşme §6) ve ekran `result` alanını okumazsa red sessizce yutulur.
// Burada gerçek bileşen render edilir, gerçek tıklama yapılır, gerçek axios
// isteği (adapter üzerinden) gözlenir.
//
// Bileşenler dinamik import edilir: statik import, dosya yokken tüm matrisi
// collection'da düşürür ve ~14 kabul kriteri tek satıra iner.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Ağır ortak modüller BİLE BİLE statik import ediliyor (İP-A7d2 · Görev 5) ──
//
// Ekranlar `import.meta.glob` ile TEMBEL yükleniyor ve maliyeti ilk testin
// İÇİNDE ödeniyor. `PackagesPage` A7d2'de ortak `DataTable` + düzenleme
// yüzeyine bağlanınca maliyet ölçüldü (paralel `src/pages/admin` koşumu,
// modül yükleme süresi):
//
//   | Ekran | Önce | Sonra |
//   |---|---|---|
//   | PackingLayout / QueuePage / StationPage | 129–581 ms | 34–76 ms |
//   | **PackagesPage** | **10.093 ms** | **68 ms** |
//
// Dosyanın İLK testi — paketleme kuyruğu — o ekranı hiç kullanmadığı hâlde
// 9 sn'lik test bütçesini aşıyordu (9296 ms, "Test timed out").
//
// Ağır olan `@tanstack/react-table` değil, `ui2/duzenlemeYuzeyi` üzerinden
// gelen `@medusajs/ui` idi (yalnız `data-table` ön-yüklendiğinde süre 10 sn
// olarak KALDI — ölçüldü).
//
// Bütçe BÜYÜTÜLMEDİ ve bu bilinçli: yavaşlık üretim kodunda değil test
// kurulumundadır. Modüller burada statik alınınca maliyet TOPLAMA (collect)
// evresine geçer — orada test bütçesi yoktur ve önbellek bütün testler için
// sıcak başlar.
import "@/components/admin/data-table";
import "@/components/admin/ui2/duzenlemeYuzeyi";

// ── Ağır ortak modül BİLE BİLE statik import ediliyor (İP-A7d2 · Görev 5) ──
//
// Ekranlar `import.meta.glob` ile TEMBEL yükleniyor ve maliyeti ilk testin
// İÇİNDE ödeniyor. `PackagesPage` A7d2'de ortak `DataTable`a (dolayısıyla
// `@tanstack/react-table`e) bağlanınca o maliyet ölçüldü: paralel yük altında
// **10.093 ms** (diğer üç ekran 0–581 ms). Dosyanın İLK testi — paketleme
// kuyruğu — o ekranı hiç kullanmadığı hâlde 9 sn'lik test bütçesini aşıyordu.
//
// Bütçeyi büyütmek yanlış cevap olurdu: yavaşlık üretim kodunda değil, test
// kurulumunda. Ağır modül burada statik olarak alınınca maliyet TOPLAMA
// (collect) evresine geçer — orada test bütçesi yoktur ve modül önbelleği
// bütün testler için sıcak başlar. Ölçüldü: ilk test 9296 ms → 138 ms.
import "@/components/admin/data-table";

import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

const VIEW = "packing.view";
const PACK = "packing.pack";

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
    const sorgu = new URLSearchParams(
      Object.entries((config.params ?? {}) as Record<string, unknown>).map(
        ([k, v]) => [k, String(v)] as [string, string],
      ),
    ).toString();
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      // Query dahil TAM adres: filtre `params`ta taşınır, `url`de değil.
      url: String(config.url) + (sorgu ? `?${sorgu}` : ""),
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
  // Store'un ÜÇ alanı da sıfırlanır (F29'da öğrenildi): yalnız `user`'ı
  // temizlemek, bir guard eklendiğinde "yetkisiz görmez" iddialarını sessizce
  // "oturum kapalı" sebebiyle geçirmeye başlardı.
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

/* ══════════════ Render ══════════════ */

function izinVer(...kodlar: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

// `import.meta.glob`: Vite düz dinamik import'u derleme anında çözer ve ekranlar
// henüz yokken tüm matrisi collection'da düşürür ("no tests" — 14 kabul kriteri
// tek satıra iner). Glob, olmayan dosya için boş eşleşme döndürür.
const EKRANLAR = import.meta.glob([
  "./PackingLayout.tsx",
  "./PackingQueuePage.tsx",
  "./PackingStationPage.tsx",
  "./PackagesPage.tsx",
]);

async function ekranlar() {
  const al = async (ad: string) => {
    const yukle = EKRANLAR[`./${ad}.tsx`];
    if (!yukle) throw new Error(`HENÜZ YAZILMADI: src/pages/admin/packing/${ad}.tsx`);
    return ((await yukle()) as Record<string, any>).default;
  };
  return {
    Layout: await al("PackingLayout"),
    Kuyruk: await al("PackingQueuePage"),
    Istasyon: await al("PackingStationPage"),
    Paketler: await al("PackagesPage"),
  };
}

async function sar(yol: string) {
  const { Layout, Kuyruk, Istasyon, Paketler } = await ekranlar();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Routes>
          <Route path="/yonetim/paketleme" element={<Layout />}>
            <Route index element={<Kuyruk />} />
            <Route path="paketler" element={<Paketler />} />
            <Route path="paket/:id" element={<Istasyon />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/* ══════════════ Fixture'lar ══════════════ */

const KUYRUK = [
  {
    order_id: 501,
    recipient: "Ayşe Yılmaz",
    address: "Seyhan, Adana",
    item_count: 3,
    promised_delivery_date: "2026-08-01",
    package: null,
  },
];

const PAKET_ACIK = {
  id: 77,
  code: "PKT-000077",
  order_id: 501,
  status: "OPEN",
  qr_payload: "PKG1:77:tok",
  packed_at: null,
  unpacked_at: null,
  items: [
    {
      order_item_id: 9001,
      product_id: 11,
      sku: "FZK-000011",
      barcode: "8690000000011",
      title: "Palme TYT Matematik Soru Bankası",
      expected_qty: 2,
      scanned_qty: 0,
    },
    {
      order_item_id: 9002,
      product_id: 12,
      sku: "FZK-000012",
      barcode: null,
      title: "345 AYT Fizik",
      expected_qty: 1,
      scanned_qty: 0,
    },
  ],
};

const paketle = (over: Partial<typeof PAKET_ACIK> = {}) => ({ ...PAKET_ACIK, ...over });

/* ══════════════ Kuyruk ══════════════ */

describe("paketleme kuyruğu", () => {
  it("bekleyen siparişi alıcı ve kalem sayısıyla gösterir", async () => {
    izinVer(VIEW, PACK);
    sunucu("/packing/queue", { data: { items: KUYRUK, total: 1 } });
    await sar("/yonetim/paketleme");
    expect(await screen.findByText(/Ayşe Yılmaz/)).toBeTruthy();
    expect(screen.getByText(/501/)).toBeTruthy();
  });

  it("yalnız görüntüleme izniyle 'Paketle' aksiyonu SUNULMAZ", async () => {
    izinVer(VIEW);
    sunucu("/packing/queue", { data: { items: KUYRUK, total: 1 } });
    await sar("/yonetim/paketleme");
    await screen.findByText(/Ayşe Yılmaz/);
    expect(screen.queryByRole("button", { name: /paketle/i })).toBeNull();
  });

  it("izinsiz yöneticiye erişim reddi gösterir ve İSTEK ATMAZ", async () => {
    // Yalnız "buton görünmüyor" yetmez: veri çekiliyorsa yetkisiz kullanıcı
    // 403'ü ekranda değil ağ katmanında yer.
    izinVer("orders.view");
    sunucu("/packing/queue", { data: { items: KUYRUK, total: 1 } });
    await sar("/yonetim/paketleme");
    await waitFor(() => expect(screen.getByText(/yetki/i)).toBeTruthy());
    expect(istekler.filter((i) => i.url.includes("/packing/queue"))).toHaveLength(0);
  });

  it("boş kuyrukta boş durum gösterir", async () => {
    izinVer(VIEW, PACK);
    sunucu("/packing/queue", { data: { items: [], total: 0 } });
    await sar("/yonetim/paketleme");
    expect(await screen.findByText(/bekleyen|boş|yok/i)).toBeTruthy();
  });
});

/* ══════════════ İstasyon: kalemler ══════════════ */

describe("paketleme istasyonu", () => {
  it("DOĞRU kalemleri SKU ve beklenen adetle gösterir", async () => {
    // Kullanıcı maddesi 2. F26'da tam bu eksikti: hazırlama ekranı ne
    // satın alındığını göstermiyordu.
    izinVer(VIEW, PACK);
    sunucu("/packing/packages/77", { data: paketle() });
    await sar("/yonetim/paketleme/paket/77");
    expect(await screen.findByText(/Palme TYT Matematik/)).toBeTruthy();
    expect(screen.getByText(/FZK-000011/)).toBeTruthy();
    expect(screen.getByText(/345 AYT Fizik/)).toBeTruthy();
    expect(screen.getByText(/FZK-000012/)).toBeTruthy();
    expect(screen.getByText("PKT-000077")).toBeTruthy();
  });

  it("okutulan kod GERÇEKTEN istek gövdesinde gider", async () => {
    izinVer(VIEW, PACK);
    sunucu("/packing/packages/77", { data: paketle() });
    sunucu(
      "/packing/packages/77/scan",
      { data: { result: "OK", ...paketle({ items: [{ ...PAKET_ACIK.items[0], scanned_qty: 1 }, PAKET_ACIK.items[1]] }) } },
      "post",
    );
    await sar("/yonetim/paketleme/paket/77");
    const kutu = await screen.findByRole("textbox", { name: /kod|barkod|okut/i });
    fireEvent.change(kutu, { target: { value: "8690000000011" } });
    fireEvent.submit(kutu.closest("form")!);

    await waitFor(() => {
      const g = istekler.find((i) => i.url.includes("/scan"));
      expect(g, "tarama isteği hiç gitmedi").toBeTruthy();
      expect(g!.body?.code).toBe("8690000000011");
      // Çift gönderim adedi iki kez artırmasın (kullanıcı ilkesi).
      expect(g!.body?.idempotency_key, "idempotency anahtarı gönderilmedi").toBeTruthy();
    });
  });

  it("YANLIŞ SKU reddi EKRANDA görünür ve adet ARTMAZ", async () => {
    // Uç 200 döndüğü için bu, reddin kullanıcıya ulaştığının TEK kanıtıdır.
    izinVer(VIEW, PACK);
    sunucu("/packing/packages/77", { data: paketle() });
    sunucu("/packing/packages/77/scan", { data: { result: "WRONG_SKU", ...paketle() } }, "post");
    await sar("/yonetim/paketleme/paket/77");
    const kutu = await screen.findByRole("textbox", { name: /kod|barkod|okut/i });
    fireEvent.change(kutu, { target: { value: "9999999999999" } });
    fireEvent.submit(kutu.closest("form")!);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/bu siparişte yok|yanlış/i);
    expect(screen.getByTestId("satir-9001").textContent).toMatch(/0\s*\/\s*2/);
  });

  it("FAZLA ADET reddi ekranda görünür", async () => {
    izinVer(VIEW, PACK);
    const dolu = paketle({
      items: [{ ...PAKET_ACIK.items[0], scanned_qty: 2 }, PAKET_ACIK.items[1]],
    });
    sunucu("/packing/packages/77", { data: dolu });
    sunucu("/packing/packages/77/scan", { data: { result: "OVER_QTY", ...dolu } }, "post");
    await sar("/yonetim/paketleme/paket/77");
    const kutu = await screen.findByRole("textbox", { name: /kod|barkod|okut/i });
    fireEvent.change(kutu, { target: { value: "8690000000011" } });
    fireEvent.submit(kutu.closest("form")!);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/fazla|tamamland/i);
  });

  it("EKSİK kalemle 'Tamamla' devre dışıdır ve gerekçe gösterir", async () => {
    izinVer(VIEW, PACK);
    sunucu("/packing/packages/77", { data: paketle() });
    await sar("/yonetim/paketleme/paket/77");
    const buton = await screen.findByRole("button", { name: /tamamla|paketi kapat/i });
    expect((buton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/eksik|bekleniyor/i)).toBeTruthy();
  });

  it("TAM pakette 'Tamamla' isteği gönderilir", async () => {
    izinVer(VIEW, PACK);
    const tam = paketle({
      items: [
        { ...PAKET_ACIK.items[0], scanned_qty: 2 },
        { ...PAKET_ACIK.items[1], scanned_qty: 1 },
      ],
    });
    sunucu("/packing/packages/77", { data: tam });
    sunucu("/packing/packages/77/complete", { data: { ...tam, status: "PACKED" } }, "post");
    await sar("/yonetim/paketleme/paket/77");
    const buton = await screen.findByRole("button", { name: /tamamla|paketi kapat/i });
    expect((buton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(buton);
    await waitFor(() =>
      expect(istekler.some((i) => i.url.includes("/complete"))).toBe(true),
    );
  });

  it("manuel doğrulama GEREKÇESİZ gönderilemez", async () => {
    // Kaçış kapısı akışın içindedir ama izsiz değildir (sözleşme §3.6).
    izinVer(VIEW, PACK);
    sunucu("/packing/packages/77", {
      data: paketle({
        items: [{ ...PAKET_ACIK.items[0], product_id: null, sku: null, barcode: null }],
      }),
    });
    await sar("/yonetim/paketleme/paket/77");
    fireEvent.click(await screen.findByRole("button", { name: /elle doğrula|manuel/i }));
    const gonder = await screen.findByRole("button", { name: /onayla|kaydet/i });
    fireEvent.click(gonder);
    await waitFor(() =>
      expect(istekler.filter((i) => i.url.includes("/scan"))).toHaveLength(0),
    );
  });

  it("sunucu hatasında ErrorState gösterir", async () => {
    izinVer(VIEW, PACK);
    sunucu("/packing/packages/77", { status: 500, data: { detail: "patladı" } });
    await sar("/yonetim/paketleme/paket/77");
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

/* ══════════════ Paket listesi ══════════════ */

describe("paketler listesi", () => {
  it("durum filtresi GERÇEKTEN API sorgusuna gider", async () => {
    // "Filtre çalışıyor" iddiasının tek kanıtı gönderilen query'dir.
    izinVer(VIEW);
    sunucu("/packing/packages", { data: { items: [], total: 0 } });
    await sar("/yonetim/paketleme/paketler?durum=RETURN_PENDING");
    await waitFor(() => {
      const g = istekler.find((i) => i.url.includes("/packing/packages"));
      expect(g?.url).toMatch(/status=RETURN_PENDING/);
    });
  });

  it("geri bekleniyor / bozulacak paketleri ayırt eder", async () => {
    izinVer(VIEW);
    sunucu("/packing/packages", {
      data: {
        items: [
          { id: 1, code: "PKT-000001", order_id: 5, status: "RETURN_PENDING", unpacked_at: null },
          { id: 2, code: "PKT-000002", order_id: 6, status: "VOID", unpacked_at: null },
        ],
        total: 2,
      },
    });
    await sar("/yonetim/paketleme/paketler");
    // İP-A7d2: `DataTable` mobil kartı ve masaüstü satırını birlikte basar.
    expect(await screen.findAllByText(/geri bekleniyor/i)).toHaveLength(2);
    expect(screen.getAllByText(/bozulacak|iptal/i).length).toBeGreaterThan(0);
  });
});
