// F30 kurye saha ekranı — zimmet ve kapı taraması AYRI MODLAR (gerçek DOM).
//
// Denetim bulgusu 7. Bu ekranın riski arka uçtan farklı: kurye elinde telefonla,
// aracın yanında, aceleyle çalışır. İki tarama **aynı görünürse** yanlış eylemi
// seçer:
//
//   • zimmet taraması  → paketi araca alıyorum (depoda, tur başında)
//   • kapı taraması    → müşteriye teslim ediyorum (adreste)
//
// Eskiden tek bir "QR okut" butonu vardı ve zimmet kavramı hiç yoktu. F30
// ikisini ayırır; bu matris ayrımın kullanıcıya GÖRÜNDÜĞÜNÜ ve yanlış durumda
// teslim eyleminin SUNULMADIĞINI sabitler.
//
// ════════════════════════════════════════════════════════════════════════
// FIXTURE DÜZELTMESİ (kırmızıları yeşile çevirirken yapıldı — zayıflatma DEĞİL)
// ════════════════════════════════════════════════════════════════════════
//
// Matris ilk yazıldığında iki fixture UYDURMA bir API'yi anlatıyordu; ekran o
// şekle göre yazılsaydı testler yeşil, gerçek sunucuya karşı ekran BOŞ olurdu
// (F26'da bire bir bu yaşandı: "hazırlama ekranı ne satın alındığını
// göstermiyordu"). İkisi de `backend/schemas/packing.py` ve
// `backend/schemas/delivery.py` okunarak gerçek sözleşmeye çevrildi:
//
//   1) Zimmet manifesti
//      ESKİ (uydurma): { run_id, total, handed_over,
//                        packages: [{ package_id, code, order_id, status,
//                                     recipient }] }
//      GERÇEK         : { run_id, run_status, total, handed_over,
//                         rows: [{ stop_id, order_id, sequence, package_id,
//                                  package_code, package_status, handed_over }] }
//      Fark yalnız isim değil: **alıcı adı manifestte YOKTUR** ve satırın
//      kimliği `stop_id`'dir.
//
//   2) Durak yükü (`GET /delivery/runs/{id}`)
//      ESKİ (uydurma): durakta `package: { package_id, code, status }` alanı.
//      GERÇEK         : `DeliveryStopOut`'ta böyle bir alan YOK. Saha ekranı
//      paket durumunu ancak zimmet manifestinden öğrenebilir (kurye erişimli,
//      durak başına canlı paket durumu verir). Bu yüzden saha testleri de
//      manifest ucunu stub'lar — ekranın gerçekte yaptığı istek budur.
//
// Ayrıca üç seçici kusuru giderildi (bkz. ilgili testlerdeki notlar):
// vakumda geçen RETURN_PENDING iddiası · "en az bir buton" gevşekliği ·
// tüm belgeyi tarayan seçiciler (artık `within(bölge)`).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Ağır ortak modül BİLE BİLE statik import ediliyor (İP-A7d3 · Görev 5) ──
//
// Bu dosya ekran/bileşen modüllerini TEMBEL yüklüyor ve maliyeti ilk testin
// İÇİNDE ödüyor. İP-A7d3'te `admin/ui` demeti `ui2/duzenlemeYuzeyi` üzerinden
// `@medusajs/ui`ye bağlandı (SK-7: `ReasonDialog`ın kirli form bekçisi) ve
// paralel yük altında ilk test bütçeyi aştı.
//
// Bütçe BÜYÜTÜLMEDİ: yavaşlık üretim kodunda değil test kurulumunda; statik
// import maliyeti TOPLAMA (collect) evresine taşır (A7d2'nin kararı).
import "@/components/admin/ui2/duzenlemeYuzeyi";
import DeliveryDriver from "@/pages/DeliveryDriver";
import DeliveryRunHandover from "@/pages/DeliveryRunHandover";


import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";
import type { ComponentType } from "react";

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
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
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
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

/* ══════════════ Render ══════════════ */

function kuryeOturumu() {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 9, role_id: 5, courier_id: 3 } as never,
  });
}

// ── İP-A7d5 · Görev 2: ekranlar STATİK import ediliyor ──
//
// Eskiden `import.meta.glob([...])` ile tembel yükleniyorlardı; glob, ekran
// dosyaları HENÜZ YOKKEN kırmızı matris kurabilmek içindi (red-first idiom).
// Dosyalar yazıldığı gün o gerekçe bitti, geriye maliyeti kaldı: modül
// değerlendirmesi ilk testin bütçesinden ödeniyordu. Statik import maliyeti
// TOPLAMA evresine taşır. Ölçüm: `docs/arsiv/ip-a/ip-a7d5-rapor.md` · Görev 2.
const EKRANLAR: Record<string, ComponentType> = {
  DeliveryRunHandover,
  DeliveryDriver,
};

async function sar(ad: string, yol: string) {
  const Bilesen = EKRANLAR[ad];
  if (!Bilesen) throw new Error(`bilinmeyen ekran: ${ad}`);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Routes>
          <Route path="/dagitim/:id/zimmet" element={<Bilesen />} />
          <Route path="/dagitim/:id" element={<Bilesen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Kod kutusuna yaz + formu gönder (RTL'in native setter'ıyla — ham
 *  `node.value = …` React'in değer izleyicisini atlatır ve `onChange` HİÇ
 *  çalışmaz; eski hâli tam olarak bu yüzden kontrollü bir kutuda hiçbir şey
 *  ölçemezdi). */
function kodOkut(kutu: HTMLInputElement, deger: string) {
  fireEvent.change(kutu, { target: { value: deger } });
  fireEvent.submit(kutu.closest("form")!);
}

/* ══════════════ Fixture'lar — GERÇEK backend sözleşmesi ══════════════ */

/** `schemas.packing.HandoverManifestRowOut` */
const SATIR = (over: Record<string, unknown> = {}) => ({
  stop_id: 31,
  order_id: 501,
  sequence: 1,
  package_id: 11,
  package_code: "PKT-000011",
  package_status: "HANDED_OVER",
  handed_over: true,
  ...over,
});

/** `schemas.packing.HandoverManifestOut` — alıcı adı YOK (bilinçli). */
const MANIFEST = (over: Record<string, unknown> = {}) => ({
  run_id: 5,
  run_status: "ACTIVE",
  total: 2,
  handed_over: 1,
  rows: [
    SATIR(),
    SATIR({
      stop_id: 32,
      order_id: 502,
      sequence: 2,
      package_id: 12,
      package_code: "PKT-000012",
      package_status: "PACKED",
      handed_over: false,
    }),
  ],
  ...over,
});

/** `schemas.packing.PackageOut` — zimmet ucunun yanıtı. */
const PAKET = (over: Record<string, unknown> = {}) => ({
  id: 12,
  order_id: 502,
  package_no: 1,
  code: "PKT-000012",
  status: "HANDED_OVER",
  qr_payload: "PKG1:12:tok",
  items_fingerprint: "abc",
  items: [],
  ...over,
});

/** `schemas.delivery.DeliveryStopOut` — `package` alanı YOKTUR. */
const DURAK = (over: Record<string, unknown> = {}) => ({
  id: 31,
  run_id: 5,
  order_id: 501,
  sequence: 1,
  status: "PENDING",
  qr_payload: "31:durakTokeni",
  recipient: "Ayşe Yılmaz",
  address: "Seyhan, Adana",
  phone: "+905550001000",
  delivery_pref: "ADRESIMDEYIM",
  items: [{ title: "TYT Matematik", quantity: 1 }],
  ...over,
});

const TUR = (over: Record<string, unknown> = {}) => ({
  id: 5,
  run_date: "2026-08-01",
  vehicle: "LADA",
  status: "ACTIVE",
  depot_lat: 37.0,
  depot_lng: 35.3,
  stops: [DURAK()],
  ...over,
});

/** Saha ekranının paket kapısı manifestten beslenir; tek duraklı tur kısayolu. */
function sahaManifesti(package_status: string | null, handed_over = false) {
  return MANIFEST({
    total: 1,
    handed_over: handed_over ? 1 : 0,
    rows: [SATIR({ package_status, handed_over })],
  });
}

/* ══════════════ 1. İki mod ayrı görünür ══════════════ */

describe("zimmet ve kapı taraması ayrı modlardır", () => {
  it("zimmet ekranı 'paketi teslim al' dilini kullanır, 'teslim et' demez", async () => {
    // SEÇİCİ DÜZELTMESİ: eski hâl `findByText(/teslim al|zimmet|araca/i)` idi;
    // bu, "zimmet" kelimesinin sayfada BİR KEZ geçmesini şart koşuyordu (çünkü
    // `findByText` çoklu eşleşmede düşer) — yani doğru davranış ekranın dilini
    // fakirleştirmeye zorluyordu. İddia rol tabanlı hâle getirildi: kullanıcının
    // BASACAĞI şeyin adı ölçülüyor, kelimenin nerede geçtiği değil.
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { data: MANIFEST() });
    await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    expect(await screen.findByRole("button", { name: /zimmetle/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /zimmet/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /müşteriye teslim et|teslim et/i })).toBeNull();
  });

  it("zimmet ekranı kaç paketin alındığını gösterir (N / M)", async () => {
    // Kurye eksik paketle yola çıkmamalı; sayaç tek görünür güvencedir.
    // Seçici sayaç bölgesiyle sınırlandı ve DESEN ÇAPALANDI: eski `/1\s*\/\s*2/`
    // "11 / 20" yazan bir ekranda da geçerdi.
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { data: MANIFEST() });
    await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    const ozet = within(await screen.findByTestId("zimmet-ozet"));
    expect(await ozet.findByText(/^1\s*\/\s*2$/)).toBeTruthy();
    // Eksik paket sayısı da söylenmeli: "1/2" tek başına "hangisi eksik, kaç
    // tane" sorusunu cevaplamaz.
    expect(ozet.getByText(/1 paket eksik/i)).toBeTruthy();
  });

  it("zimmet taraması handover ucuna gider, kapı taramasına DEĞİL", async () => {
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { data: MANIFEST() });
    sunucu("/delivery/handover/scan", { data: PAKET() }, "post");
    await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    const tarama = within(await screen.findByTestId("zimmet-tarama"));
    const kutu = tarama.getByRole("textbox") as HTMLInputElement;
    expect(kutu.type, "manuel kod girişi açık tipli değil").toBe("text");
    kodOkut(kutu, "PKG1:12:tok");

    await waitFor(() => {
      const zimmet = istekler.filter((i) => i.url.includes("/delivery/handover/scan"));
      expect(zimmet).toHaveLength(1);
      // Yük GÖVDEDE gider: QR token'ı query string'e (sunucu erişim kaydına,
      // tarayıcı geçmişine) düşmemeli.
      expect(zimmet[0].body).toEqual({ payload: "PKG1:12:tok" });
      expect(istekler.some((i) => i.url.endsWith("/delivery/scan"))).toBe(false);
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(/PKT-000012/);
  });

  it("aynı paketi ikinci kez okutmak 'zaten zimmetli' der (sessiz geçmez)", async () => {
    // Sunucu idempotenttir ve ikinci okutmaya da 200 döner. Ekran bunu
    // "zimmetlendi ✓" diye gösterirse kurye ikinci bir kutu aradığını sanır.
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { data: MANIFEST() });
    sunucu(
      "/delivery/handover/scan",
      { data: PAKET({ id: 11, order_id: 501, code: "PKT-000011" }) },
      "post",
    );
    await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    const tarama = within(await screen.findByTestId("zimmet-tarama"));
    kodOkut(tarama.getByRole("textbox") as HTMLInputElement, "PKG1:11:tok");

    const uyari = await screen.findByRole("alert");
    await waitFor(() => expect(uyari.textContent).toMatch(/zaten zimmetli/i));
    expect(uyari.textContent, "tekrar okutma 'yeni alındı' gibi gösteriliyor").not.toMatch(
      /araca alındı/i,
    );
  });

  it("okutmadan sonra odak kod kutusuna döner ve kutu temizlenir", async () => {
    // Barkod okuyucu klavye gibi yazar: odak kutuda değilse SONRAKİ okutma
    // hiçbir yere gitmez ve kurye sebebini anlamaz.
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { data: MANIFEST() });
    sunucu("/delivery/handover/scan", { data: PAKET() }, "post");
    await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    const kutu = within(await screen.findByTestId("zimmet-tarama")).getByRole(
      "textbox",
    ) as HTMLInputElement;
    kutu.blur();
    kodOkut(kutu, "PKG1:12:tok");

    await waitFor(() => expect(document.activeElement).toBe(kutu));
    expect(kutu.value, "önceki kod kutuda kaldı — sonraki okutmaya karışır").toBe("");
  });
});

/* ══════════════ 2. Zimmetlenmemiş pakette teslim eylemi yok ══════════════ */

describe("teslim eylemi yalnız zimmetli pakette sunulur", () => {
  it("paket PACKED iken teslim aksiyonları GÖSTERİLMEZ", async () => {
    // Paket hâlâ depoda: kurye elinde olmayan bir paketi teslim edemez.
    kuryeOturumu();
    sunucu("/delivery/runs/5", { data: TUR() });
    sunucu("/delivery/handover/manifest/5", { data: sahaManifesti("PACKED") });
    await sar("DeliveryDriver", "/dagitim/5");
    // ÖN KOŞUL: aktif durak kartı gerçekten çizildi mi? (Aksi hâlde "buton
    // yok" iddiası VAKUMDA geçerdi — denetim bulgusu 1.)
    const kart = within(await screen.findByTestId("aktif-durak"));
    expect(kart.getByText(/Ayşe Yılmaz/)).toBeTruthy();
    // Kapı kararı manifest yanıtından sonra netleşir: önce onu bekle.
    expect(await kart.findByText(/zimmetlen|teslim al|araca alın/i)).toBeTruthy();
    expect(
      kart.queryAllByRole("button", { name: /kod gönder|teslim et|kapıya bırak/i }),
      "depodaki pakete teslim butonu sunuluyor",
    ).toHaveLength(0);
    expect(
      screen.queryAllByRole("button", { name: /kod gönder|teslim et|kapıya bırak/i }),
      "kart dışında bir yerde teslim butonu sunuluyor",
    ).toHaveLength(0);
    // Kurye çıkmaza girmemeli: doğru ekrana çıkış olmalı.
    expect(kart.getByRole("link", { name: /zimmet/i }).getAttribute("href")).toBe(
      "/dagitim/5/zimmet",
    );
  });

  it("paket HANDED_OVER iken teslim aksiyonları görünür", async () => {
    // GEVŞEK İDDİA DÜZELTMESİ: eski hâl `getAllByRole(...).length > 0` idi
    // ("en az bir buton"). Çoğulluk meşru (kod gönder + teslim et + teslim
    // edilemedi) ama iddia TEKİL olmalı; bu yüzden bölge `within(kart)` ile
    // sınırlandı ve iki buton adıyla tek tek arandı.
    kuryeOturumu();
    sunucu("/delivery/runs/5", { data: TUR() });
    sunucu("/delivery/handover/manifest/5", { data: sahaManifesti("HANDED_OVER", true) });
    await sar("DeliveryDriver", "/dagitim/5");
    const kart = within(await screen.findByTestId("aktif-durak"));
    expect(kart.getByText(/Ayşe Yılmaz/)).toBeTruthy();
    expect(
      await kart.findByRole("button", { name: /müşteriye kod gönder/i }),
      "zimmetli pakette kod gönderme sunulmuyor",
    ).toBeTruthy();
    expect(
      kart.getByRole("button", { name: /^teslim et$/i }),
      "zimmetli pakette teslim eylemi sunulmuyor",
    ).toBeTruthy();
    // Kapı açıkken engel metni OLMAMALI (ters yön: kapı her hâlde kapalı
    // kalsaydı yukarıdaki iddialar da düşerdi; bu satır niyeti sabitler).
    expect(kart.queryByText(/zimmetlenmedi|geri dönmesi bekleniyor/i)).toBeNull();
  });

  it("paket RETURN_PENDING iken teslim aksiyonu GÖSTERİLMEZ", async () => {
    // FIXTURE DÜZELTMESİ (denetim bulgusu 1): eski hâl durağı `status:"FAILED"`
    // yapıyordu; o durakta aktif kart HİÇ çizilmez, yani "buton yok" iddiası
    // vakumda geçerdi. Gerçek ve ULAŞILABİLİR senaryo şudur: durak teslim
    // edilemedi → paket `RETURN_PENDING` → sipariş PAID'e döndü → ERTESİ GÜN
    // yeni tura eklendi (yeni durak PENDING) ama kutu hâlâ araçta, depoya
    // dönüp kabul edilmedi. Ekran o satırı "teslim edilebilir" gösterirse
    // kurye elinde olmayan paketi teslim etmeye kalkar.
    kuryeOturumu();
    sunucu("/delivery/runs/5", { data: TUR() });
    sunucu("/delivery/handover/manifest/5", { data: sahaManifesti("RETURN_PENDING") });
    await sar("DeliveryDriver", "/dagitim/5");
    const kart = within(await screen.findByTestId("aktif-durak"));
    expect(kart.getByText(/Ayşe Yılmaz/)).toBeTruthy();
    expect(await kart.findByText(/geri dön|depoya|iade bekl/i)).toBeTruthy();
    expect(
      kart.queryAllByRole("button", { name: /kod gönder|teslim et|kapıya bırak/i }),
      "araçta iade bekleyen pakete teslim butonu sunuluyor",
    ).toHaveLength(0);
    expect(
      screen.queryAllByRole("button", { name: /kod gönder|teslim et|kapıya bırak/i }),
    ).toHaveLength(0);
  });
});

/* ══════════════ 3. Yanlış QR türünde açık hata ══════════════ */

describe("yanlış QR türü", () => {
  it("zimmet ekranında DURAK QR'ı okutulursa açık hata gösterilir", async () => {
    // İki uzay ayrıktır; kullanıcıya "bulunamadı" demek yanlış yeri işaret eder.
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { data: MANIFEST() });
    await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    const kutu = within(await screen.findByTestId("zimmet-tarama")).getByRole(
      "textbox",
    ) as HTMLInputElement;
    kodOkut(kutu, "31:durakTokeni");

    const uyari = await screen.findByRole("alert");
    expect(uyari.textContent).toMatch(/paket etiketi|paket qr|yanlış/i);
    // İstemci tarafında ayırt edilebildiği için sunucuya hiç gitmemeli.
    await waitFor(() =>
      expect(istekler.some((i) => i.url.includes("/handover/scan"))).toBe(false),
    );
  });

  it("yabancı/olmayan paket 404'ünde bilgi sızdırmayan tek mesaj gösterilir", async () => {
    // Sunucu dört farklı sebebi (yabancı kurye · eski tur · bozuk token ·
    // olmayan paket) BİLİNÇLİ olarak aynı 404 ile döner; istemci bunları
    // farklı cümlelere ayırırsa sunucunun kapattığı sızıntı ekranda açılır.
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { data: MANIFEST() });
    sunucu(
      "/delivery/handover/scan",
      { status: 404, data: { detail: "Etiket tanınmadı" } },
      "post",
    );
    await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    const kutu = within(await screen.findByTestId("zimmet-tarama")).getByRole(
      "textbox",
    ) as HTMLInputElement;
    kodOkut(kutu, "PKG1:77:baskaKurye");

    const uyari = await screen.findByRole("alert");
    await waitFor(() => expect(uyari.textContent).toMatch(/tanınmadı/i));
    expect(uyari.textContent, "404 gövdesinden paket durumu/kodu sızıyor").not.toMatch(
      /PKT-|PACKED|RETURN_PENDING|HANDED_OVER/,
    );
  });

  it("yabancı turun zimmet listesi 404'ünde ETİKET değil TUR mesajı gösterilir", async () => {
    // Aynı 404 iki uçta iki farklı şeyi anlatır ve mesaj bunu ayırmalıdır:
    // tarama ucunda "etiket tanınmadı", manifest ucunda "bu tur sana ait
    // değil" (`courier_account_service.ensure_run_access`). Tek çeviriciyle
    // ekran, hiç kod okutmamış kuryeye "kutunun üstündeki kodu kontrol et"
    // diyordu — olmayan bir sorunu arattırırdı. 404'ün İÇİ hâlâ tek cümle:
    // "yok / başkasının / silinmiş" ayrımı istemcide AÇILMAZ.
    kuryeOturumu();
    sunucu("/delivery/handover/manifest/5", { status: 404, data: { detail: "Tur bulunamadı" } });
    await sar("DeliveryRunHandover", "/dagitim/5/zimmet");
    const ozet = within(await screen.findByTestId("zimmet-ozet"));
    const mesaj = (await ozet.findByRole("status")).textContent ?? "";
    // Olumlu iddia AYIRT EDİCİ seçildi: eski (yanlış) mesaj da "…bu turda
    // değil…" dediği için yalnız /tur/i aramak İKİSİNİ de geçirirdi.
    expect(mesaj).toMatch(/atanmış değil|kaldırılmış/i);
    expect(mesaj, "manifest hatası etiket/kutu hatası gibi anlatılıyor").not.toMatch(
      /etiket|kutunun üstündeki/i,
    );
    // Kurye çıkmazda bırakılmaz: yeniden deneme kaybolmamalı.
    expect(ozet.getByRole("button", { name: /yeniden dene/i })).toBeTruthy();
  });

  it("sunucu 409 verirse (zimmetlenmemiş paket) mesaj kullanıcıya ulaşır", async () => {
    kuryeOturumu();
    sunucu("/delivery/runs/5", { data: TUR() });
    sunucu("/delivery/handover/manifest/5", { data: sahaManifesti("HANDED_OVER", true) });
    sunucu(
      "/delivery/scan",
      { status: 409, data: { detail: "Paket henüz teslim alınmadı" } },
      "post",
    );
    const { container } = await sar("DeliveryDriver", "/dagitim/5");
    await screen.findByTestId("aktif-durak");
    // VAKUM GEÇİŞİ KAPATILDI: eski hâl `if (kutu) { ... }` idi ve kutu
    // bulunamadığında blok atlanıp test HİÇBİR ŞEY DOĞRULAMADAN geçiyordu.
    const kutu = within(await screen.findByTestId("saha-tarama")).getByRole(
      "textbox",
    ) as HTMLInputElement;
    expect(container.querySelector("input[type=text]"), "sayfa içi kod kutusu yok").toBe(kutu);
    kodOkut(kutu, "PKG1:99:baska");

    const uyari = await screen.findByRole("alert");
    await waitFor(() => expect(uyari.textContent).toMatch(/teslim alınmadı|zimmet/i));
  });
});
