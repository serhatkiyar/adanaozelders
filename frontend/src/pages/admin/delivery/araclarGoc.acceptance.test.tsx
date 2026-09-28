/**
 * İP-A7d2 · Görev 3 — `DeliveryVehiclesPage` göç matrisi.
 *
 * ## Bu ekran dalgaya neden alındı
 *
 * Alanları zaten adlıydı (yerel `Field` sarmalayıcısı) — yani A7d1 onu "Form.*'ın
 * çözdüğü sorunu taşımıyor" diye elemişti. Doğru ama eksik bir okumaydı:
 * `Form.*` yalnız etiketleme değil, **hatanın nereye yazıldığını** da belirler.
 * Bu ekranda on üç alanın doğrulaması tek bir `formValid()` fonksiyonundan
 * dönen tek bir cümleydi ve `toast.error` ile ekranın köşesine düşüyordu:
 * "Koordinat aralık dışı — enlem ±90, boylam ±180 olmalı." Hangi alan?
 *
 * Ayrıca ekran sayısal ağırlıklıdır (durak tavanı · sabit maliyet · sıra ·
 * enlem · boylam + iki `time` alanı) — A6c'nin koyu tema `color-scheme`
 * düzeltmesinin ikinci gerçek sınavı.
 *
 * Üçüncüsü: satır aksiyonları burada da `opacity-0 … group-hover` ile
 * gizliydi (dokunmatikte erişilemez).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import DeliveryVehiclesPage from "@/pages/admin/delivery/DeliveryVehiclesPage";
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

const ARAC = (over: Record<string, unknown> = {}) => ({
  id: 3,
  code: "DOBLO",
  label: "Doblo",
  plate: "01 ABC 123",
  max_stops: 40,
  shift_start: "09:00:00",
  shift_end: "18:00:00",
  fixed_cost: 250,
  sort_order: 0,
  is_active: true,
  ...over,
});

const NOKTA = (over: Record<string, unknown> = {}) => ({
  id: 11,
  name: "Depo — Seyhan",
  kind: "BASE",
  address: "Cadde 1",
  lat: 36.9855,
  lng: 35.3253,
  sort_order: 0,
  is_active: true,
  ...over,
});

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DeliveryVehiclesPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function adlarDogru(enAz: number) {
  const kontroller = formKontrolleri(document.body);
  expect(
    kontroller.length,
    `dal acilmamis olabilir: beklenen >=${enAz}, bulunan ${kontroller.length}`
  ).toBeGreaterThanOrEqual(enAz);
  expect(adsizKontroller(document.body).map((a) => a.html)).toEqual([]);
}

async function ekraniAc(araclar = [ARAC()], noktalar = [NOKTA()]) {
  izinVer("delivery.view", "delivery.manage");
  sunucu("/delivery/vehicles", { data: araclar }, "get");
  sunucu("/delivery/pickup-points", { data: noktalar }, "get");
  sar();
  await screen.findByRole("button", { name: "Araç ekle" });
}

/* ══════════════ 1 · Mevcut davranış korunur ══════════════ */

describe("AR-1 · liste ve yetki", () => {
  it("araç satırı etiketi, kodu ve özetini gösterir", async () => {
    await ekraniAc();
    expect(await screen.findByText("Doblo")).toBeTruthy();
    expect(screen.getByText("DOBLO")).toBeTruthy();
    expect(screen.getByText(/40 durak/)).toBeTruthy();
  });

  it("yönetim yetkisi YOKSA düzenleme yüzeyi açılmaz", async () => {
    izinVer("delivery.view");
    sunucu("/delivery/vehicles", { data: [ARAC()] }, "get");
    sunucu("/delivery/pickup-points", { data: [NOKTA()] }, "get");
    sar();
    await screen.findByText("Doblo");
    expect(screen.queryByRole("button", { name: "Araç ekle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Düzenle" })).toBeNull();
  });

  it("filo boşken davet metni çıkar", async () => {
    await ekraniAc([], []);
    expect(await screen.findByText(/Filoda araç yok/)).toBeTruthy();
    expect(screen.getByText(/Tanımlı başlangıç noktası yok/)).toBeTruthy();
  });

  it("listeler yüklenemezse boş durum değil hata + 'Yeniden dene' çıkar", async () => {
    izinVer("delivery.view", "delivery.manage");
    sunucu("/delivery/vehicles", { status: 500, data: { detail: "boom" } }, "get");
    sunucu("/delivery/pickup-points", { status: 500, data: { detail: "boom" } }, "get");
    sar();
    expect(await screen.findByText("Araçlar yüklenemedi.")).toBeTruthy();
    expect(await screen.findByText("Başlangıç noktaları yüklenemedi.")).toBeTruthy();
    expect(screen.queryByText(/Filoda araç yok/)).toBeNull();
    expect(screen.queryByText(/Tanımlı başlangıç noktası yok/)).toBeNull();

    sunucu("/delivery/vehicles", { data: [ARAC()] }, "get");
    fireEvent.click(screen.getAllByRole("button", { name: "Yeniden dene" })[0]);
    expect(await screen.findByText("Doblo")).toBeTruthy();
  });

  it("silme ONAY penceresi açmadan istek göndermez", async () => {
    await ekraniAc();
    fireEvent.click(await screen.findByRole("button", { name: "Sil" }));
    expect(istekler.some((i) => i.method === "delete")).toBe(false);
    expect(await screen.findByRole("heading", { name: "Aracı sil" })).toBeTruthy();
  });
});

/* ══════════════ 2 · Dokunmatik erişim (KIRMIZI) ══════════════ */

describe("AR-2 · satır aksiyonları HOVER'a bağlı değildir", () => {
  it("araç satırının aksiyon şeridi opacity-0 ile gizlenmez", async () => {
    await ekraniAc();
    const dugme = await screen.findByRole("button", { name: "Düzenle" });
    const serit = dugme.parentElement!;
    expect(serit.className).not.toMatch(/opacity-0/);
    expect(serit.className).not.toMatch(/group-hover/);
  });
});

/* ══════════════ 3 · Dal adları (KIRMIZI kısmen) ══════════════ */

describe("AR-3 · her koşullu dal render edilir, her alanın adı vardır", () => {
  it("ARAÇ EKLEME dalı — 'Kod' alanı VARDIR ve sekiz alan adlı", async () => {
    await ekraniAc([]);
    fireEvent.click(screen.getByRole("button", { name: "Araç ekle" }));
    expect(await screen.findByLabelText(/^Kod/)).toBeTruthy();
    expect(screen.getByLabelText(/Durak tavanı/)).toBeTruthy();
    expect(screen.getByLabelText(/Sabit maliyet/)).toBeTruthy();
    adlarDogru(8);
  });

  it("ARAÇ DÜZENLEME dalı — 'Kod' alanı YOKTUR (değişmez)", async () => {
    await ekraniAc();
    fireEvent.click(await screen.findByRole("button", { name: "Düzenle" }));
    expect(await screen.findByLabelText(/Araç adı/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Kod/)).toBeNull();
    adlarDogru(7);
  });

  it("NOKTA EKLEME dalı — beş alan adlı", async () => {
    await ekraniAc([], []);
    fireEvent.click(screen.getByRole("button", { name: "Nokta ekle" }));
    expect(await screen.findByLabelText(/Nokta adı/)).toBeTruthy();
    expect(screen.getByLabelText(/Enlem/)).toBeTruthy();
    expect(screen.getByLabelText(/Boylam/)).toBeTruthy();
    adlarDogru(5);
  });

  it("NOKTA DÜZENLEME dalı — mevcut koordinatlar dolu gelir", async () => {
    await ekraniAc();
    // Nokta satırı AYRI bir sorgudan gelir; "Düzenle" düğmelerinden ikincisi
    // ancak o satır DOM'a düştükten sonra vardır.
    await screen.findByText("Depo — Seyhan");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Düzenle" })).toHaveLength(2)
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Düzenle" })[1]);
    expect((await screen.findByLabelText(/Enlem/) as HTMLInputElement).value).toBe("36.9855");
    adlarDogru(5);
  });
});

/* ══════════════ 4 · Doğrulama ALANDA (KIRMIZI) ══════════════ */

describe("AR-4 · doğrulama alanda, gönder düğmesi kapanmaz", () => {
  it("etiketsiz araçta gönderim YAPILMAZ; hata ETİKET alanında; düğme AÇIK", async () => {
    await ekraniAc([]);
    fireEvent.click(screen.getByRole("button", { name: "Araç ekle" }));
    const ad = await screen.findByLabelText(/Araç adı/);

    const ekle = screen.getByRole("button", { name: "Ekle" });
    expect((ekle as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(ekle);

    await waitFor(() => expect(ad.getAttribute("aria-invalid")).toBe("true"));
    // Odak da ilk hatalı alana taşınmalı. Bu iddia GERÇEK TARAYICI TURUNDA
    // eklendi: `aria-invalid` doğruydu ama odak `<body>`de kalıyordu, çünkü
    // "ilk hatalı alanı bul" yardımcısı hataları `form.formState.errors`ten
    // okuyordu — gönderim anında o anlık görüntü henüz boş.
    await waitFor(() => expect(document.activeElement).toBe(ad));
    expect(istekler.some((i) => i.method === "post" && i.url === "/delivery/vehicles")).toBe(
      false
    );
  });

  it("geçersiz KOD hatası kod alanında çıkar, etiket alanında değil", async () => {
    await ekraniAc([]);
    fireEvent.click(screen.getByRole("button", { name: "Araç ekle" }));
    fireEvent.change(await screen.findByLabelText(/Araç adı/), {
      target: { value: "Yeni Araç" },
    });
    const kod = screen.getByLabelText(/^Kod/);
    fireEvent.change(kod, { target: { value: "kü.çük" } });
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));

    await waitFor(() => expect(kod.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByLabelText(/Araç adı/).getAttribute("aria-invalid")).not.toBe("true");
  });

  it("aralık dışı ENLEM hatası ENLEM alanında çıkar (tek toast değil)", async () => {
    await ekraniAc([], []);
    fireEvent.click(screen.getByRole("button", { name: "Nokta ekle" }));
    fireEvent.change(await screen.findByLabelText(/Nokta adı/), {
      target: { value: "Depo" },
    });
    const enlem = screen.getByLabelText(/Enlem/);
    fireEvent.change(enlem, { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText(/Boylam/), { target: { value: "35.3" } });
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));

    await waitFor(() => expect(enlem.getAttribute("aria-invalid")).toBe("true"));
    expect(
      istekler.some((i) => i.method === "post" && i.url === "/delivery/pickup-points")
    ).toBe(false);
  });

  it("geçerli araç gövdesi sunucuya gider; boş durak tavanı null olur", async () => {
    await ekraniAc([]);
    sunucu("/delivery/vehicles", { data: ARAC({ id: 9 }) }, "post");
    fireEvent.click(screen.getByRole("button", { name: "Araç ekle" }));
    fireEvent.change(await screen.findByLabelText(/Araç adı/), {
      target: { value: "Yeni Araç" },
    });
    fireEvent.change(screen.getByLabelText(/^Kod/), { target: { value: "YENI" } });
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));

    await waitFor(() => {
      const yazma = istekler.find(
        (i) => i.method === "post" && i.url === "/delivery/vehicles"
      );
      expect(yazma).toBeTruthy();
      expect(yazma!.body!.code).toBe("YENI");
      expect(yazma!.body!.label).toBe("Yeni Araç");
      // Boş bırakılan durak tavanı 0 DEĞİL null: "sınırsız" demek.
      expect(yazma!.body!.max_stops).toBeNull();
      expect(yazma!.body!.fixed_cost).toBe(0);
    });
  });

  it("geçerli nokta gövdesi sayı olarak gider (string değil)", async () => {
    await ekraniAc([], []);
    sunucu("/delivery/pickup-points", { data: NOKTA({ id: 12 }) }, "post");
    fireEvent.click(screen.getByRole("button", { name: "Nokta ekle" }));
    fireEvent.change(await screen.findByLabelText(/Nokta adı/), {
      target: { value: "Depo" },
    });
    fireEvent.change(screen.getByLabelText(/Enlem/), { target: { value: "36.98550" } });
    fireEvent.change(screen.getByLabelText(/Boylam/), { target: { value: "35.32530" } });
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));

    await waitFor(() => {
      const yazma = istekler.find(
        (i) => i.method === "post" && i.url === "/delivery/pickup-points"
      );
      expect(yazma).toBeTruthy();
      expect(yazma!.body!.lat).toBe(36.9855);
      expect(yazma!.body!.kind).toBe("BASE");
    });
  });
});
