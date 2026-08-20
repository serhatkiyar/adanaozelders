/**
 * İP-A8 · Görev 3 + Görev 4 — `AdminLibraries` "Oturumlar & Operatörler"
 * penceresinin İLK kabul testi.
 *
 * ## Neden bu dosya var
 *
 * Bağımsız denetim #3 iki şeyi birlikte ölçtü ve ikisi de aynı yere işaret
 * ediyordu:
 *
 *   • **B-12** — dört "belirsiz" pencerenin ikisini (her ikisi de bu ekranda)
 *     HİÇBİR test açmıyordu: `grep -rn "Oturumlar & Operatörler" src
 *     --include=*.test.tsx` boş dönüyordu. Güvence sıfır katmandan geliyordu.
 *   • **B-1** — tam orada canlı bir kusur duruyordu: operatör hesabı formu
 *     (ad · soyad · e-posta · **şifre**) kirli form bekçisine hiç bağlı
 *     değildi; ESC dört alanı da sormadan siliyordu.
 *
 * Kapsam boşluğuyla kusurun yeri birebir çakışıyordu; tesadüf değil. Bu dosya
 * o boşluğu kapatır.
 *
 * ## Ne iddia ediyor
 *
 *   1. Pencere ortak yüzeyden geliyor (`role="dialog"` + `aria-modal`).
 *   2. Operatör formu KENDİ korumalı penceresinde yaşıyor ve kirliyken
 *      kapatma ÖNCE SORUYOR (B-1).
 *   3. İç içe pencerede tek ESC yalnız EN İÇTEKİNİ kapatıyor; dıştaki
 *      pencere ayakta kalıyor (B-3).
 *   4. Alanların hepsinin erişilebilir adı var ve doğrulama hatası TOAST'ta
 *      değil ALANDA görünüyor.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminLibraries from "@/pages/dashboards/AdminLibraries";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";
import { adsizKontroller } from "@/test-utils/alanAdlari";

import type { AxiosRequestConfig } from "axios";
import type { ReactElement } from "react";

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

const KUTUPHANE = {
  id: 4,
  slug: "merkez-etut",
  name: "Merkez Etüt",
  district: "Seyhan",
  status: "ACTIVE",
  rating_avg: 0,
  rating_count: 0,
  amenities: [],
};

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
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: ["libraries.view", "libraries.manage"] } as never,
  });
  sunucu(/\/libraries\/admin$/, { data: [KUTUPHANE] }, "get");
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  useToastStore.setState({ toasts: [] });
});

function sar(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

function pencereler(): HTMLElement[] {
  return [...document.querySelectorAll('[role="dialog"]')] as HTMLElement[];
}

/**
 * ── Bekleme DEĞİL, AKITMA (İP-A8 · Görev 5'in dersi) ──
 *
 * Bu dosyanın ilk yazımı `await screen.findByRole(...)` kullanıyordu ve tam
 * suite yükü altında **kırmızı düştü**: "Unable to find role=button
 * Oturumlar & Operatörler". Sebep davranış değil DUVAR SAATİ — `findBy*`in
 * 1000 ms'lik bütçesi, paralel yük altında ekranın ilk render'ı + sorgunun
 * çözülmesi için yetmiyordu. Bu, denetimin B-4'te gösterdiği sınıfın ta
 * kendisidir ve kendi yazdığım testte tekrarladım.
 *
 * Bütçe BÜYÜTÜLMEZ (paketin kuralı). Bekleyiş ortadan kaldırılır: sahte axios
 * adapter'ı anında çözülüyor, yani beklenen şey zaman değil KUYRUK. `act`
 * içinde birkaç makrogörev turu React'in ve react-query'nin kuyruklarını
 * boşaltır; sonrasındaki iddialar eşzamanlı `getBy*`tır ve hiçbir makinede
 * "yavaştı" diye düşemez.
 */
async function akit(tur = 3): Promise<void> {
  for (let i = 0; i < tur; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Yönetim penceresini açar ve içindeki paneli döndürür. */
async function yonetimPenceresiniAc(): Promise<HTMLElement> {
  sar(<AdminLibraries />);
  await akit();
  fireEvent.click(screen.getByRole("button", { name: "Oturumlar & Operatörler" }));
  await akit(1);
  return screen.getByRole("dialog");
}

/** Yönetim penceresi + içindeki operatör ekleme penceresi (iç içe iki pencere). */
async function operatorPenceresiniAc(): Promise<HTMLElement> {
  const dis = await yonetimPenceresiniAc();
  fireEvent.click(within(dis).getByRole("button", { name: "+ Operatör" }));
  await akit(1);
  expect(pencereler()).toHaveLength(2);
  return pencereler()[1];
}

describe("İP-A8 · AdminLibraries yönetim penceresi (ilk kabul testi)", () => {
  it("pencere ortak yüzeyden geliyor — etiketli, aria-modal, ESC kapatıyor", async () => {
    const p = await yonetimPenceresiniAc();
    expect(p.getAttribute("aria-modal")).toBe("true");
    expect(within(p).getByRole("heading", { name: "Merkez Etüt" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await akit(1);
    expect(pencereler()).toHaveLength(0);
  });

  it("yönetim penceresi düzenlenebilir kontrol TAŞIMAZ (B-1 düzeltmesinin şekli)", async () => {
    // Kusurun kaynağı buydu: dört alanlık operatör formu bu pencerenin
    // içinde, korumasız yaşıyordu. Düzeltme formu KENDİ penceresine çıkardı;
    // dış pencere artık kapatılınca kaybedilecek bir şey tutmuyor.
    const p = await yonetimPenceresiniAc();
    expect(within(p).queryAllByRole("textbox")).toEqual([]);
  });
});

describe("İP-A8 · B-1 — operatör formu artık KORUNUYOR", () => {
  it("alanların hepsinin erişilebilir adı var", async () => {
    const p = await operatorPenceresiniAc();
    expect(within(p).getByLabelText("Ad")).toBeTruthy();
    expect(within(p).getByLabelText("Soyad")).toBeTruthy();
    expect(within(p).getByLabelText("E-posta")).toBeTruthy();
    expect(within(p).getByLabelText("Şifre (en az 8 karakter)")).toBeTruthy();
    expect(adsizKontroller(p).map((a) => a.html)).toEqual([]);
  });

  it("KİRLİ formda ESC ÖNCE SORAR — dört alan sormadan silinmez", async () => {
    const p = await operatorPenceresiniAc();
    fireEvent.change(within(p).getByLabelText("Ad"), { target: { value: "Ayşe" } });
    fireEvent.change(within(p).getByLabelText("E-posta"), { target: { value: "a@b.co" } });
    await act(async () => {});

    fireEvent.keyDown(document, { key: "Escape" });
    await akit();

    expect(screen.getByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    // Yazılan hiçbir şey gitmedi: form hâlâ ayakta.
    expect(within(pencereler()[1]).getByLabelText<HTMLInputElement>("Ad").value).toBe("Ayşe");
  });

  it("TEMİZ formda ESC doğrudan kapatır (gereksiz soru sorulmaz)", async () => {
    await operatorPenceresiniAc();
    fireEvent.keyDown(document, { key: "Escape" });
    await akit(1);
    expect(pencereler()).toHaveLength(1);
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).toBeNull();
  });

  it("gönder düğmesi geçerlilikle KAPANMAZ; hata TOAST'ta değil ALANDA çıkar", async () => {
    const p = await operatorPenceresiniAc();
    const dugme = within(p).getByRole("button", { name: "Operatör Hesabı Oluştur" });
    expect((dugme as HTMLButtonElement).disabled, "gönder düğmesi geçerlilikle kapanmış").toBe(
      false
    );

    fireEvent.click(dugme);
    await akit();

    expect(screen.getByText("Ad gerekli.")).toBeTruthy();
    expect(istekler.filter((i) => i.method === "post")).toEqual([]);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("geçerli formda istek GERÇEKTEN gider ve pencere kapanır", async () => {
    sunucu(/\/libraries\/4\/operators$/, { data: { id: 9 } }, "post");
    const p = await operatorPenceresiniAc();
    fireEvent.change(within(p).getByLabelText("Ad"), { target: { value: "Ayşe" } });
    fireEvent.change(within(p).getByLabelText("Soyad"), { target: { value: "Yılmaz" } });
    fireEvent.change(within(p).getByLabelText("E-posta"), { target: { value: "a@b.co" } });
    fireEvent.change(within(p).getByLabelText("Şifre (en az 8 karakter)"), {
      target: { value: "sifre12345" },
    });
    await act(async () => {});

    fireEvent.click(within(p).getByRole("button", { name: "Operatör Hesabı Oluştur" }));
    await akit();

    const post = istekler.find((i) => i.method === "post" && i.url.includes("/operators"));
    expect(post?.body).toEqual({
      first_name: "Ayşe",
      last_name: "Yılmaz",
      email: "a@b.co",
      password: "sifre12345",
    });
    // Kaydedilen formda "çıkmak istiyor musun" SORULMAZ.
    expect(pencereler()).toHaveLength(1);
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).toBeNull();
  });
});

describe("İP-A8 · B-3 — iç içe ESC yalnız EN İÇTEKİ pencereyi kapatır", () => {
  it("tek ESC iki pencereyi birden kapatmaz", async () => {
    await operatorPenceresiniAc();
    expect(pencereler()).toHaveLength(2);

    fireEvent.keyDown(document, { key: "Escape" });
    await akit(1);

    // Eski davranış: 2 → 0 (dıştaki de kapanıyordu ve içteki KORUMALI formun
    // onayı hiç görünmeden sökülüyordu). Yeni davranış: 2 → 1.
    expect(pencereler()).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Merkez Etüt" })).toBeTruthy();
  });

  it("KORUMALI iç pencerede ESC dıştakine DOKUNMAZ ve onay görünür", async () => {
    const p = await operatorPenceresiniAc();
    fireEvent.change(within(p).getByLabelText("Ad"), { target: { value: "Ayşe" } });
    await act(async () => {});

    fireEvent.keyDown(document, { key: "Escape" });
    await akit();

    expect(screen.getByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    // Dıştaki yönetim penceresi ayakta. `getByRole` KULLANILMAZ: Medusa'nın
    // onay penceresi (Radix) arkasındaki ağacı `aria-hidden` yapar, yani rol
    // sorgusu dıştaki başlığı bulamaz — bu doğru erişilebilirlik davranışıdır
    // ve pencerenin SÖKÜLDÜĞÜ anlamına gelmez. Ayakta olup olmadığı DOM'dan
    // okunur.
    const disPanel = pencereler()[0];
    expect(disPanel.textContent).toContain("Merkez Etüt");
  });

  it("art arda iki ESC yığını sırayla boşaltır (dıştan dışa değil, içten dışa)", async () => {
    await operatorPenceresiniAc();

    fireEvent.keyDown(document, { key: "Escape" });
    await akit(1);
    expect(pencereler()).toHaveLength(1);

    fireEvent.keyDown(document, { key: "Escape" });
    await akit(1);
    expect(pencereler()).toHaveLength(0);
  });
});
