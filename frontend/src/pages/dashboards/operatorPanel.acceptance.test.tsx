// İP-14 kırmızı matris — kütüphane operatörü paneli (GERÇEK DOM + gerçek axios).
//
// ════════════════════════════════════════════════════════════════════════════
// Bu dosyanın yakalamaya çalıştığı yalancı yeşil sınıfı
// ════════════════════════════════════════════════════════════════════════════
//
// Arayüz paketlerinde en kolay üretilen sahte kanıt şudur: "element var mı?"
// Bir liste ekranda görünür, test `getByText("Bugün")` ile geçer — ama listede
// YANLIŞ kayıtlar vardır (yarınki bugüne düşmüştür), ya da başlıklar doğru
// sıradadır ama içerikleri karışmıştır. Bu yüzden buradaki her iddia
// **hangi kaydın hangi grupta, hangi sırada** olduğunu sorar: grup başlığının
// altındaki bölge `within(...)` ile daraltılır ve İSİMLER karşılaştırılır.
//
// İkinci sınıf: hata durumunun boş durumdan ayırt edilememesi. Bakiyem'de
// sunucu 500 dönerken ekranda "Henüz bir işlem yok" yazması, para ekranında
// verilebilecek en yanlış cevaptır (kullanıcı "param yok" diye okur). Bu
// dosyada hata testleri **boş durumun metnini de** kontrol eder: ikisinin
// AYNI metni göstermesi başarısızlıktır (node E-5).
//
// Kanıt sınıfı (CLAUDE.md §H): gerçek DOM + gerçekten gönderilen HTTP isteği
// (axios adapter değiştirilir, hook/servis mock'lanmaz). Fixture'lar
// `backend/schemas/*.py` ve `src/types/index.ts` okunarak yazılmıştır; uydurma
// alan yoktur.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Ağır ortak modül BİLE BİLE statik import ediliyor (İP-A7d2 · Görev 5) ──
//
// Ekranlar `import.meta.glob` ile TEMBEL yükleniyor ve maliyeti ilk testin
// İÇİNDE ödeniyor. `OperatorSessions` → `ExamSessionsManager` A7d2'de ortak
// düzenleme yüzeyine (dolayısıyla `@medusajs/ui`ye) bağlanınca ölçüldü:
//
//   | Modül | Süre |
//   |---|---|
//   | Calendar / Leaderboard / Learn / Notifications | 46–260 ms |
//   | Settings / OperatorHome | 546–927 ms |
//   | **OperatorSessions** | **11.235 ms** |
//
// G-1 ve G-2 testleri 20 sn'lik bütçeyi aştı. Bütçe BÜYÜTÜLMEDİ: yavaşlık
// üretim kodunda değil test kurulumunda. Modül burada statik alınınca maliyet
// TOPLAMA (collect) evresine geçer.
import "@/components/admin/ui2/duzenlemeYuzeyi";

import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";
import { adsizKontroller } from "@/test-utils/alanAdlari";

import type { AxiosRequestConfig } from "axios";
import type { ComponentType } from "react";

// ── Süre bütçesi ────────────────────────────────────────────────────────────
//
// Bu dosya gerçek sayfa ağaçlarını (DashboardShell + üst bar + hook'lar)
// jsdom'da render eder; esbuild transform'u tek başına birkaç saniye sürer ve
// projenin 5 sn'lik varsayılan test bütçesi paralel koşuda aşılıyor — ölçülen
// davranış yüzünden DEĞİL, derleme süresi yüzünden.
//
// `vi.setConfig` YALNIZ bu dosyayı etkiler; `vitest.config.ts`'teki global
// ayar (İP-12'nin dokunduğu yer) olduğu gibi kalır.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

// RTL'in kendi bekleme süresi (`findBy*`) test bütçesinden AYRIDIR ve
// varsayılanı 1 sn'dir: yavaş bir koşuda sorgu daha patlamadan iddia
// zamanaşımına uğrayıp "element yok" diyordu. Bekleme süresi uzatılıyor;
// iddiaların kendisi değişmiyor.
configure({ asyncUtilTimeout: 5_000 });

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

function gidenler(desen: string, method?: string): Istek[] {
  return istekler.filter(
    (i) => i.url.includes(desen) && (method ? i.method === method.toLowerCase() : true)
  );
}

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  rotalar = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      body: config.data && typeof config.data === "string" ? JSON.parse(config.data) : null,
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ══════════════ Zaman ══════════════ */

/** Türkiye duvar-saati → UTC ISO (backend hep UTC döner). */
function tr(gunSaat: string): string {
  return new Date(`${gunSaat}:00+03:00`).toISOString();
}

/** "Şimdi"yi Türkiye duvar-saatiyle sabitler. Tarayıcı tz'i UTC kalır: ekran
 *  gün sınırını yerel saatten hesaplarsa TZ node'ları kırılır. */
function simdiyiKur(trGunSaat: string) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(`${trGunSaat}:00+03:00`));
}

/* ══════════════ Oturum + render ══════════════ */

const OPERATOR_ID = 77;
const LIBRARY_ID = 12;

function operatorOturumu() {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: {
      id: OPERATOR_ID,
      role_id: 4,
      email: "operator@kutuphane.example.com",
      full_name: "Operatör Test",
      email_verified: true,
    } as never,
  });
}

const EKRANLAR = import.meta.glob([
  "./OperatorHome.tsx",
  "./OperatorLibrary.tsx",
  "./OperatorSessions.tsx",
  "../Notifications.tsx",
  "../Leaderboard.tsx",
  "../Settings.tsx",
  "../Calendar.tsx",
  "../Learn.tsx",
]);

// Ekran modülleri TEMBEL yüklenir ve önbelleğe alınır: aynı sayfayı kullanan
// sonraki testler transform maliyetini tekrar ödemez. (Hepsini `beforeAll`'da
// toplu yüklemek denendi ve 10 sn'lik HOOK bütçesini aşıyor — yedi sayfanın
// tamamı aynı anda derleniyor.)
const ONBELLEK = new Map<string, ComponentType>();

async function ekran(yol: string): Promise<ComponentType> {
  const onbellekli = ONBELLEK.get(yol);
  if (onbellekli) return onbellekli;
  const yukle = EKRANLAR[yol];
  if (!yukle) throw new Error(`HENÜZ YAZILMADI: ${yol}`);
  const bilesen = ((await yukle()) as { default: ComponentType }).default;
  ONBELLEK.set(yol, bilesen);
  return bilesen;
}

async function sar(modulYolu: string, rota = "/") {
  const Bilesen = await ekran(modulYolu);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path="*" element={<Bilesen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar — GERÇEK sözleşme ══════════════ */

/** `schemas/library_exam.py::OperatorOut` */
const OPERATOR = {
  id: OPERATOR_ID,
  email: "operator@kutuphane.example.com",
  full_name: "Operatör Test",
  library_id: LIBRARY_ID,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  library_name: "Test Kütüphanesi",
};

/** `schemas/library.py::LibraryDetailOut` (kısaltılmış ama alan adları gerçek) */
const KUTUPHANE = (over: Record<string, unknown> = {}) => ({
  id: LIBRARY_ID,
  name: "Test Kütüphanesi",
  slug: "test-kutuphanesi",
  status: "ACTIVE",
  amenities: [],
  rating_count: 0,
  rating_average: null,
  hours: [],
  images: [],
  city: "Adana",
  district: "Çukurova",
  capacity: 40,
  study_hourly_price: "50.00",
  ...over,
});

/** `schemas/library.py::LibraryEarningsOut` */
const KAZANC = {
  currency: "TRY",
  released_earning: "900.00",
  held_earning: "180.00",
  commission_total: "100.00",
  released_count: 10,
  held_count: 2,
  this_month_earning: "450.00",
  refunded_total: "0.00",
};

/** `schemas/study.py::StudyReservationOut` */
const REZ = (over: Record<string, unknown> = {}) => ({
  id: 1,
  library_id: LIBRARY_ID,
  client_id: 100,
  client_name: "Ayşe Kaya",
  starts_at: tr("2026-08-10T14:00"),
  ends_at: tr("2026-08-10T16:00"),
  status: "PAID",
  amount: "100.00",
  currency: "TRY",
  created_at: "2026-08-01T00:00:00Z",
  ...over,
});

/** `schemas/library_exam.py::ExamSessionOut` */
const OTURUM = (over: Record<string, unknown> = {}) => ({
  id: 501,
  library_id: LIBRARY_ID,
  exam_type: "TYT",
  title: "Ağustos TYT Denemesi",
  starts_at: tr("2026-08-10T09:00"),
  duration_minutes: 180,
  capacity: 50,
  price: "100.00",
  currency: "TRY",
  status: "SCHEDULED",
  registered_count: 12,
  available: 38,
  results_published: false,
  results_entered_count: 0,
  ...over,
});

/** `schemas/library_exam.py::RosterRow` */
const ROSTER_SATIR = (over: Record<string, unknown> = {}) => ({
  registration_id: 9001,
  client_name: "Mehmet Yıldız",
  status: "PAID",
  attended_at: null,
  result_document_url: null,
  result_net: null,
  result_rank: null,
  ...over,
});

/** Panelin/oturumlar ekranının ihtiyaç duyduğu ortak uçlar. */
function temelUclar(
  opts: {
    rezervasyonlar?: unknown;
    oturumlar?: unknown;
    roster?: unknown;
    kutuphane?: unknown;
  } = {}
) {
  sunucu("/auth/me", { data: { id: OPERATOR_ID, role_id: 4, email: OPERATOR.email, full_name: "Operatör Test", email_verified: true } });
  sunucu("/library-operators/me", { data: OPERATOR });
  sunucu("/libraries/admin/", { data: opts.kutuphane ?? KUTUPHANE() });
  sunucu("/libraries/12/earnings", { data: KAZANC });
  // `schemas/feature_flag.py::PaymentAvailabilityOut` — `branches` bir LİSTEDİR.
  // (İlk yazımda nesne verilmişti; ekran `branches.find` çağırdığı için render
  // PATLIYOR ve node'lar yanlış sebeple kırmızı görünüyordu.)
  sunucu("/payments/availability", {
    data: {
      branches: [
        { branch: "store", label: "Mağaza", open: true },
        { branch: "tutor_marketplace", label: "Ders pazaryeri", open: true },
        { branch: "library_marketplace", label: "Kütüphane pazaryeri", open: true },
      ],
    },
  });
  sunucu("/messages/unread-count", { data: { inbox: 0, sent: 0 } });
  sunucu("/notifications/unread-count", { data: { count: 0 } });
  sunucu("/notifications", { data: [] });
  sunucu("/exam-catalogs/usable", { data: [] });
  sunucu(
    "/study-reservations/manage",
    (opts.rezervasyonlar as never) ?? { data: [REZ()] }
  );
  sunucu("/exam-sessions/manage", (opts.oturumlar as never) ?? { data: [OTURUM()] });
  sunucu(/\/exam-sessions\/\d+\/roster/, (opts.roster as never) ?? { data: [ROSTER_SATIR()] });
}

/* ════════════════════════════════════════════════════════════════════════════
   B · "Bugün" görünürlüğü (Panel ekranı)
   ════════════════════════════════════════════════════════════════════════════ */

describe("B · Panel ekranında bugün bloğu", () => {
  it("B-1 · panelde 'Bugün' bloğu render ediliyor", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar();

    await sar("./OperatorHome.tsx");

    const blok = await screen.findByTestId("operator-bugun");
    expect(within(blok).getByText(/Bugün/i)).toBeTruthy();
  });

  it("B-2 · bugünkü sayı doğru: dünkü ve yarınki sayılmıyor", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({
      rezervasyonlar: {
        data: [
          REZ({ id: 1, client_name: "Dün Öğrenci", starts_at: tr("2026-08-09T10:00"), ends_at: tr("2026-08-09T12:00") }),
          REZ({ id: 2, client_name: "Bugün Bir", starts_at: tr("2026-08-10T10:00"), ends_at: tr("2026-08-10T12:00") }),
          REZ({ id: 3, client_name: "Bugün İki", starts_at: tr("2026-08-10T15:00"), ends_at: tr("2026-08-10T17:00") }),
          REZ({ id: 4, client_name: "Yarın Öğrenci", starts_at: tr("2026-08-11T10:00"), ends_at: tr("2026-08-11T12:00") }),
        ],
      },
      oturumlar: { data: [] },
    });

    await sar("./OperatorHome.tsx");

    const blok = await screen.findByTestId("operator-bugun");
    // Sayaç "2" demeli — 4 değil, 1 değil.
    expect(within(blok).getByTestId("bugun-rezervasyon-sayisi").textContent?.trim()).toBe("2");
    expect(within(blok).queryByText(/Dün Öğrenci/)).toBeNull();
    expect(within(blok).queryByText(/Yarın Öğrenci/)).toBeNull();
  });

  it("B-3 · sıradaki randevu doğru seçiliyor: saati geçmişler atlanıyor", async () => {
    simdiyiKur("2026-08-10T13:00");
    operatorOturumu();
    temelUclar({
      rezervasyonlar: {
        data: [
          REZ({ id: 1, client_name: "Sabahki Öğrenci", starts_at: tr("2026-08-10T09:00"), ends_at: tr("2026-08-10T11:00") }),
          REZ({ id: 2, client_name: "Sıradaki Öğrenci", starts_at: tr("2026-08-10T14:00"), ends_at: tr("2026-08-10T16:00") }),
          REZ({ id: 3, client_name: "Akşamki Öğrenci", starts_at: tr("2026-08-10T18:00"), ends_at: tr("2026-08-10T20:00") }),
        ],
      },
      oturumlar: { data: [] },
    });

    await sar("./OperatorHome.tsx");

    const siradaki = await screen.findByTestId("bugun-siradaki");
    expect(siradaki.textContent ?? "").toMatch("Sıradaki Öğrenci");
    expect(siradaki.textContent ?? "").not.toMatch("Sabahki Öğrenci");
    expect(siradaki.textContent ?? "").not.toMatch("Akşamki Öğrenci");
  });

  it("B-4 · bugün hiç kayıt yoksa blok 'bugün kayıt yok' diyor (boş/bozuk görünmüyor)", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({
      rezervasyonlar: { data: [REZ({ id: 9, starts_at: tr("2026-08-20T10:00"), ends_at: tr("2026-08-20T12:00") })] },
      oturumlar: { data: [] },
    });

    await sar("./OperatorHome.tsx");

    const blok = await screen.findByTestId("operator-bugun");
    expect(within(blok).getByText(/bugün için kayıt yok/i)).toBeTruthy();
    // "Sıradaki" satırı uydurulmuş bir kayıt göstermemeli.
    expect(within(blok).queryByTestId("bugun-siradaki")).toBeNull();
  });

  it("B-5 · TZ sınırı: 23:30 ve 00:30 kayıtları doğru güne düşüyor (Türkiye saati)", async () => {
    // Tarayıcı UTC. TR 23:00'te; UTC'de saat 20:00, yani UTC günü hâlâ 10 Ağustos.
    simdiyiKur("2026-08-10T23:00");
    operatorOturumu();
    temelUclar({
      rezervasyonlar: {
        data: [
          REZ({ id: 1, client_name: "Gece Yarısı Öncesi", starts_at: tr("2026-08-10T23:30"), ends_at: tr("2026-08-11T01:30") }),
          REZ({ id: 2, client_name: "Gece Yarısı Sonrası", starts_at: tr("2026-08-11T00:30"), ends_at: tr("2026-08-11T02:30") }),
        ],
      },
      oturumlar: { data: [] },
    });

    await sar("./OperatorHome.tsx");

    const blok = await screen.findByTestId("operator-bugun");
    // 23:30 BUGÜN, 00:30 YARIN → bugün sayacı tam olarak 1.
    expect(within(blok).getByTestId("bugun-rezervasyon-sayisi").textContent?.trim()).toBe("1");
    const siradaki = await screen.findByTestId("bugun-siradaki");
    expect(siradaki.textContent ?? "").toMatch("Gece Yarısı Öncesi");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   G · Gün gruplaması (Oturumlar & QR ekranı)
   ════════════════════════════════════════════════════════════════════════════ */

describe("G · yaklaşan liste güne göre gruplanıyor", () => {
  const GRUPLU_REZ = {
    data: [
      REZ({ id: 1, client_name: "Bugünkü Öğrenci", starts_at: tr("2026-08-10T14:00"), ends_at: tr("2026-08-10T16:00") }),
      REZ({ id: 2, client_name: "Yarınki Öğrenci", starts_at: tr("2026-08-11T09:00"), ends_at: tr("2026-08-11T11:00") }),
      REZ({ id: 3, client_name: "Haftaiçi Öğrenci", starts_at: tr("2026-08-13T09:00"), ends_at: tr("2026-08-13T11:00") }),
      REZ({ id: 4, client_name: "Bugünkü İkinci", starts_at: tr("2026-08-10T18:00"), ends_at: tr("2026-08-10T20:00") }),
    ],
  };

  it("G-1 · liste Bugün / Yarın / Bu hafta başlıklarıyla gruplanıyor VE kayıtlar doğru gruba düşüyor", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({ rezervasyonlar: GRUPLU_REZ });

    await sar("./OperatorSessions.tsx");

    const bugun = await screen.findByTestId("rez-grup-BUGUN");
    const yarin = screen.getByTestId("rez-grup-YARIN");
    const buHafta = screen.getByTestId("rez-grup-BU_HAFTA");

    // "Element var mı" değil — HANGİ kayıt HANGİ grupta.
    expect(within(bugun).getByText("Bugünkü Öğrenci")).toBeTruthy();
    expect(within(bugun).getByText("Bugünkü İkinci")).toBeTruthy();
    expect(within(bugun).queryByText("Yarınki Öğrenci")).toBeNull();

    expect(within(yarin).getByText("Yarınki Öğrenci")).toBeTruthy();
    expect(within(yarin).queryByText("Haftaiçi Öğrenci")).toBeNull();

    expect(within(buHafta).getByText("Haftaiçi Öğrenci")).toBeTruthy();
  });

  it("G-2 · her grubun başında sayaç var", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({ rezervasyonlar: GRUPLU_REZ });

    await sar("./OperatorSessions.tsx");

    const bugun = await screen.findByTestId("rez-grup-BUGUN");
    expect(within(bugun).getByTestId("grup-sayaci").textContent?.trim()).toBe("2");
    const yarin = screen.getByTestId("rez-grup-YARIN");
    expect(within(yarin).getByTestId("grup-sayaci").textContent?.trim()).toBe("1");
  });

  it("G-3 · bu haftadan sonrası ayrı grupta — listeden DÜŞMÜYOR", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({
      rezervasyonlar: {
        data: [
          REZ({ id: 1, client_name: "Bugünkü Öğrenci", starts_at: tr("2026-08-10T14:00"), ends_at: tr("2026-08-10T16:00") }),
          REZ({ id: 5, client_name: "Gelecek Ay Öğrenci", starts_at: tr("2026-09-10T14:00"), ends_at: tr("2026-09-10T16:00") }),
        ],
      },
    });

    await sar("./OperatorSessions.tsx");

    const sonra = await screen.findByTestId("rez-grup-DAHA_SONRA");
    expect(within(sonra).getByText("Gelecek Ay Öğrenci")).toBeTruthy();
  });

  it("G-4 · boş grup başlığı basılmıyor", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({
      rezervasyonlar: {
        data: [REZ({ id: 1, client_name: "Bugünkü Öğrenci", starts_at: tr("2026-08-10T14:00"), ends_at: tr("2026-08-10T16:00") })],
      },
    });

    await sar("./OperatorSessions.tsx");

    await screen.findByTestId("rez-grup-BUGUN");
    expect(screen.queryByTestId("rez-grup-YARIN")).toBeNull();
    expect(screen.queryByTestId("rez-grup-BU_HAFTA")).toBeNull();
    expect(screen.queryByTestId("rez-grup-DAHA_SONRA")).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   E · Hata durumu (ErrorState) — hata ≠ boş ekran
   ════════════════════════════════════════════════════════════════════════════ */

describe("E · hata durumları ErrorState gösteriyor", () => {
  it("E-2 · rezervasyon listesi hatası ErrorState gösteriyor", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({ rezervasyonlar: { status: 500, data: { detail: "patladı" } } });

    await sar("./OperatorSessions.tsx");

    const sarmal = await screen.findByTestId("rez-hata");
    const uyari = within(sarmal).getByRole("alert");
    expect(uyari).toBeTruthy();
    expect(uyari.textContent ?? "").toMatch(/yüklenemedi|hata/i);
  });

  it("E-3 · oturum listesi hatası ErrorState gösteriyor, 'Henüz oturum eklenmedi' DEĞİL", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({ oturumlar: { status: 500, data: { detail: "patladı" } } });

    await sar("./OperatorSessions.tsx");

    const sarmal = await screen.findByTestId("oturum-hata");
    const uyari = within(sarmal).getByRole("alert");
    expect(uyari).toBeTruthy();
    expect(screen.queryByText(/Henüz oturum eklenmedi/i)).toBeNull();
  });

  it("E-4 · roster hatası ErrorState gösteriyor", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({ roster: { status: 500, data: { detail: "patladı" } } });

    await sar("./OperatorSessions.tsx");

    fireEvent.click(await screen.findByRole("button", { name: /Katılımcılar/i }));

    const sarmal = await screen.findByTestId("roster-hata");
    const uyari = within(sarmal).getByRole("alert");
    expect(uyari).toBeTruthy();
    expect(screen.queryByText(/Henüz kayıtlı katılımcı yok/i)).toBeNull();
  });

  it("E-5 · boş durum ile hata durumu FARKLI metin gösteriyor", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({ oturumlar: { data: [] } });

    const bos = await sar("./OperatorSessions.tsx");
    const bosMetin = (await screen.findByTestId("oturum-bos")).textContent ?? "";
    bos.unmount();

    rotalar = [];
    istekler = [];
    temelUclar({ oturumlar: { status: 500, data: { detail: "patladı" } } });
    await sar("./OperatorSessions.tsx");
    const hataMetin = (await screen.findByTestId("oturum-hata")).textContent ?? "";

    expect(bosMetin.trim().length).toBeGreaterThan(0);
    expect(hataMetin.trim().length).toBeGreaterThan(0);
    expect(hataMetin).not.toBe(bosMetin);
  });

  it("E-6 · 403 sessiz kalmıyor — yetki hatası da ErrorState'e düşüyor", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({
      rezervasyonlar: { status: 403, data: { detail: "Kütüphaneniz henüz onaylanmadı" } },
    });

    await sar("./OperatorSessions.tsx");

    const sarmal = await screen.findByTestId("rez-hata");
    const uyari = within(sarmal).getByRole("alert");
    expect(uyari).toBeTruthy();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   Y · Sayaç ve onay
   ════════════════════════════════════════════════════════════════════════════ */

describe("Y · yoklama sayacı ve onay diyalogları", () => {
  it("Y-1 · roster başında 'N/M giriş yapıldı' görünüyor", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({
      roster: {
        data: [
          ROSTER_SATIR({ registration_id: 1, client_name: "Katılan Bir", status: "ATTENDED", attended_at: tr("2026-08-10T09:05") }),
          ROSTER_SATIR({ registration_id: 2, client_name: "Bekleyen Bir", status: "PAID" }),
          ROSTER_SATIR({ registration_id: 3, client_name: "Bekleyen İki", status: "PAID" }),
        ],
      },
    });

    await sar("./OperatorSessions.tsx");
    fireEvent.click(await screen.findByRole("button", { name: /Katılımcılar/i }));

    const sayac = await screen.findByTestId("roster-sayaci");
    expect(sayac.textContent ?? "").toContain("1/3");
    expect(sayac.textContent ?? "").toMatch(/giriş yapıldı/i);
  });

  it("Y-2 · sayaç yalnız ATTENDED'ı sayar (PAID'i katılmış saymaz)", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({
      roster: {
        data: [
          ROSTER_SATIR({ registration_id: 1, client_name: "Bekleyen Bir", status: "PAID" }),
          ROSTER_SATIR({ registration_id: 2, client_name: "Bekleyen İki", status: "PAID" }),
        ],
      },
    });

    await sar("./OperatorSessions.tsx");
    fireEvent.click(await screen.findByRole("button", { name: /Katılımcılar/i }));

    const sayac = await screen.findByTestId("roster-sayaci");
    expect(sayac.textContent ?? "").toContain("0/2");
  });

  it("Y-3 · oturum iptali ConfirmDialog açmadan mutation tetiklemiyor", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar();
    sunucu(/\/exam-sessions\/\d+\/cancel/, { data: OTURUM({ status: "CANCELLED" }) }, "post");
    // Tarayıcı diyaloğu bırakılmalı: çağrılırsa da "evet" desin ki, eski kod
    // yolunda istek GERÇEKTEN gitsin ve node kırmızı olsun.
    const confirmCasusu = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmCasusu);

    await sar("./OperatorSessions.tsx");
    fireEvent.click(await screen.findByRole("button", { name: /^İptal$/ }));

    // 1) Uygulama-içi onay penceresi açılmalı.
    const dialog = await screen.findByRole("dialog");
    // Diyalog NE yaptığını söylemeli: iade sonucu metinde geçmeli.
    expect(within(dialog).getByText(/iade/i)).toBeTruthy();
    // 2) Onay verilmeden HİÇBİR istek gitmemeli.
    expect(gidenler("/cancel", "post")).toHaveLength(0);
    expect(confirmCasusu).not.toHaveBeenCalled();

    // 3) Onaydan sonra istek gider.
    fireEvent.click(within(dialog).getByRole("button", { name: /onayla|iptal et|evet/i }));
    await waitFor(() => expect(gidenler("/cancel", "post")).toHaveLength(1));
  });

  it("Y-4 · karne yayınlama ConfirmDialog açmadan mutation tetiklemiyor", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar({ oturumlar: { data: [OTURUM({ starts_at: tr("2026-08-01T09:00") })] } });
    sunucu(/\/exam-sessions\/\d+\/results\/publish/, { data: { published_count: 3, message: "Sonuçlar yayınlandı (3 karne)." } }, "post");
    const confirmCasusu = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmCasusu);

    await sar("./OperatorSessions.tsx");
    fireEvent.click(await screen.findByRole("button", { name: /Sonuçlar/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Karneleri Yayınla/i }));

    const dialog = await screen.findByRole("dialog");
    expect(gidenler("results/publish", "post")).toHaveLength(0);
    expect(confirmCasusu).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /onayla|yayınla|evet/i }));
    await waitFor(() => expect(gidenler("results/publish", "post")).toHaveLength(1));
  });

  it("Y-5 · istek uçarken onay butonu disabled — çift gönderim yok", async () => {
    simdiyiKur("2026-08-10T08:00");
    operatorOturumu();
    temelUclar();
    let cozumle: (() => void) | null = null;
    sunucu(
      /\/exam-sessions\/\d+\/cancel/,
      () => {
        // Yanıtı askıya al: isPending penceresi gözlemlenebilir olsun.
        return { data: OTURUM({ status: "CANCELLED" }) };
      },
      "post"
    );
    // Askıya alma adapter seviyesinde yapılamadığı için isPending penceresini
    // yavaş bir yanıtla üretiriz.
    const eskiAdapterYerel = apiClient.defaults.adapter;
    apiClient.defaults.adapter = (async (config: AxiosRequestConfig) => {
      if (String(config.url).includes("/cancel")) {
        await new Promise<void>((r) => {
          cozumle = r;
        });
      }
      return (eskiAdapterYerel as (c: AxiosRequestConfig) => Promise<unknown>)(config);
    }) as never;

    await sar("./OperatorSessions.tsx");
    fireEvent.click(await screen.findByRole("button", { name: /^İptal$/ }));
    const dialog = await screen.findByRole("dialog");
    const onay = within(dialog).getByRole("button", { name: /onayla|iptal et|evet/i });
    fireEvent.click(onay);

    await waitFor(() => expect((onay as HTMLButtonElement).disabled).toBe(true));
    cozumle?.();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   N · Navigasyon — operatör panelden kopmuyor
   ════════════════════════════════════════════════════════════════════════════ */

describe("N · ortak sayfalarda operatör navigasyonu", () => {
  const SAYFALAR: [string, string][] = [
    ["../Notifications.tsx", "/bildirimler"],
    ["../Leaderboard.tsx", "/liderlik"],
    ["../Settings.tsx", "/ayarlar"],
    ["../Calendar.tsx", "/takvim"],
    ["../Learn.tsx", "/ogren"],
  ];

  for (const [modul, yol] of SAYFALAR) {
    it(`N · ${yol} operatör nav'ını gösteriyor (öğrenci nav'ı DEĞİL, boş DEĞİL)`, async () => {
      // Bu gruba sahte zaman GEREKMEZ; `Settings` gibi ağır sayfalarda sahte
      // zamanlayıcı RTL'in bekleme döngüsünü yavaşlatıp 5 sn'lik testi
      // altyapı yüzünden düşürüyordu (davranış yüzünden değil).
      operatorOturumu();
      temelUclar();
      // `types::LeaderboardOut` — dört ayrı liste taşıyan NESNE (dizi değil;
      // dizi verilince sayfa `.map` üzerinde patlıyor ve nav hiç basılmıyordu).
      // Ayarlar sayfası ad/kullanıcı adı değişiklik taleplerini LİSTE bekler;
      // stub'sız bırakılınca `nameRequests.find` üzerinde render PATLIYOR ve
      // nav zaten basıldığı için test yeşil kalıyordu — yakalanmamış istisna
      // suite raporunda "1 error" olarak görünüyordu.
      sunucu("/auth/me/name-change-requests", { data: [] });
      sunucu("/leaderboard", {
        data: {
          tutors_by_lessons: [],
          tutors_by_rating: [],
          students_by_lessons: [],
          students_by_net: [],
        },
      });
      sunucu("/bookings", { data: [] });
      sunucu("/habits", { data: [] });

      await sar(modul, yol);

      // N-1/N-2: operatörün kendi girişleri görünür.
      const kutuphanem = await screen.findAllByRole("link", { name: /Kütüphanem/i });
      expect(kutuphanem.length).toBeGreaterThan(0);
      expect(screen.getAllByRole("link", { name: /Oturumlar & QR/i }).length).toBeGreaterThan(0);
      // N-3: öğrenci nav'ı gösterilmiyor.
      expect(screen.queryByRole("link", { name: /Favorilerim/i })).toBeNull();
      expect(screen.queryByRole("link", { name: /Rezervasyonlar/i })).toBeNull();
    });
  }
});


/* ══════════════════════════════════════════════════════════════════════════
 * İP-A7d3 · göç dalgası 3 · ekranlar (7)(8)(9): operatör paneli üçlüsü
 *
 * Haritadaki yeri (dalga başındaki taban):
 *   • `OperatorLibrary`  — 4 ham düğme + **7 adsız kontrol** (tabanın en büyük
 *     adsız kalemi: beş adres kutusu + on dört saat kutusundan ikisi)
 *   • `OperatorHome`     — 3 ham düğme + 3 adsız kontrol (şifre paneli)
 *   • `OperatorSessions` — 3 ham düğme + 1 adsız kontrol (elle bilet kodu)
 *
 * A7d2 bu üçlüyü "ayrı sahip, ayrı kabul matrisi" gerekçesiyle elemişti.
 * Bu dalganın ölçütü BORÇ YOĞUNLUĞU: kalan 26 adsız kontrolün 11'i buradaydı
 * ve üçünü de almadan sayıyı anlamlı biçimde düşürmek mümkün değildi. Kabul
 * matrisi karışmasın diye iddialar bu dosyanın SONUNDA, kendi bölümünde durur
 * ve İP-14'ün mevcut testlerine dokunmaz.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("İP-A7d3 · operatör paneli göçü", () => {
  it("OperatorHome · şifre panelinin üç alanı da ADLI", async () => {
    operatorOturumu();
    temelUclar();
    const { container } = await sar("./OperatorHome.tsx");

    fireEvent.click(await screen.findByRole("button", { name: "Şifre değiştir" }));
    expect(await screen.findByLabelText("Mevcut şifre")).toBeTruthy();
    expect(screen.getByLabelText(/Yeni şifre \(en az 8/)).toBeTruthy();
    expect(screen.getByLabelText("Yeni şifre (tekrar)")).toBeTruthy();
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("OperatorHome · KAPALI dalda şifre alanları hiç basılmaz (ters prova)", async () => {
    operatorOturumu();
    temelUclar();
    await sar("./OperatorHome.tsx");
    await screen.findByRole("button", { name: "Şifre değiştir" });
    expect(screen.queryByLabelText("Mevcut şifre")).toBeNull();
  });

  it("OperatorHome · kısa şifrede düğme AÇIK kalır, istek GİTMEZ, hata ALANDA çıkar", async () => {
    operatorOturumu();
    temelUclar();
    await sar("./OperatorHome.tsx");

    fireEvent.click(await screen.findByRole("button", { name: "Şifre değiştir" }));
    const mevcut = await screen.findByLabelText("Mevcut şifre");
    fireEvent.change(mevcut, { target: { value: "eski-sifre" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifre \(en az 8/), { target: { value: "kisa" } });
    await act(async () => {});

    const gonder = screen.getByRole("button", { name: "Şifreyi Güncelle" }) as HTMLButtonElement;
    expect(gonder.disabled).toBe(false);
    fireEvent.click(gonder);

    expect(await screen.findByText("Yeni şifre en az 8 karakter olmalı.")).toBeTruthy();
    expect(gidenler("/change-password", "post")).toHaveLength(0);
  });

  it("OperatorHome · şifreler eşleşmiyorsa hata TEKRAR alanında çıkar", async () => {
    operatorOturumu();
    temelUclar();
    await sar("./OperatorHome.tsx");

    fireEvent.click(await screen.findByRole("button", { name: "Şifre değiştir" }));
    fireEvent.change(await screen.findByLabelText("Mevcut şifre"), { target: { value: "eski" } });
    fireEvent.change(screen.getByLabelText(/Yeni şifre \(en az 8/), {
      target: { value: "yeterince-uzun" },
    });
    fireEvent.change(screen.getByLabelText("Yeni şifre (tekrar)"), { target: { value: "baska" } });
    fireEvent.click(screen.getByRole("button", { name: "Şifreyi Güncelle" }));

    const mesaj = await screen.findByText("Yeni şifreler eşleşmiyor.");
    const tekrar = screen.getByLabelText("Yeni şifre (tekrar)");
    expect(tekrar.getAttribute("aria-describedby") ?? "").toContain(mesaj.id);
  });

  it("OperatorHome · şifre formu KİRLİYKEN sekme kapatma İPTAL edilir", async () => {
    operatorOturumu();
    temelUclar();
    await sar("./OperatorHome.tsx");
    fireEvent.click(await screen.findByRole("button", { name: "Şifre değiştir" }));

    const temiz = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(temiz);
    expect(temiz.defaultPrevented).toBe(false);

    fireEvent.change(await screen.findByLabelText("Mevcut şifre"), { target: { value: "x" } });
    await act(async () => {});
    const kirli = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(kirli);
    expect(kirli.defaultPrevented).toBe(true);
  });

  it("OperatorSessions · elle bilet kodu kutusu ADLI", async () => {
    operatorOturumu();
    temelUclar();
    const { container } = await sar("./OperatorSessions.tsx");

    expect(await screen.findByLabelText("Bilet kodu")).toBeTruthy();
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("OperatorLibrary · adres dalının BEŞ alanı da ADLI", async () => {
    operatorOturumu();
    temelUclar();
    const { container } = await sar("./OperatorLibrary.tsx");

    fireEvent.click(
      await screen.findByRole("button", { name: /Adres & Konum — düzenle/ }),
    );
    expect(await screen.findByLabelText("İl")).toBeTruthy();
    expect(screen.getByLabelText("İlçe")).toBeTruthy();
    expect(screen.getByLabelText("Mahalle")).toBeTruthy();
    expect(screen.getByLabelText("Sokak / Cadde")).toBeTruthy();
    expect(screen.getByLabelText("No")).toBeTruthy();
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("OperatorLibrary · saat dalının ON DÖRT kutusu da GÜN ADIYLA adlı", async () => {
    operatorOturumu();
    temelUclar();
    const { container } = await sar("./OperatorLibrary.tsx");

    fireEvent.click(
      await screen.findByRole("button", { name: /Çalışma Saatleri — düzenle/ }),
    );
    // Gün varsayılan olarak KAPALI gelir (fixture `hours: []`); saat kutuları
    // ancak gün açıkken basılır.
    fireEvent.click((await screen.findAllByRole("checkbox", { name: "Açık" }))[0]);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Açık" })[6]);
    // Gün adı ADIN İÇİNDE: yedi satırın on dört kutusu birbirinden ayırt
    // edilebilmeli. "Bir yerde bir ad var" iddiası burada yetmez.
    expect(await screen.findByLabelText("Pazartesi açılış saati")).toBeTruthy();
    expect(screen.getByLabelText("Pazartesi kapanış saati")).toBeTruthy();
    expect(screen.getByLabelText("Pazar açılış saati")).toBeTruthy();
    expect(screen.getByLabelText("Pazar kapanış saati")).toBeTruthy();
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("OperatorLibrary · SALT OKUNUR dalda hiçbir kontrol adsız değil (ters prova)", async () => {
    operatorOturumu();
    temelUclar();
    const { container } = await sar("./OperatorLibrary.tsx");
    await screen.findByRole("button", { name: /Adres & Konum — düzenle/ });
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("OperatorLibrary · olanak çipi SEÇİM DURUMUNU beyan eder (aria-pressed)", async () => {
    operatorOturumu();
    temelUclar({ kutuphane: KUTUPHANE({ amenities: ["wifi"] }) });
    await sar("./OperatorLibrary.tsx");

    fireEvent.click(await screen.findByRole("button", { name: /Olanaklar — düzenle/ }));
    const secili = await screen.findAllByRole("button", { pressed: true });
    expect(secili.length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { pressed: false }).length).toBeGreaterThan(0);
  });
});
