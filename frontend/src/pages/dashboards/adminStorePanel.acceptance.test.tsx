// İP-12 · Mağaza panel yüzeyi — UI KABUL MATRİSİ (gerçek DOM + gerçek istek gövdesi).
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.
//
// Paketin kırmızı matris commit'i olduğu için ekran henüz bu sözleşmeyi
// taşımıyor: ilk koşum KIRMIZIDIR.
//
// ## Bu paketin başarısızlık sınıfı neden farklı
//
// Önceki paketler para/veri sözleşmesiydi; kusur DB'de görünürdü. Bu paket
// tamamen arayüz ve buradaki tipik yalancı yeşil şudur: ekran render edilir,
// test elementi DOM'da bulur, ama filtre hiçbir şeyi filtrelemez — çünkü
// parametre sunucuya HİÇ GİTMEZ. "Sayfalama var" iddiası da aynı şekilde
// istemci tarafında dilimleme olabilir.
//
// Bu yüzden her filtre/sayfalama/sıralama node'u `istekler` dizisinden
// GERÇEKTEN GÖNDERİLEN sorgu parametresini okur. "Element var mı" tek başına
// hiçbir yerde kanıt sayılmaz.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminStore from "@/pages/dashboards/AdminStore";
import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
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

type Yanit =
  | { status?: number; data: unknown; headers?: Record<string, string> }
  | ((istek: Istek) => { status?: number; data: unknown; headers?: Record<string, string> });

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

/** Bir uca giden SON isteğin sorgu parametreleri. */
function sonIstek(parca: string): Istek | undefined {
  return [...istekler].reverse().find((i) => i.url.split("?")[0].includes(parca));
}

function urunIstekleri(): Istek[] {
  return istekler.filter((i) => i.url.split("?")[0].includes("/store/admin/products"));
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  rotalar = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    // Sorgu parametreleri iki yoldan gelebilir: url'e gömülü ya da axios
    // `params`. İkisi de okunur — yoksa "parametre gitti" iddiası, istemcinin
    // hangi yolu seçtiğine göre yalancı kırmızı/yeşil olurdu.
    const gomulu = String(config.url).split("?")[1] ?? "";
    const params = new URLSearchParams(gomulu);
    for (const [k, v] of Object.entries(
      (config.params ?? {}) as Record<string, unknown>
    )) {
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
});

function izinVer(...kodlar: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

function sar(yol: string, element: React.ReactElement, rota?: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Routes>
          <Route path={rota ?? yol.split("?")[0]} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function magaza(sorgu = "") {
  return sar(
    `${ROUTES.adminStoreProducts}${sorgu}`,
    <AdminStore />,
    ROUTES.adminStoreProducts
  );
}

function siparisler(sorgu = "") {
  return sar(
    `${ROUTES.adminStoreOrders}${sorgu}`,
    <AdminStore />,
    ROUTES.adminStoreOrders
  );
}

/* ══════════════ Fixture'lar ══════════════ */

function urun(over: Partial<Record<string, unknown>> = {}) {
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

function siparis(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 5001,
    total: "360.00",
    status: "PAID",
    payment_status: "PAID",
    has_physical: true,
    created_at: "2026-08-01T10:00:00+00:00",
    ship_recipient: "Ayşe Demir",
    ship_address: "Seyhan / Adana",
    // Kalem sayısı `items` dizisinden okunur — şemada ayrı bir `item_count`
    // alanı YOK (ilk yazımda öyle varsaymıştım; ölçüm düzeltti).
    items: [
      { id: 1, title: "Geometri", quantity: 1 },
      { id: 2, title: "Fizik", quantity: 1 },
      { id: 3, title: "Kimya", quantity: 1 },
    ],
    ...over,
  };
}

/** Ürün listesini `total` başlığıyla döndüren sunucu.
 *
 *  `/store/config` de kurulur: düşük stok eşiği İSTEMCİDE SABİT DEĞİL,
 *  sunucudan okunur (eşiğin üç yerde ayrı gömülü olması bu paketin
 *  düzelttiği kusurdu). Ekran o ucu gerçekten çağırıyor.
 */
function urunSunucusu(kayitlar: unknown[], toplam = kayitlar.length) {
  sunucu("/store/config", { data: { low_stock_threshold: 5 } }, "get");
  sunucu("/store/book-facets", { data: { publisher: [], author: [], cover_type: [] } }, "get");
  sunucu(
    "/store/admin/products",
    { data: kayitlar, headers: { "x-total-count": String(toplam) } },
    "get"
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * P · Ürün listesi
 * ═══════════════════════════════════════════════════════════════════════ */

describe("P-1 · ürün listesi DataTable'a taşındı", () => {
  it("kolon başlıklı gerçek bir tablo basar", async () => {
    izinVer("products.view");
    urunSunucusu([urun()]);

    magaza();

    const tablo = await screen.findByRole("table");
    const basliklar = within(tablo)
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    // Kolon SETİ aranır, sırası değil: sıra bir tasarım kararı, varlık ise
    // sözleşme.
    for (const beklenen of ["Başlık", "Stok", "Fiyat", "Durum"]) {
      expect(
        basliklar.some((b) => b.includes(beklenen)),
        `"${beklenen}" kolonu yok — bulunan: ${basliklar.join(" | ")}`
      ).toBe(true);
    }
  });

  it("künye satırı yazar · yayınevi · ISBN taşır", async () => {
    izinVer("products.view");
    urunSunucusu([urun()]);

    magaza();

    const satir = (await screen.findByText(/Geometri Soru Bankası/)).closest("tr");
    expect(satir).not.toBeNull();
    const icinde = within(satir as HTMLElement);
    expect(icinde.getByText(/Ahmet Yılmaz/)).toBeTruthy();
    expect(icinde.getByText(/Palme Yayınları/)).toBeTruthy();
    expect(icinde.getByText(/9786051234567/)).toBeTruthy();
  });
});

describe("P-2 · sayfalama SUNUCUDA (istemci dilimlemesi değil)", () => {
  it("ilk istek limit/offset ile gider", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 120);

    magaza();
    await screen.findByRole("table");

    const ilk = sonIstek("/store/admin/products");
    expect(ilk, "ürün listesi isteği hiç gitmedi").toBeTruthy();
    expect(ilk?.params.get("limit"), "limit gönderilmiyor").toBeTruthy();
    expect(ilk?.params.get("offset"), "offset gönderilmiyor").not.toBeNull();
  });

  it("sonraki sayfa YENİ bir istek üretir ve offset ARTAR", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 120);

    magaza();
    await screen.findByRole("table");
    const oncekiSayi = urunIstekleri().length;

    fireEvent.click(await screen.findByRole("button", { name: /sonraki/i }));

    // Kritik ayrım: istemci dilimlemesi yapan bir uygulama BURADA yeni istek
    // üretmez, elindeki diziden keser. Ölçüt "yeni istek gitti mi" ve
    // "offset gerçekten arttı mı" — DOM'da satır değişmesi yetmez.
    await screen.findByRole("table");
    const sonrakiIstekler = urunIstekleri();
    expect(
      sonrakiIstekler.length,
      "sayfa değişti ama yeni istek gitmedi — istemci tarafında dilimleniyor"
    ).toBeGreaterThan(oncekiSayi);
    expect(Number(sonrakiIstekler.at(-1)?.params.get("offset"))).toBeGreaterThan(0);
  });

  it("toplam kayıt sayısı ekranda görünür (P-3)", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 120);

    magaza();

    expect(
      await screen.findByText(/120/),
      "toplam kayıt sayısı yok — kullanıcı son sayfada mı bilemez"
    ).toBeTruthy();
  });
});

describe("P-4 · sıralama sunucuya gider", () => {
  /** Bir kolon başlığındaki sıralama düğmesi. */
  async function siralamaDugmesi(baslik: string) {
    const tablo = await screen.findByRole("table");
    const kolon = within(tablo)
      .getAllByRole("columnheader")
      .find((h) => (h.textContent ?? "").includes(baslik));
    return within(kolon as HTMLElement).getByRole("button");
  }

  // İDDİA DEĞERE BAĞLI (P1-4): ilk yazımında bu node yalnız
  // `expect(params.get("sort")).toBeTruthy()` diyordu ve audit M17 ile
  // gösterdi ki `onSortingChange` tamamen etkisizleştirilse bile test
  // GEÇİYORDU — çünkü `storeProductQuery` `sort`u HER istekte varsayılanla
  // (`created_at`) gönderiyor. Yani parametrenin varlığı tıklamanın etkisini
  // ölçmüyordu; ölçtüğü şey varsayılanın gönderildiğiydi.
  //
  // Artık tıklamadan ÖNCEKİ ve SONRAKİ değer karşılaştırılıyor.
  it("Fiyat başlığına tıklayınca sort DEĞERİ created_at'ten price'a döner", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 10);

    magaza();
    await screen.findByRole("table");

    const oncekiIstek = urunIstekleri().at(-1);
    expect(
      oncekiIstek?.params.get("sort"),
      "başlangıçta varsayılan sıralama gönderilmiyor"
    ).toBe("created_at");

    fireEvent.click(await siralamaDugmesi("Fiyat"));
    await screen.findByRole("table");

    const sonrakiIstek = urunIstekleri().at(-1);
    expect(
      sonrakiIstek?.params.get("sort"),
      "Fiyat başlığına tıklandı ama sunucuya giden sıralama anahtarı " +
        "değişmedi — tıklamanın hiçbir etkisi yok"
    ).toBe("price");
  });

  it("aynı kolona ikinci tıklama YÖNÜ çevirir", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 10);

    magaza();
    await screen.findByRole("table");

    fireEvent.click(await siralamaDugmesi("Fiyat"));
    await screen.findByRole("table");
    const ilkYon = urunIstekleri().at(-1)?.params.get("order");

    fireEvent.click(await siralamaDugmesi("Fiyat"));
    await screen.findByRole("table");
    const ikinciYon = urunIstekleri().at(-1)?.params.get("order");

    expect(ilkYon, "sıralama yönü gönderilmiyor").toBeTruthy();
    expect(
      ikinciYon,
      "ikinci tıklama yönü çevirmedi — 'en pahalı' ile 'en ucuz' arasında " +
        "geçiş yapılamıyor"
    ).not.toBe(ilkYon);
  });
});

describe("P-6/P-7/P-8 · stok rozeti", () => {
  // Rozet TABLONUN İÇİNDE aranır. Filtre çubuğundaki stok seçicisi de
  // "Tükendi" yazan bir <option> taşıyor; genel bir metin sorgusu ikisini
  // ayırt edemez ve "rozet basıldı" iddiası seçeneği yakalayarak yalancı
  // yeşile dönerdi. (İlk yazımda tam olarak bu oldu.)
  it("stok 0 → 'Tükendi'", async () => {
    izinVer("products.view");
    urunSunucusu([urun({ stock: 0, in_stock: false })]);

    magaza();

    const tablo = await screen.findByRole("table");
    expect(within(tablo).getByText(/tükendi/i)).toBeTruthy();
  });

  it("stok eşiğin altında → adet SAYISIYLA gösterilir", async () => {
    izinVer("products.view");
    urunSunucusu([urun({ stock: 3 })]);

    magaza();

    // Sayı görünmeli: "az" demek yetmez, yönetici kaç adet kaldığını görmeli.
    const tablo = await screen.findByRole("table");
    expect(within(tablo).getByText(/3 adet/)).toBeTruthy();
  });

  it("bol stokta da SAYI gösterilir (in_stock boolean'ı değil)", async () => {
    izinVer("products.view");
    urunSunucusu([urun({ stock: 42 })]);

    magaza();

    const tablo = await screen.findByRole("table");
    expect(within(tablo).getByText(/42 adet/)).toBeTruthy();
  });

  it("dijital üründe stok rozeti 'Tükendi' DEĞİLDİR", async () => {
    izinVer("products.view");
    urunSunucusu([urun({ kind: "DIGITAL", stock: null, in_stock: true })]);

    magaza();

    const tablo = await screen.findByRole("table");
    expect(
      within(tablo).queryByText(/tükendi/i),
      "dijital ürün 'Tükendi' gösteriyor — dijital ürün tükenmez"
    ).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * F · Filtreler
 * ═══════════════════════════════════════════════════════════════════════ */

describe("F-1/F-2/F-3 · stok filtresi gerçekten sunucuya gider", () => {
  it("URL'deki ?stok=azalan isteğe taşınır", async () => {
    izinVer("products.view");
    urunSunucusu([urun({ stock: 3 })]);

    magaza("?stok=azalan");
    await screen.findByRole("table");

    expect(
      sonIstek("/store/admin/products")?.params.get("stok"),
      "stok filtresi URL'de var ama sunucuya GİTMİYOR — ekran filtreliymiş " +
        "gibi görünür, veri filtresizdir"
    ).toBe("azalan");
  });

  it("filtre seçimi URL'e yazılır ve sunucuya gider", async () => {
    izinVer("products.view");
    urunSunucusu([urun()]);

    magaza();
    await screen.findByRole("table");

    const secici = await screen.findByLabelText(/stok durumu/i);
    fireEvent.change(secici, { target: { value: "tukendi" } });

    await screen.findByRole("table");
    expect(sonIstek("/store/admin/products")?.params.get("stok")).toBe("tukendi");
  });

  it("F-4 · filtre URL'de yaşar (yenilemede korunur)", async () => {
    izinVer("products.view");
    urunSunucusu([urun({ stock: 0, in_stock: false })]);

    // Ayrı bir render, yani "sayfa yenilendi" hâli: seçim yalnız bileşen
    // state'inde yaşasaydı bu koşumda kaybolurdu.
    magaza("?stok=tukendi");
    await screen.findByRole("table");

    const secici = (await screen.findByLabelText(/stok durumu/i)) as HTMLSelectElement;
    expect(secici.value, "filtre URL'den geri okunmuyor").toBe("tukendi");
  });
});

describe("F-7/F-8 · yayınevi ve yazar filtresi", () => {
  it("yayınevi seçimi publisher parametresiyle gider", async () => {
    izinVer("products.view");
    urunSunucusu([urun()]);

    magaza("?yayinevi=Palme+Yayınları");
    await screen.findByRole("table");

    expect(sonIstek("/store/admin/products")?.params.get("publisher")).toBe(
      "Palme Yayınları"
    );
  });

  it("yazar seçimi author parametresiyle gider", async () => {
    izinVer("products.view");
    urunSunucusu([urun()]);

    magaza("?yazar=Ahmet+Yılmaz");
    await screen.findByRole("table");

    expect(sonIstek("/store/admin/products")?.params.get("author")).toBe(
      "Ahmet Yılmaz"
    );
  });
});

describe("A · ürün araması", () => {
  it("arama kutusuna yazılan metin q olarak sunucuya gider", async () => {
    izinVer("products.view");
    urunSunucusu([urun()]);

    magaza();
    await screen.findByRole("table");

    const kutu = await screen.findByRole("searchbox");
    fireEvent.change(kutu, { target: { value: "9786051234567" } });

    // Arama muhtemelen debounce'ludur; testin işi "sonunda gitti mi".
    await screen.findByRole("table");
    await new Promise((r) => setTimeout(r, 600));
    expect(
      urunIstekleri().some((i) => i.params.get("q") === "9786051234567"),
      "arama metni sunucuya hiç gitmedi — kutu var ama aramıyor"
    ).toBe(true);
  });

  it("URL'deki ?q= ilk istekte taşınır", async () => {
    izinVer("products.view");
    urunSunucusu([urun()]);

    magaza("?q=palme");
    await screen.findByRole("table");

    expect(sonIstek("/store/admin/products")?.params.get("q")).toBe("palme");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * O · Sipariş listesi
 * ═══════════════════════════════════════════════════════════════════════ */

describe("O-1/O-2 · sipariş durum filtresi", () => {
  it("durum seçimi ?status= olarak sunucuya gider", async () => {
    izinVer("orders.view");
    sunucu("/store/admin/orders", { data: [siparis()] }, "get");

    siparisler();
    // İP-A6: `DataTable` mobil kart düzenini (`renderMobileRow`) da basar;
    // jsdom CSS uygulamadığı için tablo VE kartlar aynı anda DOM'dadır.
    // Bu bir davranış değişikliği değil, ölçüm ortamının sınırı — sorgu
    // MASAÜSTÜ TABLOSUNA daraltıldı; iddia aynı kaldı.
    await within(await screen.findByRole("table")).findByText(/5001/);

    const secici = await screen.findByLabelText(/durum/i);
    fireEvent.change(secici, { target: { value: "PAID" } });

    await new Promise((r) => setTimeout(r, 50));
    expect(
      sonIstek("/store/admin/orders")?.params.get("status"),
      "durum filtresi sunucuya gitmiyor"
    ).toBe("PAID");
  });

  it("URL'deki ?durum= ilk istekte taşınır ve seçicide görünür", async () => {
    izinVer("orders.view");
    sunucu("/store/admin/orders", { data: [siparis()] }, "get");

    siparisler("?durum=SHIPPED");
    // İP-A6: `DataTable` mobil kart düzenini (`renderMobileRow`) da basar;
    // jsdom CSS uygulamadığı için tablo VE kartlar aynı anda DOM'dadır.
    // Bu bir davranış değişikliği değil, ölçüm ortamının sınırı — sorgu
    // MASAÜSTÜ TABLOSUNA daraltıldı; iddia aynı kaldı.
    await within(await screen.findByRole("table")).findByText(/5001/);

    expect(sonIstek("/store/admin/orders")?.params.get("status")).toBe("SHIPPED");
    const secici = (await screen.findByLabelText(/durum/i)) as HTMLSelectElement;
    expect(secici.value).toBe("SHIPPED");
  });
});

describe("O-3/O-4/O-5 · sipariş kolonları ve rozetler", () => {
  it("kolonlar: No · Tarih · Müşteri · Kalem · Toplam · Ödeme · Durum", async () => {
    izinVer("orders.view");
    sunucu("/store/admin/orders", { data: [siparis()] }, "get");

    siparisler();

    const tablo = await screen.findByRole("table");
    const basliklar = within(tablo)
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    for (const beklenen of ["No", "Tarih", "Müşteri", "Kalem", "Toplam", "Ödeme", "Durum"]) {
      expect(
        basliklar.some((b) => b.includes(beklenen)),
        `"${beklenen}" kolonu yok — bulunan: ${basliklar.join(" | ")}`
      ).toBe(true);
    }
  });

  it("durum HAM ENUM değil Türkçe etiketle gösterilir", async () => {
    izinVer("orders.view");
    sunucu("/store/admin/orders", { data: [siparis({ status: "SHIPPED" })] }, "get");

    siparisler();

    const tablo = await screen.findByRole("table");
    expect(within(tablo).getByText(/kargoda|kargoya verildi/i)).toBeTruthy();
    expect(
      within(tablo).queryByText(/^SHIPPED$/),
      "ham enum ekranda — yönetici İngilizce durum kodu okuyor"
    ).toBeNull();
  });

  it("ödeme durumu da Türkçe etiketlidir", async () => {
    izinVer("orders.view");
    sunucu("/store/admin/orders", { data: [siparis({ payment_status: "PAID" })] }, "get");

    siparisler();

    const tablo = await screen.findByRole("table");
    expect(within(tablo).queryByText(/^PAID$/)).toBeNull();
    expect(within(tablo).getByText(/ödendi/i)).toBeTruthy();
  });

  it("kalem sayısı görünür", async () => {
    izinVer("orders.view");
    sunucu("/store/admin/orders", { data: [siparis()] }, "get");

    siparisler();

    // Kalem hücresi kolon başlığından bulunur: "3" metni tabloda başka
    // hücrelerde de geçebilir (tutar, tarih) ve genel bir sorgu neyi
    // doğruladığını bulanıklaştırırdı.
    const tablo = await screen.findByRole("table");
    const basliklar = within(tablo).getAllByRole("columnheader");
    const kalemIndeksi = basliklar.findIndex((h) =>
      (h.textContent ?? "").includes("Kalem")
    );
    expect(kalemIndeksi, "Kalem kolonu yok").toBeGreaterThanOrEqual(0);
    const satir = within(tablo).getAllByRole("row")[1];
    const hucreler = within(satir).getAllByRole("cell");
    expect(hucreler[kalemIndeksi].textContent).toContain("3");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * E · Boş durum ve sessiz kesilme
 * ═══════════════════════════════════════════════════════════════════════ */

describe("E-1/E-2/E-3 · 'kayıt yok' ile 'sonuç yok' farklı", () => {
  it("filtresiz ve boşsa: katalog boş mesajı", async () => {
    izinVer("products.view");
    urunSunucusu([], 0);

    magaza();

    expect(await screen.findByText(/henüz ürün eklenmemiş|ilk ürünü/i)).toBeTruthy();
  });

  it("filtreli ve sonuçsuzsa: FARKLI mesaj + filtreyi temizle aksiyonu", async () => {
    izinVer("products.view");
    urunSunucusu([], 0);

    magaza("?stok=tukendi");

    expect(await screen.findByText(/sonuç bulunamadı|eşleşen ürün yok/i)).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: /filtreleri temizle/i })
    ).toBeTruthy();
  });

  it("iki metin AYNI olamaz", async () => {
    izinVer("products.view");
    urunSunucusu([], 0);

    // Başlık `heading` rolüyle aranır: serbest metin sorgusu filtre
    // çubuğundaki "Ürün ara" etiketini de yakalıyordu ve karşılaştırma
    // yanlış iki metni kıyaslıyordu (testin kendi kusuruydu).
    const bos = magaza();
    const bosMetin = (await screen.findByRole("heading", { level: 2 })).textContent;
    bos.unmount();

    urunSunucusu([], 0);
    magaza("?stok=tukendi");
    const filtreliMetin = (await screen.findByRole("heading", { level: 2 })).textContent;

    expect(
      filtreliMetin,
      "boş katalog ile sonuçsuz filtre aynı metni gösteriyor — yönetici " +
        "katalogun boşaldığını sanır"
    ).not.toBe(bosMetin);
  });
});

describe("E-4/E-5 · sessiz kesilme uyarısı", () => {
  // GERÇEK sunucu davranışı taklit edilir (P1-5). Önceki hâli sahte sunucuya
  // 200 kayıt uydurup "tavan 200" varsayıyordu; oysa üretimde istemci `limit`
  // göndermiyor, sunucu varsayılan 100 uyguluyor ve `X-Total-Count`
  // dönmüyordu — yani uyarı HİÇBİR koşulda tetiklenemiyordu ve test bunu
  // göremiyordu.
  //
  // Artık senaryo audit'in ölçtüğü senaryonun aynısı: katalogda 130 sipariş
  // var, uç istenen `limit` kadarını döndürüyor ve toplamı başlıkta
  // bildiriyor.
  function siparisSunucusu(toplam: number) {
    sunucu(
      "/store/admin/orders",
      (istek) => {
        const limit = Number(istek.params.get("limit") ?? 100);
        const donecek = Math.min(limit, toplam);
        return {
          data: Array.from({ length: donecek }, (_, i) => siparis({ id: 6000 + i })),
          headers: { "x-total-count": String(toplam) },
        };
      },
      "get"
    );
  }

  it("liste kesilmişse kullanıcıya SÖYLENİR", async () => {
    izinVer("orders.view");
    siparisSunucusu(130);

    siparisler();

    // İstemci `limit` GÖNDERMELİ: göndermezse tavanı bilemez ve kesilmeyi
    // hesaplayamaz.
    await screen.findByRole("table");
    expect(
      sonIstek("/store/admin/orders")?.params.get("limit"),
      "istemci limit göndermiyor — sunucu varsayılanı sessizce uygulanır"
    ).toBeTruthy();

    const uyari = await screen.findByText(/listenin tamamı bu değil/i);
    expect(
      uyari,
      "liste kesildi ama kullanıcıya söylenmiyor — 'göremediğim kayıt var " +
        "mı' sorusunun cevabı sessizce 'evet'"
    ).toBeTruthy();
    // Uyarı GERÇEK sayıları taşımalı: sabit bir metin, tavan değiştiğinde
    // sessizce yanlışa döner.
    expect(uyari.textContent).toContain("130");
  });

  it("liste kesilmemişse uyarı ÇIKMAZ", async () => {
    izinVer("orders.view");
    // Toplam, dönen kayıt sayısına eşit: kesilme yok.
    siparisSunucusu(3);

    siparisler();

    await screen.findByRole("table");
    expect(
      screen.queryByText(/listenin tamamı bu değil/i),
      "kesilmemiş listede uyarı var — yanıltıcı"
    ).toBeNull();
  });

  it("sayfalaması olan listede kesilme uyarısı GÖRÜNMEZ", async () => {
    izinVer("products.view");
    urunSunucusu([urun()], 120);

    magaza();
    await screen.findByRole("table");

    expect(
      screen.queryByText(/ilk \d+ .*gösteril/i),
      "sayfalanan listede kesilme uyarısı var — yanıltıcı"
    ).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * F-5/F-6 · Dashboard kartlarının hedefi
 * ═══════════════════════════════════════════════════════════════════════ */

describe("F-5/F-6 · dashboard kartları doğru filtreli hedefe gider", () => {
  function istatistik(over: Record<string, unknown> = {}) {
    return {
      new_clients: 0, previous_new_clients: 0,
      new_tutors: 0, previous_new_tutors: 0,
      new_orders: 0, previous_new_orders: 0,
      pending_tutors: 0, pending_diplomas: 0, open_reports: 0,
      disputed_bookings: 0, active_bookings: 0, open_demands: 0,
      paid_orders: 4, pending_returns: 0, low_stock_products: 7,
      pending_libraries: 0, active_delivery_runs: 0, period_audit_logs: 0,
      ...over,
    };
  }

  // Hedef `?stok=kritik`, `?stok=azalan` DEĞİL: dashboard sayacı
  // `stock <= eşik` diyor ve stoğu 0 olanı da sayıyor; `azalan` ise bilerek
  // `0 < stock` (F-2: "stoğu 0 olan 'azalan' değil 'tükendi'dir"). Kart
  // `azalan`a gitseydi sayı ile liste FARKLI küme gösterirdi. `kritik`
  // ikisinin birleşimi ve sayacın tam karşılığı.
  it("'Düşük stok' kartı filtreli (kritik) listeye açılır", async () => {
    izinVer("dashboard.view", "products.view");
    sunucu("/admin/stats", { data: istatistik() }, "get");
    sunucu("/admin/revenue", { data: {} }, "get");

    sar(ROUTES.admin, <AdminDashboardPage />);

    const kart = (await screen.findByText(/düşük stok/i)).closest("a");
    expect(kart, "düşük stok kartı bir bağlantı değil").not.toBeNull();
    expect(
      kart?.getAttribute("href"),
      "alarm kartı filtresiz listeye gidiyor: sayıyı görüyorsun, hangi " +
        "ürünler olduğunu göremiyorsun"
    ).toContain("stok=kritik");
  });

  it("'Hazırlanacak siparişler' kartı paketleme kuyruğuna gider", async () => {
    izinVer("dashboard.view", "orders.view");
    sunucu("/admin/stats", { data: istatistik() }, "get");
    sunucu("/admin/revenue", { data: {} }, "get");

    sar(ROUTES.admin, <AdminDashboardPage />);

    const kart = (await screen.findByText(/hazırlanacak sipariş/i)).closest("a");
    expect(kart?.getAttribute("href")).toContain("paketleme");
  });
});
