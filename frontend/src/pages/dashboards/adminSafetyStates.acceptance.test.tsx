// İP-4 · Yıkıcı aksiyon onayı + yalancı boş durum — UI KABUL MATRİSİ (C ve D).
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ. Bir
// iddia uygulamaya uydurmak için zayıflatılacaksa gerekçesi ayrı başlıkta
// raporlanır.
//
// ## C · Onaysız tek-tık yıkım (P1-5 sınıfı)
//
// Denetim raporundaki örnek (`AdminStore.tsx` sipariş iadesi) İP-2b turunda
// `ReasonDialog`'a bağlandı; ama AYNI DOSYADA aynı sınıftan üç aksiyon
// korumasız kaldı: **ürün silme** (`remove.mutate()` doğrudan), **kategori
// silme** ve **"Teslim edildi"**. Üçü de tek tıkla geri alınamaz durum
// değiştirir; ürün silme kataloğu, kategori silme ise kategori ağacını
// etkiler. P1-5'in gerekçesi ("yanlış satıra tıklama") bunlar için de geçerli.
//
// ## D · "Yalancı boş durum" (P1-6)
//
// `isError` okumayan bir liste, 500/403 aldığında "kayıt yok" basar. Yönetici
// bunu "iş yok, her şey yolunda" diye okur ve bekleyen iade/ödeme sessizce
// atlanır. `lib/queryClient.ts` 403/404'ü bildirimden muaf tuttuğu için 403
// TAMAMEN sessizdir — bu yüzden 403 ayrı bir node'dur.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { Toaster } from "@/components/Toaster";
import AdminPayoutsPage from "@/pages/admin/AdminPayoutsPage";
import AdminSectionPage from "@/pages/admin/AdminSectionPage";
import AdminStore from "@/pages/dashboards/AdminStore";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu ══════════════ */

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

type Yanit = { status?: number; data: unknown } | ((istek: Istek) => { status?: number; data: unknown });

let istekler: Istek[] = [];
let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit }[] = [];
let eskiAdapter: unknown;
/** Yanıtı testin elinde tutulan bir söze bağlar (isPending penceresi için). */
let bekletici: (() => void) | null = null;

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
  bekletici = null;
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const sorgu = new URLSearchParams(
      Object.entries((config.params ?? {}) as Record<string, unknown>).map(
        ([k, v]) => [k, String(v)] as [string, string]
      )
    ).toString();
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url) + (sorgu ? `?${sorgu}` : ""),
      body: config.data ? JSON.parse(String(config.data)) : null,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota ? (typeof rota.yanit === "function" ? rota.yanit(istek) : rota.yanit) : { data: {} };
    const status = ham.status ?? 200;
    if (status === 599) {
      // 599 = "asılı kal": yanıt testin `bekletici`'yi çağırmasıyla döner.
      await new Promise<void>((resolve) => {
        bekletici = resolve;
      });
      return { data: {}, status: 200, statusText: "OK", headers: {}, config } as never;
    }
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
  useToastStore.setState({ toasts: [] });
});

function izinVer(...kodlar: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

function sar(yol: string, eleman: React.ReactNode, desen = yol) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Routes>
          <Route path={desen} element={eleman} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

const URUN = {
  id: 5,
  title: "Palme TYT Matematik Soru Bankası",
  price: "250.00",
  kind: "PHYSICAL",
  status: "ACTIVE",
  seller_type: "PLATFORM",
  cover_url: null,
  tutor_name: null,
};

const KATEGORI = { id: 3, name: "Deneme Kitapları", product_count: 4 };

const SIPARIS = {
  id: 77,
  total: "250.00",
  status: "SHIPPED",
  payment_status: "PAID",
  has_physical: true,
  ship_address: "Ceyhan / Adana",
  ship_recipient: "Ayşe Y.",
  created_at: "2027-04-01T09:00:00+00:00",
};

const IADE = {
  id: 12,
  order_id: 77,
  status: "PENDING",
  reason: "Kitap hasarlı geldi",
  admin_note: null,
  created_at: "2027-04-02T09:00:00+00:00",
  order: { total: "250.00", ship_recipient: "Ayşe Y.", ship_address: "Ceyhan / Adana" },
};

const DIPLOMA = {
  id: 9,
  tutor_id: 41,
  tutor_name: "Aday Ogretmen",
  school_name: "Çukurova Üniversitesi",
  degree: "Lisans",
  field_of_study: "Matematik",
  document_type: "DIPLOMA",
  document_url: null,
  verification_code: "ABC123",
  verification_tckn: "12345678901",
};

const HAKEDIS_KAYDI = {
  id: 4,
  paid_at: "2027-03-01T09:00:00+00:00",
  payee_type: "TUTOR",
  payee_id: 41,
  amount: "1200.00",
  reference: "HVL-1",
  iban_snapshot: "TR33 **** 1326",
};

/**
 * Ürün satırını başlığından bulur.
 *
 * İP-12 UYARLAMASI (davranış iddiası DEĞİŞMEDİ): ürün listesi A1 ile kart
 * yığınından `DataTable`'a taşındı, yani satır artık `div.rounded-xl` değil
 * `<tr>`. Bu testlerin ölçtüğü şey — "Sil tek başına DELETE göndermez",
 * "onay düğmesi istek uçarken disabled kalır", "409 gerekçesi ekranda görünür"
 * — aynen korunuyor; değişen yalnız satırın DOM'da nasıl bulunduğu.
 *
 * Seçici ikisini de kabul ediyor ki düzen bir daha değişirse test yine
 * yerleşime değil DAVRANIŞA bakmaya devam etsin.
 */
async function urunSatiri(baslik: string): Promise<HTMLElement> {
  const hucre = await screen.findByText(baslik);
  const satir = hucre.closest("tr, div.rounded-xl");
  if (!satir) throw new Error(`"${baslik}" için satır bulunamadı`);
  return satir as HTMLElement;
}

/* ═════════════════════ C-1/C-2/C-3 · Yıkıcı aksiyon sözleşmesi ═════════════════════ */

describe("C-1 · yıkıcı aksiyon onay penceresi olmadan istek üretmez", () => {
  it("ürün silme: 'Sil' tıklaması tek başına DELETE göndermez", async () => {
    izinVer("products.view", "products.manage");
    sunucu("/store/admin/products", { data: [URUN] }, "get");
    sunucu(/\/store\/admin\/products\/5$/, { data: {} }, "delete");

    sar(ROUTES.adminStoreProducts, <AdminStore />);

    const satir = await urunSatiri(URUN.title);
    fireEvent.click(within(satir as HTMLElement).getByRole("button", { name: "Sil" }));

    // Onay penceresi açılmalı; istek HENÜZ gitmemeli.
    expect(await screen.findByRole("button", { name: "Ürünü sil" })).toBeTruthy();
    expect(istekler.some((i) => i.method === "delete")).toBe(false);
  });

  it("ürün silme: onaydan SONRA gerçek DELETE gider", async () => {
    izinVer("products.view", "products.manage");
    sunucu("/store/admin/products", { data: [URUN] }, "get");
    sunucu(/\/store\/admin\/products\/5$/, { data: {} }, "delete");

    sar(ROUTES.adminStoreProducts, <AdminStore />);

    const satir = await urunSatiri(URUN.title);
    fireEvent.click(within(satir as HTMLElement).getByRole("button", { name: "Sil" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ürünü sil" }));

    await screen.findByText(/ürün silindi/i);
    expect(
      istekler.some((i) => i.method === "delete" && i.url.endsWith("/store/admin/products/5"))
    ).toBe(true);
  });

  it("kategori silme: 'Sil' tıklaması tek başına DELETE göndermez", async () => {
    izinVer("products.view", "products.manage");
    sunucu("/store/categories", { data: [KATEGORI] }, "get");
    sunucu(/\/store\/admin\/categories\/3$/, { data: {} }, "delete");

    sar(ROUTES.adminStoreCategories, <AdminStore />);

    const satir = (await screen.findByText(/Deneme Kitapları/)).closest("div");
    fireEvent.click(within(satir as HTMLElement).getByRole("button", { name: "Sil" }));

    expect(await screen.findByRole("button", { name: "Kategoriyi sil" })).toBeTruthy();
    expect(istekler.some((i) => i.method === "delete")).toBe(false);
  });

  it("'Teslim edildi' tek tıkla siparişi kapatmaz", async () => {
    izinVer("orders.view", "orders.manage");
    sunucu("/store/admin/orders", { data: [SIPARIS] }, "get");
    sunucu("/store/admin/orders/77/deliver", { data: SIPARIS }, "post");

    sar(ROUTES.adminStoreOrders, <AdminStore />);

    fireEvent.click(await screen.findByRole("button", { name: "Teslim edildi" }));

    expect(await screen.findByRole("button", { name: "Teslim edildi olarak işaretle" })).toBeTruthy();
    expect(istekler.some((i) => i.url.includes("/deliver"))).toBe(false);
  });
});

describe("C-2 · istek uçarken onay düğmesi devre dışı (çift tıklama yok)", () => {
  it("ürün silme onayı beklerken düğme disabled kalır", async () => {
    izinVer("products.view", "products.manage");
    sunucu("/store/admin/products", { data: [URUN] }, "get");
    sunucu(/\/store\/admin\/products\/5$/, { status: 599, data: {} }, "delete");

    sar(ROUTES.adminStoreProducts, <AdminStore />);

    const satir = await urunSatiri(URUN.title);
    fireEvent.click(within(satir as HTMLElement).getByRole("button", { name: "Sil" }));
    const onay = await screen.findByRole("button", { name: "Ürünü sil" });
    fireEvent.click(onay);

    await waitFor(() => expect((onay as HTMLButtonElement).disabled).toBe(true));
    // İkinci tıklama ikinci istek üretmemeli.
    fireEvent.click(onay);
    expect(istekler.filter((i) => i.method === "delete").length).toBe(1);
    bekletici?.();
  });
});

describe("C-3 · yıkıcı aksiyon patlarsa kullanıcı hatayı GÖRÜR", () => {
  it("ürün silme 409 dönerse sunucunun gerekçesi ekranda görünür", async () => {
    izinVer("products.view", "products.manage");
    sunucu("/store/admin/products", { data: [URUN] }, "get");
    sunucu(
      /\/store\/admin\/products\/5$/,
      { status: 409, data: { detail: "Ürün açık siparişte kullanılıyor." } },
      "delete"
    );

    sar(ROUTES.adminStoreProducts, <AdminStore />);

    const satir = await urunSatiri(URUN.title);
    fireEvent.click(within(satir as HTMLElement).getByRole("button", { name: "Sil" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ürünü sil" }));

    expect(await screen.findByText(/açık siparişte kullanılıyor/i)).toBeTruthy();
  });

  it("kategori silme patlarsa sessiz kalmaz", async () => {
    izinVer("products.view", "products.manage");
    sunucu("/store/categories", { data: [KATEGORI] }, "get");
    sunucu(/\/store\/admin\/categories\/3$/, { status: 500, data: {} }, "delete");

    sar(ROUTES.adminStoreCategories, <AdminStore />);

    const satir = (await screen.findByText(/Deneme Kitapları/)).closest("div");
    fireEvent.click(within(satir as HTMLElement).getByRole("button", { name: "Sil" }));
    fireEvent.click(await screen.findByRole("button", { name: "Kategoriyi sil" }));

    expect(await screen.findByText(/silinemedi/i)).toBeTruthy();
  });
});

/* ═════════════════════ D-1/D-2 · Yalancı boş durum ═════════════════════ */

type Senaryo = {
  ad: string;
  yol: string;
  desen?: string;
  eleman: React.ReactNode;
  izinler: string[];
  /** Hata verdirilecek uç. */
  uc: string | RegExp;
  /** Bu metin hata hâlinde ekranda GÖRÜNMEMELİ (yalancı boş durum). */
  bosMetin: RegExp;
  /** Ekranı hazırlayan yardımcı istekler. */
  hazirla?: () => void;
};

const SENARYOLAR: Senaryo[] = [
  {
    ad: "AdminStore · siparişler",
    yol: ROUTES.adminStoreOrders,
    eleman: <AdminStore />,
    izinler: ["orders.view", "orders.manage"],
    uc: "/store/admin/orders",
    bosMetin: /sipariş yok/i,
  },
  {
    ad: "AdminStore · iadeler",
    yol: ROUTES.adminStoreReturns,
    eleman: <AdminStore />,
    izinler: ["returns.view", "returns.manage"],
    uc: "/store/admin/returns",
    bosMetin: /iade talebi yok/i,
  },
  {
    ad: "AdminHome · diploma kuyruğu",
    yol: "/yonetim/diplomalar",
    eleman: <AdminSectionPage section="diplomas" />,
    izinler: ["tutors.view", "tutors.manage"],
    uc: "/admin/educations/pending",
    bosMetin: /teyit bekleyen belge yok/i,
  },
  {
    ad: "AdminPayouts · ödeme geçmişi",
    yol: ROUTES.adminPayouts,
    eleman: <AdminPayoutsPage />,
    izinler: ["payments.view", "payments.manage"],
    // Geçmiş ucu GET /payouts (pending ile aynı önek) — desen tam eşleşmeli.
    uc: /^\/payouts$/,
    bosMetin: /henüz ödeme kaydı yok/i,
    hazirla: () => sunucu("/payouts/pending", { data: [] }, "get"),
  },
];

/** Ödeme geçmişi ikinci sekmededir; hata durumunu görmek için açılması gerekir. */
async function sekmeAc(senaryo: Senaryo) {
  if (senaryo.ad.includes("Payouts")) {
    fireEvent.click(await screen.findByRole("button", { name: "Ödeme geçmişi" }));
  }
}

describe.each(SENARYOLAR)("D-1 · $ad: hata 'kayıt yok' diye gösterilmez", (senaryo) => {
  it("500'de hata durumu görünür, boş-durum metni GÖRÜNMEZ", async () => {
    izinVer(...senaryo.izinler);
    senaryo.hazirla?.();
    sunucu(senaryo.uc, { status: 500, data: { detail: "sunucu hatası" } }, "get");

    sar(senaryo.yol, senaryo.eleman, senaryo.desen ?? senaryo.yol);
    await sekmeAc(senaryo);

    // `findAllByText`: ortak `ErrorState` hem başlık ("Veriler yüklenemedi")
    // hem açıklama basar; tekil sorgu "birden çok eşleşme" ile patlıyordu.
    // İddianın ağırlığı ikinci satırdadır: boş-durum metni GÖRÜNMEMELİ.
    expect(
      (await screen.findAllByText(/yüklenemedi|alınamadı/i)).length,
      "hata durumu hiç gösterilmedi"
    ).toBeGreaterThan(0);
    expect(screen.queryByText(senaryo.bosMetin)).toBeNull();
  });

  it("D-2 · 403'te de sessiz kalmaz", async () => {
    izinVer(...senaryo.izinler);
    senaryo.hazirla?.();
    sunucu(senaryo.uc, { status: 403, data: { detail: "Insufficient admin permission" } }, "get");

    sar(senaryo.yol, senaryo.eleman, senaryo.desen ?? senaryo.yol);
    await sekmeAc(senaryo);

    expect((await screen.findAllByText(/yüklenemedi|alınamadı/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(senaryo.bosMetin)).toBeNull();
  });

  it("gerçekten boşsa boş-durum metni GÖRÜNÜR (hata durumu her şeyi yutmasın)", async () => {
    izinVer(...senaryo.izinler);
    senaryo.hazirla?.();
    sunucu(senaryo.uc, { data: [] }, "get");

    sar(senaryo.yol, senaryo.eleman, senaryo.desen ?? senaryo.yol);
    await sekmeAc(senaryo);

    expect(await screen.findByText(senaryo.bosMetin)).toBeTruthy();
  });
});

describe("D · veri geldiğinde liste basılır (hata durumu yanlış tetiklenmiyor)", () => {
  it("siparişler", async () => {
    izinVer("orders.view", "orders.manage");
    sunucu("/store/admin/orders", { data: [SIPARIS] }, "get");
    sar(ROUTES.adminStoreOrders, <AdminStore />);
    expect(await screen.findByText(/#77/)).toBeTruthy();
  });

  it("iadeler", async () => {
    izinVer("returns.view", "returns.manage");
    sunucu("/store/admin/returns", { data: [IADE] }, "get");
    sar(ROUTES.adminStoreReturns, <AdminStore />);
    expect(await screen.findByText(/Kitap hasarlı geldi/)).toBeTruthy();
  });

  it("diploma kuyruğu", async () => {
    izinVer("tutors.view", "tutors.manage");
    sunucu("/admin/educations/pending", { data: [DIPLOMA] }, "get");
    sar("/yonetim/diplomalar", <AdminSectionPage section="diplomas" />);
    expect(await screen.findByText(/Çukurova Üniversitesi/)).toBeTruthy();
  });

  it("ödeme geçmişi", async () => {
    izinVer("payments.view", "payments.manage");
    sunucu("/payouts/pending", { data: [] }, "get");
    sunucu(/^\/payouts$/, { data: [HAKEDIS_KAYDI] }, "get");
    sar(ROUTES.adminPayouts, <AdminPayoutsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Ödeme geçmişi" }));
    expect(await screen.findByText("HVL-1")).toBeTruthy();
  });
});
