// İP-B2 · Ürün listesi — LİSTE SAYFASI ANATOMİSİ KABUL MATRİSİ
// (gerçek DOM + gerçekten gönderilen sorgu parametreleri).
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.
//
// ## Neden ayrı bir kabul dosyası
//
// `adminStorePanel.acceptance` İP-12'nin sözleşmesidir ve ürün listesinin
// VERİ davranışını (filtre sunucuya gidiyor mu, sayfalama gerçek mi,
// sıralama değeri değişiyor mu) zaten tutuyor. Bu dosya onun yerine geçmez;
// İP-B2'nin getirdiği ANATOMİYİ tutar:
//
//   - araç çubuğu (arama · filtre menüsü · sıralama) tek yerde mi,
//   - uygulanan filtre çipleri gerçekten sorguyu değiştiriyor mu,
//   - iki boş durum doğru anda mı geliyor,
//   - mobil kart bağlandı mı,
//   - satır aksiyonları Ç-2 · D kuralına uyuyor mu,
//   - birincil aksiyon kabuğun başlık şeridine gidiyor mu.
//
// Her filtre/sıralama düğümü `istekler` dizisinden GERÇEKTEN GÖNDERİLEN
// parametreyi okur: "element var mı" hiçbir yerde kanıt sayılmaz. Bu depoda
// tam olarak o yalancı yeşil ölçüldü (İP-12 · P1-4).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminStore from "@/pages/dashboards/AdminStore";
import { BASLIK_AKSIYON_ID } from "@/components/admin/layout/baslikAksiyonu";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu (İP-4 deseni) ══════════════ */

interface Istek {
  method: string;
  url: string;
  params: URLSearchParams;
  body: Record<string, unknown> | null;
}

let istekler: Istek[] = [];
let rotalar: {
  esles: (i: Istek) => boolean;
  yanit:
    | { status?: number; data: unknown; headers?: Record<string, string> }
    | ((i: Istek) => { status?: number; data: unknown; headers?: Record<string, string> });
}[] = [];
let eskiAdapter: unknown;

function sunucu(desen: string, yanit: (typeof rotalar)[number]["yanit"], method = "get") {
  rotalar.unshift({
    esles: (i) => i.method === method && i.url.split("?")[0].includes(desen),
    yanit,
  });
}

function urunIstekleri(): Istek[] {
  return istekler.filter((i) => i.url.split("?")[0].includes("/store/admin/products"));
}

function sonUrunIstegi(): Istek | undefined {
  return urunIstekleri().at(-1);
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  rotalar = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const gomulu = String(config.url).split("?")[1] ?? "";
    const params = new URLSearchParams(gomulu);
    for (const [k, v] of Object.entries((config.params ?? {}) as Record<string, unknown>)) {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    }
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      params,
      body: config.data ? JSON.parse(String(config.data)) : null,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota
      ? typeof rota.yanit === "function"
        ? rota.yanit(istek)
        : rota.yanit
      : { data: [] };
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
    return {
      data: ham.data,
      status,
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
  document.getElementById(BASLIK_AKSIYON_ID)?.remove();
});

function izinVer(...kodlar: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

function urun(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: "geometri",
    title: "Geometri Soru Bankası",
    kind: "PHYSICAL",
    seller_type: "PLATFORM",
    price: "180.00",
    currency: "TRY",
    in_stock: true,
    stock: 42,
    rating_count: 0,
    status: "ACTIVE",
    author: "Ahmet Yılmaz",
    publisher: "Palme Yayınları",
    isbn: "9786051234567",
    ...over,
  };
}

function urunSunucusu(kayitlar: unknown[], toplam = kayitlar.length) {
  sunucu("/store/config", { data: { low_stock_threshold: 5 } });
  sunucu("/store/book-facets", {
    data: {
      publisher: [{ value: "Palme Yayınları", count: 7 }],
      author: [{ value: "Ahmet Yılmaz", count: 3 }],
      cover_type: [],
    },
  });
  sunucu("/store/admin/products", {
    data: kayitlar,
    headers: { "x-total-count": String(toplam) },
  });
}

function magaza(sorgu = "") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`${ROUTES.adminStoreProducts}${sorgu}`]}>
        <Routes>
          <Route path={ROUTES.adminStoreProducts} element={<AdminStore />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Masaüstü tablosu — jsdom mobil kartları da basar, ayırmak ŞART. */
function tablo() {
  return screen.getByRole("table");
}

/** Mobil kart bölümü. */
function mobilBolum(kap: HTMLElement): HTMLElement {
  const el = kap.querySelector<HTMLElement>("[data-mobil-satirlar]");
  if (!el) throw new Error("mobil kart bölümü yok — renderMobileRow bağlanmamış");
  return el;
}

/* ═══════════════════════════════════════════════════════════════════
 * A · Araç çubuğu tek yerde
 * ═══════════════════════════════════════════════════════════════════ */

describe("A-1 · araç çubuğu: arama + filtre menüsü + sıralama", () => {
  it("üç denetim de tek şeritte", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 1);
    magaza();
    await screen.findByRole("table");

    expect(screen.getByLabelText("Ürün ara")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filtre ekle" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sırala:/ })).toBeTruthy();
  });

  it("ESKİ dört <select>'li filtre şeridi KALKTI", async () => {
    // Ters yön kaydı: göç "yeni deseni ekle" değil, "eskisini kaldır"ı da
    // içeriyor. İkisi bir arada kalsaydı aynı filtre iki yerden ayarlanır ve
    // hangisinin geçerli olduğu belirsizleşirdi.
    izinVer("products.view");
    urunSunucusu([urun()], 1);
    const { container } = magaza();
    await screen.findByRole("table");

    // Kalan tek `<select>` sayfalamanın "sayfa başına" seçicisidir.
    const secililer = Array.from(container.querySelectorAll("select"));
    expect(secililer).toHaveLength(1);
    expect(secililer[0].closest("label")?.textContent).toContain("Sayfa başına");
  });
});

describe("A-2 · filtre menüsü GERÇEKTEN sunucuya gidiyor", () => {
  it("menüden 'Tükendi' seçmek isteğe stok=tukendi ekler", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 1);
    magaza();
    await screen.findByRole("table");

    expect(sonUrunIstegi()?.params.get("stok"), "başlangıçta filtre yok").toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Stok durumu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tükendi" }));

    await waitFor(() =>
      expect(
        sonUrunIstegi()?.params.get("stok"),
        "filtre menüde seçildi ama sunucuya HİÇ gitmedi"
      ).toBe("tukendi")
    );
  });

  it("yayınevi seçenekleri GERÇEK facet ucundan gelir (uydurma yok)", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 1);
    magaza();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Yayınevi" }));
    // Sayı da facet'ten geliyor: sabit bir liste olsaydı burada 7 yazmazdı.
    expect(screen.getByRole("menuitem", { name: /Palme Yayınları/ }).textContent).toContain(
      "7 kayıt"
    );
  });
});

describe("A-3 · uygulanan filtre çipi", () => {
  it("çip kaldırılınca sorgu GERÇEKTEN değişir", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 1);
    magaza("?stok=tukendi");
    await screen.findByRole("table");
    expect(sonUrunIstegi()?.params.get("stok")).toBe("tukendi");

    fireEvent.click(screen.getByRole("button", { name: /Stok durumu filtresini kaldır/ }));

    await waitFor(() =>
      expect(
        sonUrunIstegi()?.params.get("stok"),
        "çip ekrandan kalktı ama sorgu aynı kaldı — çip dekoratif"
      ).toBeNull()
    );
  });

  it("'Tümünü temizle' filtreyi siler, SIRALAMAYI korur", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 1);
    magaza("?stok=tukendi&sirala=price&yon=asc");
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Tümünü temizle" }));

    await waitFor(() => expect(sonUrunIstegi()?.params.get("stok")).toBeNull());
    expect(
      sonUrunIstegi()?.params.get("sort"),
      "filtre temizlenirken sıralama da silindi — kullanıcı listeyi " +
        "genişletmek istedi, sırasını kaybetmeyi değil"
    ).toBe("price");
    expect(sonUrunIstegi()?.params.get("order")).toBe("asc");
  });
});

describe("A-4 · sıralama iki yerden okunur ama TEK durumdur", () => {
  it("araç çubuğundan sıralamak tablo başlığındaki göstergeyi de değiştirir", async () => {
    // İkisi ayrı state tutsaydı çelişebilirlerdi: araç çubuğu "Fiyat" derken
    // tablo başlığı "Eklenme"yi işaretli gösterirdi.
    izinVer("products.view");
    urunSunucusu([urun()], 1);
    magaza();
    await screen.findByRole("table");

    const eklenme = within(tablo())
      .getAllByRole("columnheader")
      .find((h) => h.textContent?.includes("Eklenme"))!;
    expect(eklenme.getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(screen.getByRole("button", { name: /Sırala:/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Fiyat" }));

    await waitFor(() => {
      const fiyat = within(tablo())
        .getAllByRole("columnheader")
        .find((h) => h.textContent?.includes("Fiyat"))!;
      expect(fiyat.getAttribute("aria-sort")).toBe("descending");
    });
    expect(sonUrunIstegi()?.params.get("sort")).toBe("price");
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * B · İki boş durum
 * ═══════════════════════════════════════════════════════════════════ */

describe("B-1 · boş durumlar", () => {
  it("filtresiz boş katalog: YARATMA daveti, filtre temizleme YOK", async () => {
    izinVer("products.view", "products.manage");
    urunSunucusu([], 0);
    magaza();

    expect(await screen.findByText(/henüz ürün eklenmemiş/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Filtreleri temizle" }),
      "boş katalogda 'filtreleri temizle' sunuluyor — yönetici olmayan bir " +
        "filtreyi aramaya başlar"
    ).toBeNull();
  });

  it("filtreli ve sonuçsuz: TEMİZLEME talimatı ve gerçekten temizliyor", async () => {
    izinVer("products.view", "products.manage");
    urunSunucusu([], 0);
    magaza("?stok=tukendi");

    const dugme = await screen.findByRole("button", { name: "Filtreleri temizle" });
    fireEvent.click(dugme);

    await waitFor(() =>
      expect(
        sonUrunIstegi()?.params.get("stok"),
        "'Filtreleri temizle' basıldı ama sorgu aynı kaldı"
      ).toBeNull()
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * C · Mobil kart
 * ═══════════════════════════════════════════════════════════════════ */

describe("C-1 · mobil kart bağlandı", () => {
  it("her satır için bir kart basılır", async () => {
    // İP-B1 envanteri T1: "`renderMobileRow` bugün kullanılmıyor — B2'de
    // bağlanır." Bu testin varlığı o cümlenin kapandığının kanıtı.
    izinVer("products.view");
    urunSunucusu([urun(), urun({ id: 2, title: "Fizik Soru Bankası" })], 2);
    const { container } = magaza();
    await screen.findByRole("table");

    const kartlar = mobilBolum(container);
    expect(within(kartlar).getByText("Geometri Soru Bankası")).toBeTruthy();
    expect(within(kartlar).getByText("Fizik Soru Bankası")).toBeTruthy();
  });

  it("kart kimlik + durum + fiyat + stok taşır (üç meta satırını aşmaz)", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 1);
    const { container } = magaza();
    await screen.findByRole("table");

    const kart = mobilBolum(container);
    expect(within(kart).getByText("Yayında")).toBeTruthy();
    expect(within(kart).getByText(/180/)).toBeTruthy();
    expect(within(kart).getByText(/42 adet/)).toBeTruthy();
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * D · Satır aksiyonları (Ç-2 · D)
 * ═══════════════════════════════════════════════════════════════════ */

describe("D-1 · satırda en fazla iki açık düğme, yıkıcı olan menüde", () => {
  it("masaüstü satırında açıkta yalnız 'Düzenle' ve 'Gizle' var", async () => {
    izinVer("products.view", "products.manage");
    urunSunucusu([urun()], 1);
    magaza();
    await screen.findByRole("table");

    const satir = within(tablo()).getAllByRole("row")[1];
    const acikDugmeler = within(satir)
      .getAllByRole("button")
      .map((b) => b.textContent?.trim())
      .filter((t) => t && !t.includes("işlemler"));
    expect(acikDugmeler).toEqual(["Düzenle", "Gizle"]);
  });

  it("'Sil' AÇIKTA DEĞİL — menüde ve onay adımlı", async () => {
    izinVer("products.view", "products.manage");
    urunSunucusu([urun()], 1);
    magaza();
    await screen.findByRole("table");

    const satir = within(tablo()).getAllByRole("row")[1];
    expect(
      within(satir).queryByRole("button", { name: "Sil" }),
      "yıkıcı aksiyon açıkta — yanlış satıra dokunmak geri alınamaz"
    ).toBeNull();

    fireEvent.click(within(satir).getByRole("button", { name: /diğer işlemler/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sil" }));

    // DELETE HENÜZ gitmemeli.
    expect(istekler.filter((i) => i.method === "delete")).toHaveLength(0);
    // Pencere BAŞLIĞI aranıyor, serbest metin değil: onay düğmesinin adı da
    // "Ürünü sil" ve serbest metin sorgusu ikisini birden yakalıyordu
    // (ilk yazımda tam olarak bu oldu — testin kendi kusuru).
    expect(screen.getByRole("heading", { name: "Ürünü sil" })).toBeTruthy();
    expect(screen.getByText(/katalogdan kaldırılacak/)).toBeTruthy();
  });

  it("onaylayınca DELETE gerçekten gider", async () => {
    izinVer("products.view", "products.manage");
    urunSunucusu([urun()], 1);
    sunucu("/store/admin/products/1", { data: {} }, "delete");
    magaza();
    await screen.findByRole("table");

    const satir = within(tablo()).getAllByRole("row")[1];
    fireEvent.click(within(satir).getByRole("button", { name: /diğer işlemler/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sil" }));
    fireEvent.click(screen.getByRole("button", { name: "Ürünü sil" }));

    await waitFor(() =>
      expect(istekler.filter((i) => i.method === "delete")).toHaveLength(1)
    );
  });

  it("yetkisiz kullanıcıda satır aksiyonu HİÇ basılmaz", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 1);
    magaza();
    await screen.findByRole("table");

    const satir = within(tablo()).getAllByRole("row")[1];
    expect(within(satir).queryAllByRole("button")).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * E · Birincil aksiyon kabuğun başlığında
 * ═══════════════════════════════════════════════════════════════════ */

describe("E-1 · 'Yeni ürün' başlık şeridine gider", () => {
  it("kabuk yuvası VARSA aksiyon oraya portallanır", async () => {
    // Yuva `AdminLayout`ta yaşıyor; bu test onu elle kurar çünkü kabuğun
    // tamamını monte etmek bu dosyanın kapsamı değil.
    const yuva = document.createElement("div");
    yuva.id = BASLIK_AKSIYON_ID;
    document.body.appendChild(yuva);

    izinVer("products.view", "products.manage");
    urunSunucusu([urun()], 1);
    const { container } = magaza();
    await screen.findByRole("table");

    expect(within(yuva).getByRole("button", { name: "Yeni ürün" })).toBeTruthy();
    expect(
      within(container).queryByRole("button", { name: "Yeni ürün" }),
      "aksiyon hem başlıkta hem içerikte — iki kez basılıyor"
    ).toBeNull();
  });

  it("kabuk YOKSA satır içinde çizilir (sessizce kaybolmaz)", async () => {
    izinVer("products.view", "products.manage");
    urunSunucusu([urun()], 1);
    const { container } = magaza();
    await screen.findByRole("table");

    expect(within(container).getByRole("button", { name: "Yeni ürün" })).toBeTruthy();
  });

  it("'Yeni ürün' formu gerçekten açar", async () => {
    izinVer("products.view", "products.manage");
    urunSunucusu([], 0);
    magaza();
    await screen.findByText(/henüz ürün eklenmemiş/i);

    // Boş durumdaki davet düğmesi de aynı formu açmalı.
    const davet = within(
      screen.getByText(/henüz ürün eklenmemiş/i).closest("[data-bos-durum]") as HTMLElement
    ).getByRole("button", { name: "Yeni ürün" });
    await act(async () => {
      fireEvent.click(davet);
    });
    expect(await screen.findByLabelText("Ürün adı")).toBeTruthy();
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * F · Tedarikçi (D-6/D-8) B2 ANATOMİSİNE TAŞINDI
 *
 * Bu bölüm main ↔ feat/panel-tasarim birleşmesinin nöbetçisidir. İki dal
 * ürün listesinin AYNI bölgesine dokundu: main tedarikçi süzgecini/kolonunu
 * ekledi (eski dört `<select>`li şeride), B2 o şeridi tamamen kaldırıp
 * `ListeAracCubugu` + çip desenine geçti. Birleşmede tedarikçi tarafının
 * "kolay olsun" diye düşmesi HİÇBİR MEVCUT TESTİ KIRMAZDI — birleşme anında
 * bu davranışın tek bir testi yoktu. Bu bölüm o boşluğu kapatır.
 * ═══════════════════════════════════════════════════════════════════ */

/** Tedarikçisi bağlı, kendi rafı boş ürün (D-8'in ölçtüğü hâl). */
function tedarikcili(over: Record<string, unknown> = {}) {
  return urun({
    stock: 0,
    supplier_backed: true,
    supplier: {
      supplier_product_id: 9,
      external_code: "YD-9",
      unit_name: "adet",
      stock_qty: "12.500",
      cost_net: "100.00",
      cost_gross: "120.00",
      margin_absolute: "60.00",
      margin_percent: "33.3",
      below_cost: false,
      link_source: "AUTO",
      is_favorite: true,
      quarantine_flags: [],
    },
    ...over,
  });
}

describe("F-1 · tedarikçi süzgeci araç çubuğu menüsünde YAŞIYOR", () => {
  it("menüden 'Tedarikçiden temin' seçmek isteğe supplier=backed EKLER", async () => {
    izinVer("products.view", "suppliers.view");
    urunSunucusu([tedarikcili()], 1);
    magaza();
    await screen.findByRole("table");

    expect(sonUrunIstegi()?.params.get("supplier"), "başlangıçta süzgeç yok").toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tedarikçi" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tedarikçiden temin" }));

    await waitFor(() =>
      expect(
        sonUrunIstegi()?.params.get("supplier"),
        "tedarikçi süzgeci menüde göründü ama sunucuya HİÇ gitmedi"
      ).toBe("backed")
    );
  });

  it("URL'den gelen süzgeç ÇİP olur ve kaldırılınca sorgu gerçekten değişir", async () => {
    izinVer("products.view", "suppliers.view");
    urunSunucusu([tedarikcili()], 1);
    magaza("?tedarikci=below_cost");
    await screen.findByRole("table");
    expect(sonUrunIstegi()?.params.get("supplier")).toBe("below_cost");

    fireEvent.click(screen.getByRole("button", { name: /Tedarikçi filtresini kaldır/ }));

    await waitFor(() =>
      expect(sonUrunIstegi()?.params.get("supplier"), "çip dekoratif").toBeNull()
    );
  });

  it("`suppliers.view` YOKSA süzgeç menüde HİÇ YOK (D-6 izin duvarı)", async () => {
    izinVer("products.view");
    urunSunucusu([tedarikcili()], 1);
    magaza();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Filtre ekle" }));
    expect(
      screen.queryByRole("menuitem", { name: "Tedarikçi" }),
      "sunucu bu role tedarikçi bloğunu doldurmaz — süzgeç boş liste üretirdi"
    ).toBeNull();
  });
});

describe("F-2 · Maliyet/Marj kolonu izin duvarının arkasında", () => {
  it("`suppliers.view` VARSA kolon basılır ve maliyeti gösterir", async () => {
    izinVer("products.view", "suppliers.view");
    urunSunucusu([tedarikcili()], 1);
    magaza();
    await screen.findByRole("table");

    expect(within(tablo()).getByRole("columnheader", { name: "Maliyet / Marj" })).toBeTruthy();
    const satir = within(tablo()).getAllByRole("row")[1];
    expect(within(satir).getByText(/120 TL/)).toBeTruthy();
  });

  it("`suppliers.view` YOKSA kolon HİÇ basılmaz", async () => {
    izinVer("products.view");
    urunSunucusu([tedarikcili()], 1);
    magaza();
    await screen.findByRole("table");

    expect(
      within(tablo()).queryByRole("columnheader", { name: "Maliyet / Marj" }),
      "görev ayrılığı ekranda da görünmeli — kolon baştan sona '—' olurdu"
    ).toBeNull();
  });
});

describe("F-3 · tedarikçi bilgisi MOBİL KARTTA da var", () => {
  it("kendi rafı boşken kart kırmızı 'Tükendi' DEĞİL, 'Kendi stoğu 0' der", async () => {
    // Kayıp sınıfı: `renderMobileRow` B2'de ilk kez bağlandı ve düz
    // `StockBadge` kullanıyordu. Tedarikçi karşılıyorken kırmızı "Tükendi"
    // basmak satın alma kararını yanlış yönlendirir (D-8).
    izinVer("products.view");
    urunSunucusu([tedarikcili()], 1);
    const { container } = magaza();
    await screen.findByRole("table");

    const kart = mobilBolum(container);
    expect(within(kart).getByText("Kendi stoğu 0")).toBeTruthy();
    expect(within(kart).queryByText("Tükendi")).toBeNull();
    // Tedarikçi sayısı da masaüstünde kalmamalı; birim adı olmadan yanıltıcı.
    expect(within(kart).getByText(/Tedarikçide 12,5 adet/)).toBeTruthy();
  });

  it("`suppliers.view` VARSA maliyet kartta da görünür", async () => {
    izinVer("products.view", "suppliers.view");
    urunSunucusu([tedarikcili()], 1);
    const { container } = magaza();
    await screen.findByRole("table");

    const kart = mobilBolum(container);
    expect(within(kart).getByText(/120 TL/)).toBeTruthy();
    expect(within(kart).getByText(/%33,3/)).toBeTruthy();
  });

  it("`suppliers.view` YOKSA maliyet satırı kartta HİÇ DOĞMAZ", async () => {
    // İlk yazımında bu iddia AYRI BİR RENDER'a yaslanıyordu ve mutasyon
    // provasında YAKALANMADI: ikinci liste henüz yüklenmemişken kart boştu,
    // yani "maliyet yok" iddiası veri olmadığı için bedavaya geçiyordu.
    // Çare: tek render + ÇIPA. Önce kartın gerçekten dolu olduğu kanıtlanır,
    // sonra maliyetin yokluğu iddia edilir.
    izinVer("products.view");
    urunSunucusu([tedarikcili()], 1);
    const { container } = magaza();
    await screen.findByRole("table");

    const kart = mobilBolum(container);
    expect(within(kart).getByText("Geometri Soru Bankası"), "kart boş — iddia bedava").toBeTruthy();
    expect(within(kart).getByText("Kendi stoğu 0"), "kart boş — iddia bedava").toBeTruthy();
    expect(
      within(kart).queryByText(/120 TL/),
      "maliyet mobilde izin duvarını atlıyor (D-6)"
    ).toBeNull();
  });
});
