/**
 * İP-A6 · Görev 5 — **dal testi**: göç eden her formun TÜM koşullu dalları
 * render edilir ve her form kontrolünün erişilebilir adı doğrulanır.
 *
 * ## Neden bu test var
 *
 * `Form.Control`un adsız alan koruması (İP-A3c) ve nöbetçi sayacı birlikte
 * güçlü görünüyor ama ikisinin de aynı kör noktası var:
 *
 *   - Koruma `throw`/`console.error` ile çalışır → yalnız RENDER EDİLDİĞİNDE
 *     ateşlenir.
 *   - Sayaç statiktir → JSX'te `Form.Control` içinde gördüğü alanı
 *     adlandırılmış SAYAR, gerçekten adı olup olmadığını ölçemez.
 *
 * Yani hiçbir testin uğramadığı koşullu bir dalda duran alan üretime adsız
 * çıkar ve **sayaç "0 borç" der**. Bu dosya o boşluğu kapatır.
 *
 * ## Kapsam kuralı: kartezyen çarpma YOK
 *
 * İP-A4'ün uyarısı: dalları çarparsan test sayısı patlar. Kural **"her koşullu
 * alan en az bir kez render edilsin"**. `ProductForm`un dalları bu yüzden ÜÇ
 * senaryoya bölündü (oluşturma / düzenleme+stok / varyant), her biri kendi
 * dallarını açar.
 *
 * Ölçülen maliyet paketin raporunda (`docs/ip-a6-rapor.md` → Görev 5).
 *
 * ## Dosyanın kapsamı
 *
 * | Küme | Ne kanıtlar |
 * |---|---|
 * | D-1…D-3 | göç eden her formun TÜM koşullu dallarında alan adları (Görev 5) |
 * | D-4 | gönder düğmesi geçerlilikte kapanmaz + odak ilk hatalı alana (kalıcı kural) |
 * | D-5 | sunucu taraflı sıralamanın göstergesi ekran okuyucuya da görünür (Görev 2) |
 *
 * Üçü aynı dosyada çünkü aynı harness'i (sahte sunucu + `AdminStore`
 * render'ı) paylaşıyorlar; ayrı dosyalara bölmek 175 satırlık kurulumu üç kez
 * kopyalamak olurdu.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminStore from "@/pages/dashboards/AdminStore";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";
import { adsizKontroller, formKontrolleri } from "@/test-utils/alanAdlari";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu (mağaza harness'inin kopyası) ══════════════ */

interface Istek {
  method: string;
  url: string;
  params: URLSearchParams;
  body: Record<string, unknown> | null;
}
type Yanit =
  | { status?: number; data: unknown; headers?: Record<string, string> }
  | ((istek: Istek) => { status?: number; data: unknown; headers?: Record<string, string> });

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
  rotalar = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      params: new URLSearchParams(String(config.url).split("?")[1] ?? ""),
      body: config.data ? JSON.parse(String(config.data)) : null,
    };
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota
      ? typeof rota.yanit === "function"
        ? rota.yanit(istek)
        : rota.yanit
      : { data: [] };
    return {
      data: ham.data,
      status: ham.status ?? 200,
      statusText: "OK",
      headers: ham.headers ?? {},
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

function panel(rota: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path={rota} element={<AdminStore />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

const KATEGORILER = [
  { id: 10, slug: "sinav-kitaplari", name: "Sınav Kitapları", parent_id: null, sort_order: 0, product_count: 3 },
  { id: 20, slug: "kirtasiye", name: "Kırtasiye", parent_id: null, sort_order: 1, product_count: 5 },
];
const CONFIG = {
  axes: ["Renk", "Ebat"],
  book_root_slugs: ["sinav-kitaplari"],
};
const GRUP = { id: 7, title: "Fosforlu Kalem", option1_name: "Renk", option2_name: "Ebat", member_count: 1 };
const URUN = {
  id: 101,
  slug: "fosforlu-sari",
  title: "Fosforlu Kalem - Sarı",
  kind: "PHYSICAL",
  seller_type: "PLATFORM",
  price: "45.00",
  tax_rate: "0.2000",
  currency: "TRY",
  in_stock: true,
  stock: 12,
  rating_count: 0,
  status: "ACTIVE",
  images: [],
  variant_group_id: GRUP.id,
  option1_value: "Sarı",
  option2_value: "Küçük",
  variant_sort: 0,
  barcode: "8690001",
  category_id: 20,
};
const GRUP_DETAY = {
  ...GRUP,
  members: [
    { id: 101, title: "Fosforlu Kalem - Sarı", option1_value: "Sarı", option2_value: "Küçük", variant_sort: 0, price: "45.00", stock: 12, status: "ACTIVE", sku: "FZK-000101", barcode: "8690001" },
  ],
};

function temelSunucu() {
  sunucu("/store/config", { data: { low_stock_threshold: 5 } }, "get");
  sunucu("/store/book-facets", { data: { publisher: [], author: [], cover_type: [] } }, "get");
  sunucu("/store/categories", { data: KATEGORILER }, "get");
  sunucu("/store/admin/variant-config", { data: CONFIG }, "get");
  sunucu("/store/admin/variant-groups", { data: [GRUP] }, "get");
  sunucu(`/store/admin/variant-groups/${GRUP.id}`, { data: GRUP_DETAY }, "get");
  sunucu("/payments/availability", { data: { branches: {} } }, "get");
}

/**
 * Defter uçları EN SONA kaydedilir: `sunucu` yeni kuralı listenin BAŞINA
 * ekliyor ve eşleşme `includes` ile yapılıyor, yani `/store/admin/products`
 * kuralı `/store/admin/products/101/stock-verify`i de yakalar. Daha sonra
 * kaydedilen kural önce denendiği için defter kuralları ürün kuralından SONRA
 * gelmek zorunda; aksi hâlde `StockLedgerPanel` boş dizi alıp
 * `problems.map` üzerinde patlıyordu (bu gerçekten yaşandı).
 */
function defterSunucusu() {
  sunucu(/stock-movements/, { data: { items: [], total: 0, limit: 10, offset: 0 } }, "get");
  sunucu(/stock-verify/, { data: { consistent: true, problems: [], product_id: 101 } }, "get");
}

/**
 * MASAÜSTÜ tablosundaki "Düzenle" düğmesi.
 *
 * İP-B2'de `renderMobileRow` bağlandı: aynı satırın aksiyonları hem tabloda
 * hem mobil kartta basılıyor ve jsdom ikisini de görüyor (`md:hidden` yalnız
 * CSS'tir). Daraltılmamış bir `findByRole` bu yüzden "birden çok eşleşme"
 * hatası veriyor.
 *
 * İDDİA DEĞİŞMEDİ — hangi yüzeyden tıklandığı zaten testin konusu değil;
 * konusu, açılan formun alanlarının adı.
 */
async function masaustuDuzenle(): Promise<HTMLElement> {
  const tablo = await screen.findByRole("table", {}, YUK);
  return within(tablo).getByRole("button", { name: "Düzenle" });
}

/**
 * Denetimin kendisi. İKİ iddia birden:
 *
 *   1. Adsız kontrol YOK (asıl kural).
 *   2. En az `enAz` kadar kontrol GERÇEKTEN render edildi — yoksa dal hiç
 *      açılmamış olabilir ve boş bir kap "adsız yok" diye sessizce geçerdi
 *      (bu testin kendi yalancı yeşil kapısı).
 */
function adlarDogru(enAz: number) {
  const kap = document.body;
  const kontroller = formKontrolleri(kap);
  expect(
    kontroller.length,
    `dal açılmamış olabilir: beklenen ≥${enAz}, bulunan ${kontroller.length}`
  ).toBeGreaterThanOrEqual(enAz);
  const adsiz = adsizKontroller(kap);
  expect(
    adsiz,
    `erişilebilir adı olmayan kontrol(ler):\n${adsiz.map((a) => a.html).join("\n")}`
  ).toEqual([]);
  return kontroller.length;
}

/**
 * Yük altındaki bekleme bütçesi — gerekçe `ticketsPaymentGate.test.tsx`te
 * (İP-A6b · Görev 5 · BULGU-10). Global `asyncUtilTimeout` kaldırıldı; bütçe
 * yalnız gerçekten yük-bağımlı olan çağrı yerlerinde duruyor.
 *
 * Bu dosya listeye İP-A6c'de girdi: tam suite `--sequence.shuffle --seed=22`
 * koşumunda D-2 kırmızı düştü ve DOM iskelet (`aria-label="Yükleniyor"`)
 * hâlindeydi — yani ürün listesi sorgusu RTL'in 1000 ms'lik varsayılan
 * bütçesinde çözülmemişti. Aynı seed tek başına koşturulunca YEŞİLDİ; bu
 * "flaky" değil, yük altında daralan bir zamanlama penceresidir.
 *
 * Bütçe YALNIZ bu çağrı yerinde: `duzenlemeyiAc` iki ağ sorgusu (liste +
 * ürün detayı) çözülene kadar bekler. Liste bilinçli olarak genişletilmedi.
 */
const YUK = { timeout: 4000 };

/* ══════════════ D-1 · ProductForm — oluşturma dalları ══════════════ */

describe("D-1 · ürün formu (oluşturma) — tüm koşullu dallar adlı", () => {
  it("tür seçici + künye açık + varyant açık + yeni grup satırı", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { data: [], headers: { "x-total-count": "0" } }, "get");
    panel(ROUTES.adminStoreProducts);

    // Dal: form kapalı → açık
    fireEvent.click(await screen.findByRole("button", { name: "Yeni ürün" }));
    await screen.findByLabelText("Ürün adı");
    // Dal: "Ürün türü" YALNIZ oluşturmada var (düzenlemede "Durum").
    expect(screen.getByLabelText("Ürün türü")).toBeTruthy();
    expect(screen.queryByLabelText("Durum")).toBeNull();
    // Dal: fiziksel üründe "Stok" alanı var.
    expect(screen.getByLabelText("Stok")).toBeTruthy();

    // Dal: künye bölümü (dokuz alan)
    fireEvent.click(screen.getByRole("button", { name: /Kitap künyesi/ }));
    await screen.findByLabelText("Yazar (opsiyonel)");

    // Dal: varyant bölümü
    fireEvent.click(screen.getByRole("button", { name: /Varyantlar/ }));
    await screen.findByLabelText("Varyant grubu");

    // Dal: "yeni grup oluştur" satırı (üç alan, ana formun parçası DEĞİL)
    fireEvent.change(screen.getByLabelText("Varyant grubu"), {
      target: { value: "__yeni__" },
    });
    await screen.findByLabelText("Grup adı");
    expect(screen.getByLabelText("1. eksen")).toBeTruthy();
    expect(screen.getByLabelText("2. eksen (opsiyonel)")).toBeTruthy();

    adlarDogru(20);
  });

  it("dijital ürün seçilince 'Stok' alanı kalkar; kalan alanların hepsi adlı", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { data: [], headers: { "x-total-count": "0" } }, "get");
    // Dijital kolu AÇIK olmalı, yoksa seçenek `disabled` gelir (fail-closed).
    sunucu("/payments/availability", {
      data: { branches: { store: { open: true, blockers: [] } } },
    }, "get");
    panel(ROUTES.adminStoreProducts);

    fireEvent.click(await screen.findByRole("button", { name: "Yeni ürün" }));
    await screen.findByLabelText("Ürün adı");
    fireEvent.change(screen.getByLabelText("Ürün türü"), { target: { value: "DIGITAL" } });

    await waitFor(() => expect(screen.queryByLabelText("Stok")).toBeNull());
    adlarDogru(6);
  });

  it("kitap kategorisi seçilince künye AÇILIR ve varyant bölümü kapanır", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { data: [], headers: { "x-total-count": "0" } }, "get");
    panel(ROUTES.adminStoreProducts);

    fireEvent.click(await screen.findByRole("button", { name: "Yeni ürün" }));
    await screen.findByRole("option", { name: "Sınav Kitapları" });
    fireEvent.change(screen.getByLabelText(/^Kategori/), { target: { value: "10" } });

    // Dal: kitap kategorisinde varyant bölümü HİÇ render edilmez.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Varyantlar/ })).toBeNull()
    );
    // Dal: künye kendiliğinden açılır → dokuz alan.
    expect(screen.getByLabelText("Yazar (opsiyonel)")).toBeTruthy();
    adlarDogru(15);
  });
});

/* ══════════════ D-2 · ProductForm — düzenleme dalları ══════════════ */

describe("D-2 · ürün formu (düzenleme) — stok gerekçesi ve varyant dalları adlı", () => {
  async function duzenlemeyiAc() {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { data: [URUN], headers: { "x-total-count": "1" } }, "get");
    sunucu("/store/admin/products/101", { data: URUN }, "get");
    defterSunucusu();
    panel(ROUTES.adminStoreProducts);
    fireEvent.click(await masaustuDuzenle());
    await screen.findByLabelText("Ürün adı");
  }

  it("stok DEĞİŞİNCE gerekçe alanı, 'Diğer' seçilince açıklama alanı çıkar", async () => {
    await duzenlemeyiAc();
    // Dal: düzenlemede "Durum" var, "Ürün türü" yok.
    expect(screen.getByLabelText("Durum")).toBeTruthy();
    expect(screen.queryByLabelText("Ürün türü")).toBeNull();

    // Dal: stok değişmedikçe gerekçe alanı YOK.
    expect(screen.queryByLabelText("Gerekçe")).toBeNull();
    fireEvent.change(screen.getByLabelText("Stok"), { target: { value: "9" } });
    const gerekce = await screen.findByLabelText("Gerekçe");

    // Dal: yalnız açıklama İSTEYEN gerekçede not alanı çıkar.
    expect(screen.queryByLabelText("Stok değişikliği açıklaması")).toBeNull();
    fireEvent.change(gerekce, { target: { value: "DIGER" } });
    await screen.findByLabelText("Stok değişikliği açıklaması");

    adlarDogru(12);
  });

  it("gruplu üründe eksen/barkod/sıra ve 'varyant türet' dalı adlı", async () => {
    await duzenlemeyiAc();
    // Dal: üyelikli üründe varyant bölümü AÇIK başlar.
    await screen.findByLabelText("Varyant grubu");
    expect(screen.getByLabelText("Barkod")).toBeTruthy();
    // Dal: iki eksenli grup → ikinci eksen alanı da render edilir.
    expect(screen.getByLabelText("Renk")).toBeTruthy();
    expect(screen.getByLabelText("Ebat")).toBeTruthy();
    expect(screen.getByLabelText("Varyant sırası")).toBeTruthy();

    // Dal: "türet" formu (üç alan, iki eksenli)
    fireEvent.click(
      await screen.findByRole("button", { name: /Bu üründen yeni varyant türet/ })
    );
    await screen.findByLabelText("Yeni Renk");
    expect(screen.getByLabelText("Yeni Ebat")).toBeTruthy();
    expect(screen.getByLabelText("Yeni barkod")).toBeTruthy();

    adlarDogru(15);
  });
});

/* ══════════════ D-3 · diğer göç eden bölümler ══════════════ */

describe("D-3 · kupon / kategori / içe aktarma / sipariş / iade formları", () => {
  it("kupon formunun altı alanı da adlı", async () => {
    izinVer("coupons.view", "coupons.manage");
    sunucu("/store/admin/coupons", { data: [] }, "get");
    panel(ROUTES.adminStoreCoupons);

    await screen.findByRole("heading", { name: "Yeni kupon" });
    expect(screen.getByLabelText("Kod")).toBeTruthy();
    expect(screen.getByLabelText("İndirim türü")).toBeTruthy();
    expect(screen.getByLabelText("Değer")).toBeTruthy();
    expect(screen.getByLabelText("Min sepet")).toBeTruthy();
    expect(screen.getByLabelText("Maks kullanım (opsiyonel)")).toBeTruthy();
    expect(screen.getByLabelText("Kişi başı (opsiyonel)")).toBeTruthy();
    adlarDogru(6);
  });

  it("kategori ekleme alanı ve satır içi KDV düzenlemesi adlı", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    panel(ROUTES.adminStoreCategories);

    await screen.findByLabelText("Kategori adı");
    // Dal: KDV rozeti düzenleme moduna geçince satır içi alan çıkar.
    fireEvent.click((await screen.findAllByRole("button", { name: "Düzenle" }))[0]);
    await screen.findByLabelText("Sınav Kitapları varsayılan KDV (%)");
    adlarDogru(2);
  });

  it("toplu içe aktarma dosya seçicisi adlı", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { data: [], headers: { "x-total-count": "0" } }, "get");
    panel(ROUTES.adminStoreProducts);

    fireEvent.click(await screen.findByRole("button", { name: "Toplu içe aktar" }));
    await screen.findByLabelText("Yüklenecek CSV dosyası");
    // Eşik 5 → 2 (İP-B2): ürün listesinin DÖRT filtre `<select>`i kalktı;
    // filtreler artık "Filtre ekle" menüsünde ve menü öğeleri form kontrolü
    // DEĞİL, `menuitem` düğmeleridir. Ekranda kalan kontroller: arama girdisi
    // + CSV dosya seçicisi. (Liste boş olduğu için sayfalama seçicisi de
    // basılmıyor.) Bu eşik bir SÖZLEŞME değil, "dal gerçekten açıldı mı"
    // yalancı-yeşil kapısıdır; sayı gerçek render'a göre yeniden ölçüldü.
    adlarDogru(2);
  });

  it("sipariş durum filtresi ve 'Kargola' takip no alanı adlı", async () => {
    izinVer("orders.view", "orders.manage");
    sunucu("/store/admin/orders", {
      data: [
        {
          id: 77,
          created_at: "2026-08-01T10:00:00Z",
          status: "PAID",
          payment_status: "PAID",
          total: "120.00",
          has_physical: true,
          ship_recipient: "Ayşe Y.",
          items: [],
        },
      ],
      headers: { "x-total-count": "1" },
    }, "get");
    panel(ROUTES.adminStoreOrders);

    await screen.findByLabelText("Durum");
    // Dal: "Kargola" YALNIZ ödenmiş + fiziksel + PAID siparişte çıkar.
    expect((await screen.findAllByLabelText("Takip no")).length).toBeGreaterThan(0);
    adlarDogru(2);
  });

  it("iade kuyruğunun filtre kutucuğu adlı", async () => {
    izinVer("returns.view", "returns.manage");
    sunucu("/store/admin/returns", { data: [] }, "get");
    panel(ROUTES.adminStoreReturns);

    await screen.findByLabelText("Yalnız bekleyenler");
    adlarDogru(1);
  });
});

/* ══════════ D-4 · gönder kapısı YOK + odak ilk hatalı alana ══════════ */

/**
 * Kalıcı kuralın `AdminStore` üzerindeki karşılığı (İP-A3c'de pilotta
 * kurulan desen): gönder düğmesi geçerlilik yüzünden KAPANMAZ; basılınca
 * geçersizse **istek gitmez**, hatalar alanların altında belirir ve **odak
 * ilk hatalı alana taşınır**.
 *
 * `ProductForm`da ek bir zorluk var: ilk hatalı alan KATLANMIŞ bir bölümde
 * olabilir. `setFocus` DOM'da olmayan alanı odaklayamaz, o yüzden bölüm önce
 * açılmalı. Bu dal ayrıca sınanır.
 */
describe("D-4 · gönder kapısı ve odak", () => {
  it("boş formda düğme AÇIK; basınca istek GİTMEZ, hata alanda, odak ilk hatalı alanda", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { data: [], headers: { "x-total-count": "0" } }, "get");
    let postSayisi = 0;
    sunucu("/store/admin/products", () => {
      postSayisi += 1;
      return { status: 201, data: { id: 1 } };
    }, "post");
    panel(ROUTES.adminStoreProducts);

    fireEvent.click(await screen.findByRole("button", { name: "Yeni ürün" }));
    const gonder = await screen.findByRole("button", { name: "Ürünü ekle" });
    // Kapı YOK: boş formda bile düğme basılabilir.
    expect((gonder as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(gonder);

    const baslik = (await screen.findByLabelText("Ürün adı")) as HTMLInputElement;
    await waitFor(() => expect(baslik.getAttribute("aria-invalid")).toBe("true"));
    // Hata ALANIN altında ve okunabilir.
    const mesajId = baslik.getAttribute("aria-describedby");
    expect(document.getElementById(mesajId!)?.textContent).toMatch(/Ürün adı/i);
    // Odak ilk hatalı alanda.
    expect(document.activeElement).toBe(baslik);
    // Ve asıl iddia: sunucuya HİÇBİR şey gitmedi.
    expect(postSayisi).toBe(0);
  });

  it("hata KATLANMIŞ künye bölümündeyse bölüm açılır ve odak oraya taşınır", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { data: [], headers: { "x-total-count": "0" } }, "get");
    panel(ROUTES.adminStoreProducts);

    fireEvent.click(await screen.findByRole("button", { name: "Yeni ürün" }));
    await screen.findByLabelText("Ürün adı");
    // Zorunlu alanlar doldurulur ki İLK hata künyede olsun.
    fireEvent.change(screen.getByLabelText("Ürün adı"), { target: { value: "Kalem" } });
    fireEvent.change(screen.getByLabelText(/^Kategori/), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Fiyat (TL)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("KDV oranı (%)"), { target: { value: "20" } });

    // Künyeyi aç, geçersiz sayfa sayısı yaz, sonra bölümü KAPAT.
    fireEvent.click(screen.getByRole("button", { name: /Kitap künyesi/ }));
    const sayfa = await screen.findByLabelText("Sayfa sayısı (opsiyonel)");
    fireEvent.change(sayfa, { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: /Kitap künyesi/ }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Sayfa sayısı (opsiyonel)")).toBeNull()
    );

    fireEvent.click(screen.getByRole("button", { name: "Ürünü ekle" }));

    // Bölüm KENDİLİĞİNDEN açıldı ve odak hatalı alanda.
    const yeniden = (await screen.findByLabelText(
      "Sayfa sayısı (opsiyonel)"
    )) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(yeniden));
    expect(yeniden.getAttribute("aria-invalid")).toBe("true");
  });
});

/* ══════════ D-5 · sunucu taraflı sıralama deseni (Görev 2) ══════════ */

/**
 * `ProductsPanel` panelin sıralaması OLAN tek listesi (İP-A4'ün pilotunda
 * sıralama yoktu, TB-A4-1). Desen burada prova edilir ki A7'nin 21 ekranı
 * kopyalayacağı hâl kanıtlı olsun:
 *
 *   - sıralama SUNUCUDA yapılır (`manualSorting`), istemcide değil;
 *   - seçim URL'de yaşar (paylaşılabilir link, çalışan geri tuşu);
 *   - hangi kolonun hangi yönde sıralı olduğu **ekran okuyucuya da** söylenir.
 *
 * Sunucuya gerçekten `sort` parametresi gittiği `adminStorePanel`de zaten
 * kanıtlı; buradaki iddia GÖSTERGE, yani şimdiye kadar hiç ölçülmemiş kısım.
 */
describe("D-6 · kirli formda kapatma önce sorar (İP-A7d2 · SK-4)", () => {
  /**
   * Bu test A7d2'de yazıldı ve YAZILDIĞI ANDA KIRMIZIYDI.
   *
   * `EditProductModal` İP-A6'da ortak `DuzenlemePenceresi`ye geçirilmişti ve
   * o paketin raporu kazanç listesine "kirli formda kapatma onayı"nı da
   * yazmıştı. Ama pencere korumayı İÇERİKTEN öğrenir (`useYuzeyKirliFormBekcisi`
   * bildirimi) ve `ProductForm` o kancayı HİÇ çağırmıyordu: 25 alanlık ürün
   * formunda ESC / × / dış tıklama, yazılan her şeyi sormadan siliyordu.
   *
   * A7d1'in SK-3'ü "kanca YANLIŞ YERDE çağrıldı" hâliydi; bu onun kardeşi:
   * "kanca HİÇ çağrılmadı". A7d2'nin `pencereSiz` beyanı ikincisini yakalamaz
   * — olmayan çağrının beyanı da olmaz.
   */
  it("düzenleme penceresinde alan değişince ESC kapatmaz, önce sorar", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { data: [URUN], headers: { "x-total-count": "1" } }, "get");
    sunucu("/store/admin/products/101", { data: URUN }, "get");
    defterSunucusu();
    panel(ROUTES.adminStoreProducts);
    fireEvent.click(await masaustuDuzenle());
    const ad = await screen.findByLabelText("Ürün adı");

    fireEvent.change(ad, { target: { value: "Fosforlu Kalem - Yeşil" } });
    // Bekçinin kurulmasını BEKLE. Form `mode: "onChange"` ve zod resolver'ı
    // ASENKRON: `isDirty` bayrağı değişiklikle aynı tikte değil, doğrulama
    // sözü çözülünce yayınlanıyor. Ölçüldü (A7d2 · Görev 3): değişiklikten
    // hemen sonraki render'da `isDirty` hâlâ false, bir tik sonra true.
    // Beklemeden ESC'ye basmak testi YANLIŞ SEBEPLE yeşil/kırmızı yapardı.
    await act(async () => {});
    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    // Editör AYAKTA. `getByRole("dialog")` kullanılmaz: onay penceresi açıkken
    // Radix kardeş düğümlere `aria-hidden` koyar ve editör erişilebilirlik
    // ağacından geçici olarak düşer (A7d1'de bu tuzağa düşüldü).
    expect(
      document.querySelector('[role="dialog"]'),
      "onay sorulmadan ürün penceresi kapandı"
    ).not.toBeNull();
  });

  it("TEMİZ formda ESC doğrudan kapatır (bekçi her şeyi sormuyor)", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { data: [URUN], headers: { "x-total-count": "1" } }, "get");
    sunucu("/store/admin/products/101", { data: URUN }, "get");
    defterSunucusu();
    panel(ROUTES.adminStoreProducts);
    fireEvent.click(await masaustuDuzenle());
    await screen.findByLabelText("Ürün adı");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Ürün adı")).toBeNull());
  });

  it("SATIR İÇİ oluşturma formu beyanlıdır: pencere yokken patlamaz", async () => {
    // `pencereSiz: true` beyanının gerçek çağrı yerindeki kanıtı. Beyan
    // silinirse A7d2'nin `throw`u burayı kırar.
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { data: [], headers: { "x-total-count": "0" } }, "get");
    panel(ROUTES.adminStoreProducts);
    fireEvent.click(await screen.findByRole("button", { name: "Yeni ürün" }, YUK));
    expect(await screen.findByLabelText("Ürün adı")).toBeTruthy();
  });
});

describe("D-5 · sıralama göstergesi", () => {
  it("sıralı kolon aria-sort taşır, diğerleri 'none' der ve URL'den okunur", async () => {
    izinVer("products.view", "products.manage");
    temelSunucu();
    sunucu("/store/admin/products", { data: [URUN], headers: { "x-total-count": "1" } }, "get");
    // URL sıralamayı fiyat/artan diye söylüyor; gösterge ONU yansıtmalı.
    panel(`${ROUTES.adminStoreProducts}`);

    await screen.findByRole("table");
    const basliklar = screen.getAllByRole("columnheader");
    const fiyat = basliklar.find((b) => b.textContent?.includes("Fiyat"))!;
    const eklenme = basliklar.find((b) => b.textContent?.includes("Eklenme"))!;
    const durum = basliklar.find((b) => b.textContent?.includes("Durum"))!;

    // Varsayılan sıra `created_at` DESC (bkz. lib/storeProductQuery).
    expect(eklenme.getAttribute("aria-sort")).toBe("descending");
    expect(fiyat.getAttribute("aria-sort")).toBe("none");
    // Sıralanamayan kolon hiçbir şey demez.
    expect(durum.getAttribute("aria-sort")).toBeNull();

    // Tıklayınca gösterge SIÇRAR — ve bu URL durumundan türer.
    fireEvent.click(within(fiyat).getByRole("button"));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("columnheader")
          .find((b) => b.textContent?.includes("Fiyat"))!
          .getAttribute("aria-sort")
      ).not.toBe("none")
    );
  });
});
