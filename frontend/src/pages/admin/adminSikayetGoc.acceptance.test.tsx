/**
 * İP-A7d3 · göç dalgası 3 · ekran (2): `AdminReportsPage`.
 *
 * Haritadaki yeri: bir pencere durumu (`decision`) + **SK-4 sınıfı bir
 * kusur**. Ekran kendi `Dialog`ını kuruyor, içinde 2000 karakterlik moderasyon
 * notu ve "yorumu yayından kaldır" kutusu taşıyor, kirli form bekçisini HİÇ
 * çağırmıyordu: ×/ESC/dış tıklama yazılan gerekçeyi sormadan siliyordu.
 *
 * Ekranın hiç kabul testi YOKTU — `adminOperations.acceptance` şikâyet
 * kuyruğuna hiç dokunmuyor. Bu yüzden dosyanın ilk bölümü göçün KIRMAMASI
 * gereken mevcut davranışı sabitler.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminReportsPage from "@/pages/admin/AdminReportsPage";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";
import { adsizKontroller } from "@/test-utils/alanAdlari";

import type { AxiosRequestConfig } from "axios";

const YOL = "/yonetim/sikayetler";

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}
type Yanit = { status?: number; data: unknown; headers?: Record<string, string> };

let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit }[] = [];
let istekler: Istek[] = [];
let eskiAdapter: unknown;

function sorgu(params: unknown): string {
  if (!params || typeof params !== "object") return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  const metin = usp.toString();
  return metin ? `?${metin}` : "";
}

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
      // `fetchAdminReportList` süzgeçleri axios `params` nesnesiyle geçiriyor;
      // ham `config.url` onları taşımaz. Sorgu burada birleştirilir, yoksa
      // "filtre gerçekten isteğe kondu mu" iddiası boşlukta geçerdi.
      url: String(config.url) + sorgu(config.params),
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

function izinVer(...izinler: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: izinler } as never,
  });
}

/** `schemas/reports.py::ReportOut` */
const SIKAYET = (over: Record<string, unknown> = {}) => ({
  id: 12,
  target_type: "REVIEW",
  target_id: 88,
  reason: "HARASSMENT",
  description: "Yorum hakaret içeriyor.",
  status: "OPEN",
  reporter_role: 3,
  reporter_id: 45,
  created_at: "2026-08-01T10:00:00Z",
  ...over,
});

/** Kuyruk yanıtı DİZİDİR; toplam `x-total-count` başlığından okunur. */
function liste(kayitlar: Record<string, unknown>[]) {
  sunucu(/^\/admin\/reports$/, {
    data: kayitlar,
    headers: { "x-total-count": String(kayitlar.length) },
  }, "get");
}

function sar(adres = YOL) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[adres]}>
        <Routes>
          <Route path={YOL} element={<AdminReportsPage />} />
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

async function kararAc(sikayet = SIKAYET(), dugme: "Çöz" | "Reddet" = "Çöz") {
  izinVer("reports.view", "reports.manage");
  liste([sikayet]);
  sar();
  fireEvent.click(await screen.findAllByRole("button", { name: dugme }).then((d) => d[0]));
  await screen.findByRole("dialog");
}

/* ═════════ Ş-1 · mevcut davranış korunur ═════════ */

describe("Ş-1 · kuyruk listesi ve yetki", () => {
  it("şikâyet satırı hedefi, nedeni ve durumu gösterir", async () => {
    izinVer("reports.view", "reports.manage");
    liste([SIKAYET()]);
    sar();
    expect(await screen.findAllByText("REVIEW #88")).not.toHaveLength(0);
    expect(screen.getAllByText("Taciz / hakaret")).not.toHaveLength(0);
  });

  it("yönetme izni YOKKEN aksiyon düğmesi çıkmaz, 'Salt okunur' yazar", async () => {
    izinVer("reports.view");
    liste([SIKAYET()]);
    sar();
    expect(await screen.findAllByText("Salt okunur")).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Çöz" })).toBeNull();
  });

  it("KARAR VERİLMİŞ şikâyette aksiyon çıkmaz", async () => {
    izinVer("reports.view", "reports.manage");
    liste([SIKAYET({ status: "RESOLVED" })]);
    sar();
    expect(await screen.findAllByText("Karar verildi")).not.toHaveLength(0);
  });

  it("liste hatası boş durumdan AYRI gösterilir", async () => {
    izinVer("reports.view");
    sunucu(/^\/admin\/reports$/, { status: 500, data: { detail: "patladi" } }, "get");
    sar();
    expect(await screen.findByRole("button", { name: /Yeniden dene/i })).toBeTruthy();
    expect(screen.queryByText("Bu kuyrukta şikâyet yok")).toBeNull();
  });

  it("durum filtresi GERÇEKTEN isteğe konur (adresten okunur)", async () => {
    izinVer("reports.view");
    liste([]);
    sar(`${YOL}?status=DISMISSED`);
    await waitFor(() => {
      const g = istekler.find((i) => i.url.includes("/admin/reports"));
      expect(g, "kuyruk isteği hiç gitmedi").toBeTruthy();
      expect(g!.url).toMatch(/status=DISMISSED/);
    });
  });
});

/* ═════════ Ş-2 · pencere ortak yüzeyden gelir (KIRMIZI) ═════════ */

describe("Ş-2 · karar penceresi ortak düzenleme yüzeyinde", () => {
  it("pencere role=dialog + aria-modal taşır", async () => {
    await kararAc();
    expect(pencere().getAttribute("aria-modal")).toBe("true");
  });

  it("TEMİZ formda ESC kapatır", async () => {
    await kararAc();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("KİRLİ formda kapatma ÖNCE SORAR (SK-4 sınıfı — moderasyon notu kaybolmamalı)", async () => {
    await kararAc();
    fireEvent.change(within(pencere()).getByLabelText(/Moderasyon notu/), {
      target: { value: "Yorum gerçekten hakaret içeriyor." },
    });
    await act(async () => {});

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

/* ═════════ Ş-3 · tüm koşullu dallar + alan adları (KIRMIZI) ═════════ */

describe("Ş-3 · her koşullu dal render edilir, her alanın adı vardır", () => {
  it("MODERE EDİLEBİLİR hedef (REVIEW) — not + gizleme kutusu, ikisi de adlı", async () => {
    await kararAc(SIKAYET({ target_type: "REVIEW" }));
    const p = pencere();
    expect(within(p).getByLabelText(/Moderasyon notu/)).toBeTruthy();
    expect(within(p).getByRole("checkbox", { name: /Yorumu yayından kaldır/ })).toBeTruthy();
    expect(adsizKontroller(p).map((a) => a.html)).toEqual([]);
  });

  it("MODERE EDİLEMEZ hedef (MESSAGE) — gizleme kutusu YOK, not yine adlı", async () => {
    await kararAc(SIKAYET({ target_type: "MESSAGE" }));
    const p = pencere();
    expect(within(p).queryByRole("checkbox")).toBeNull();
    expect(within(p).getByLabelText(/Moderasyon notu/)).toBeTruthy();
    expect(adsizKontroller(p).map((a) => a.html)).toEqual([]);
  });

  it("REDDET dalı — başlık ve düğme değişir, alanlar yine adlı", async () => {
    await kararAc(SIKAYET(), "Reddet");
    const p = pencere();
    expect(within(p).getByText("Şikâyeti reddet")).toBeTruthy();
    expect(within(p).getByLabelText(/Moderasyon notu/)).toBeTruthy();
    expect(adsizKontroller(p).map((a) => a.html)).toEqual([]);
  });

  it("ÇÖZ + modere edilebilir hedefte gizleme kutusu VARSAYILAN İŞARETLİ", async () => {
    // Korunan davranış: haklı bulunan bir yorum şikâyetinde yorumun yayında
    // kalması beklenmez.
    await kararAc(SIKAYET({ target_type: "REVIEW" }), "Çöz");
    const kutu = within(pencere()).getByRole("checkbox") as HTMLInputElement;
    expect(kutu.checked).toBe(true);
  });

  it("REDDET dalında gizleme kutusu varsayılan İŞARETSİZ", async () => {
    await kararAc(SIKAYET({ target_type: "REVIEW" }), "Reddet");
    const kutu = within(pencere()).getByRole("checkbox") as HTMLInputElement;
    expect(kutu.checked).toBe(false);
  });
});

/* ═════════ Ş-4 · gerçekten gönderilen gövde ═════════ */

describe("Ş-4 · karar gövdesi sunucuya doğru gider", () => {
  it("not ve gizleme bayrağı gövdeye konur", async () => {
    await kararAc(SIKAYET({ target_type: "REVIEW" }));
    sunucu("/admin/reports/12/resolve", { data: {} }, "post");
    fireEvent.change(within(pencere()).getByLabelText(/Moderasyon notu/), {
      target: { value: "  hakaret doğrulandı  " },
    });
    fireEvent.click(within(pencere()).getByRole("button", { name: "Kararı kaydet" }));

    await waitFor(() => {
      const yazma = istekler.find((i) => i.method === "post" && i.url.includes("/admin/reports/12/resolve"));
      expect(yazma, "karar isteği hiç gitmedi").toBeTruthy();
      expect(yazma!.body!.resolution).toBe("hakaret doğrulandı");
      expect(yazma!.body!.hide_target).toBe(true);
    });
  });

  it("MODERE EDİLEMEZ hedefte gizleme bayrağı gövdeye KONMAZ", async () => {
    await kararAc(SIKAYET({ target_type: "MESSAGE" }));
    sunucu("/admin/reports/12/resolve", { data: {} }, "post");
    fireEvent.click(within(pencere()).getByRole("button", { name: "Kararı kaydet" }));

    await waitFor(() => {
      const yazma = istekler.find((i) => i.method === "post" && i.url.includes("/admin/reports/12/resolve"));
      expect(yazma, "karar isteği hiç gitmedi").toBeTruthy();
      expect(yazma!.body!.hide_target).toBeFalsy();
    });
  });

  it("boş not gövdeye HİÇ konmaz (undefined)", async () => {
    await kararAc(SIKAYET({ target_type: "MESSAGE" }));
    sunucu("/admin/reports/12/resolve", { data: {} }, "post");
    fireEvent.click(within(pencere()).getByRole("button", { name: "Kararı kaydet" }));

    await waitFor(() => {
      const yazma = istekler.find((i) => i.method === "post" && i.url.includes("/admin/reports/12/resolve"));
      expect(yazma, "karar isteği hiç gitmedi").toBeTruthy();
      expect("resolution" in (yazma!.body ?? {})).toBe(false);
    });
  });

  it("başarıda pencere kapanır (koşulsuz kapatma — bekçiye sorulmaz)", async () => {
    await kararAc();
    sunucu("/admin/reports/12/resolve", { data: {} }, "post");
    fireEvent.change(within(pencere()).getByLabelText(/Moderasyon notu/), {
      target: { value: "karar" },
    });
    fireEvent.click(within(pencere()).getByRole("button", { name: "Kararı kaydet" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sunucunun 422'si NOT alanının altına yazılır", async () => {
    await kararAc();
    sunucu(
      "/admin/reports/12/resolve",
      {
        status: 422,
        data: { detail: [{ loc: ["body", "resolution"], msg: "Not çok kısa" }] },
      },
      "post"
    );
    fireEvent.click(within(pencere()).getByRole("button", { name: "Kararı kaydet" }));
    expect(await within(pencere()).findByText("Not çok kısa")).toBeTruthy();
  });

  it("alana düşmeyen sunucu hatası pencerede ŞERİTTE çıkar", async () => {
    await kararAc();
    sunucu("/admin/reports/12/resolve", { status: 500, data: { detail: "patladi" } }, "post");
    fireEvent.click(within(pencere()).getByRole("button", { name: "Kararı kaydet" }));
    expect(await within(pencere()).findByRole("alert")).toBeTruthy();
  });
});
