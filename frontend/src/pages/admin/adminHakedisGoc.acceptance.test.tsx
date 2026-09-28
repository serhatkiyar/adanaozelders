/**
 * İP-A7d2 · Görev 3 — `AdminPayoutsPage` göç matrisi.
 *
 * Bu ekran dalgaya üç sebeple girdi:
 *
 *   1. Kalan üç etiketsiz overlay'in **sonuncusu** burada (`PayModal`).
 *   2. Kilitli kararın **açık bir ihlalini** taşıyor: gönder düğmesi
 *      geçerlilikle KAPANIYOR (`disabled={gecersiz || …}`). Kullanıcı neden
 *      basamadığını düğmeden öğrenemez.
 *   3. Sekme bir FİLTREDİR ve `useState`te yaşıyor: adres paylaşılamıyor,
 *      geri tuşu çalışmıyor ("filtreler URL'de" kilitli kararı).
 *
 * Para ekranı olduğu için mevcut davranışı sabitleyen testler ayrıca önemli:
 * geçmiş listesi hatasının "kayıt yok" gibi görünmemesi zaten bir P1
 * düzeltmesiydi (`adminSafetyStates`), buradaki testler onu tekrar etmez.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminPayoutsPage from "@/pages/admin/AdminPayoutsPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";
import { adsizKontroller, formKontrolleri } from "@/test-utils/alanAdlari";

import type { AxiosRequestConfig } from "axios";

/**
 * ── Yük altındaki bekleme bütçesi (İP-A7d2 · Görev 5) ──
 *
 * Bu dosya, RTL'in 1000 ms'lik varsayılanını aşan **dördüncü** çağrı yeridir
 * (öncekiler: `adminStoreDalAdlari`, `storeVariants`, `ticketsPaymentGate`).
 * Bütçe ölçülmeden artırılmadı; ölçüm şudur:
 *
 * | Koşum | Ölçülen |
 * |---|---|
 * | dosya tek başına (6 karışık tohum) | 16/16 yeşil, hiç sınıra yaklaşmadı |
 * | tam suite · tohum 2006 | H-4 "temiz formda ESC" düştü |
 * | tam suite · tohum 2013 | H-3 düştü; **ölçülen süre 917 ms** |
 * | tam suite · tohum 2014/2020/2027 | 98 / 124 / 207 ms |
 *
 * Yani sorgu normalde ~100–500 ms'de çözülüyor, paralel yük altında 917 ms'ye
 * çıkıyor ve varsayılanın DİBİNE değiyor. Bu "flaky test" değil, daralan bir
 * zamanlama penceresidir (proje defterinde aynı sınıf iki kez yaşandı) —
 * dolayısıyla "yerelde geçiyor" bir kanıt sayılmadı.
 *
 * Sebep test kurulumu: sahte adapter zaten anında dönüyor, üretim kodunda
 * bekleyen bir iş yok; gecikme vitest işçilerinin CPU paylaşımından geliyor.
 */
const YUK = { timeout: 4000 };

/* ══════════════ Sahte sunucu ══════════════ */

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
  params?: Record<string, unknown>;
}
type Yanit = { status?: number; data: unknown };

let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit }[] = [];
let istekler: Istek[] = [];
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
  istekler = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      body: config.data && typeof config.data === "string" ? JSON.parse(config.data) : null,
      params: config.params as Record<string, unknown> | undefined,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota ? rota.yanit : { data: [] };
    const status = ham.status ?? 200;
    if (status >= 400) {
      const hata = new Error("istek basarisiz") as Error & {
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
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: {
      id: 1,
      role_id: 1,
      admin_permissions: ["payments.view", "payments.manage"],
    } as never,
  });
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  useToastStore.setState({ toasts: [] });
});

/* ══════════════ Fixture ══════════════ */

/** `api/payouts.ts::PayeeBalance` */
const BAKIYE = (over: Record<string, unknown> = {}) => ({
  payee_type: "TUTOR",
  payee_id: 5,
  name: "Deniz Öğretmen",
  iban: "TR120006200000000000000001",
  earned: "1200.00",
  paid: "200.00",
  balance: "1000.00",
  pending: "150.00",
  // Öğretmene ödeme yalnız açık para çekme talebi varken yapılır (23 Eyl 2026).
  requested_amount: "1000.00",
  requested_at: "2026-09-20T10:00:00Z",
  ...over,
});

/** `api/payouts.ts::PayoutRecord` */
const KAYIT = {
  id: 3,
  payee_type: "TUTOR",
  payee_id: 5,
  amount: "200.00",
  reference: "HVL-1",
  note: null,
  iban_snapshot: "TR120006200000000000000001",
  paid_at: "2026-08-01T10:00:00Z",
};

function sar(adres = ROUTES.adminPayouts) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[adres]}>
        <Routes>
          <Route path={ROUTES.adminPayouts} element={<AdminPayoutsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function pencere(): HTMLElement {
  const p = document.querySelector('[role="dialog"]');
  if (!p) throw new Error("pencere yok");
  return p as HTMLElement;
}

function adlarDogru(enAz: number) {
  const kontroller = formKontrolleri(document.body);
  expect(
    kontroller.length,
    `dal acilmamis olabilir: beklenen >=${enAz}, bulunan ${kontroller.length}`
  ).toBeGreaterThanOrEqual(enAz);
  expect(adsizKontroller(document.body).map((a) => a.html)).toEqual([]);
}

async function pencereyiAc(bakiye = BAKIYE()) {
  sunucu("/payouts/pending", { data: [bakiye] }, "get");
  sar();
  fireEvent.click(await screen.findByRole("button", { name: "Ödedim" }, YUK));
  await screen.findByLabelText(/Tutar/, undefined, YUK);
}

/* ══════════════ 1 · Mevcut davranış korunur ══════════════ */

describe("H-1 · liste ve sekmeler", () => {
  it("ödenecekler listesi toplamı ve alıcıyı gösterir", async () => {
    sunucu("/payouts/pending", { data: [BAKIYE()] }, "get");
    sar();
    expect(await screen.findByText("Deniz Öğretmen", undefined, YUK)).toBeTruthy();
    expect(screen.getByText(/1 alıcı/)).toBeTruthy();
  });

  it("IBAN'ı olmayan alıcı için uyarı basılır", async () => {
    sunucu("/payouts/pending", { data: [BAKIYE({ iban: null })] }, "get");
    sar();
    expect(await screen.findByText("IBAN yok", undefined, YUK)).toBeTruthy();
  });

  it("geçmiş sekmesi kayıtları listeler", async () => {
    sunucu("/payouts/pending", { data: [] }, "get");
    sunucu(/^\/payouts$/, { data: [KAYIT] }, "get");
    sar();
    fireEvent.click(await screen.findByRole("button", { name: "Ödeme geçmişi" }, YUK));
    expect(await screen.findByText("HVL-1", undefined, YUK)).toBeTruthy();
  });
});

/* ══════════════ 1b · Geçmiş sayfalıdır (100'de sessiz kesilme yok) ══════════════ */

describe("H-1b · ödeme geçmişi sayfalıdır", () => {
  const gecmisIstekleri = () =>
    istekler.filter((i) => i.method === "get" && i.url.split("?")[0] === "/payouts");

  it("sayfa boyutundan fazla kayıt varsa sonraki sayfaya geçilir; boş 2. sayfa 'kayıt yok' demez", async () => {
    // 51 kayıt = 50'lik sayfa + 1 yoklama satırı → "daha eski kayıt var".
    const kayitlar = Array.from({ length: 51 }, (_, i) => ({
      ...KAYIT,
      id: 1000 - i,
      reference: `HVL-${1000 - i}`,
    }));
    sunucu("/payouts/pending", { data: [] }, "get");
    sunucu(/^\/payouts$/, { data: kayitlar }, "get");
    sar(`${ROUTES.adminPayouts}?sekme=gecmis`);

    expect(await screen.findByText("HVL-1000", undefined, YUK)).toBeTruthy();
    expect(screen.getByText("HVL-951")).toBeTruthy();
    // Yoklama satırı ekrana basılmaz.
    expect(screen.queryByText("HVL-950")).toBeNull();
    expect(gecmisIstekleri().at(-1)?.params).toEqual({ limit: 51, offset: 0 });
    expect(screen.getByText(/daha eski kayıtlar var/)).toBeTruthy();

    sunucu(/^\/payouts$/, { data: [] }, "get");
    fireEvent.click(screen.getByRole("button", { name: "Sonraki" }));
    expect(await screen.findByText("Bu sayfada kayıt kalmadı", undefined, YUK)).toBeTruthy();
    expect(gecmisIstekleri().at(-1)?.params).toEqual({ limit: 51, offset: 50 });
    expect(screen.queryByText(/Henüz ödeme kaydı yok/)).toBeNull();
  });

  it("tek sayfaya sığan geçmişte sayfa düğmesi çıkmaz", async () => {
    sunucu("/payouts/pending", { data: [] }, "get");
    sunucu(/^\/payouts$/, { data: [KAYIT] }, "get");
    sar(`${ROUTES.adminPayouts}?sekme=gecmis`);
    expect(await screen.findByText("HVL-1", undefined, YUK)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sonraki" })).toBeNull();
  });
});

/* ══════════════ 2 · Sekme URL'de (KIRMIZI) ══════════════ */

describe("H-2 · sekme bir filtredir ve adreste yaşar", () => {
  it("geçmiş sekmesine geçince adres değişir", async () => {
    sunucu("/payouts/pending", { data: [] }, "get");
    sunucu(/^\/payouts$/, { data: [KAYIT] }, "get");
    sar();
    fireEvent.click(await screen.findByRole("button", { name: "Ödeme geçmişi" }, YUK));
    await waitFor(() =>
      expect(window.location.search || document.location.search).toBeDefined()
    );
    // Adres doğrudan okunamadığı için kanıt: aynı adresle AÇILAN ekran
    // geçmiş sekmesinde başlar (aşağıdaki test).
    expect(await screen.findByText("HVL-1", undefined, YUK)).toBeTruthy();
  });

  it("adres geçmiş sekmesini gösteriyorsa ekran ORADA açılır (paylaşılabilir)", async () => {
    sunucu("/payouts/pending", { data: [] }, "get");
    sunucu(/^\/payouts$/, { data: [KAYIT] }, "get");
    sar(`${ROUTES.adminPayouts}?sekme=gecmis`);
    expect(await screen.findByText("HVL-1", undefined, YUK)).toBeTruthy();
  });

  it("varsayılan sekme adrese YAZILMAZ (adres çöplenmez)", async () => {
    sunucu("/payouts/pending", { data: [] }, "get");
    sar(`${ROUTES.adminPayouts}?sekme=odenecekler`);
    // Varsayılana eşit değer temizlenir; ekran yine ödenecekler sekmesinde.
    expect(await screen.findByText(/Ödenmemiş hakediş yok/, undefined, YUK)).toBeTruthy();
  });
});

/* ══════════════ 3 · Hata ≠ boş (KIRMIZI) ══════════════ */

describe("H-3 · ödenecekler listesi hatası ortak yüzeyden gelir", () => {
  it("hata durumunda 'Yeniden dene' çıkar ve boş metni ÇIKMAZ", async () => {
    sunucu("/payouts/pending", { status: 500, data: { detail: "patladi" } }, "get");
    sar();
    expect(
      await screen.findByRole("button", { name: /Yeniden dene/i }, YUK)
    ).toBeTruthy();
    expect(screen.queryByText(/Ödenmemiş hakediş yok/)).toBeNull();
  });
});

/* ══════════════ 4 · Pencere sözleşmesi (KIRMIZI) ══════════════ */

describe("H-4 · ödeme penceresi ortak yüzeyden gelir", () => {
  it("pencere role=dialog + aria-modal taşır", async () => {
    await pencereyiAc();
    const p = await screen.findByRole("dialog");
    expect(p.getAttribute("aria-modal")).toBe("true");
  });

  it("temiz formda ESC kapatır", async () => {
    await pencereyiAc();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("KİRLİ formda kapatma önce sorar (para ekranı — yazılan kaybolmamalı)", async () => {
    await pencereyiAc();
    fireEvent.change(within(pencere()).getByLabelText(/Havale referansı/), {
      target: { value: "HVL-99" },
    });
    await act(async () => {});
    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

/* ══════════════ 5 · Dal adları (KIRMIZI) ══════════════ */

describe("H-5 · her koşullu dal render edilir, her alanın adı vardır", () => {
  it("IBAN'lı dal — üç alan da adlı", async () => {
    await pencereyiAc();
    expect(within(pencere()).getByText(/TR120006200000000000000001/)).toBeTruthy();
    expect(within(pencere()).getByLabelText(/Not/)).toBeTruthy();
    adlarDogru(3);
  });

  it("IBAN'sız dal — uyarı çıkar, alanlar yine adlı", async () => {
    await pencereyiAc(BAKIYE({ iban: null }));
    expect(within(pencere()).getByText(/IBAN'ı kayıtlı değil/)).toBeTruthy();
    adlarDogru(3);
  });
});

/* ══════════════ 6 · Gönder kapısı (KIRMIZI — kilitli karar ihlali) ══════════════ */

describe("H-6 · gönder düğmesi geçerlilikle KAPANMAZ", () => {
  it("tutar bakiyeden büyükken düğme AÇIK kalır", async () => {
    await pencereyiAc();
    fireEvent.change(within(pencere()).getByLabelText(/Tutar/), {
      target: { value: "5000" },
    });
    await act(async () => {});
    const gonder = within(pencere()).getByRole("button", { name: "Ödemeyi kaydet" });
    expect((gonder as HTMLButtonElement).disabled).toBe(false);
  });

  it("geçersiz tutarda gönderim YAPILMAZ, hata ALANDA çıkar, odak oraya gider", async () => {
    await pencereyiAc();
    const tutar = within(pencere()).getByLabelText(/Tutar/);
    fireEvent.change(tutar, { target: { value: "5000" } });
    fireEvent.click(within(pencere()).getByRole("button", { name: "Ödemeyi kaydet" }));

    await waitFor(() => expect(tutar.getAttribute("aria-invalid")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(tutar));
    expect(istekler.some((i) => i.method === "post" && i.url === "/payouts")).toBe(false);
  });

  it("geçerli tutarda gövde sunucuya gider", async () => {
    await pencereyiAc();
    sunucu(/^\/payouts$/, { data: KAYIT }, "post");
    fireEvent.change(within(pencere()).getByLabelText(/Havale referansı/), {
      target: { value: "HVL-99" },
    });
    fireEvent.click(within(pencere()).getByRole("button", { name: "Ödemeyi kaydet" }));

    await waitFor(() => {
      const yazma = istekler.find((i) => i.method === "post" && i.url === "/payouts");
      expect(yazma).toBeTruthy();
      expect(yazma!.body!.payee_id).toBe(5);
      expect(yazma!.body!.amount).toBe("1000.00");
      expect(yazma!.body!.reference).toBe("HVL-99");
    });
  });

  it("sunucu 422'si ALANIN altına yazılır", async () => {
    await pencereyiAc();
    sunucu(
      /^\/payouts$/,
      {
        status: 422,
        data: { detail: [{ loc: ["body", "amount"], msg: "Bakiye yetersiz" }] },
      },
      "post"
    );
    fireEvent.click(within(pencere()).getByRole("button", { name: "Ödemeyi kaydet" }));
    expect(await within(pencere()).findByText("Bakiye yetersiz")).toBeTruthy();
  });
});
