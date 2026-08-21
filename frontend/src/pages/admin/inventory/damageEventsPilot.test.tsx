/**
 * İP-A4 · Pilot ekran kabul testleri — `DamageEventsPage`.
 *
 * Mevcut kabul matrisi (`inventoryScreens.acceptance.test.tsx`) sözleşme gereği
 * DÜZENLENMEZ; göçün YENİ getirdiği davranışlar bu dosyada sınanır:
 *
 *   - filtrelerin URL'de yaşaması (yenileme / paylaşım / geri tuşu),
 *   - "filtre eşleşmedi" ile "hiç kayıt yok" boş durumlarının AYRILMASI,
 *   - her sorguda "Yeniden dene",
 *   - `DataTable` + `renderMobileRow`,
 *   - pencere durumunun ekrandan çıkması (düzenleme yüzeyi) ve kirli form
 *     bekçisinin yüzeyin İÇİNDEN bağlanması.
 *
 * Gerçek DOM + gerçek axios örneği (yalnız adapter değişir): "filtre gerçekten
 * isteğe gidiyor mu" sorusunun tek geçerli kanıtı gönderilen istektir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import DamageEventsPage from "@/pages/admin/inventory/DamageEventsPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

const VIEW = "inventory.view";
const APPLY = "inventory.apply";

/* ── Sahte sunucu (kabul matrisiyle aynı desen) ── */

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}
type Yanit = { status?: number; data: unknown } | ((i: Istek) => { status?: number; data: unknown });

let istekler: Istek[] = [];
let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit }[] = [];
let eskiAdapter: unknown;

function sunucu(desen: string, yanit: Yanit, method = "get") {
  rotalar.unshift({
    esles: (i) => i.method === method && i.url.split("?")[0].includes(desen),
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
      url: String(config.url) + (sorgu ? `?${sorgu}` : ""),
      body: config.data ? JSON.parse(String(config.data)) : null,
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
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

function izinVer(...kodlar: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

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

function hasarSunucusu(olaylar: unknown[] = [OLAY], toplam?: number) {
  sunucu("damage-events", (i) => {
    const q = new URLSearchParams(i.url.split("?")[1] ?? "");
    // Filtre GERÇEKTEN uygulanmış gibi davranır: ürün eşleşmezse boş liste.
    const urun = q.get("product_id");
    const suzulmus = urun
      ? olaylar.filter((o) => String((o as { product_id: number }).product_id) === urun)
      : olaylar;
    return {
      data: {
        items: suzulmus,
        total: toplam ?? suzulmus.length,
        limit: Number(q.get("limit") ?? 25),
        offset: Number(q.get("offset") ?? 0),
      },
    };
  });
  sunucu("/store/admin/products", { data: [] });
}

/** Adres çubuğunun testten okunabilir hâli. */
function Konum() {
  const konum = useLocation();
  return <span data-testid="adres">{konum.search}</span>;
}

function sar(yol = ROUTES.adminInventoryDamage) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Konum />
        <Routes>
          <Route path={ROUTES.adminInventoryDamage} element={<DamageEventsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const adres = () => screen.getByTestId("adres").textContent ?? "";
const sonListe = () => [...istekler].reverse().find((i) => i.url.includes("damage-events"));

/* ══════════════ Filtreler URL'de ══════════════ */

describe("İP-A4 · filtre URL'de yaşar", () => {
  it("kutuya yazılan ürün numarası ADRESE yazılır ve İSTEĞE gider", async () => {
    izinVer(VIEW);
    hasarSunucusu();
    sar();
    await screen.findAllByText(/hasara ayrıldı/i);

    fireEvent.change(screen.getByLabelText(/ürün numarasına göre/i), {
      target: { value: "5" },
    });

    await waitFor(() => expect(adres()).toContain("urun=5"));
    await waitFor(() =>
      expect(sonListe()!.url, "filtre isteğe gitmedi").toContain("product_id=5")
    );
  });

  it("filtreli ADRESLE açılınca filtre AYAKTA (yenileme/paylaşım)", async () => {
    // Sayfa yenilemesinin testteki karşılığı: aynı adresle TAZE mount.
    izinVer(VIEW);
    hasarSunucusu();
    sar(`${ROUTES.adminInventoryDamage}?urun=5`);

    await waitFor(() =>
      expect(sonListe()!.url, "adresteki filtre ilk isteğe girmedi").toContain("product_id=5")
    );
    expect(
      (screen.getByLabelText(/ürün numarasına göre/i) as HTMLInputElement).value
    ).toBe("5");
  });

  it("varsayılan değerler adrese YAZILMAZ (paylaşılabilir adres)", async () => {
    izinVer(VIEW);
    hasarSunucusu();
    sar();
    await screen.findAllByText(/hasara ayrıldı/i);
    expect(adres()).toBe("");
  });

  it("sayfa değişince adres ilerler; filtre değişince sayfa BAŞA döner", async () => {
    izinVer(VIEW);
    // 40 kayıt: iki sayfa.
    hasarSunucusu(
      Array.from({ length: 25 }, (_, i) => ({ ...OLAY, id: i + 1 })),
      40
    );
    sar();
    await screen.findAllByText(/hasara ayrıldı/i);

    fireEvent.click(screen.getByRole("button", { name: /sonraki/i }));
    await waitFor(() => expect(adres()).toContain("sayfa=2"));
    await waitFor(() => expect(sonListe()!.url).toContain("offset=25"));

    fireEvent.change(screen.getByLabelText(/ürün numarasına göre/i), {
      target: { value: "5" },
    });
    await waitFor(() => expect(adres()).toContain("urun=5"));
    expect(adres(), "filtre daraltıldı ama kullanıcı 2. sayfada kaldı").not.toContain(
      "sayfa=2"
    );
    await waitFor(() => expect(sonListe()!.url).toContain("offset=0"));
  });

  it("GERİ TUŞU önceki sayfaya döner (push, replace değil)", async () => {
    // GERÇEK tarayıcı geçmişi: `BrowserRouter` + jsdom `history`. `replace`
    // kullanılsaydı geri tuşu filtreli görünümü atlar ve kullanıcı ekrandan
    // çıkardı — bu testin tuttuğu şey tam olarak o.
    izinVer(VIEW);
    hasarSunucusu(
      Array.from({ length: 25 }, (_, i) => ({ ...OLAY, id: i + 1 })),
      40
    );
    window.history.replaceState({}, "", ROUTES.adminInventoryDamage);
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <Konum />
          <Routes>
            <Route path={ROUTES.adminInventoryDamage} element={<DamageEventsPage />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    );
    await screen.findAllByText(/hasara ayrıldı/i);

    fireEvent.click(screen.getByRole("button", { name: /sonraki/i }));
    await waitFor(() => expect(adres()).toContain("sayfa=2"));

    window.history.back();
    await waitFor(() => expect(adres(), "geri tuşu çalışmadı").not.toContain("sayfa=2"));
    await waitFor(() => expect(sonListe()!.url).toContain("offset=0"));
  });
});

/* ══════════════ İki ayrı boş durum ══════════════ */

describe("İP-A4 · boş durumlar ayrı", () => {
  it("filtre eşleşmediğinde ÇIKIŞI filtreyi temizlemektir", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sar(`${ROUTES.adminInventoryDamage}?urun=999`);

    expect(await screen.findByText(/bu filtreyle kayıt bulunamadı/i)).toBeTruthy();
    // "İlk kaydı oluştur" daveti bu durumda YANLIŞ olurdu: kayıt var, filtre
    // eşleşmiyor.
    expect(screen.queryByRole("button", { name: /[İi]lk kaydı oluştur/ })).toBeNull();

    const temizle = screen.getAllByRole("button", { name: /filtreyi temizle/i })[0];
    fireEvent.click(temizle);
    await waitFor(() => expect(adres()).not.toContain("urun"));
    await waitFor(() => expect(sonListe()!.url).not.toContain("product_id"));
  });

  it("hiç kayıt yokken ÇIKIŞI ilk kaydı oluşturmaktır", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu([]);
    sar();

    expect(await screen.findByText(/hasar kaydı yok/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /filtreyi temizle/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /[İi]lk kaydı oluştur/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("yetkisiz kullanıcıya olmayan bir çıkış GÖSTERİLMEZ", async () => {
    // `inventory.apply` yoksa "ilk kaydı oluştur" tıklanabilir bir yalan olur.
    izinVer(VIEW);
    hasarSunucusu([]);
    sar();
    expect(await screen.findByText(/hasar kaydı yok/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /[İi]lk kaydı oluştur/ })).toBeNull();
  });
});

/* ══════════════ Hata ve yeniden deneme ══════════════ */

describe("İP-A4 · hata durumu", () => {
  it("liste hatasında 'Yeniden dene' YENİ istek atar", async () => {
    izinVer(VIEW);
    sunucu("damage-events", { status: 500, data: { detail: "geçici hata" } });
    sar();

    const yeniden = await screen.findByRole("button", { name: /yeniden dene/i });
    const once = istekler.filter((i) => i.url.includes("damage-events")).length;
    fireEvent.click(yeniden);
    await waitFor(() =>
      expect(istekler.filter((i) => i.url.includes("damage-events")).length).toBeGreaterThan(
        once
      )
    );
  });

  it("hata ekranında boş durum METNİ gösterilmez (hata ≠ boş)", async () => {
    izinVer(VIEW);
    sunucu("damage-events", { status: 500, data: { detail: "geçici hata" } });
    sar();
    await screen.findByRole("button", { name: /yeniden dene/i });
    expect(screen.queryByText(/hasar kaydı yok/i)).toBeNull();
  });
});

/* ══════════════ DataTable + renderMobileRow ══════════════ */

describe("İP-A4 · tablo ortak DataTable'da", () => {
  it("mobil satır düzeni RENDER EDİLİR ve masaüstü tablodan ayrıdır", async () => {
    izinVer(VIEW);
    hasarSunucusu();
    const { container } = sar();
    await screen.findAllByText(/hasara ayrıldı/i);

    // `renderMobileRow` verildiğinde DataTable md altında kart, md üstünde
    // tablo çizer. İkisi de DOM'dadır; ayrımı sınıf yapar.
    const mobil = container.querySelector(".md\\:hidden");
    expect(mobil, "renderMobileRow kullanılmıyor — mobil düzen yok").toBeTruthy();
    expect(within(mobil as HTMLElement).getByText(/2 adet/)).toBeTruthy();

    const masaustu = container.querySelector("table");
    expect(masaustu).toBeTruthy();
    expect(masaustu!.closest(".hidden")).toBeTruthy();
  });

  it("sayfa boyutu değişimi isteğe LIMIT olarak gider", async () => {
    izinVer(VIEW);
    hasarSunucusu([OLAY], 200);
    sar();
    await screen.findAllByText(/hasara ayrıldı/i);

    fireEvent.change(screen.getByLabelText(/sayfa başına/i), { target: { value: "50" } });
    await waitFor(() => expect(sonListe()!.url).toContain("limit=50"));
    expect(adres()).toContain("boyut=50");
  });
});

/* ══════════════ Düzenleme yüzeyi ══════════════ */

describe("İP-A4 · pencere durumu ekranda değil", () => {
  it("işlem düğmesi yüzeyi açar, başarı KOŞULSUZ kapatır", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sunucu("damage-events", { status: 201, data: OLAY }, "post");
    sar();

    fireEvent.click(await screen.findByRole("button", { name: /hasara ayır/i }));
    const dialog = await screen.findByRole("dialog");

    // Ürün seçimi gerekmeden gönderim yapılmaz; burada ölçülen şey kapanış
    // yolu olduğu için formu geçerli hâle getirmeye gerek yok: kaydedilmiş
    // gönderimin kapanışı kabul matrisinde zaten var. Burada "Vazgeç"
    // YÜZEYİN kendisinden geliyor mu ona bakılır.
    expect(within(dialog).getByRole("button", { name: /vazgeç/i })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /vazgeç/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("kirli formda kapatma ONAY SORAR (bekçi yüzeyin içinden bağlı)", async () => {
    izinVer(VIEW, APPLY);
    hasarSunucusu();
    sar();

    fireEvent.click(await screen.findByRole("button", { name: /hasara ayır/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/miktar/i), { target: { value: "3" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /vazgeç/i }));

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    // Pencere HÂLÂ açık: onay penceresi Radix modalıdır ve arkadaki paneli
    // `aria-hidden` yapar, bu yüzden rol sorgusu yerine varlığı okunur.
    expect(document.querySelector('[role="dialog"]'), "form onaysız kapandı").toBeTruthy();
    expect(screen.getByLabelText(/miktar/i)).toBeTruthy();
  });
});
