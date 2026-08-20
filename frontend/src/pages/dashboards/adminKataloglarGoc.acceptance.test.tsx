/**
 * İP-A7d2 · Görev 3 — `AdminExamCatalogs` göç matrisi.
 *
 * Bu ekran dalgaya `ExamSessionsManager`in **bağımlısı** olduğu için girdi
 * (A7d1 raporu: "AdminExamCatalogs ona bağımlı; onu göç ettirmeden
 * ölçülemez"). Kalan üç etiketsiz overlay'in ikincisi burada ve yetkiye bağlı
 * bir dalı var (`catalogs.manage` yoksa ekran SALT OKUNUR) — dal testinin
 * gerçekten farklı yüzeyler açtığı ilk örneklerden biri.
 *
 * Testlerin bir kısmı yazıldığı anda kırmızıydı; sayı raporda.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminExamCatalogs from "@/pages/dashboards/AdminExamCatalogs";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";
import { adsizKontroller, formKontrolleri } from "@/test-utils/alanAdlari";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu ══════════════ */

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
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

/* ══════════════ Fixture ══════════════ */

/** `schemas/exam_catalog.py::CatalogOut` */
const KATALOG = (over: Record<string, unknown> = {}) => ({
  id: 9,
  exam_name: "Türkiye Geneli YKS-1",
  exam_type: "TYT",
  publisher_name: "Özdebir",
  description: "Ortak deneme",
  question_count: 120,
  duration_minutes: 165,
  is_public: true,
  is_nationwide: true,
  session_count: 4,
  answer_key_url: null,
  ...over,
});

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminExamCatalogs />
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

async function editoruAc(dugme = "+ Katalog") {
  izinVer("catalogs.view", "catalogs.manage");
  sunucu("/exam-catalogs", { data: [KATALOG()] }, "get");
  sar();
  fireEvent.click(await screen.findByRole("button", { name: dugme }));
  await screen.findByLabelText("Deneme adı");
}

/* ══════════════ 1 · Mevcut davranış korunur ══════════════ */

describe("K-1 · yetki ve liste", () => {
  it("görüntüleme yetkisi yoksa ekran açılmaz", async () => {
    izinVer();
    sar();
    expect(
      await screen.findByRole("heading", { name: "Bu alan için yetkiniz yok" })
    ).toBeTruthy();
  });

  it("yönetim yetkisi YOKSA salt-okunur: 'Katalog' ekleme düğmesi çıkmaz", async () => {
    izinVer("catalogs.view");
    sunucu("/exam-catalogs", { data: [KATALOG()] }, "get");
    sar();
    expect(await screen.findByText("Türkiye Geneli YKS-1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ Katalog" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sil" })).toBeNull();
  });

  it("liste boşken boş durum metni çıkar", async () => {
    izinVer("catalogs.view", "catalogs.manage");
    sunucu("/exam-catalogs", { data: [] }, "get");
    sar();
    expect(await screen.findByText(/Henüz katalog eklenmedi/)).toBeTruthy();
  });

  it("silme ONAY penceresi açmadan istek göndermez", async () => {
    izinVer("catalogs.view", "catalogs.manage");
    sunucu("/exam-catalogs", { data: [KATALOG()] }, "get");
    sar();
    fireEvent.click(await screen.findByRole("button", { name: "Sil" }));
    expect(istekler.some((i) => i.method === "delete")).toBe(false);
    expect(
      await screen.findByRole("heading", { name: "Deneme kataloğunu sil" })
    ).toBeTruthy();
  });
});

/* ══════════════ 2 · Liste hatası (KIRMIZI) ══════════════ */

describe("K-2 · hata ≠ boş", () => {
  it("liste hatasında 'Yeniden dene' çıkar, boş durum metni ÇIKMAZ", async () => {
    izinVer("catalogs.view", "catalogs.manage");
    sunucu("/exam-catalogs", { status: 500, data: { detail: "patladi" } }, "get");
    sar();
    expect(await screen.findByRole("button", { name: /Yeniden dene/i })).toBeTruthy();
    expect(screen.queryByText(/Henüz katalog eklenmedi/)).toBeNull();
  });
});

/* ══════════════ 3 · Pencere sözleşmesi (KIRMIZI) ══════════════ */

describe("K-3 · editör ortak pencereden gelir", () => {
  it("editör role=dialog + aria-modal taşır", async () => {
    await editoruAc();
    const p = await screen.findByRole("dialog");
    expect(p.getAttribute("aria-modal")).toBe("true");
  });

  it("temiz formda ESC kapatır", async () => {
    await editoruAc();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("KİRLİ formda kapatma önce sorar", async () => {
    await editoruAc();
    fireEvent.change(within(pencere()).getByLabelText("Deneme adı"), {
      target: { value: "Yeni Ortak Deneme" },
    });
    await act(async () => {});
    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

/* ══════════════ 4 · Dal adları (KIRMIZI) ══════════════ */

describe("K-4 · her koşullu dal render edilir, her alanın adı vardır", () => {
  it("YENİ katalog dalı — onay kutuları dahil bütün alanlar adlı", async () => {
    await editoruAc();
    expect(within(pencere()).getByLabelText(/Public/)).toBeTruthy();
    expect(within(pencere()).getByLabelText(/Türkiye Geneli/)).toBeTruthy();
    adlarDogru(8);
  });

  it("DÜZENLEME dalı — değerler dolu gelir", async () => {
    await editoruAc("Düzenle");
    expect(
      (within(pencere()).getByLabelText("Deneme adı") as HTMLInputElement).value
    ).toBe("Türkiye Geneli YKS-1");
    expect(
      (within(pencere()).getByLabelText(/Soru sayısı/) as HTMLInputElement).value
    ).toBe("120");
    adlarDogru(8);
  });

  it("CEVAP ANAHTARI yüklü dalı — bağlantı ve 'Değiştir' birlikte çıkar", async () => {
    izinVer("catalogs.view", "catalogs.manage");
    sunucu(
      "/exam-catalogs",
      { data: [KATALOG({ answer_key_url: "https://ornek.test/anahtar.pdf" })] },
      "get"
    );
    sar();
    expect(await screen.findByRole("link", { name: /Cevap anahtarı/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Değiştir" })).toBeTruthy();
    adlarDogru(0);
  });
});

/* ══════════════ 5 · Gönder kapısı (KIRMIZI) ══════════════ */

describe("K-5 · gönder düğmesi ve doğrulama", () => {
  it("gönder düğmesi geçerlilik yüzünden KAPANMAZ", async () => {
    await editoruAc();
    expect(
      (within(pencere()).getByRole("button", { name: "Oluştur" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("ad boşken gönderim YAPILMAZ; hata ALANDA çıkar ve odak oraya gider", async () => {
    await editoruAc();
    fireEvent.click(within(pencere()).getByRole("button", { name: "Oluştur" }));

    const ad = within(pencere()).getByLabelText("Deneme adı");
    await waitFor(() => expect(ad.getAttribute("aria-invalid")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(ad));
    expect(istekler.some((i) => i.method === "post" && i.url === "/exam-catalogs")).toBe(
      false
    );
  });

  it("geçerli formda gövde sunucuya gider; boş sayılar null olur", async () => {
    await editoruAc();
    sunucu("/exam-catalogs", { data: KATALOG({ id: 42 }) }, "post");
    fireEvent.change(within(pencere()).getByLabelText("Deneme adı"), {
      target: { value: "Yeni Ortak Deneme" },
    });
    fireEvent.click(within(pencere()).getByRole("button", { name: "Oluştur" }));

    await waitFor(() => {
      const yazma = istekler.find((i) => i.method === "post" && i.url === "/exam-catalogs");
      expect(yazma).toBeTruthy();
      expect(yazma!.body!.exam_name).toBe("Yeni Ortak Deneme");
      // Boş sayısal alan 0 DEĞİL null gitmeli: 0 soruluk deneme diye bir şey yok.
      expect(yazma!.body!.question_count).toBeNull();
      expect(yazma!.body!.is_public).toBe(true);
    });
  });

  it("sunucu 422'si ALANIN altına yazılır", async () => {
    await editoruAc();
    sunucu(
      "/exam-catalogs",
      {
        status: 422,
        data: { detail: [{ loc: ["body", "exam_name"], msg: "Bu ad zaten kullanımda" }] },
      },
      "post"
    );
    fireEvent.change(within(pencere()).getByLabelText("Deneme adı"), {
      target: { value: "Yeni Ortak Deneme" },
    });
    fireEvent.click(within(pencere()).getByRole("button", { name: "Oluştur" }));

    expect(await within(pencere()).findByText("Bu ad zaten kullanımda")).toBeTruthy();
  });
});
