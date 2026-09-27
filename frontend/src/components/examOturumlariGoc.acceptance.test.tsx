/**
 * İP-A7d2 · Görev 3 — `ExamSessionsManager` göç matrisi.
 *
 * Bu ekran dalga 2'nin ilk hedefi ve dalga 1'in açık bıraktığı iki şeyi
 * birden taşıyor:
 *
 *   • Kalan üç etiketsiz overlay'den biri BURADA (`fixed inset-0`, `role`
 *     yok, `aria-modal` yok, odak tuzağı yok, ESC yok, kirli form uyarısı
 *     yok). A7d1 `Dialog`a `genislik` ekleyene kadar ortak pencereye
 *     geçemiyordu; önü artık açık.
 *   • Sayısal/tarih ağırlıklı tek gerçek form (ücret · süre · kontenjan ·
 *     `datetime-local`) — A6c'nin koyu tema `color-scheme` düzeltmesi ilk kez
 *     gerçek bir ekranda sınanıyor.
 *
 * Aşağıdaki testlerin bir kısmı YAZILDIĞI ANDA KIRMIZIDIR; hangileri olduğu
 * `docs/arsiv/ip-a/ip-a7d2-rapor.md` → Görev 3'te sayıyla yazılıdır. Kırmızı olmayanlar
 * mevcut davranışı sabitler: göç onları kırmamalıdır.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { ExamSessionsManager } from "@/components/ExamSessionsManager";
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

let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit | ((i: Istek) => Yanit) }[] = [];
let istekler: Istek[] = [];
let eskiAdapter: unknown;

function sunucu(
  desen: string | RegExp,
  yanit: Yanit | ((i: Istek) => Yanit),
  method?: string
) {
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
    const ham = rota
      ? typeof rota.yanit === "function"
        ? rota.yanit(istek)
        : rota.yanit
      : { data: [] };
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
  useToastStore.setState({ toasts: [] });
});

/* ══════════════ Fixture ══════════════ */

const LIBRARY_ID = 12;

/** `schemas/library_exam.py::ExamSessionOut` */
const OTURUM = (over: Record<string, unknown> = {}) => ({
  id: 501,
  library_id: LIBRARY_ID,
  catalog_id: null,
  catalog_name: null,
  is_nationwide: false,
  exam_type: "TYT",
  title: "Mart TYT Genel Denemesi",
  description: "Genel deneme",
  starts_at: "2026-03-15T07:00:00Z",
  duration_minutes: 180,
  capacity: 50,
  price: "150.00",
  status: "SCHEDULED",
  registered_count: 3,
  results_published: false,
  results_entered_count: 0,
  ...over,
});

/** `schemas/exam_catalog.py::CatalogOut` */
const KATALOG = {
  id: 9,
  exam_name: "Ulusal Deneme 3",
  exam_type: "AYT",
  publisher_name: "Yayin A",
  is_nationwide: true,
  duration_minutes: 160,
};

/** `schemas/library_exam.py::RosterEntry` */
const KATILIMCI = (over: Record<string, unknown> = {}) => ({
  registration_id: 900,
  client_id: 3,
  client_name: "Ayşe Yılmaz",
  status: "ATTENDED",
  result_net: null,
  result_rank: null,
  result_document_url: null,
  ...over,
});

function temelSunucu(oturumlar: unknown[] = [OTURUM()]) {
  sunucu("/exam-catalogs/usable", { data: [KATALOG] }, "get");
  sunucu("/exam-sessions/manage", { data: oturumlar }, "get");
}

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ExamSessionsManager libraryId={LIBRARY_ID} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Ekrandaki pencere paneli (onay penceresi açıkken bile DOM'dan okunur). */
function pencere(): HTMLElement {
  const p = document.querySelector('[role="dialog"]');
  if (!p) throw new Error("pencere yok");
  return p as HTMLElement;
}

async function editoruAc(ad = "+ Oturum") {
  temelSunucu();
  sar();
  fireEvent.click(await screen.findByRole("button", { name: ad }));
  await screen.findByLabelText("Başlık");
}

/**
 * Dal denetimi: adsız kontrol YOK **ve** dal gerçekten açıldı.
 * İkinci iddia bu testin kendi yalancı yeşil kapısıdır.
 */
function adlarDogru(enAz: number) {
  const kontroller = formKontrolleri(document.body);
  expect(
    kontroller.length,
    `dal acilmamis olabilir: beklenen >=${enAz}, bulunan ${kontroller.length}`
  ).toBeGreaterThanOrEqual(enAz);
  const adsiz = adsizKontroller(document.body);
  expect(
    adsiz,
    `erisilebilir adi olmayan kontrol(ler): ${adsiz.map((a) => a.html).join(" | ")}`
  ).toEqual([]);
}

/* ══════════════ 1 · Mevcut davranış (göç bunları KIRMAMALI) ══════════════ */

describe("S-1 · liste ve boş/hata ayrımı korunur", () => {
  it("oturum listesi başlık ve sayıları gösterir", async () => {
    temelSunucu();
    sar();
    expect(await screen.findByText("Mart TYT Genel Denemesi")).toBeTruthy();
    expect(screen.getByText(/3\/50 kayıt/)).toBeTruthy();
  });

  it("liste boşken 'kayıt yok' der; HATA metni ayrıdır", async () => {
    temelSunucu([]);
    sar();
    expect(await screen.findByTestId("oturum-bos")).toBeTruthy();
  });

  it("liste hatasında ErrorState + 'Yeniden dene' çıkar, boş metni ÇIKMAZ", async () => {
    sunucu("/exam-catalogs/usable", { data: [] }, "get");
    sunucu("/exam-sessions/manage", { status: 500, data: { detail: "patladi" } }, "get");
    sar();
    expect(await screen.findByTestId("oturum-hata")).toBeTruthy();
    expect(screen.queryByTestId("oturum-bos")).toBeNull();
    expect(screen.getByRole("button", { name: /Yeniden dene/i })).toBeTruthy();
  });

  it("oturum iptali ONAY penceresi açmadan istek göndermez", async () => {
    temelSunucu();
    sar();
    fireEvent.click(await screen.findByRole("button", { name: "İptal" }));
    expect(istekler.some((i) => i.method === "post" && i.url.includes("/cancel"))).toBe(
      false
    );
    expect(await screen.findByRole("heading", { name: "Oturumu iptal et" })).toBeTruthy();
  });
});

/* ══════════════ 2 · Pencere sözleşmesi (YAZILDIĞINDA KIRMIZI) ══════════════ */

describe("S-2 · editör ortak pencereden gelir", () => {
  it("editör role=dialog + aria-modal taşır (etiketsiz overlay DEĞİL)", async () => {
    await editoruAc();
    const p = await screen.findByRole("dialog");
    expect(p.getAttribute("aria-modal")).toBe("true");
  });

  it("temiz formda ESC editörü kapatır", async () => {
    await editoruAc();
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("KİRLİ formda kapatma önce sorar (veri kaybı koruması)", async () => {
    await editoruAc();
    fireEvent.change(within(pencere()).getByLabelText("Başlık"), {
      target: { value: "Nisan AYT Denemesi" },
    });
    // Bekçi asenkron doğrulama çözülünce kurulur (bkz. adminStoreDalAdlari D-6).
    await act(async () => {});
    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(
      document.querySelector('[role="dialog"]'),
      "onay sorulmadan editor kapandi"
    ).not.toBeNull();
  });
});

/* ══════════════ 3 · Dal adları (YAZILDIĞINDA KIRMIZI) ══════════════ */

describe("S-3 · her koşullu dal render edilir, her alanın adı vardır", () => {
  it("YENİ oturum dalı (katalogsuz) — adsız kontrol yok", async () => {
    await editoruAc();
    expect(within(pencere()).getByLabelText(/Deneme katalogu/)).toBeTruthy();
    expect(within(pencere()).getByLabelText("Kontenjan")).toBeTruthy();
    adlarDogru(8);
  });

  it("KATALOG seçili dalı — tür ve süre katalogdan ön-dolar", async () => {
    await editoruAc();
    // Katalog listesi AYRI bir sorgudan gelir; seçenek DOM'a düşmeden
    // yapılan `change` jsdom'da sessizce yutulur (değer "" kalır) ve test
    // yanlış sebeple kırmızı olurdu.
    await within(pencere()).findByRole("option", { name: /Ulusal Deneme 3/ });
    fireEvent.change(within(pencere()).getByLabelText(/Deneme katalogu/), {
      target: { value: String(KATALOG.id) },
    });
    await waitFor(() =>
      expect(
        (within(pencere()).getByLabelText("Sınav türü") as HTMLSelectElement).value
      ).toBe("AYT")
    );
    expect((within(pencere()).getByLabelText("Süre (dk)") as HTMLInputElement).value).toBe(
      "160"
    );
    adlarDogru(8);
  });

  it("DÜZENLEME dalı — mevcut değerler forma dolar", async () => {
    await editoruAc("Düzenle");
    expect((within(pencere()).getByLabelText("Başlık") as HTMLInputElement).value).toBe(
      "Mart TYT Genel Denemesi"
    );
    expect((within(pencere()).getByLabelText("Kontenjan") as HTMLInputElement).value).toBe(
      "50"
    );
    adlarDogru(8);
  });

  it("KATILIMCI paneli — 'Giriş ver' dalı ve sayaç adlı", async () => {
    temelSunucu();
    sunucu(/roster/, { data: [KATILIMCI({ status: "PAID" })] }, "get");
    sar();
    fireEvent.click(await screen.findByRole("button", { name: "Katılımcılar" }));
    expect(await screen.findByTestId("roster-sayaci")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Giriş ver" })).toBeTruthy();
    // İP-A7d5 · Görev 4: eskiden `adlarDogru(0)` yazıyordu ve HİÇBİR ŞEY
    // iddia etmiyordu — ölü kontrol. İkisi de boş küme üzerinde her koşulda
    // doğruydu: (1) "kontrol sayısı ≥ 0" totolojidir, (2) "adsız kontrol yok"
    // iddiası hiç kontrol render edilmediği için kendiliğinden geçiyordu.
    // ÖLÇÜLDÜ: bu dal GERÇEKTEN sıfır form kontrolü render ediyor. Kimlik
    // kontrolüne çevrildi — dala bir alan eklendiği gün kırılır ve alanın
    // adlandırılıp ölçüme girmesi gerektiğini söyler.
    expect(
      formKontrolleri(document.body).map((k) => k.tagName),
      "bu dalda form kontrolü BEKLENMİYOR"
    ).toEqual([]);
  });

  it("SONUÇ tablosu dalı — net ve sıra alanlarının adı vardır", async () => {
    temelSunucu();
    sunucu(/roster/, { data: [KATILIMCI()] }, "get");
    sar();
    fireEvent.click(await screen.findByRole("button", { name: "Sonuçlar" }));
    // Bu dal A7d2'ye kadar İKİ ADSIZ sayısal kontrol taşıyordu (nöbetçi
    // sayacında `ExamSessionsManager: 2`).
    expect(await screen.findByLabelText(/Ayşe Yılmaz.*net/i)).toBeTruthy();
    expect(screen.getByLabelText(/Ayşe Yılmaz.*sıra/i)).toBeTruthy();
    adlarDogru(2);
  });
});

/* ══════════════ 4 · Gönder kapısı ve doğrulama (KIRMIZI) ══════════════ */

describe("S-4 · gönder düğmesi ve doğrulama", () => {
  it("gönder düğmesi geçerlilik yüzünden KAPANMAZ", async () => {
    await editoruAc();
    const gonder = within(pencere()).getByRole("button", { name: "Ekle" });
    expect((gonder as HTMLButtonElement).disabled).toBe(false);
  });

  it("başlık boşken gönderim YAPILMAZ; hata ALANDA çıkar ve odak oraya gider", async () => {
    await editoruAc();
    fireEvent.click(within(pencere()).getByRole("button", { name: "Ekle" }));

    // Birden çok alan hatalı olabilir; iddia BAŞLIK alanının kendi hata
    // düğümü üzerinedir — "bir yerde bir alert var" iddiası zayıf olurdu.
    const baslik = await within(pencere()).findByLabelText("Başlık");
    const hataId = baslik.getAttribute("aria-describedby");
    expect(hataId).toBeTruthy();
    const hata = document.getElementById(hataId!.split(" ").pop()!);
    expect(hata?.getAttribute("role")).toBe("alert");
    expect(hata?.textContent).toBeTruthy();
    expect(baslik.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(baslik));
    expect(istekler.some((i) => i.method === "post" && i.url === "/exam-sessions")).toBe(
      false
    );
  });

  it("tarih boşken de gönderim YAPILMAZ ve hata TARİH alanında çıkar", async () => {
    await editoruAc();
    fireEvent.change(within(pencere()).getByLabelText("Başlık"), {
      target: { value: "Nisan Denemesi" },
    });
    fireEvent.click(within(pencere()).getByRole("button", { name: "Ekle" }));

    const tarih = await within(pencere()).findByLabelText("Tarih & saat");
    await waitFor(() => expect(tarih.getAttribute("aria-invalid")).toBe("true"));
    expect(istekler.some((i) => i.method === "post" && i.url === "/exam-sessions")).toBe(
      false
    );
  });

  it("geçerli formda gövde sunucuya gider ve tarih ISO'ya çevrilir", async () => {
    await editoruAc();
    sunucu("/exam-sessions", { data: OTURUM({ id: 777 }) }, "post");
    fireEvent.change(within(pencere()).getByLabelText("Başlık"), {
      target: { value: "Nisan Denemesi" },
    });
    fireEvent.change(within(pencere()).getByLabelText("Tarih & saat"), {
      target: { value: "2026-04-10T10:30" },
    });
    fireEvent.click(within(pencere()).getByRole("button", { name: "Ekle" }));

    await waitFor(() => {
      const yazma = istekler.find((i) => i.method === "post" && i.url === "/exam-sessions");
      expect(yazma).toBeTruthy();
      expect(yazma!.body!.title).toBe("Nisan Denemesi");
      expect(String(yazma!.body!.starts_at)).toContain("T");
      expect(yazma!.body!.capacity).toBe(50);
    });
  });

  it("sunucu 422'si ALANIN altına yazılır, şeride düşmez", async () => {
    await editoruAc();
    sunucu(
      "/exam-sessions",
      {
        status: 422,
        data: { detail: [{ loc: ["body", "capacity"], msg: "Kontenjan çok yüksek" }] },
      },
      "post"
    );
    fireEvent.change(within(pencere()).getByLabelText("Başlık"), {
      target: { value: "Nisan Denemesi" },
    });
    fireEvent.change(within(pencere()).getByLabelText("Tarih & saat"), {
      target: { value: "2026-04-10T10:30" },
    });
    fireEvent.click(within(pencere()).getByRole("button", { name: "Ekle" }));

    expect(await within(pencere()).findByText("Kontenjan çok yüksek")).toBeTruthy();
    expect(
      (within(pencere()).getByLabelText("Kontenjan") as HTMLInputElement).getAttribute(
        "aria-invalid"
      )
    ).toBe("true");
  });
});
