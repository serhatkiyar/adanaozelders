// F29 envanter ekranları — UI KABUL MATRİSİ (bölüm B: gerçek DOM).
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ. Bir
// iddia uygulamaya uydurmak için zayıflatılacaksa gerekçesi ayrı başlıkta
// raporlanır.
//
// Paketin ilk commit'i olduğu için ekranlar henüz YOKTUR: ilk koşum kırmızıdır.
//
// Neden saf test yetmez: `lib/inventory.ts` kuralları doğru olsa bile arayüzün
// onları kullanmaması mümkündür. Burada gerçek bileşen render edilir, gerçek
// tıklama yapılır, gerçek axios isteği (adapter üzerinden) gözlenir. Kaynak
// taraması UI davranışının kanıtı değildir.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { ADMIN_NAV_ITEMS } from "@/components/admin/layout/adminNavigation";
import InventoryLayout from "@/pages/admin/inventory/InventoryLayout";
import InventoryOverviewPage from "@/pages/admin/inventory/InventoryOverviewPage";
import CountSessionDetailPage from "@/pages/admin/inventory/CountSessionDetailPage";
import CountSessionsPage from "@/pages/admin/inventory/CountSessionsPage";
import DamageEventsPage from "@/pages/admin/inventory/DamageEventsPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

const VIEW = "inventory.view";
const COUNT = "inventory.count";
const APPLY = "inventory.apply";

/* ══════════════ Sahte sunucu — gerçek axios örneği, yalnız adapter değişir ══════════════ */

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
  headers: Record<string, unknown>;
}

type Yanit = { status?: number; data: unknown } | ((istek: Istek) => { status?: number; data: unknown });

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
        ([k, v]) => [k, String(v)] as [string, string]
      )
    ).toString();
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      // Query dahil TAM adres: filtre `params`ta taşınır, `url`de değil.
      url: String(config.url) + (sorgu ? `?${sorgu}` : ""),
      body: config.data ? JSON.parse(String(config.data)) : null,
      headers: (config.headers ?? {}) as Record<string, unknown>,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota ? (typeof rota.yanit === "function" ? rota.yanit(istek) : rota.yanit) : { data: {} };
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
  // Store'un ÜÇ alanı da sıfırlanır. Yalnız `user`'ı temizlemek, ileride
  // `isAuthenticated`/`token` okuyan bir guard eklendiğinde 40+ testin
  // anlamını sessizce değiştirirdi: "yetkisiz kullanıcı butonu görmez"
  // iddiaları "oturum açık değil" sebebiyle geçmeye başlardı.
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

/* ══════════════ Render yardımcıları ══════════════ */

function izinVer(...kodlar: string[]) {
  // GERÇEKÇİ oturum: token ve `isAuthenticated` de kurulur. Aksi hâlde bütün
  // ekran testleri "oturum kapalı" durumunda koşar ve izin kapısının kendisi
  // hiç sınanmamış olur.
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

function sar(yol: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Routes>
          <Route path="/yonetim/envanter" element={<InventoryLayout />}>
            <Route index element={<InventoryOverviewPage />} />
            <Route path="sayimlar" element={<CountSessionsPage />} />
            <Route path="sayimlar/:id" element={<CountSessionDetailPage />} />
            <Route path="hasar" element={<DamageEventsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

const SATIR_SALEABLE = {
  id: 101,
  product_id: 5,
  product_name: "Palme TYT Matematik Soru Bankası",
  product_sku: "FZK-000005",
  bucket: "SALEABLE",
  status: "COUNTED",
  system_qty_snapshot: 8,
  reserved_qty_snapshot: 2,
  counted_qty: 8,
  difference: -2,
  counted_at: "2027-03-03T10:00:00+00:00",
  counted_by_admin_id: 1,
  stale_reason: null,
  resolved_by_admin_id: null,
  resolved_at: null,
  resolution_note: null,
  note: null,
  applied_movement_id: null,
};

const SATIR_DAMAGED = {
  ...SATIR_SALEABLE,
  id: 102,
  bucket: "DAMAGED",
  system_qty_snapshot: 3,
  reserved_qty_snapshot: null,
  counted_qty: 3,
  difference: 0,
};

/**
 * Oturum kodunun DOM'daki düğümleri (İP-A7d3 · kasıtlı test güncellemesi).
 *
 * Sayım listesi ortak `DataTable`a geçti; bileşen masaüstü satırını ve mobil
 * kartı BİRLİKTE basar (görünürlüğü CSS ayırır). Bu yüzden kod iki düğümde
 * bulunur ve `getByText` "birden çok eşleşme" diye patlar.
 *
 * Sayı GEVŞETİLMEDİ: iddia `toHaveLength(2)`dir. `getAllByText(...).length > 0`
 * yazmak, satır iki kez basılsa da (gerçek bir hata) geçerdi.
 */
function kodDugumleri(kod: string): HTMLElement[] {
  return screen.getAllByText(kod);
}

const OTURUM = {
  id: 7,
  code: "SAY-2027-0007",
  status: "REVIEW",
  scope: "MANUAL",
  category_id: null,
  note: null,
  created_by_admin_id: 1,
  created_at: "2027-03-03T09:00:00+00:00",
  started_at: "2027-03-03T09:05:00+00:00",
  submitted_at: "2027-03-03T10:30:00+00:00",
  reviewed_by_admin_id: 1,
  reviewed_at: "2027-03-03T10:30:00+00:00",
  applied_by_admin_id: null,
  applied_at: null,
  cancelled_by_admin_id: null,
  cancelled_at: null,
  cancel_reason: null,
  line_count: 2,
  uncounted_line_count: 0,
  has_stale: false,
};

const detay = (over: Record<string, unknown> = {}, satirlar = [SATIR_SALEABLE, SATIR_DAMAGED]) => ({
  ...OTURUM,
  ...over,
  lines: satirlar,
});

const OLAY = {
  id: 31,
  product_id: 5,
  kind: "TRANSFER",
  qty: 2,
  source_bucket: "SALEABLE",
  reason_code: "KIRIK",
  note: null,
  actor_admin_id: 1,
  created_at: "2027-03-03T11:00:00+00:00",
  idempotency_key: "dmg-abc",
};

function listeSunucusu(oturumlar = [OTURUM]) {
  sunucu("count-sessions", { data: { items: oturumlar, total: oturumlar.length, limit: 25, offset: 0 } }, "get");
}

function detaySunucusu(d: Record<string, unknown> = detay()) {
  sunucu(/count-sessions\/\d+$/, { data: d }, "get");
}

function hasarSunucusu(olaylar = [OLAY]) {
  sunucu("damage-events", { data: { items: olaylar, total: olaylar.length, limit: 25, offset: 0 } }, "get");
  // İP-12/A12: hasar diyaloğu ham ürün ID kutusu yerine ARAMA TABANLI seçici
  // kullanıyor, dolayısıyla ürün arama ucu da kurulmalı. Yanıt sorgudaki
  // terimi ID olarak yorumlar; böylece testler eskisi gibi "5" yazıp o ürünü
  // seçebiliyor ve DAVRANIŞ iddiaları (gövdeye hangi product_id gitti)
  // değişmeden kalıyor.
  sunucu(
    "/store/admin/products",
    (i) => {
      const q = i.url.split("?")[1] ?? "";
      const terim = new URLSearchParams(q).get("q") ?? "";
      const id = Number(terim);
      if (!Number.isInteger(id) || id <= 0) return { data: [] };
      return {
        data: [
          {
            id,
            slug: `urun-${id}`,
            title: `Test Ürünü ${id}`,
            kind: "PHYSICAL",
            seller_type: "PLATFORM",
            price: "100.00",
            currency: "TRY",
            in_stock: true,
            stock: 10,
            rating_count: 0,
            status: "ACTIVE",
            sku: `FZK-${String(id).padStart(6, "0")}`,
          },
        ],
      };
    },
    "get"
  );
}

/**
 * Hasar diyaloğunda ürün seçer.
 *
 * İP-12 UYARLAMASI (davranış iddiaları DEĞİŞMEDİ): A12 ham "Ürün numarası"
 * kutusunu arama tabanlı seçiciyle değiştirdi — hasar kaydı stoktan düşen ve
 * geri alınamaz bir defter satırı ürettiği için seçilen ürünün adıyla teyit
 * edilebilmesi gerekiyor. Bu testlerin ölçtüğü şey (gövdeye giden
 * `product_id`, idempotency anahtarının ömrü, 409 gerekçesinin görünmesi)
 * aynen korunuyor; değişen yalnız ürünün nasıl seçildiği.
 */
async function hasarUrunuSec(dialog: HTMLElement, id: number) {
  fireEvent.change(within(dialog).getByLabelText(/ürün ara/i), {
    target: { value: String(id) },
  });
  fireEvent.click(await within(dialog).findByText(`Test Ürünü ${id}`));
}

/* ══════════════════════════ 1. Menü görünürlüğü ══════════════════════════ */

describe("1 · envanter menüsü", () => {
  it("Ticaret grubunda, inventory.view izniyle kapılı bir menü öğesi vardır", () => {
    const item = ADMIN_NAV_ITEMS.find((i) => i.to === ROUTES.adminInventory);
    expect(item, "envanter menü öğesi yok").toBeTruthy();
    expect(item!.group).toBe("Ticaret");
    expect(item!.requiredPermission).toBe(VIEW);
    // Menüde başlık ve açıklama sayfanın da başlığıdır (AdminPageHeader).
    expect(item!.label).toMatch(/envanter/i);
    expect(item!.description.length).toBeGreaterThan(20);
  });
});

/* ══════════════════════════ 2-6. İzin kademeleri ══════════════════════════ */

describe("2 · yalnız inventory.view", () => {
  it("listeyi görür ama 'Yeni sayım' butonu YOKTUR", async () => {
    izinVer(VIEW);
    listeSunucusu();
    sar(ROUTES.adminInventoryCounts);
    await waitFor(() => expect(kodDugumleri("SAY-2027-0007")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /yeni sayım/i })).toBeNull();
  });

  it("detayda sayma alanı ve apply butonu YOKTUR", async () => {
    izinVer(VIEW);
    detaySunucusu();
    sar(ROUTES.adminInventoryCount(7));
    await waitFor(() => expect(screen.getByText("SAY-2027-0007")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /farkları uygula/i })).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("salt-okunur olduğunu şeritle söyler", async () => {
    izinVer(VIEW);
    listeSunucusu();
    sar(ROUTES.adminInventoryCounts);
    await waitFor(() => expect(screen.getByText(/salt okunur/i)).toBeTruthy());
  });
});

describe("3 · inventory.count", () => {
  it("yeni sayım açabilir ve sunucuya doğru gövde gider", async () => {
    izinVer(VIEW, COUNT);
    listeSunucusu([]);
    sunucu("count-sessions", { status: 201, data: detay({ status: "DRAFT" }, []) }, "post");
    sar(ROUTES.adminInventoryCounts);

    await waitFor(() => expect(screen.getAllByRole("button", { name: /yeni sayım/i }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: /yeni sayım/i })[0]);

    const kapsam = await screen.findByLabelText(/kapsam/i);
    fireEvent.change(kapsam, { target: { value: "ALL" } });
    fireEvent.click(screen.getByRole("button", { name: /oturumu aç/i }));

    await waitFor(() => {
      const p = istekler.find((i) => i.method === "post" && i.url.endsWith("/inventory/count-sessions"));
      expect(p, "POST /count-sessions atılmadı").toBeTruthy();
      expect(p!.body).toMatchObject({ scope: "ALL" });
    });
  });

  it("satır sayabilir ve counted_at GÖNDERMEZ", async () => {
    izinVer(VIEW, COUNT);
    detaySunucusu(detay({ status: "IN_PROGRESS", reviewed_at: null, reviewed_by_admin_id: null }));
    sunucu(/lines\/\d+\/count$/, { data: { ...SATIR_SALEABLE, counted_qty: 9, difference: -1 } }, "post");
    sar(ROUTES.adminInventoryCount(7));

    const alan = await screen.findByLabelText(/satılabilir.*sayılan|sayılan.*satılabilir/i);
    fireEvent.change(alan, { target: { value: "9" } });
    fireEvent.click(screen.getAllByRole("button", { name: /kaydet/i })[0]);

    await waitFor(() => {
      const p = istekler.find((i) => i.method === "post" && /lines\/\d+\/count$/.test(i.url));
      expect(p, "sayım isteği atılmadı").toBeTruthy();
      expect(p!.body).toEqual({ counted_qty: 9 });
      // Sunucu zamanı istemciden ALINMAZ — `extra=forbid` 422 üretirdi.
      expect(p!.body).not.toHaveProperty("counted_at");
    });
  });

  it("submit edebilir", async () => {
    izinVer(VIEW, COUNT);
    detaySunucusu(detay({ status: "IN_PROGRESS" }));
    sunucu("/submit", { data: detay() }, "post");
    sar(ROUTES.adminInventoryCount(7));
    const btn = await screen.findByRole("button", { name: /[İi]ncelemeye gönder/ });
    fireEvent.click(btn);
    await waitFor(() => expect(istekler.some((i) => i.url.endsWith("/submit"))).toBe(true));
  });
});

describe("4 · inventory.count APPLY yapamaz", () => {
  it("REVIEW oturumunda 'Farkları uygula' butonu GÖSTERİLMEZ", async () => {
    izinVer(VIEW, COUNT);
    detaySunucusu();
    sar(ROUTES.adminInventoryCount(7));
    await waitFor(() => expect(screen.getByText("SAY-2027-0007")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /farkları uygula/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /[İi]ncelemeyi geri al/ })).toBeNull();
  });

  it("hasar ekranında işlem başlatamaz", async () => {
    izinVer(VIEW, COUNT);
    hasarSunucusu();
    sar(ROUTES.adminInventoryDamage);
    await waitFor(() => expect(screen.getByText(/hasara ayır/i)).toBeTruthy());
    // Geçmiş görünür ama işlem butonu yok.
    expect(screen.queryByRole("button", { name: /hasara ayır/i })).toBeNull();
  });
});

describe("5 · inventory.apply", () => {
  it("apply, reopen ve hasar işlemlerini görebilir", async () => {
    izinVer(VIEW, COUNT, APPLY);
    detaySunucusu(detay({}, [{ ...SATIR_SALEABLE, counted_qty: 10, difference: 0 }]));
    sar(ROUTES.adminInventoryCount(7));
    await waitFor(() => expect(screen.getByRole("button", { name: /farkları uygula/i })).toBeTruthy());
    expect(screen.getByRole("button", { name: /[İi]ncelemeyi geri al/ })).toBeTruthy();
  });

  it("hasar işlem butonları görünür", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sar(ROUTES.adminInventoryDamage);
    await waitFor(() => expect(screen.getByRole("button", { name: /hasara ayır/i })).toBeTruthy());
    expect(screen.getByRole("button", { name: /satılabilir duruma döndür/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /[İi]mha et/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /tedarikçiye iade/i })).toBeTruthy();
  });
});

describe("6 · izinsiz deep-link", () => {
  it("güvenli yetki ekranı gösterir, veri çekmez", async () => {
    izinVer("products.manage");
    sar(ROUTES.adminInventoryCounts);
    expect(screen.getByText(/yetkiniz yok/i)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(istekler, "yetkisiz ekran yine de sunucuya gitti").toEqual([]);
  });
});

/* ══════════════════════════ 7. Liste ekranı ══════════════════════════ */

describe("7 · sayım listesi", () => {
  it("durum, kapsam, oluşturan ve tarihi okunur biçimde gösterir", async () => {
    izinVer(VIEW);
    listeSunucusu();
    sar(ROUTES.adminInventoryCounts);
    await waitFor(() => expect(kodDugumleri("SAY-2027-0007")).toHaveLength(2));
    // Durum RENKLE değil METİNLE anlatılır.
    const satir = screen.getByTestId("session-row-7");
    expect(within(satir).getByText(/[İi]ncelemede/), "durum satırda METİN olarak yok").toBeTruthy();
    expect(within(satir).getByTestId("created-by").textContent).toMatch(/#1/);
    expect(within(satir).getByTestId("created-at").textContent).toMatch(/2027/);
    expect(within(satir).getByTestId("scope").textContent).toBeTruthy();
    // Boşluk KAPANDI: liste ucu artık satır sayısını sunucuda toplu sorguyla
    // hesaplayıp gönderiyor (commit 8 kapanışı). Önceki sürümde burada
    // "uydurma sayının yokluğu" sabitleniyordu.
    expect(within(satir).getByTestId("line-count").textContent).toMatch(/2 satır/);
  });

  it("durum filtresi gerçekten query'ye gider", async () => {
    izinVer(VIEW);
    listeSunucusu();
    sar(ROUTES.adminInventoryCounts);
    await waitFor(() => expect(kodDugumleri("SAY-2027-0007")).toHaveLength(2));
    fireEvent.change(screen.getByLabelText(/duruma göre/i), { target: { value: "REVIEW" } });
    await waitFor(() => {
      const son = istekler[istekler.length - 1];
      expect(son.url).toContain("status=REVIEW");
    });
  });

  it("dikkat gerektiren oturum listede işaretlenir ve detaya götürür", async () => {
    izinVer(VIEW);
    listeSunucusu([{ ...OTURUM, has_stale: true }]);
    sar(ROUTES.adminInventoryCounts);
    await waitFor(() => expect(kodDugumleri("SAY-2027-0007")).toHaveLength(2));
    const satir = screen.getByTestId("session-row-7");
    expect(within(satir).getByTestId("stale-flag")).toBeTruthy();
    expect(within(satir).getByRole("link").getAttribute("href")).toBe(
      ROUTES.adminInventoryCount(7)
    );
  });
});

/* ══════════════════════════ 8-14. Detay ekranı ══════════════════════════ */

describe("8-9 · kova ve miktar kavramları", () => {
  it("SALEABLE ve DAMAGED AYRI satır olarak görünür", async () => {
    izinVer(VIEW);
    detaySunucusu();
    sar(ROUTES.adminInventoryCount(7));
    await waitFor(() => expect(screen.getByText(/satılabilir/i)).toBeTruthy());
    expect(screen.getByText(/hasarlı/i)).toBeTruthy();
    expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(3); // başlık + 2 satır
  });

  it("sistem, rezerve, beklenen fiziksel, sayılan ve fark AYRI sütunlardır", async () => {
    izinVer(VIEW);
    detaySunucusu();
    sar(ROUTES.adminInventoryCount(7));
    await waitFor(() => expect(screen.getByText("SAY-2027-0007")).toBeTruthy());
    for (const baslik of [/sistem/i, /rezerve/i, /beklenen fiziksel/i, /sayılan/i, /fark/i]) {
      expect(screen.getByRole("columnheader", { name: baslik }), `sütun yok: ${baslik}`).toBeTruthy();
    }
  });

  it("SALEABLE satırda beklenen fiziksel = sistem + rezerve olarak GÖSTERİLİR", async () => {
    izinVer(VIEW);
    detaySunucusu(detay({}, [SATIR_SALEABLE]));
    sar(ROUTES.adminInventoryCount(7));
    const satir = await screen.findByTestId("count-line-101");
    expect(within(satir).getByTestId("system").textContent).toBe("8");
    expect(within(satir).getByTestId("reserved").textContent).toBe("2");
    expect(within(satir).getByTestId("expected").textContent).toBe("10");
    expect(within(satir).getByTestId("difference").textContent).toBe("−2");
  });

  it("DAMAGED satırda rezerve 'Uygulanmaz' der, 0 YAZMAZ", async () => {
    izinVer(VIEW);
    detaySunucusu(detay({}, [SATIR_DAMAGED]));
    sar(ROUTES.adminInventoryCount(7));
    const satir = await screen.findByTestId("count-line-102");
    expect(within(satir).getByTestId("reserved").textContent).toMatch(/uygulanmaz/i);
    expect(within(satir).getByTestId("expected").textContent).toBe("3");
  });
});

describe("10 · sayılmamış satır", () => {
  it("farkı 0 değil 'Henüz sayılmadı' gösterir", async () => {
    izinVer(VIEW);
    detaySunucusu(
      detay({ status: "IN_PROGRESS" }, [
        { ...SATIR_SALEABLE, status: "PENDING", counted_qty: null, difference: null },
      ])
    );
    sar(ROUTES.adminInventoryCount(7));
    const satir = await screen.findByTestId("count-line-101");
    expect(within(satir).getByTestId("difference").textContent).toMatch(/henüz sayılmadı/i);
    expect(within(satir).getByTestId("difference").textContent).not.toBe("0");
  });
});

describe("11-12 · STALE ve RESOLVED", () => {
  it("STALE satır belirgin uyarı verir ve APPLY'i engeller", async () => {
    izinVer(VIEW, COUNT, APPLY);
    detaySunucusu(detay({}, [{ ...SATIR_SALEABLE, status: "STALE", stale_reason: "ORDER_SHIPPED" }]));
    sar(ROUTES.adminInventoryCount(7));

    const satir = await screen.findByTestId("count-line-101");
    expect(within(satir).getByText(/belirsiz/i), "STALE satır uyarı taşımıyor").toBeTruthy();
    const uygula = screen.getByRole("button", { name: /farkları uygula/i });
    expect((uygula as HTMLButtonElement).disabled, "STALE satır varken apply aktif").toBe(true);
    // Neden engellendiği YAZILI olmalı — disabled buton sessiz kalmamalı.
    expect(screen.getByTestId("apply-blockers").textContent).toMatch(/yeniden say/i);
  });

  it("yalnız açıklama yazmak satırı çözülmüş göstermez, apply hâlâ kapalı", async () => {
    izinVer(VIEW, COUNT, APPLY);
    detaySunucusu(
      detay({}, [
        {
          ...SATIR_SALEABLE,
          status: "RESOLVED",
          stale_reason: "ORDER_SHIPPED",
          resolution_note: "depoda kontrol edildi",
          resolved_by_admin_id: 1,
        },
      ])
    );
    sar(ROUTES.adminInventoryCount(7));
    await waitFor(() => expect(screen.getByText(/depoda kontrol edildi/)).toBeTruthy());
    expect((screen.getByRole("button", { name: /farkları uygula/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("apply-blockers").textContent).toMatch(/yeniden say/i);
    // "Çözüldü" gibi yatıştırıcı bir etiket kullanılamaz.
    expect(screen.queryByText(/^çözüldü$/i)).toBeNull();
  });
});

describe("13-14 · yeniden sayım", () => {
  it("REVIEW'da sayım alanı GÖSTERİLMEZ — önce incelemeyi geri al", async () => {
    // Commit 9 uçtan uca turunda bulundu: arayüz REVIEW'da sayım alanı
    // gösteriyordu ama servis `IN_PROGRESS` dışındaki her durumu 409 ile
    // reddediyor. Her tıklaması kesin hataya giden bir alan, "servisin
    // reddedeceği butonu gösterme" kuralının ihlaliydi.
    izinVer(VIEW, COUNT, APPLY);
    detaySunucusu(detay({}, [{ ...SATIR_SALEABLE, status: "STALE" }]));
    sar(ROUTES.adminInventoryCount(7));
    await screen.findByTestId("count-line-101");
    expect(screen.queryByLabelText(/sayılan/i)).toBeNull();
    expect(screen.getByRole("button", { name: /[İi]ncelemeyi geri al/ })).toBeTruthy();
  });

  it("yeniden sayımda yeni snapshot ve sayım değeri ekrana yansır", async () => {
    izinVer(VIEW, COUNT, APPLY);
    let sayac = 0;
    sunucu(
      /count-sessions\/\d+$/,
      () => {
        sayac += 1;
        return {
          // Oturum reopen edilmiş: IN_PROGRESS'te sayım açık.
          data:
            sayac === 1
              ? detay({ status: "IN_PROGRESS", reviewed_at: null, reviewed_by_admin_id: null },
                      [{ ...SATIR_SALEABLE, status: "STALE" }])
              : detay({ status: "IN_PROGRESS", reviewed_at: null, reviewed_by_admin_id: null }, [
                  { ...SATIR_SALEABLE, status: "COUNTED", system_qty_snapshot: 9, counted_qty: 11, difference: 0 },
                ]),
        };
      },
      "get"
    );
    sunucu(/lines\/\d+\/count$/, { data: { ...SATIR_SALEABLE, counted_qty: 11 } }, "post");
    sar(ROUTES.adminInventoryCount(7));

    const alan = await screen.findByLabelText(/sayılan/i);
    fireEvent.change(alan, { target: { value: "11" } });
    fireEvent.click(screen.getAllByRole("button", { name: /kaydet/i })[0]);

    // Yeni sistem snapshot'ı (9) ve yeni sayım (11) görünür.
    await waitFor(() => {
      const satir = screen.getByTestId("count-line-101");
      expect(within(satir).getByTestId("system").textContent).toBe("9");
    });
    // Oturum durumu ekranda METİNLE görünür.
    await waitFor(() => expect(screen.getByText(/sayım sürüyor/i)).toBeTruthy());
  });
});

/* ══════════════════════════ 15-18. Apply ══════════════════════════ */

describe("15 · apply onayı", () => {
  it("uygulanacak miktarları açık bir onay penceresinde gösterir", async () => {
    izinVer(VIEW, COUNT, APPLY);
    detaySunucusu(detay({}, [SATIR_SALEABLE, { ...SATIR_DAMAGED, counted_qty: 5, difference: 2 }]));
    sar(ROUTES.adminInventoryCount(7));

    fireEvent.click(await screen.findByRole("button", { name: /farkları uygula/i }));
    const dialog = await screen.findByRole("dialog");
    // Etki rakamla yazılır: hangi kova, ne kadar.
    expect(within(dialog).getByText(/−2/)).toBeTruthy();
    expect(within(dialog).getByText(/\+2/)).toBeTruthy();
    expect(within(dialog).getByText(/satılabilir/i)).toBeTruthy();
    expect(within(dialog).getByText(/hasarlı/i)).toBeTruthy();
  });
});

describe("16 · çift gönderim", () => {
  it("double-click TEK apply isteği üretir ve anahtar DEĞİŞMEZ", async () => {
    izinVer(VIEW, COUNT, APPLY);
    detaySunucusu();
    sunucu("/apply", { data: detay({ status: "APPLIED" }) }, "post");
    sar(ROUTES.adminInventoryCount(7));

    fireEvent.click(await screen.findByRole("button", { name: /farkları uygula/i }));
    const dialog = await screen.findByRole("dialog");
    const onay = within(dialog).getByRole("button", { name: /uygula/i });
    fireEvent.click(onay);
    fireEvent.click(onay);
    fireEvent.click(onay);

    await waitFor(() => expect(istekler.some((i) => i.url.endsWith("/apply"))).toBe(true));
    const applyler = istekler.filter((i) => i.url.endsWith("/apply"));
    expect(applyler.length, "çift gönderim engellenmedi").toBe(1);
    expect(applyler[0].body).toHaveProperty("idempotency_key");
    expect(String((applyler[0].body as Record<string, string>).idempotency_key).length).toBeGreaterThan(8);
  });
});

describe("17-18 · conflict ve invariant", () => {
  it("409'u anlaşılır ve eyleme dönük gösterir, başarı SAYMAZ", async () => {
    izinVer(VIEW, COUNT, APPLY);
    detaySunucusu();
    sunucu("/apply", { status: 409, data: { detail: "oturum başka bir anahtarla uygulanmış" } }, "post");
    sar(ROUTES.adminInventoryCount(7));

    fireEvent.click(await screen.findByRole("button", { name: /farkları uygula/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /uygula/i }));

    await waitFor(() => expect(screen.getByText(/başka bir anahtarla uygulanmış/i)).toBeTruthy());
    // "Uygulandı" gibi bir başarı ifadesi ekrana YAZILMAZ.
    expect(screen.queryByText(/başarıyla uygulandı/i)).toBeNull();
  });

  it("ledger invariant hatasında otomatik onarım İDDİA ETMEZ", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sunucu(
      "damage-events",
      { status: 409, data: { detail: "LEDGER_INVARIANT: beklenen defter bacağı eksik" } },
      "post"
    );
    sar(ROUTES.adminInventoryDamage);

    fireEvent.click(await screen.findByRole("button", { name: /hasara ayır/i }));
    const dialog = await screen.findByRole("dialog");
    await hasarUrunuSec(dialog, 5);
    fireEvent.change(within(dialog).getByLabelText(/miktar/i), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText(/neden/i), { target: { value: "KIRIK" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /onayla|uygula|kaydet|ayır/i })
    );

    await waitFor(() => expect(screen.getByText(/defter/i)).toBeTruthy());
    expect(screen.queryByText(/onarıldı|düzeltildi|otomatik/i)).toBeNull();
  });
});

/* ══════════════════════════ 19-25. Hasar formları ══════════════════════════ */

describe("19-20 · etki özeti", () => {
  it("hasara ayırmada düşecek ve eklenecek kova açık yazılır", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sar(ROUTES.adminInventoryDamage);
    fireEvent.click(await screen.findByRole("button", { name: /hasara ayır/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/miktar/i), { target: { value: "3" } });
    const etki = within(dialog).getByTestId("damage-effect").textContent ?? "";
    expect(etki).toMatch(/satılabilir/i);
    expect(etki).toMatch(/hasarlı/i);
    expect(etki).toContain("3");
  });

  it("kurtarma yönü TERSİ olarak gösterilir", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sar(ROUTES.adminInventoryDamage);
    fireEvent.click(await screen.findByRole("button", { name: /satılabilir duruma döndür/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/miktar/i), { target: { value: "1" } });
    const etki = within(dialog).getByTestId("damage-effect").textContent ?? "";
    expect(etki.indexOf("Hasarlı")).toBeLessThan(etki.indexOf("Satılabilir"));
  });
});

describe("21 · imha", () => {
  it("geri dönüşsüz olduğu için güçlü onay ister", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sar(ROUTES.adminInventoryDamage);
    fireEvent.click(await screen.findByRole("button", { name: /[İi]mha et/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/geri alınamaz|geri dönüşsüz/i)).toBeTruthy();

    // GÜNCELLENDİ (İP-A3c · Görev 4). Eski iddia "düğme disabled"dı; kapalı
    // düğme deseni bırakıldı. Korunan ASIL iddia: onay kutusu işaretlenmeden
    // işlem SUNUCUYA GİTMEZ — ve kullanıcı neden gitmediğini görür.
    const gonder = within(dialog).getByRole("button", { name: /[İi]mha/ });
    expect((gonder as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(gonder);

    await waitFor(() =>
      expect(within(dialog).getByTestId("damage-onay-hatasi")).toBeTruthy()
    );
    expect(istekler.some((i) => i.method === "post")).toBe(false);
  });
});

describe("22 · tedarikçi iadesi", () => {
  it("kaynak kova seçilmeden gönderilemez ve gövdede bucket gider", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sunucu("damage-events", { status: 201, data: OLAY }, "post");
    sar(ROUTES.adminInventoryDamage);

    fireEvent.click(await screen.findByRole("button", { name: /tedarikçiye iade/i }));
    const dialog = await screen.findByRole("dialog");
    await hasarUrunuSec(dialog, 5);
    fireEvent.change(within(dialog).getByLabelText(/miktar/i), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText(/neden/i), { target: { value: "KIRIK" } });

    // GÜNCELLENDİ (İP-A3c · Görev 4): "düğme disabled" yerine "gönderim
    // sunucuya gitmez" sınanıyor — kapalı düğme deseni bırakıldı, garanti
    // yerinde duruyor.
    const gonder = within(dialog).getByRole("button", { name: /gönder|onayla|iade/i });
    fireEvent.click(gonder);
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText(/kaynak kova/i).getAttribute("aria-invalid"),
        "kova seçilmeden gönderilebiliyor"
      ).toBe("true")
    );
    expect(istekler.some((i) => i.method === "post")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/kaynak kova/i), { target: { value: "DAMAGED" } });
    fireEvent.click(gonder);

    await waitFor(() => {
      const p = istekler.find((i) => i.method === "post" && i.url.includes("damage-events"));
      expect(p!.body).toMatchObject({ kind: "SUPPLIER_RETURN", bucket: "DAMAGED" });
    });
  });
});

describe("23 · dijital ürün", () => {
  it("dijital üründe hasar işlemi güvenle engellenir", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sunucu(
      "damage-events",
      { status: 400, data: { detail: "dijital ürün için hasar işlemi yapılamaz" } },
      "post"
    );
    sar(ROUTES.adminInventoryDamage);
    fireEvent.click(await screen.findByRole("button", { name: /hasara ayır/i }));
    const dialog = await screen.findByRole("dialog");
    await hasarUrunuSec(dialog, 9);
    fireEvent.change(within(dialog).getByLabelText(/miktar/i), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText(/neden/i), { target: { value: "KIRIK" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /onayla|uygula|kaydet|ayır/i }));
    await waitFor(() => expect(screen.getByText(/dijital ürün/i)).toBeTruthy());
  });
});

describe("24 · DIGER gerekçesi", () => {
  it("açıklama boşken gönderim kapalı, dolunca gövdeye girer", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sunucu("damage-events", { status: 201, data: OLAY }, "post");
    sar(ROUTES.adminInventoryDamage);

    fireEvent.click(await screen.findByRole("button", { name: /hasara ayır/i }));
    const dialog = await screen.findByRole("dialog");
    await hasarUrunuSec(dialog, 5);
    fireEvent.change(within(dialog).getByLabelText(/miktar/i), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText(/neden/i), { target: { value: "DIGER" } });

    // GÜNCELLENDİ (İP-A3c · Görev 4): aynı gerekçe — garanti "kapalı düğme"
    // değil, "geçersiz veri sunucuya gitmez".
    const gonder = within(dialog).getByRole("button", { name: /onayla|uygula|kaydet|ayır/i });
    fireEvent.click(gonder);
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText(/açıklama/i).getAttribute("aria-invalid"),
        "DIGER açıklamasız gönderilebiliyor"
      ).toBe("true")
    );
    expect(istekler.some((i) => i.method === "post")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/açıklama/i), { target: { value: "kapak yırtık" } });
    fireEvent.click(gonder);
    await waitFor(() => {
      const p = istekler.find((i) => i.method === "post" && i.url.includes("damage-events"));
      expect(p!.body).toMatchObject({ reason_code: "DIGER", note: "kapak yırtık" });
    });
  });
});

describe("25b · idempotency anahtarının ömrü", () => {
  it("başarısız denemeden sonra AYNI anahtar gönderilir", async () => {
    // Anahtar her render'da yenilenseydi, ağ tekrarında sunucu iki ayrı iş
    // görür ve stok iki kez düşerdi. Sabitlik ancak GÖZLEMLE kanıtlanır.
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sunucu("damage-events", { status: 500, data: { detail: "geçici hata" } }, "post");
    sar(ROUTES.adminInventoryDamage);

    fireEvent.click(await screen.findByRole("button", { name: /hasara ayır/i }));
    const dialog = await screen.findByRole("dialog");
    await hasarUrunuSec(dialog, 5);
    fireEvent.change(within(dialog).getByLabelText(/miktar/i), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText(/neden/i), { target: { value: "KIRIK" } });
    const gonder = within(dialog).getByRole("button", { name: /hasara ayır/i });

    fireEvent.click(gonder);
    await waitFor(() =>
      expect(istekler.filter((i) => i.method === "post").length).toBe(1)
    );
    fireEvent.click(gonder);
    await waitFor(() =>
      expect(istekler.filter((i) => i.method === "post").length).toBe(2)
    );

    const gonderimler = istekler.filter((i) => i.method === "post");
    const a = (gonderimler[0].body as Record<string, string>).idempotency_key;
    const b = (gonderimler[1].body as Record<string, string>).idempotency_key;
    expect(a).toBeTruthy();
    expect(b, "anahtar yeniden denemede DEĞİŞTİ — çift stok düşümü riski").toBe(a);
  });

  it("başarılı işlemden sonra YENİ işlem yeni anahtar alır", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sunucu("damage-events", { status: 201, data: OLAY }, "post");
    sar(ROUTES.adminInventoryDamage);

    const doldurVeGonder = async () => {
      fireEvent.click(screen.getByRole("button", { name: /hasara ayır/i }));
      const d = await screen.findByRole("dialog");
      await hasarUrunuSec(d, 5);
      fireEvent.change(within(d).getByLabelText(/miktar/i), { target: { value: "2" } });
      fireEvent.change(within(d).getByLabelText(/neden/i), { target: { value: "KIRIK" } });
      fireEvent.click(within(d).getByRole("button", { name: /hasara ayır/i }));
    };

    await waitFor(() => expect(screen.getByRole("button", { name: /hasara ayır/i })).toBeTruthy());
    await doldurVeGonder();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await doldurVeGonder();
    await waitFor(() =>
      expect(istekler.filter((i) => i.method === "post").length).toBe(2)
    );

    const g = istekler.filter((i) => i.method === "post");
    expect(
      (g[1].body as Record<string, string>).idempotency_key,
      "yeni işlem eski anahtarı kullandı — sunucu bunu replay sayar ve iş YAPILMAZ"
    ).not.toBe((g[0].body as Record<string, string>).idempotency_key);
  });
});

describe("25 · replay", () => {
  it("aynı işlemin replay'i İKİNCİ BAŞARI gibi gösterilmez", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    // Sunucu kayıtlı olayı aynen geri verir (replay) — yeni iş yapılmadı.
    sunucu("damage-events", { status: 200, data: OLAY }, "post");
    sar(ROUTES.adminInventoryDamage);

    fireEvent.click(await screen.findByRole("button", { name: /hasara ayır/i }));
    const dialog = await screen.findByRole("dialog");
    await hasarUrunuSec(dialog, 5);
    fireEvent.change(within(dialog).getByLabelText(/miktar/i), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText(/neden/i), { target: { value: "KIRIK" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /onayla|uygula|kaydet|ayır/i }));

    await waitFor(() => expect(screen.getByText(/kaydedildi|zaten|[İi]şlendi/)).toBeTruthy());
    // 201 ile 200'ü ayırt eder: replay'de "yeni işlem oluşturuldu" DEMEZ.
    expect(screen.queryByText(/yeni.*oluşturuldu/i)).toBeNull();
  });
});

/* ══════════════════════════ 26-30. Genel kalite ══════════════════════════ */

describe("26 · sayfalama", () => {
  it("liste isteği limit ve offset gönderir, sonraki sayfa offset'i ilerletir", async () => {
    izinVer(VIEW);
    const cok = Array.from({ length: 25 }, (_, i) => ({ ...OTURUM, id: i + 1, code: `SAY-${i + 1}` }));
    sunucu("count-sessions", { data: { items: cok, total: 60, limit: 25, offset: 0 } }, "get");
    sar(ROUTES.adminInventoryCounts);

    await waitFor(() => expect(kodDugumleri("SAY-1")).toHaveLength(2));
    expect(istekler[0].url).toMatch(/limit=25/);
    expect(istekler[0].url).toMatch(/offset=0/);

    fireEvent.click(screen.getByRole("button", { name: /sonraki/i }));
    await waitFor(() => {
      expect(istekler[istekler.length - 1].url).toMatch(/offset=25/);
    });
  });
});

describe("27 · loading / boş / hata / retry", () => {
  it("yüklenirken skeleton gösterir", async () => {
    izinVer(VIEW);
    sunucu("count-sessions", { data: { items: [], total: 0, limit: 25, offset: 0 } }, "get");
    const { container } = sar(ROUTES.adminInventoryCounts);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("boş listede açıklama ve ana eylem sunar", async () => {
    izinVer(VIEW, COUNT);
    sunucu("count-sessions", { data: { items: [], total: 0, limit: 25, offset: 0 } }, "get");
    sar(ROUTES.adminInventoryCounts);
    await waitFor(() => expect(screen.getByText(/henüz sayım/i)).toBeTruthy());
    expect(screen.getAllByRole("button", { name: /yeni sayım/i }).length).toBeGreaterThan(0);
  });

  it("hata durumunda BOŞ EKRAN değil hata ve yeniden dene gösterir", async () => {
    izinVer(VIEW);
    sunucu("count-sessions", { status: 500, data: { detail: "sunucu hatası" } }, "get");
    sar(ROUTES.adminInventoryCounts);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("button", { name: /yeniden dene/i })).toBeTruthy();
    // "Sayım yok" ile "yüklenemedi" karıştırılmaz.
    expect(screen.queryByText(/henüz sayım/i)).toBeNull();
  });

  it("yeniden dene gerçekten yeni istek atar", async () => {
    izinVer(VIEW);
    sunucu("count-sessions", { status: 500, data: { detail: "sunucu hatası" } }, "get");
    sar(ROUTES.adminInventoryCounts);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const once = istekler.length;
    fireEvent.click(screen.getByRole("button", { name: /yeniden dene/i }));
    await waitFor(() => expect(istekler.length).toBeGreaterThan(once));
  });
});

describe("28 · dar ekran", () => {
  it("geniş tablo yatay taşmayı kontrollü yönetir", async () => {
    izinVer(VIEW);
    detaySunucusu();
    const { container } = sar(ROUTES.adminInventoryCount(7));
    await waitFor(() => expect(screen.getByText("SAY-2027-0007")).toBeTruthy());
    const tablo = container.querySelector("table");
    expect(tablo).toBeTruthy();
    // Tablo, gövdeyi yatay kaydırmak yerine KENDİ kabında kayar.
    const kap = tablo!.closest("div");
    expect(kap?.className ?? "").toMatch(/overflow-x-auto/);
  });
});

describe("29 · erişilebilirlik", () => {
  it("sayım alanı gerçek etiketle bağlı", async () => {
    izinVer(VIEW, COUNT);
    detaySunucusu(detay({ status: "IN_PROGRESS" }, [SATIR_SALEABLE]));
    sar(ROUTES.adminInventoryCount(7));
    const alan = await screen.findByLabelText(/sayılan/i);
    expect(alan.tagName).toBe("INPUT");
    expect(alan.getAttribute("type")).toBe("number");
    expect(alan.getAttribute("min")).toBe("0");
  });

  it("hasar penceresi dialog rolü ve erişilebilir ad taşır, Esc kapatır", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sar(ROUTES.adminInventoryDamage);
    fireEvent.click(await screen.findByRole("button", { name: /hasara ayır/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("dialog", { name: /hasara ayır/i })).toBe(dialog);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sekme gezinmesi landmark taşır", async () => {
    izinVer(VIEW);
    listeSunucusu();
    sar(ROUTES.adminInventoryCounts);
    expect(screen.getByRole("navigation", { name: /envanter/i })).toBeTruthy();
  });

  it("hiçbir envanter ekranı kendi h1'ini basmaz (başlık AdminLayout'un)", async () => {
    izinVer(VIEW);
    listeSunucusu();
    const { container } = sar(ROUTES.adminInventoryCounts);
    await waitFor(() => expect(kodDugumleri("SAY-2027-0007")).toHaveLength(2));
    expect(container.querySelectorAll("h1").length).toBe(0);
  });
});

describe("30 · parasal alan yok", () => {
  it("sayım detayında fiyat/maliyet/zarar geçmez", async () => {
    izinVer(VIEW, COUNT, APPLY);
    detaySunucusu();
    const { container } = sar(ROUTES.adminInventoryCount(7));
    await waitFor(() => expect(screen.getByText("SAY-2027-0007")).toBeTruthy());
    const metin = (container.textContent ?? "").toLowerCase();
    for (const yasak of ["₺", "fiyat", "maliyet", "tutar", "zarar", "değer"]) {
      expect(metin.includes(yasak), `parasal kavram sızmış: ${yasak}`).toBe(false);
    }
  });

  it("hasar ekranında da parasal kavram yok", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    const { container } = sar(ROUTES.adminInventoryDamage);
    await waitFor(() => expect(screen.getByText(/hasara ayır/i)).toBeTruthy());
    const metin = (container.textContent ?? "").toLowerCase();
    for (const yasak of ["₺", "fiyat", "maliyet", "tutar", "zarar"]) {
      expect(metin.includes(yasak), `parasal kavram sızmış: ${yasak}`).toBe(false);
    }
  });
});

/* ══════════════════════════ Ek: envanter ↔ defter bağı ══════════════════════════ */

describe("mevcut ekranlarla bağ", () => {
  it("envanter girişi stok hareketleri ekranına bağlantı verir", async () => {
    izinVer(VIEW);
    hasarSunucusu();
    listeSunucusu();
    sar(ROUTES.adminInventory);
    await waitFor(() => expect(screen.getByRole("link", { name: /stok hareketleri/i })).toBeTruthy());
    expect(screen.getByRole("link", { name: /stok hareketleri/i }).getAttribute("href")).toBe(
      ROUTES.adminStoreStock
    );
  });
});

/* ═══════════ Commit 8 kapanışı: ürün kimliği ve liste özeti ═══════════ */

describe("K1 · sayım satırında ürün kimliği", () => {
  it("ürün ADI ana metin, SKU ikincil; 'Ürün #id' ana kimlik DEĞİL", async () => {
    izinVer(VIEW);
    detaySunucusu(detay({}, [SATIR_SALEABLE]));
    sar(ROUTES.adminInventoryCount(7));
    const satir = await screen.findByTestId("count-line-101");
    expect(within(satir).getByTestId("product-name").textContent).toBe(
      "Palme TYT Matematik Soru Bankası"
    );
    expect(within(satir).getByTestId("product-sku").textContent).toContain("FZK-000005");
    // Numara hâlâ bulunabilir olmalı ama ürünü TANITAN metin ad olmalı.
    expect(within(satir).getByTestId("product-name").textContent).not.toMatch(/^Ürün #/);
  });

  it("API adı göndermezse UYDURMAZ, güvenli yedek gösterir", async () => {
    // Sunucu eski sürümdeyse ya da alan boş gelirse ekran "" veya "undefined"
    // yazmamalı; operatör en azından teknik kimliği görmeli.
    izinVer(VIEW);
    detaySunucusu(
      detay({}, [{ ...SATIR_SALEABLE, product_name: undefined, product_sku: undefined }])
    );
    sar(ROUTES.adminInventoryCount(7));
    const satir = await screen.findByTestId("count-line-101");
    const ad = within(satir).getByTestId("product-name").textContent ?? "";
    expect(ad).toMatch(/Ürün #5/);
    expect(ad.toLowerCase()).not.toContain("undefined");
    expect(within(satir).queryByText(/^null$/)).toBeNull();
  });

  it("uzun ad ve SKU satırı taşırmaz (kırpma/sarma sınıfı taşır)", async () => {
    izinVer(VIEW);
    detaySunucusu(
      detay({}, [
        {
          ...SATIR_SALEABLE,
          product_name:
            "Çok Uzun Bir Yayınevi Adı ile TYT AYT Tüm Dersler Konu Anlatımlı Soru Bankası Seti 2027",
        },
      ])
    );
    sar(ROUTES.adminInventoryCount(7));
    const hucre = (await screen.findByTestId("product-name")).closest("td");
    expect(hucre?.className ?? "").toMatch(/max-w|truncate|break-words/);
  });
});

describe("K2 · sayım listesinde özet", () => {
  it("satır sayısı görünür", async () => {
    izinVer(VIEW);
    listeSunucusu([{ ...OTURUM, line_count: 6, uncounted_line_count: 2 }]);
    sar(ROUTES.adminInventoryCounts);
    const satir = await screen.findByTestId("session-row-7");
    expect(within(satir).getByTestId("line-count").textContent).toMatch(/6/);
  });

  it("STALE oturum İKON ve METİNLE işaretlenir — renk tek başına değil", async () => {
    izinVer(VIEW);
    listeSunucusu([{ ...OTURUM, has_stale: true }]);
    sar(ROUTES.adminInventoryCounts);
    const satir = await screen.findByTestId("session-row-7");
    const uyari = within(satir).getByTestId("stale-flag");
    expect(uyari.textContent).toMatch(/yeniden say|dikkat/i);
    // İkon erişilebilir bir işaret taşımalı (yalnız renk/şekil yetmez).
    expect(uyari.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(uyari.textContent?.trim().length).toBeGreaterThan(3);
  });

  it("STALE yoksa uyarı işareti GÖSTERİLMEZ", async () => {
    izinVer(VIEW);
    listeSunucusu([{ ...OTURUM, has_stale: false }]);
    sar(ROUTES.adminInventoryCounts);
    const satir = await screen.findByTestId("session-row-7");
    expect(within(satir).queryByTestId("stale-flag")).toBeNull();
  });

  it("özet alanları eksikse sahte sayı üretilmez", async () => {
    izinVer(VIEW);
    listeSunucusu([
      { ...OTURUM, line_count: undefined, has_stale: undefined } as never,
    ]);
    sar(ROUTES.adminInventoryCounts);
    const satir = await screen.findByTestId("session-row-7");
    const metin = within(satir).getByTestId("line-count").textContent ?? "";
    expect(metin).not.toMatch(/\b0\b/);
    expect(metin.toLowerCase()).not.toContain("undefined");
    expect(within(satir).queryByTestId("stale-flag")).toBeNull();
  });
});
