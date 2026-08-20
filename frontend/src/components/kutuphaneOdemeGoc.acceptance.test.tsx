/**
 * İP-A7d3 · göç dalgası 3 · ekran (1): `LibraryPayoutForm`.
 *
 * Ekranın haritadaki yeri: **beş adsız kontrol** — tabanın en büyük ikinci
 * kalemi ve `CALISMA_ZAMANI_ADSIZ` listesinde isimle yazılı gerçek borç.
 * Beşi de `placeholder`ı etiket yerine kullanıyordu; doğrulama `toast.error`
 * ile veriliyor, kullanıcı HANGİ alanın yanlış olduğunu formdan okuyamıyordu.
 *
 * Bir PARA + PII yüzeyi (IBAN, TCKN): kirli form koruması burada konfor değil.
 * Bileşen hem satır içi (`Balance`, `Settings`) hem pencere içinde
 * (`AdminLibraries`) yaşadığı için `pencereSiz` beyanı koşulsuzdur.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { LibraryPayoutForm } from "@/components/LibraryPayoutForm";
import { useToastStore } from "@/store/toastStore";
import { adsizKontroller, formKontrolleri } from "@/test-utils/alanAdlari";

import type { AxiosRequestConfig } from "axios";

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
    const ham = rota ? rota.yanit : { data: {} };
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

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LibraryPayoutForm libraryId={7} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const GONDER = /payout/;

function alan(ad: RegExp | string): HTMLInputElement {
  return screen.getByLabelText(ad) as HTMLInputElement;
}

function gecerliDoldur() {
  fireEvent.change(alan(/Sorumlu kişi adı/), { target: { value: "Ayşe Yılmaz" } });
  fireEvent.change(alan(/E-posta/), { target: { value: "ayse@ornek.com" } });
  fireEvent.change(alan(/^IBAN/), { target: { value: "TR12 0006 2000 0000 0000 0000 01" } });
  fireEvent.change(alan(/Sorumlu TCKN/), { target: { value: "12345678901" } });
}

/* ═════════ Ö-1 · her alanın erişilebilir adı var (koşullu dallar dahil) ═════════ */

describe("Ö-1 · beş alanın beşi de adlı", () => {
  it("varsayılan dalda hiçbir kontrol adsız değil", async () => {
    sunucu("/payout", { data: { payout_status: "NONE", iban_masked: null } }, "get");
    const { container } = sar();
    await screen.findByLabelText(/^IBAN/);

    expect(formKontrolleri(container).length).toBe(5);
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("MASKELİ IBAN dalı (kayıt var) render edilir ve alanlar yine adlı", async () => {
    // Koşullu dal: `payout.iban_masked` doluysa ekstra bir satır basılır.
    sunucu(
      "/payout",
      { data: { payout_status: "ACTIVE", iban_masked: "TR12 **** 0001" } },
      "get"
    );
    const { container } = sar();
    expect(await screen.findByText("TR12 **** 0001")).toBeTruthy();
    expect(screen.getByText("Doğrulandı ✓")).toBeTruthy();
    expect(adsizKontroller(container).map((a) => a.html)).toEqual([]);
  });

  it("REDDEDİLDİ dalı rozetiyle görünür", async () => {
    sunucu("/payout", { data: { payout_status: "REJECTED", iban_masked: null } }, "get");
    sar();
    expect(await screen.findByText("Reddedildi")).toBeTruthy();
  });

  it("DOĞRULAMA BEKLENİYOR dalı rozetiyle görünür", async () => {
    sunucu("/payout", { data: { payout_status: "PENDING", iban_masked: null } }, "get");
    sar();
    expect(await screen.findByText("Doğrulama bekleniyor")).toBeTruthy();
  });
});

/* ═════════ Ö-2 · gönder kapısı: hata ALANDA, düğme AÇIK ═════════ */

describe("Ö-2 · doğrulama hatası alanda çıkar, düğme kapanmaz", () => {
  it("boş formda düğme AÇIK kalır, istek GİTMEZ, odak ilk hatalı alana gider", async () => {
    sunucu("/payout", { data: { payout_status: "NONE" } }, "get");
    sar();
    const gonder = await screen.findByRole("button", { name: /Kaydet & Doğrula/ });
    expect((gonder as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(gonder);

    const ad = alan(/Sorumlu kişi adı/);
    await waitFor(() => expect(ad.getAttribute("aria-invalid")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(ad));
    expect(istekler.some((i) => i.method === "post" && GONDER.test(i.url))).toBe(false);
  });

  it("hatalı IBAN mesajı IBAN alanının altında çıkar (toast DEĞİL)", async () => {
    sunucu("/payout", { data: { payout_status: "NONE" } }, "get");
    sar();
    await screen.findByLabelText(/^IBAN/);
    gecerliDoldur();
    fireEvent.change(alan(/^IBAN/), { target: { value: "TR123" } });
    fireEvent.click(screen.getByRole("button", { name: /Kaydet & Doğrula/ }));

    const mesaj = await screen.findByText(/26 karakterli bir IBAN/);
    const iban = alan(/^IBAN/);
    // Mesajın İBAN alanına BAĞLI olduğu kanıtlanır: "bir yerde bir hata var"
    // zayıf bir iddiadır (A7d2'nin yazdığı ders).
    expect(iban.getAttribute("aria-describedby") ?? "").toContain(mesaj.id);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("hatalı TCKN mesajı TCKN alanının altında çıkar", async () => {
    sunucu("/payout", { data: { payout_status: "NONE" } }, "get");
    sar();
    await screen.findByLabelText(/^IBAN/);
    gecerliDoldur();
    fireEvent.change(alan(/Sorumlu TCKN/), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: /Kaydet & Doğrula/ }));

    const mesaj = await screen.findByText("TCKN 11 haneli olmalı.");
    expect(alan(/Sorumlu TCKN/).getAttribute("aria-describedby") ?? "").toContain(mesaj.id);
  });

  it("TCKN alanı rakam DIŞI karakteri kabul etmez (korunan davranış)", async () => {
    sunucu("/payout", { data: { payout_status: "NONE" } }, "get");
    sar();
    await screen.findByLabelText(/^IBAN/);
    fireEvent.change(alan(/Sorumlu TCKN/), { target: { value: "12a34b" } });
    await act(async () => {});
    expect(alan(/Sorumlu TCKN/).value).toBe("1234");
  });
});

/* ═════════ Ö-3 · gerçekten gönderilen gövde ═════════ */

describe("Ö-3 · geçerli form sunucuya normalize gövde gönderir", () => {
  it("IBAN boşlukları kırpılır, büyük harfe çevrilir; boş telefon null gider", async () => {
    sunucu("/payout", { data: { payout_status: "NONE" } }, "get");
    sunucu("/payout", { data: { payout_status: "PENDING" } }, "post");
    sar();
    await screen.findByLabelText(/^IBAN/);
    gecerliDoldur();
    fireEvent.change(alan(/^IBAN/), { target: { value: "tr12 0006 2000 0000 0000 0000 01" } });
    fireEvent.click(screen.getByRole("button", { name: /Kaydet & Doğrula/ }));

    await waitFor(() => {
      const yazma = istekler.find((i) => i.method === "post" && GONDER.test(i.url));
      expect(yazma, "gönderim hiç yapılmadı").toBeTruthy();
      expect(yazma!.body).toEqual({
        iban: "TR120006200000000000000001",
        tckn: "12345678901",
        gsm: null,
        contact_name: "Ayşe Yılmaz",
        contact_email: "ayse@ornek.com",
      });
    });
  });

  it("sunucunun 422'si ALANIN altına yazılır", async () => {
    sunucu("/payout", { data: { payout_status: "NONE" } }, "get");
    sunucu(
      "/payout",
      { status: 422, data: { detail: [{ loc: ["body", "iban"], msg: "IBAN sahibi eşleşmedi" }] } },
      "post"
    );
    sar();
    await screen.findByLabelText(/^IBAN/);
    gecerliDoldur();
    fireEvent.click(screen.getByRole("button", { name: /Kaydet & Doğrula/ }));

    const mesaj = await screen.findByText("IBAN sahibi eşleşmedi");
    expect(alan(/^IBAN/).getAttribute("aria-describedby") ?? "").toContain(mesaj.id);
  });

  it("alana düşmeyen sunucu hatası ŞERİTTE çıkar (kaybolmaz)", async () => {
    sunucu("/payout", { data: { payout_status: "NONE" } }, "get");
    sunucu("/payout", { status: 500, data: { detail: "sağlayıcı yanıt vermedi" } }, "post");
    sar();
    await screen.findByLabelText(/^IBAN/);
    gecerliDoldur();
    fireEvent.click(screen.getByRole("button", { name: /Kaydet & Doğrula/ }));

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

/* ═════════ Ö-4 · kirli form koruması GERÇEKTEN kurulu ═════════ */

describe("Ö-4 · satır içi formda kirli form bekçisi kurulur", () => {
  it("kirliyken sekme kapatma olayı İPTAL edilir; temizken edilmez", async () => {
    // Satır içi formda pencere yok; bekçinin kurulduğunun gözlemlenebilir
    // kanıtı `beforeunload`un iptal edilmesidir. Çift yönlü ölçülür — tek yön
    // "olay her hâlde iptal ediliyor" yalancı yeşilini kapatmaz.
    sunucu("/payout", { data: { payout_status: "NONE" } }, "get");
    sar();
    await screen.findByLabelText(/^IBAN/);

    const temiz = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(temiz);
    expect(temiz.defaultPrevented).toBe(false);

    fireEvent.change(alan(/Sorumlu kişi adı/), { target: { value: "Ayşe" } });
    await act(async () => {});

    const kirli = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(kirli);
    expect(kirli.defaultPrevented).toBe(true);
  });
});
