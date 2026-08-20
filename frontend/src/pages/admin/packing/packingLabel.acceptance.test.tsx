// F30 — etiket basımının UI'ya bağlanması + commit 6 denetim borçları.
//
// SÖZLEŞME: bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ. Bir iddia
// uygulamaya uydurmak için zayıflatılacaksa gerekçesi ayrı başlıkta raporlanır.
//
// ## Neden gerçek DOM + gerçek axios
//
// Etiket bileşeni commit 6'da yazıldı, testleri yeşildi ve **hiçbir ekrandan
// açılamıyordu** — yani "18 test geçiyor" cümlesi kullanıcının hiç göremediği
// bir özellik için kuruluyordu. Aynı sınıftan hatalar F26'da somut zarar verdi:
// etiket bomboş basıldı, uzun başlık QR'ı ezdi, hazırlama ekranı ne satın
// alındığını göstermedi. Bu yüzden burada ölçülen şey ekranda görünen sonuç ve
// **gerçekten giden istek**tir; "bileşen render oldu" kanıt sayılmaz.
//
// Kapsanan denetim borçları: (4a) duruma bağlı vazgeçme yetkisi · (4b) işlem
// başına sabit idempotency anahtarı · (4d) `?durum=` prototip sızıntısı ·
// (4e) kalan-adet sunumu ve tutarsızlık uyarısı · (4f) ReasonDialog sınırları
// ve erişilebilir ad çakışması.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AxiosError } from "axios";

import { apiClient } from "@/api/axios";
import { Toaster } from "@/components/Toaster";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";

import PackagesPage from "./PackagesPage";
import PackingLayout from "./PackingLayout";
import PackingQueuePage from "./PackingQueuePage";
import PackingStationPage from "./PackingStationPage";
import ReturnQueuePage from "./ReturnQueuePage";

import type { AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";

const VIEW = "packing.view";
const PACK = "packing.pack";
const MANAGE = "packing.manage";

/* ══════════════ QR: kütüphaneye GERÇEKTEN geçen prop'lar gözlenir ══════════════ */

const { qrCagrilari } = vi.hoisted(() => ({
  qrCagrilari: [] as Record<string, unknown>[],
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: Record<string, unknown>) => {
    qrCagrilari.push(props);
    return <svg data-testid="qr" />;
  },
}));

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

/**
 * Rota kaydı — **sonra kaydedilen ÖNCE denenir** (`unshift`).
 *
 * Alt yol tuzağı: `"/packing/packages/77"` deseni `includes` ile eşleştiği için
 * `/packing/packages/77/label` adresini de yakalar. Bu yüzden paket detayı
 * aşağıdaki `paketDetayi()` yardımcısıyla **sonu bağlı regex** olarak kaydedilir;
 * ilk koşumda tam bu karışma yüzünden etiket, paket detayının gövdesiyle
 * dolduruluyor ve sevkiyat kimliği boş çıkıyordu.
 */
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

/**
 * Ağ katmanında düşen istek (yanıt YOK) — yeniden deneme senaryoları için.
 *
 * **GERÇEK `AxiosError`** üretilir, `isAxiosError: true` yazılmış düz bir
 * `Error` değil: `lib/errors.ts::getErrorMessage` `instanceof AxiosError`
 * kontrolü yapıyor ve ördek-tipli sahte hata sessizce FALLBACK metnine
 * düşüyordu. Yani "hata kullanıcıya doğru anlatılıyor" iddiası, harness
 * yüzünden ölçülemez hâle geliyordu (ilk koşumda tam bunu yakaladık).
 */
function agHatasi(): never {
  throw new AxiosError("ağa çıkılamadı", AxiosError.ERR_NETWORK);
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  rotalar = [];
  qrCagrilari.length = 0;
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
      throw new AxiosError(
        `istek başarısız: ${status}`,
        String(status),
        config as InternalAxiosRequestConfig,
        undefined,
        { status, data: ham.data, headers: {}, config, statusText: "" } as never,
      );
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
  // Toast kuyruğu testler arasında taşınmaz: bir önceki testin hata mesajı,
  // sonrakinin "hata gösterildi" iddiasını yalancı yeşil yapardı.
  useToastStore.setState({ toasts: [] });
});

function izinVer(...kodlar: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: kodlar } as never,
  });
}

async function sar(yol: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Routes>
          <Route path="/yonetim/paketleme" element={<PackingLayout />}>
            <Route index element={<PackingQueuePage />} />
            <Route path="paketler" element={<PackagesPage />} />
            <Route path="paket/:id" element={<PackingStationPage />} />
            <Route path="iade" element={<ReturnQueuePage />} />
          </Route>
        </Routes>
        {/* Üretimde `App.tsx` global olarak basar. Testte de basılır, yoksa
            `toast.error` ile giden mesajlar DOM'a hiç düşmez ve "hata
            kullanıcıya gösterildi" iddiası ölçülemez hâle gelirdi. */}
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Paket detayı — alt yollara (`/label`, `/scan`) SIZMAYAN kayıt. */
function paketDetayi(data: unknown) {
  sunucu(/\/packing\/packages\/\d+$/, { data });
}

/** Yazma isteği = paket durumunu ya da token'ı değiştirebilecek her istek. */
const yazmaIstekleri = () => istekler.filter((i) => i.method !== "get");

/* ══════════════ Fixture'lar ══════════════ */

const KALEM = (over: Record<string, unknown> = {}) => ({
  id: 1,
  order_item_id: 9001,
  product_id: 11,
  sku: "FZK-000011",
  barcode: "8690000000011",
  title: "Palme TYT Matematik Soru Bankası",
  expected_qty: 2,
  scanned_qty: 2,
  remaining: 0,
  ...over,
});

const PAKET = (over: Record<string, unknown> = {}) => ({
  id: 77,
  order_id: 501,
  package_no: 1,
  code: "PKT-000077",
  status: "PACKED",
  // Detay ucundaki yük BİLİNÇLİ olarak farklı: etiketin GERÇEKTEN etiket
  // ucundan beslendiğini ayırt edebilmek için (bkz. ilk test).
  qr_payload: "PKG1:77:detayTokeni",
  items_fingerprint: "abc",
  packed_at: "2026-08-01T09:30:00Z",
  handed_over_at: null,
  returned_at: null,
  delivered_at: null,
  void_at: null,
  unpacked_at: null,
  created_at: "2026-08-01T08:00:00Z",
  items: [KALEM()],
  ...over,
});

const ETIKET = (over: Record<string, unknown> = {}) => ({
  package_id: 77,
  code: "PKT-000077",
  status: "PACKED",
  qr_payload: "PKG1:77:ETIKET_UCUNDAN_GELEN_TOKEN",
  order_id: 501,
  recipient: "Ayşe Yıldız",
  address: "Kurtuluş Mah. 64019 Sk. No:12 D:4",
  city: "Adana",
  district: "Seyhan",
  delivery_pref: "KAPIYA_BIRAK",
  delivery_pref_note: null,
  items: [
    { order_item_id: 9001, sku: "FZK-000011", title: "Palme TYT Matematik Soru Bankası", expected_qty: 2 },
  ],
  ...over,
});

/* ══════════════ 1. İstasyonda etiket ══════════════ */

describe("istasyonda paket etiketi", () => {
  it("PACKED pakette 'Etiketi yazdır' görünür ve etiketi ETİKET UCUNDAN doldurur", async () => {
    // Ayırt edici nokta: paket detayı da bir `qr_payload` taşıyor. Etiket o
    // yükü kullansaydı test yine "bir QR basıldı" derdi ama sevkiyat kimliği
    // (alıcı/adres/tercih) hiç gelmezdi — F26'daki boş etiketin ta kendisi.
    izinVer(VIEW, PACK);
    sunucu("/packing/packages/77/label", { data: ETIKET() });
    paketDetayi(PAKET());
    await sar("/yonetim/paketleme/paket/77");

    const buton = await screen.findByRole("button", { name: /etiketi yazdır/i });
    fireEvent.click(buton);

    await waitFor(() => expect(document.querySelector(".package-label")).toBeTruthy());
    const kagit = document.querySelector(".package-label")!;

    // Sevkiyat kimliği GERÇEKTEN kâğıtta.
    expect(kagit.textContent).toContain("Ayşe Yıldız");
    expect(kagit.textContent).toContain("Kurtuluş Mah. 64019 Sk. No:12 D:4");
    expect(kagit.textContent).toContain("Seyhan");
    expect(kagit.textContent).toMatch(/KAPIYA BIRAK/);
    expect(kagit.textContent).toContain("PKT-000077");

    // QR'a basılan değer etiket ucundan gelendir, detaydaki değil.
    expect(qrCagrilari.length).toBeGreaterThan(0);
    expect(qrCagrilari[0].value).toBe("PKG1:77:ETIKET_UCUNDAN_GELEN_TOKEN");
    expect(qrCagrilari[0].value).not.toBe("PKG1:77:detayTokeni");
  });

  it("etiket AÇMAK hiçbir yazma isteği atmaz (durum ve token değişmez)", async () => {
    // Yeniden basım yan etkisiz olmalı: `repack` sonrası kutunun üstündeki eski
    // etiket geçerli kalır (boşluk G3). Basmanın bir POST'a dönüşmesi, kâğıdı
    // her yırtıldığında sistemi bir yere taşırdı.
    izinVer(VIEW, PACK);
    sunucu("/packing/packages/77/label", { data: ETIKET() });
    paketDetayi(PAKET());
    await sar("/yonetim/paketleme/paket/77");

    fireEvent.click(await screen.findByRole("button", { name: /etiketi yazdır/i }));
    await waitFor(() => expect(document.querySelector(".package-label")).toBeTruthy());

    expect(yazmaIstekleri()).toHaveLength(0);
    expect(istekler.some((i) => i.url.includes("/packing/packages/77/label"))).toBe(true);
  });

  it("OPEN pakette etiket düğmesi GÖRÜNMEZ (yarım etiket basılmaz)", async () => {
    // Açık paketin kalemleri henüz tek tek okutulmadı; etiket "kutu bunları
    // içerir" diyen bir beyandır ve yarım kutuda o beyan yalan olur.
    izinVer(VIEW, PACK);
    paketDetayi(PAKET({ status: "OPEN", items: [KALEM({ scanned_qty: 0, remaining: 2 })] }));
    await sar("/yonetim/paketleme/paket/77");

    await screen.findByText("PKT-000077");
    expect(screen.queryByRole("button", { name: /etiketi yazdır/i })).toBeNull();
    expect(istekler.some((i) => i.url.includes("/label"))).toBe(false);
  });

  it("qr_payload YOKSA etiket açılmaz ve SEBEBİ ekranda yazar", async () => {
    // Sessiz boş etiket yasak: karekodsuz kâğıt kutunun üstünde işe yaramaz ve
    // kurye paketi okutamaz. F26'da tam olarak bu fark edilmemişti.
    izinVer(VIEW, PACK);
    sunucu("/packing/packages/77/label", { data: ETIKET({ qr_payload: "" }) });
    paketDetayi(PAKET());
    await sar("/yonetim/paketleme/paket/77");

    fireEvent.click(await screen.findByRole("button", { name: /etiketi yazdır/i }));

    const uyari = await screen.findByRole("alert");
    expect(uyari.textContent).toMatch(/karekod/i);
    expect(document.querySelector(".package-label")).toBeNull();
    expect(qrCagrilari).toHaveLength(0);
  });

  it("paket TAMAMLANINCA etiket düğmesi ekranda BELİRİR (akışın devamı)", async () => {
    // İstenen kullanıcı yolu: kutuyu kapat → etiketi bas → yapıştır. Düğme
    // yalnız sayfa yenilenince gelseydi operatör kâğıdı basmadan istasyondan
    // ayrılırdı. Ölçüm gerçek tıklama + sunucunun döndürdüğü PACKED paket.
    izinVer(VIEW, PACK);
    const tam = PAKET({ status: "OPEN", items: [KALEM({ scanned_qty: 2, remaining: 0 })] });
    // Sahte sunucu bu testte DURUMLUDUR ve bu bir kolaylık değil, doğruluk
    // şartı: `useCompletePackage` başarıdan sonra bütün paketleme sorgularını
    // geçersiz kılar (kapanan kutu dağıtım kuyruğuna düşer), yani paket detayı
    // YENİDEN çekilir. Sabit `OPEN` gövdesi döndüren bir fixture, gerçek
    // sunucunun asla yapmayacağı bir şeyi yapar — kapanmış paketi tekrar açık
    // gösterir — ve düğmeyi belirdiği anda geri alırdı. İlk koşumda tam olarak
    // bu yaşandı: `complete` 200 döndü, "PKT-000077 paketlendi" toast'ı
    // basıldı, ama ekran refetch'le OPEN'a geri sardı. Ölçülmek istenen şey
    // ekranın kendi akışı olduğu için düzeltme harness'ta yapıldı.
    let sunucudakiDurum = "OPEN";
    sunucu(/\/packing\/packages\/\d+$/, () => ({
      data: { ...tam, status: sunucudakiDurum },
    }));
    sunucu(
      "/packing/packages/77/complete",
      () => {
        sunucudakiDurum = "PACKED";
        return { data: { ...tam, status: "PACKED" } };
      },
      "post",
    );
    sunucu(/\/packing\/packages\/\d+\/label$/, { data: ETIKET() });
    await sar("/yonetim/paketleme/paket/77");

    expect(screen.queryByRole("button", { name: /etiketi yazdır/i })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /paketi tamamla/i }));

    const etiketDugmesi = await screen.findByRole("button", { name: /etiketi yazdır/i });
    fireEvent.click(etiketDugmesi);
    await waitFor(() => expect(document.querySelector(".package-label")).toBeTruthy());
    expect(qrCagrilari[0].value).toBe("PKG1:77:ETIKET_UCUNDAN_GELEN_TOKEN");
  });

  it("etiket verisi alınamazsa kâğıt açılmaz, hata gösterilir", async () => {
    izinVer(VIEW, PACK);
    sunucu("/packing/packages/77/label", { status: 500, data: { detail: "patladı" } });
    paketDetayi(PAKET());
    await sar("/yonetim/paketleme/paket/77");

    fireEvent.click(await screen.findByRole("button", { name: /etiketi yazdır/i }));
    await screen.findByRole("alert");
    expect(document.querySelector(".package-label")).toBeNull();
  });
});

/* ══════════════ 2. Paketler listesi: yeniden basım + çoklu sayfa ══════════════ */

describe("paketler listesinden etiket", () => {
  const LISTE = (durumlar: string[]) => ({
    items: durumlar.map((status, i) => ({
      id: 100 + i,
      order_id: 500 + i,
      code: `PKT-${String(100 + i).padStart(6, "0")}`,
      status,
      unpacked_at: null,
      packed_at: "2026-08-01T09:30:00Z",
      created_at: "2026-08-01T08:00:00Z",
      handed_over_at: "2026-08-01T12:00:00Z",
      returned_at: "2026-08-02T10:00:00Z",
      items: [],
    })),
    total: durumlar.length,
    limit: 50,
    offset: 0,
  });

  it("PACKED satırında yeniden basım sunulur, KURYEDEKİ satırda sunulmaz", async () => {
    // Araçtaki kutuya kâğıt yapıştırılamaz; orada basılan ikinci etiket ancak
    // yanlış bir kutunun üstüne gidebilir.
    izinVer(VIEW, PACK);
    sunucu("/packing/packages", { data: LISTE(["PACKED", "HANDED_OVER"]) });
    await sar("/yonetim/paketleme/paketler");

    // İP-A7d2: liste `DataTable`a geçti ve tablo mobil kartı da masaüstü
    // satırını da DOM'a basar (görünürlüğü CSS ayırır). Bu yüzden her satır
    // içeriği İKİ kez bulunur; sayı iddiası satır BAŞINA ikiye çıkar.
    await screen.findAllByText("PKT-000100");
    expect(screen.getAllByRole("button", { name: "Etiket" })).toHaveLength(2);
  });

  it("seçilen paketlerin etiketleri TEK sayfada basılır (N paket → N etiket)", async () => {
    izinVer(VIEW, PACK);
    sunucu("/packing/packages", { data: LISTE(["PACKED", "PACKED", "HANDED_OVER"]) });
    sunucu(/\/packing\/packages\/(\d+)\/label$/, (i) => {
      const id = Number(/\/packages\/(\d+)\/label/.exec(i.url)![1]);
      return {
        data: ETIKET({
          package_id: id,
          code: `PKT-${String(id).padStart(6, "0")}`,
          qr_payload: `PKG1:${id}:tok${id}`,
          order_id: id,
        }),
      };
    });
    await sar("/yonetim/paketleme/paketler");

    // "Bu sayfadaki basılabilir 2 paketi seç" — kuryedeki satır seçilemez.
    const hepsi = await screen.findByRole("checkbox", { name: /basılabilir 2 paketi seç/i });
    fireEvent.click(hepsi);
    fireEvent.click(screen.getByRole("button", { name: /seçili 2 etiketi yazdır/i }));

    await waitFor(() =>
      expect(document.querySelectorAll(".package-label")).toHaveLength(2),
    );
    const yukler = qrCagrilari.map((p) => String(p.value));
    expect(yukler).toContain("PKG1:100:tok100");
    expect(yukler).toContain("PKG1:101:tok101");
    // Kuryedeki paketin etiketi hiç istenmedi.
    expect(istekler.some((i) => i.url.includes("/packages/102/label"))).toBe(false);
    expect(yazmaIstekleri()).toHaveLength(0);
  });

  it("satırda duruma göre ANLAMLI zaman damgası yazar", async () => {
    // `packed_at`/`handed_over_at`/`returned_at` mevcuttu ama hiç gösterilmiyordu:
    // kuyrukta unutulmuş kutuyu görünür kılan tek şey bu damgadır. Hepsini
    // birden basmak satırı okunamaz yapardı, o yüzden duruma göre TEK damga.
    izinVer(VIEW);
    sunucu("/packing/packages", { data: LISTE(["PACKED", "RETURNED"]) });
    await sar("/yonetim/paketleme/paketler");

    await screen.findAllByText("PKT-000100");
    expect(screen.getAllByText(/paketlendi ·/).length).toBeGreaterThan(0);
    // PACKED satırında "depoya alındı" damgası GÖRÜNMEZ (veri dolu olsa bile).
    // İP-A7d2: `DataTable` mobil kart + masaüstü satırı ikisini de basar, bu
    // yüzden tek satırın damgası İKİ düğümde görünür.
    expect(screen.getAllByText(/depoya alındı ·/)).toHaveLength(2);
  });

  it("?durum=toString API'ye status olarak GİTMEZ (prototip sızıntısı)", async () => {
    // Eski kontrol `hamDurum in PACKAGE_STATUS_LABEL` idi ve `in` prototip
    // zincirini de kapsıyordu: `toString`, `constructor`, `__proto__` "geçerli"
    // sayılıp sunucuya gidiyor, 422 dönüyor ve kullanıcı boş ekranın sebebini
    // göremiyordu.
    izinVer(VIEW);
    sunucu("/packing/packages", { data: { items: [], total: 0, limit: 50, offset: 0 } });
    await sar("/yonetim/paketleme/paketler?durum=toString");

    await waitFor(() => {
      const g = istekler.find((i) => i.url.includes("/packing/packages"));
      expect(g, "liste isteği hiç gitmedi").toBeTruthy();
      expect(g!.url).not.toMatch(/status=/);
    });
  });

  it("?durum=__proto__ ve ?durum=constructor de süzgeç sayılmaz", async () => {
    izinVer(VIEW);
    sunucu("/packing/packages", { data: { items: [], total: 0, limit: 50, offset: 0 } });
    await sar("/yonetim/paketleme/paketler?durum=__proto__");
    await waitFor(() => expect(istekler.length).toBeGreaterThan(0));
    expect(istekler.find((i) => i.url.includes("/packing/packages"))!.url).not.toMatch(
      /status=/,
    );

    // Ters prova: GERÇEK bir durum hâlâ sorguya gitmeli, yoksa test "her şeyi
    // atıyor" diyerek süzgeci tamamen kırık bir uygulamada da geçerdi.
    istekler = [];
    await sar("/yonetim/paketleme/paketler?durum=RETURN_PENDING");
    await waitFor(() =>
      expect(istekler.find((i) => i.url.includes("/packing/packages"))!.url).toMatch(
        /status=RETURN_PENDING/,
      ),
    );
  });
});

/* ══════════════ 3. Vazgeçme yetkisi DURUMA bağlıdır (4a) ══════════════ */

describe("paketten vazgeçme yetkisinin ekrandaki karşılığı", () => {
  const vazgecDugmesi = () => screen.queryByRole("button", { name: /paketten vazgeç/i });

  it("OPEN + packing.pack → düğme GÖRÜNÜR", async () => {
    izinVer(VIEW, PACK);
    paketDetayi(PAKET({ status: "OPEN", items: [KALEM({ scanned_qty: 0, remaining: 2 })] }));
    await sar("/yonetim/paketleme/paket/77");
    await screen.findByText("PKT-000077");
    expect(vazgecDugmesi()).toBeTruthy();
  });

  it("PACKED + YALNIZ packing.pack → düğme GÖRÜNMEZ", async () => {
    // Kapanmış paketi çözmek başka birinin kararını iptal etmektir ve
    // `_yonetim_izni_ara` ile `packing.manage` arar (görev ayrılığı). Düğmeyi
    // göstermek, tıklandığında kesin 403 alacak bir iş vaat etmekti.
    izinVer(VIEW, PACK);
    paketDetayi(PAKET({ status: "PACKED" }));
    await sar("/yonetim/paketleme/paket/77");
    await screen.findByText("PKT-000077");
    expect(vazgecDugmesi()).toBeNull();
  });

  it("RETURNED + YALNIZ packing.pack → düğme GÖRÜNMEZ", async () => {
    izinVer(VIEW, PACK);
    paketDetayi(PAKET({ status: "RETURNED" }));
    await sar("/yonetim/paketleme/paket/77");
    await screen.findByText("PKT-000077");
    expect(vazgecDugmesi()).toBeNull();
  });

  it("PACKED + packing.pack + packing.manage → düğme GÖRÜNÜR", async () => {
    izinVer(VIEW, PACK, MANAGE);
    paketDetayi(PAKET({ status: "PACKED" }));
    await sar("/yonetim/paketleme/paket/77");
    await screen.findByText("PKT-000077");
    expect(vazgecDugmesi()).toBeTruthy();
  });

  it("PACKED + YALNIZ packing.manage → düğme GÖRÜNMEZ (uç `packing.pack` de ister)", async () => {
    // `api/routers/packing.py::void_package` `Depends(PACK)` taşır: `manage`
    // tek başına yetmez. İki kapı üst üstedir ve ekran ikisini de yansıtır.
    izinVer(VIEW, MANAGE);
    paketDetayi(PAKET({ status: "PACKED" }));
    await sar("/yonetim/paketleme/paket/77");
    await screen.findByText("PKT-000077");
    expect(vazgecDugmesi()).toBeNull();
  });

  it("backend yine de reddederse hata KULLANICIYA gösterilir", async () => {
    // Ekrandaki kapı bir kolaylıktır, otorite değil: yarış hâlinde (araya giren
    // `complete`) sunucu 403 döndürebilir ve bu sessiz kalmamalı.
    izinVer(VIEW, PACK);
    paketDetayi(PAKET({ status: "OPEN", items: [KALEM({ scanned_qty: 0, remaining: 2 })] }));
    sunucu(
      "/packing/packages/77/void",
      { status: 403, data: { detail: "Kapanmış paketi çözmek için packing.manage izni gerekir" } },
      "post",
    );
    await sar("/yonetim/paketleme/paket/77");

    fireEvent.click(await screen.findByRole("button", { name: /paketten vazgeç/i }));
    // Ekranda okutma kutusu da bir `textbox`: ad ile ayrılır.
    const alan = await screen.findByRole("textbox", { name: /gerekçe/i });
    fireEvent.change(alan, { target: { value: "sipariş iptal edildi" } });
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));

    await waitFor(() =>
      expect(istekler.some((i) => i.url.includes("/void"))).toBe(true),
    );
    // NOT: `lib/errors.ts` 403'te sunucunun `detail` metnini DÜŞÜRÜP sabit bir
    // cümle veriyor ("Bu işlem için yetkin yok."), yani gövdedeki "packing.manage"
    // kullanıcıya ulaşmıyor. Ortak katman bu paketin kapsamı dışında; burada
    // ölçülen şey reddin sessizce yutulmadığıdır.
    expect(await screen.findByText(/yetki/i)).toBeTruthy();
  });
});

/* ══════════════ 4. İdempotency anahtarı işlem başına SABİT (4b) ══════════════ */

describe("idempotency anahtarı", () => {
  const ACIK = () =>
    PAKET({
      status: "OPEN",
      items: [
        KALEM({ scanned_qty: 0, remaining: 2 }),
        KALEM({ id: 2, order_item_id: 9002, sku: "FZK-000012", barcode: null, title: "345 AYT Fizik", expected_qty: 1, scanned_qty: 0, remaining: 1 }),
      ],
    });

  const taramaAnahtarlari = () =>
    istekler
      .filter((i) => i.url.includes("/scan"))
      .map((i) => String(i.body?.idempotency_key ?? ""));

  it("AYNI okutma iki transport denemesinde AYNI anahtarı taşır", async () => {
    // Anahtar eskiden `mutate` çağrısının İÇİNDE üretiliyordu: ağ zaman aşımı
    // ya da kullanıcının ikinci denemesi YENİ anahtar doğuruyor ve sunucu aynı
    // fiziksel kitabı iki kez sayıyordu.
    izinVer(VIEW, PACK);
    paketDetayi(ACIK());
    let deneme = 0;
    sunucu(
      "/packing/packages/77/scan",
      () => {
        deneme += 1;
        if (deneme === 1) agHatasi();
        return { data: { result: "OK", ...ACIK() } };
      },
      "post",
    );
    await sar("/yonetim/paketleme/paket/77");

    const kutu = await screen.findByRole("textbox", { name: /kod|barkod|okut/i });
    fireEvent.change(kutu, { target: { value: "8690000000011" } });
    fireEvent.submit(kutu.closest("form")!);
    await waitFor(() => expect(taramaAnahtarlari()).toHaveLength(1));

    // Ağ hatası sonrası kullanıcı aynı kodu yeniden gönderir.
    fireEvent.submit(kutu.closest("form")!);
    await waitFor(() => expect(taramaAnahtarlari()).toHaveLength(2));

    const [ilk, ikinci] = taramaAnahtarlari();
    expect(ilk).toBeTruthy();
    expect(ikinci).toBe(ilk);
  });

  it("BAŞARIDAN sonraki okutma YENİ anahtar alır (aynı kitabın 2. kopyası sayılmalı)", async () => {
    // Aynı barkodu ikinci kez okutmak, aynı üründen ikinci adet demektir.
    // Anahtar korunsaydı sunucu ilk sonucu `replayed` ile tekrar oynatır ve
    // ikinci kopya hiç sayılmazdı.
    izinVer(VIEW, PACK);
    paketDetayi(ACIK());
    sunucu("/packing/packages/77/scan", { data: { result: "OK", ...ACIK() } }, "post");
    await sar("/yonetim/paketleme/paket/77");

    const kutu = await screen.findByRole("textbox", { name: /kod|barkod|okut/i });
    fireEvent.change(kutu, { target: { value: "8690000000011" } });
    fireEvent.submit(kutu.closest("form")!);
    await waitFor(() => expect(taramaAnahtarlari()).toHaveLength(1));

    fireEvent.change(kutu, { target: { value: "8690000000011" } });
    fireEvent.submit(kutu.closest("form")!);
    await waitFor(() => expect(taramaAnahtarlari()).toHaveLength(2));

    const [ilk, ikinci] = taramaAnahtarlari();
    expect(ikinci).not.toBe(ilk);
  });

  it("BAŞKA bir kod okutmak yeni işlemdir: anahtar yenilenir", async () => {
    // Ağ hatasından sonra farklı bir kitap okutulursa eski anahtar sunucuda
    // ilk taramanın sonucunu tekrar oynatırdı: operatör yanlış kitabı kutuya
    // koyar, ekran "okutuldu" derdi.
    izinVer(VIEW, PACK);
    paketDetayi(ACIK());
    sunucu("/packing/packages/77/scan", () => agHatasi(), "post");
    await sar("/yonetim/paketleme/paket/77");

    const kutu = await screen.findByRole("textbox", { name: /kod|barkod|okut/i });
    fireEvent.change(kutu, { target: { value: "8690000000011" } });
    fireEvent.submit(kutu.closest("form")!);
    await waitFor(() => expect(taramaAnahtarlari()).toHaveLength(1));

    fireEvent.change(kutu, { target: { value: "8690000000012" } });
    fireEvent.submit(kutu.closest("form")!);
    await waitFor(() => expect(taramaAnahtarlari()).toHaveLength(2));

    const [ilk, ikinci] = taramaAnahtarlari();
    expect(ikinci).not.toBe(ilk);
  });

  it("SALT render anahtarı değiştirmez", async () => {
    // Her render'da yenilenen bir anahtar, ağ tekrarını sunucuya iki ayrı iş
    // gibi gösterirdi. Ölçüm: araya bir yeniden render sokup aynı kodu gönder.
    izinVer(VIEW, PACK);
    paketDetayi(ACIK());
    sunucu("/packing/packages/77/scan", () => agHatasi(), "post");
    await sar("/yonetim/paketleme/paket/77");

    const kutu = await screen.findByRole("textbox", { name: /kod|barkod|okut/i });
    fireEvent.change(kutu, { target: { value: "8690000000011" } });
    fireEvent.submit(kutu.closest("form")!);
    await waitFor(() => expect(taramaAnahtarlari()).toHaveLength(1));

    // Kutuya yazmak state günceller → bileşen yeniden render olur.
    fireEvent.change(kutu, { target: { value: "8690000000011x" } });
    fireEvent.change(kutu, { target: { value: "8690000000011" } });
    fireEvent.submit(kutu.closest("form")!);
    await waitFor(() => expect(taramaAnahtarlari()).toHaveLength(2));

    const [ilk, ikinci] = taramaAnahtarlari();
    expect(ikinci).toBe(ilk);
  });

  it("geri alma ile okutma anahtarları KARIŞMAZ", async () => {
    // İki uç ayrı işler: `undo_scan` durum-idempotan DEĞİL ve anahtarı
    // taramanınkiyle çakışırsa sunucu yanlış sonucu oynatır.
    izinVer(VIEW, PACK);
    paketDetayi(PAKET({ status: "OPEN", items: [KALEM({ scanned_qty: 1, remaining: 1 })] }));
    sunucu("/packing/packages/77/undo-scan", { data: { result: "OK", ...PAKET({ status: "OPEN" }) } }, "post");
    sunucu("/packing/packages/77/scan", { data: { result: "OK", ...PAKET({ status: "OPEN" }) } }, "post");
    await sar("/yonetim/paketleme/paket/77");

    const kutu = await screen.findByRole("textbox", { name: /kod|barkod|okut/i });
    fireEvent.change(kutu, { target: { value: "8690000000011" } });
    fireEvent.submit(kutu.closest("form")!);
    await waitFor(() => expect(taramaAnahtarlari()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /geri al/i }));
    const alan = await screen.findByRole("textbox", { name: /gerekçe/i });
    fireEvent.change(alan, { target: { value: "yanlış kutuya kondu" } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() =>
      expect(istekler.some((i) => i.url.includes("/undo-scan"))).toBe(true),
    );
    const geriAl = istekler.find((i) => i.url.includes("/undo-scan"))!;
    expect(geriAl.body?.idempotency_key).toBeTruthy();
    expect(geriAl.body?.idempotency_key).not.toBe(taramaAnahtarlari()[0]);
  });
});

/* ══════════════ 5. Kalan adet ve tutarsızlık sunumu (4e) ══════════════ */

describe("kalan adet ve veri tutarsızlığı", () => {
  // A satırı eksik (0/2), B satırı FAZLA (3/1). `packageProgress.remaining`
  // toplamı tavanladığı için "0 adet kaldı" der; buton ise haklı olarak
  // kapalıdır — operatör neden kapatamadığını göremezdi.
  const CARPIK = () =>
    PAKET({
      status: "OPEN",
      items: [
        KALEM({ scanned_qty: 0, remaining: 2 }),
        KALEM({
          id: 2,
          order_item_id: 9002,
          sku: "FZK-000012",
          barcode: null,
          title: "345 AYT Fizik",
          expected_qty: 1,
          scanned_qty: 3,
          remaining: 0,
        }),
      ],
    });

  it("eksik adet TAVANLANMADAN yazılır ('0 adet kaldı' yalanı yok)", async () => {
    izinVer(VIEW, PACK);
    paketDetayi(CARPIK());
    await sar("/yonetim/paketleme/paket/77");

    const buton = await screen.findByRole("button", { name: /paketi tamamla/i });
    expect((buton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/2 adet daha okutulmalı/)).toBeTruthy();
    expect(screen.queryByText(/0 adet daha okutulmalı/)).toBeNull();
  });

  it("fazla okutulmuş satır AÇIK bir tutarsızlık uyarısı üretir", async () => {
    izinVer(VIEW, PACK);
    paketDetayi(CARPIK());
    await sar("/yonetim/paketleme/paket/77");

    await screen.findByText("PKT-000077");
    const uyari = screen.getByRole("alert");
    // "tutarsızlık" değil "tutarsızl": Türkçede ünsüz yumuşaması var
    // (tutarsızlık → tutarsızlığı) ve tam kelime araması yanlış kırmızı verir.
    expect(uyari.textContent).toMatch(/tutarsızl/i);
    expect(uyari.textContent).toContain("345 AYT Fizik");
    expect(uyari.textContent).toMatch(/beklenen 1/);
    expect(uyari.textContent).toMatch(/okutulan 3/);
  });

  it("tutarlı pakette tutarsızlık uyarısı ÇIKMAZ", async () => {
    // Ters prova: uyarı her pakette görünseydi yukarıdaki test de geçerdi.
    izinVer(VIEW, PACK);
    paketDetayi(PAKET({ status: "OPEN", items: [KALEM({ scanned_qty: 1, remaining: 1 })] }));
    await sar("/yonetim/paketleme/paket/77");
    await screen.findByText("PKT-000077");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("STALE 409 kapatma hatası EKRANDA kalır (toast'a bırakılmaz)", async () => {
    // 409 STALE (kalem listesi değişti) ile 409 eksik-kalem birbirinden yalnız
    // METİNLE ayrılır; kaybolan bir toast operatörü kutuyu bantlamış hâlde
    // bırakırdı.
    izinVer(VIEW, PACK);
    paketDetayi(PAKET({ status: "OPEN", items: [KALEM({ scanned_qty: 2, remaining: 0 })] }));
    sunucu(
      "/packing/packages/77/complete",
      { status: 409, data: { detail: "Paketin kalem listesi değişti (STALE)" } },
      "post",
    );
    await sar("/yonetim/paketleme/paket/77");

    const buton = await screen.findByRole("button", { name: /paketi tamamla/i });
    expect((buton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(buton);

    await screen.findByText(/paket kapatılamadı/i);

    // Asıl iddia: toast SÖNDÜKTEN sonra da sebep ekranda duruyor. Toast'ı
    // gerçekten söndürüyoruz (4,5 sn'lik zamanlayıcıyı beklemeden) ve sayfada
    // kalıcı şeridi arıyoruz.
    act(() => useToastStore.setState({ toasts: [] }));
    const kalici = screen.getByText(/paket kapatılamadı/i).closest('[role="alert"]')!;
    expect(kalici.textContent).toMatch(/kalem listesi/i);
  });
});

/* ══════════════ 6. ReasonDialog sınırları ve erişilebilirlik (4f) ══════════════ */

describe("gerekçe penceresi", () => {
  async function vazgecPenceresiniAc() {
    izinVer(VIEW, PACK);
    paketDetayi(PAKET({ status: "OPEN", items: [KALEM({ scanned_qty: 0, remaining: 2 })] }));
    sunucu("/packing/packages/77/void", { data: PAKET({ status: "VOID" }) }, "post");
    await sar("/yonetim/paketleme/paket/77");
    fireEvent.click(await screen.findByRole("button", { name: /paketten vazgeç/i }));
    return screen.findByRole("textbox", { name: /gerekçe/i });
  }

  it("onay ve iptal düğmeleri FARKLI erişilebilir ada sahiptir", async () => {
    // Onay düğmesinin adı "Vazgeç"ti ve iptalinki de "Vazgeç"ti: ekran okuyucu
    // kullanıcısı hangisinin paketi çözdüğünü ayırt edemiyordu.
    await vazgecPenceresiniAc();
    expect(screen.getAllByRole("button", { name: "Vazgeç" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "İptal" })).toBeTruthy();
  });

  it("sayaç GERÇEK sunucu sınırını gösterir (REASON_MAX = 200)", async () => {
    // `schemas/packing.py::REASON_MAX`. Varsayılan 2000 gösterilseydi kullanıcı
    // 500 karakter yazıp 422 yerdi.
    const alan = await vazgecPenceresiniAc();
    expect(screen.getByText("0/200")).toBeTruthy();
    fireEvent.change(alan, { target: { value: "abc" } });
    expect(screen.getByText("3/200")).toBeTruthy();
  });

  // İP-A7d3 · SK-8 (KASITLI DEĞİŞİKLİK): iddia aynı — sınır üstü gerekçe
  // sunucuya GİTMEZ. Mekanizma değişti: düğme geçerlilikle kapanmıyor, hata
  // alanda çıkıyor. Sayaç iddiası korundu.
  it("sınır üstü gerekçe GÖNDERİLEMEZ (422'ye bırakılmaz)", async () => {
    const alan = await vazgecPenceresiniAc();
    fireEvent.change(alan, { target: { value: "x".repeat(201) } });

    const onay = screen.getByRole("button", { name: "Vazgeç" }) as HTMLButtonElement;
    expect(onay.disabled).toBe(false);
    fireEvent.click(onay);
    await waitFor(() => expect(alan.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("201/200")).toBeTruthy();
    expect(istekler.filter((i) => i.url.includes("/void"))).toHaveLength(0);
  });

  it("sınır içindeki gerekçe GÖNDERİLİR (ters prova)", async () => {
    // Yukarıdaki test, gönderim her hâlde engellenseydi de geçerdi.
    const alan = await vazgecPenceresiniAc();
    fireEvent.change(alan, { target: { value: "x".repeat(200) } });
    const onay = screen.getByRole("button", { name: "Vazgeç" }) as HTMLButtonElement;
    expect(onay.disabled).toBe(false);
    fireEvent.click(onay);
    await waitFor(() =>
      expect(istekler.filter((i) => i.url.includes("/void"))).toHaveLength(1),
    );
    expect(String(istekler.find((i) => i.url.includes("/void"))!.body?.reason)).toHaveLength(
      200,
    );
  });
});

/* ══════════════ 7. Geri dönüş kuyruğunun YENİ sayfalı yanıt şekli (4g) ══════════════ */

describe("geri dönüş kuyruğu sayfalama", () => {
  const SATIR = (id: number) => ({
    package_id: id,
    package_code: `PKT-${String(id).padStart(6, "0")}`,
    order_id: 400 + id,
    courier_id: 5,
    courier_name: "Mehmet Kurye",
    handed_over_at: "2026-07-29T09:00:00Z",
    waiting_days: 4,
  });

  it("sayaç SÜZÜLMÜŞ toplamı gösterir, sayfa uzunluğunu değil", async () => {
    // Uç eskiden düz bir liste dönüyordu; artık {items,total,limit,offset}.
    // `total` yerine `items.length` gösterilseydi ekran "2 kutu" der, gerçekte
    // 137 kutu araçta kaybolmuş olurdu — bu ekranın var olma sebebi tam da
    // görünürlük (TB-7).
    izinVer(VIEW, MANAGE);
    sunucu("/packing/return-queue", {
      data: { items: [SATIR(1), SATIR(2)], total: 137, limit: 50, offset: 0 },
    });
    await sar("/yonetim/paketleme/iade");

    expect(await screen.findByText("PKT-000001")).toBeTruthy();
    expect(screen.getByText("137 kutu")).toBeTruthy();
    expect(screen.queryByText("2 kutu")).toBeNull();
  });

  it("sayfalama parametreleri GERÇEKTEN isteğe konur", async () => {
    izinVer(VIEW);
    sunucu("/packing/return-queue", {
      data: { items: [SATIR(1)], total: 137, limit: 50, offset: 50 },
    });
    await sar("/yonetim/paketleme/iade?sayfa=2");

    await waitFor(() => {
      const g = istekler.find((i) => i.url.includes("/packing/return-queue"));
      expect(g, "kuyruk isteği hiç gitmedi").toBeTruthy();
      expect(g!.url).toMatch(/limit=50/);
      expect(g!.url).toMatch(/offset=50/);
    });
  });

  it("depoya alma notu GERÇEK sınırı (NOTE_MAX = 500) gösterir", async () => {
    izinVer(VIEW, MANAGE);
    sunucu("/packing/return-queue", {
      data: { items: [SATIR(1)], total: 1, limit: 50, offset: 0 },
    });
    await sar("/yonetim/paketleme/iade");

    fireEvent.click(await screen.findByRole("button", { name: /depoya al/i }));
    await screen.findByRole("textbox", { name: /not/i });
    expect(screen.getByText("0/500")).toBeTruthy();
    // İptal düğmesi onaydan ("Depoya alındı") ayrı bir ada sahip.
    expect(screen.getByRole("button", { name: "İptal" })).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * İP-A7d3 · göç dalgası 3 · ekran (5): `PackingStationPage`
 *
 * Haritadaki yeri: **üç pencere durumu** — tabanın en yoğun iki kaleminden
 * biri. Üçü de `useDuzenlemeYuzeyi`ye taşındı.
 *
 * Ekranın yazımı da yeni: paketleme istasyonu ÇOK ADIMLI bir akıştır (kod
 * okut → satır kapat → kutuyu tamamla) ve pencereler akışın ortasında açılır.
 * Bu yüzden "kirli formda kapatma sorar" iddiası burada sıradan bir konfor
 * değil: operatör gerekçeyi yazarken kutuya bir kod daha okutursa yazdığı
 * gerekçe kaybolmamalıdır.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("İP-A7d3 · istasyon pencereleri ortak yüzeyde", () => {
  async function paketiAc(over: Record<string, unknown> = {}) {
    izinVer(VIEW, PACK, MANAGE);
    paketDetayi(
      PAKET({
        status: "OPEN",
        items: [KALEM({ scanned_qty: 1, remaining: 1 })],
        ...over,
      }),
    );
    await sar("/yonetim/paketleme/paket/77");
  }

  it("ELLE DOĞRULA penceresinde kirli formda kapatma ÖNCE SORAR", async () => {
    await paketiAc();
    fireEvent.click(await screen.findByRole("button", { name: /elle doğrula/i }));
    const alan = await screen.findByRole("textbox", { name: /gerekçe/i });
    fireEvent.change(alan, { target: { value: "barkod yırtık" } });
    await act(async () => {});

    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
  });

  it("GERİ AL penceresinde kirli formda kapatma ÖNCE SORAR", async () => {
    await paketiAc();
    fireEvent.click(await screen.findByRole("button", { name: /geri al/i }));
    const alan = await screen.findByRole("textbox", { name: /gerekçe/i });
    fireEvent.change(alan, { target: { value: "yanlış kutu" } });
    await act(async () => {});

    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
  });

  it("PAKETTEN VAZGEÇ penceresinde kirli formda kapatma ÖNCE SORAR", async () => {
    await paketiAc();
    fireEvent.click(await screen.findByRole("button", { name: /paketten vazgeç/i }));
    const alan = await screen.findByRole("textbox", { name: /gerekçe/i });
    fireEvent.change(alan, { target: { value: "sipariş iptal" } });
    await act(async () => {});

    fireEvent.keyDown(document, { key: "Escape" });
    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
  });

  it("TEMİZ pencerede ESC doğrudan kapatır (ters prova)", async () => {
    // Üstteki üç test, bekçi HER kapatmayı engelleseydi de geçerdi.
    await paketiAc();
    fireEvent.click(await screen.findByRole("button", { name: /paketten vazgeç/i }));
    await screen.findByRole("textbox", { name: /gerekçe/i });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: /gerekçe/i })).toBeNull(),
    );
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).toBeNull();
  });

  it("gerekçe ZORUNLUYKEN boş gönderim istek ÜRETMEZ, hata alanda çıkar (SK-8)", async () => {
    await paketiAc();
    fireEvent.click(await screen.findByRole("button", { name: /paketten vazgeç/i }));
    const alan = await screen.findByRole("textbox", { name: /gerekçe/i });
    const onay = screen.getByRole("button", { name: "Vazgeç" }) as HTMLButtonElement;
    expect(onay.disabled).toBe(false);
    fireEvent.click(onay);

    await waitFor(() => expect(alan.getAttribute("aria-invalid")).toBe("true"));
    expect(istekler.filter((i) => i.url.includes("/void"))).toHaveLength(0);
  });
});
