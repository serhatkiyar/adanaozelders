// İP-14 kırmızı matris — Bakiyem (operatör kolu): hata dürüstlüğü, kesilme
// dürüstlüğü ve ödeme metninin doğruluğu. GERÇEK DOM + gerçek axios.
//
// Neden ayrı dosya: burada ölçülen şey liste düzeni değil, **para ekranının
// söylediği cümle**. Üç yalan aynı ekranda toplanmıştı:
//
//   1. Sunucu hatası "Henüz bir işlem yok" diye görünüyordu — kullanıcı bunu
//      "hiç ödeme almamışım" diye okur (node E-1).
//   2. Liste 200 satırda SESSİZCE kesiliyordu; "eski bir işlem kayboldu"
//      şikâyetinde ekran hiçbir şey söylemiyordu (node K-1/K-2).
//   3. Ekran "tutarlar iyzico üzerinden doğrudan IBAN'ına geçer" diyordu;
//      kurulu mekanizma ise ADMIN'in tuttuğu **elle havale defteri**
//      (`backend/api/routers/payouts.py`: "Ödeme banka üzerinden ELLE
//      yapılır; burada yalnız defter tutulur") — node Y-6.
//
// Kanıt sınıfı: gerçek DOM + gerçek HTTP isteği. `EarningTransaction`
// fixture'ı `backend/schemas/payment.py` alan adlarıyla birebirdir.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Ağır modüller BİLE BİLE statik import ediliyor (İP-A7d3 · Görev 5) ──
//
// Maliyet TOPLAMA (collect) evresinde ödenir; orada test/kanca bütçesi yoktur.
// İP-A7d5'te ekranın KENDİSİ de (`Balance`) buraya alındı — tembel yükleme
// kaldırıldı, gerekçesi aşağıda.
import "@/components/admin/ui2/duzenlemeYuzeyi";
import Balance from "@/pages/Balance";

import { apiClient } from "@/api/axios";
import { dosyaBeklemeButcesi } from "@/test-utils/beklemeButcesi";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

// ── İP-A7d5 · Görev 3: İKİ BÜTÇE EZMESİ DE KALDIRILDI ──
//
// Burada iki ezme vardı ve ikisinin de gerekçesi AYNI cümleydi: "esbuild
// transform'u birkaç saniye sürüyor". Yani ölçülen davranış değil, MODÜL
// YÜKLEME maliyeti bütçeyi yiyordu — ve o maliyet Görev 2'de kaynağında
// kaldırıldı (ekranlar statik import edildi, maliyet collect evresine geçti).
//
//   1. `vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 })` — KALKTI.
//      `vitest.config.ts`'in yazılı kuralını ("dosya başına testTimeout ezmesi
//      YAPILMAZ") delen iki dosyadan biriydi. Göç sonrası ÖLÇÜLDÜ: tam suite
//      yükü altında bu dosyanın EN YAVAŞ testi 3.997 ms (öncesi: ilk test tek
//      başına 6.923 ms). 9 sn'lik ortak bütçe yeterli.
//
//   2. `configure({ asyncUtilTimeout: 5_000 })` — bundan daha kötüsü: RTL'in
//      `configure`u modül düzeyinde GLOBALDİR ve `@testing-library/dom` bir
//      node_modules bağımlılığı olduğu için vitest işçisinin ESM önbelleğinde
//      DOSYALAR ARASINDA paylaşılır (aynı sızıntı `zodTurkce.test.ts`te zod
//      için belgeli). Ölçüldü: `--pool=forks --singleFork` ile bu dosyadan
//      SONRA koşan bir sonda `asyncUtilTimeout = 5000` okuyor; tek başına
//      koşunca 1000. Yani bu satır "yalnız bu dosyanın bütçesi" değildi —
//      aynı işçide sonra gelen HER dosyanın bütçesini, karışık tohumda
//      değişen bir kümede sessizce beş katına çıkarıyordu. İP-A6b'nin
//      BULGU-10'da kaldırdığı global ayar, yan kapıdan geri gelmişti.
//
// Bütçe SIZINTISIZ biçimde geri kondu ve ÖLÇÜLMÜŞ bir değere indirildi
// (5000 → 3000): bu dosyanın ölçülen tepe beklemesi 1.184 ms'dir (üst sınır,
// tam suite yükü) — yani varsayılanın üstünde ama kardeş dosyanın mertebesinde
// değil. `dosyaBeklemeButcesi` değeri `beforeAll`da kurar, `afterAll`da
// ÖNCEKİ değerine döndürür.
dosyaBeklemeButcesi(3_000);

/* ══════════════ Sahte sunucu ══════════════ */

interface Istek {
  method: string;
  url: string;
}
type Yanit = { status?: number; data: unknown };

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
    };
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota?.yanit ?? { data: {} };
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
  vi.restoreAllMocks();
});

/* ══════════════ Oturum + render ══════════════ */

const OPERATOR_ID = 77;
const LIBRARY_ID = 12;

function operatorOturumu() {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: OPERATOR_ID, role_id: 4, email: "op@k.example.com", full_name: "Operatör Test", email_verified: true } as never,
  });
}

// ── İP-A7d5 · Görev 2: ekran STATİK import ediliyor ──
//
// Eskiden `import.meta.glob(["./Balance.tsx"])` + `beforeAll` yüklemesiydi.
// Glob, ekran dosyası HENÜZ YOKKEN kırmızı matris kurabilmek içindi (red-first
// idiom); dosya yazıldığı gün o gerekçe bitti ve geriye yalnız maliyeti kaldı:
// modül değerlendirmesi TOPLAMA evresinde değil, koşum evresinde ödeniyordu.
// Statik import maliyeti collect'e taşır — orada test/kanca bütçesi yoktur.
// Ölçüm ve gerekçe: `docs/ip-a7d5-rapor.md` · Görev 2.

async function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/bakiyem"]}>
        <Routes>
          <Route path="*" element={<Balance />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

/** `schemas/payment.py::EarningTransaction` */
const ISLEM = (i: number) => ({
  id: i,
  source: "EXAM",
  title: `Ağustos TYT Denemesi #${i}`,
  counterparty: `Öğrenci ${i}`,
  gross: "100.00",
  commission: "10.00",
  net: "90.00",
  status: "RELEASED",
  currency: "TRY",
  occurred_at: "2026-08-01T10:00:00Z",
  created_at: "2026-08-01T10:00:00Z",
});

function temelUclar(islemler: Yanit) {
  sunucu("/auth/me", { data: { id: OPERATOR_ID, role_id: 4, email: "op@k.example.com", full_name: "Operatör Test", email_verified: true } });
  sunucu("/library-operators/me", {
    data: { id: OPERATOR_ID, email: "op@k.example.com", full_name: "Operatör Test", library_id: LIBRARY_ID, is_active: true, created_at: "2026-01-01T00:00:00Z", library_name: "Test Kütüphanesi" },
  });
  // DİKKAT sıra: `sunucu` rotaları unshift'ler (son kaydedilen önce eşleşir) ve
  // eşleşme substring'dir. "/libraries/12/earnings" deseni
  // "/libraries/12/earnings/transactions" yolunu da yakalar; bu yüzden ÖZEL
  // olan sonra kaydedilir. (İlk yazımda ters sıradaydı: işlem dökümü isteği
  // ÖZET yanıtını alıyor, ekran `transactions.map` üzerinde patlıyordu — node
  // kırmızıydı ama yanlış sebeple.)
  sunucu("/libraries/12/earnings", {
    data: {
      currency: "TRY",
      released_earning: "900.00",
      held_earning: "180.00",
      commission_total: "100.00",
      released_count: 10,
      held_count: 2,
      this_month_earning: "450.00",
      refunded_total: "0.00",
    },
  });
  sunucu("/libraries/12/earnings/transactions", islemler);
  sunucu("/libraries/admin/12/payout", { data: { payout_status: "ACTIVE", iban_masked: "TR** **** 1234" } });
  sunucu("/messages/unread-count", { data: { inbox: 0, sent: 0 } });
  sunucu("/notifications/unread-count", { data: { count: 0 } });
}

/* ════════════════════════════════════════════════════════════════════════════ */

describe("E-1 · Bakiyem hatası 'işlem yok' diye okunmuyor", () => {
  it("işlem dökümü sorgusu patlarsa ErrorState görünür", async () => {
    operatorOturumu();
    temelUclar({ status: 500, data: { detail: "patladı" } });

    await sar();

    const sarmal = await screen.findByTestId("islem-hata");
    expect(within(sarmal).getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/Henüz bir işlem yok/i)).toBeNull();
  });

  it("E-5 · boş liste ile hata FARKLI metin gösterir", async () => {
    operatorOturumu();
    temelUclar({ data: [] });
    const bos = await sar();
    const bosMetin = (await screen.findByTestId("islem-bos")).textContent ?? "";
    bos.unmount();

    rotalar = [];
    temelUclar({ status: 500, data: { detail: "patladı" } });
    await sar();
    const hataMetin = (await screen.findByTestId("islem-hata")).textContent ?? "";

    expect(bosMetin.trim()).not.toBe("");
    expect(hataMetin.trim()).not.toBe("");
    expect(hataMetin).not.toBe(bosMetin);
  });
});

describe("K · 200 satır tavanı görünür", () => {
  it("K-1 · liste tavana dayanınca 'son 200 işlem' uyarısı görünür", async () => {
    operatorOturumu();
    temelUclar({ data: Array.from({ length: 200 }, (_, i) => ISLEM(i + 1)) });

    await sar();

    const uyari = await screen.findByTestId("islem-tavan-uyarisi");
    expect(uyari.textContent ?? "").toMatch(/200/);
  });

  it("K-2 · tavana dayanmayan listede uyarı YOK", async () => {
    operatorOturumu();
    temelUclar({ data: Array.from({ length: 199 }, (_, i) => ISLEM(i + 1)) });

    await sar();

    await screen.findByText(/İşlem Dökümü/i);
    expect(screen.queryByTestId("islem-tavan-uyarisi")).toBeNull();
  });
});

describe("Y-6 · ödeme metni gerçeği söylüyor", () => {
  it("hakedişin elle havaleyle ödendiği yazar; 'iyzico doğrudan IBAN'ına geçer' vaadi YOKTUR", async () => {
    operatorOturumu();
    temelUclar({ data: [ISLEM(1)] });

    await sar();

    const aciklama = await screen.findByTestId("bakiye-odeme-aciklamasi");
    // Kurulu mekanizma: admin'in tuttuğu defter + banka havalesi.
    expect(aciklama.textContent ?? "").toMatch(/havale/i);
    // Yanlış vaat: pazaryeri alt üye işyeri kurulmadan iyzico IBAN'a para geçmez.
    expect(within(aciklama).queryByText(/iyzico/i)).toBeNull();
    expect(aciklama.textContent ?? "").not.toMatch(/iyzico/i);
  });
});
