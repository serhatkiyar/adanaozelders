/**
 * İP-A7d1 · Ekran (b) — `AdminBookingsPage` kabul matrisi.
 *
 * Göç dalgası 1'in "çoklu filtre" ekranı: üç bağımsız filtre (serbest metin +
 * iki ayrık seçim), sunucu tarafı sıralama (iki anahtar TEK olayda yazılır) ve
 * sayfalama. `useUrlDurumu` sözleşmesini bugüne dek hiçbir ekran bu kadar
 * yönden zorlamadı — pilot (`DamageEventsPage`) tek filtreliydi.
 *
 * Dosya İKİ bölümdür: (1) göçün KIRMAMASI gereken mevcut davranış,
 * (2) göçün getirdiği ve yazıldığı anda KIRMIZI olan davranış.
 *
 * Gerçek DOM + gerçek axios örneği: filtrenin isteğe gerçekten gittiğinin tek
 * kanıtı gönderilen istektir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminBookingsPage from "@/pages/admin/AdminBookingsPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

let istekler: Istek[] = [];
let eskiAdapter: unknown;
let kayitlar: Record<string, unknown>[] = [];
let hataVer = false;

const REZ = {
  id: 7,
  tutor_id: 2,
  client_id: 3,
  tutor_name: "Ayşe Yılmaz",
  client_name: "Mert Demir",
  start_at: "2027-03-03T11:00:00+00:00",
  end_at: "2027-03-03T12:00:00+00:00",
  price: 400,
  status: "PENDING",
  is_disputed: false,
  admin_notes: null,
  cancel_reason: null,
  created_at: "2027-03-01T09:00:00+00:00",
};

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  kayitlar = [REZ];
  hataVer = false;
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const sorgu = new URLSearchParams(
      Object.entries((config.params ?? {}) as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => [k, String(v)] as [string, string])
    ).toString();
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url) + (sorgu ? `?${sorgu}` : ""),
      body: config.data ? JSON.parse(String(config.data)) : null,
    };
    istekler.push(istek);
    if (istek.method !== "get") {
      return { data: {}, status: 200, statusText: "OK", headers: {}, config } as never;
    }
    if (hataVer) {
      const hata = new Error("500") as Error & { isAxiosError: boolean; response: unknown };
      hata.isAxiosError = true;
      hata.response = { status: 500, data: {}, headers: {}, config };
      throw hata;
    }
    // Filtreler GERÇEKTEN uygulanmış gibi davranır.
    const q = new URLSearchParams(istek.url.split("?")[1] ?? "");
    let liste = kayitlar;
    const durum = q.get("status");
    if (durum) liste = liste.filter((k) => k.status === durum);
    const ihtilaf = q.get("is_disputed");
    if (ihtilaf) liste = liste.filter((k) => String(k.is_disputed) === ihtilaf);
    const ara = q.get("q");
    if (ara) liste = liste.filter((k) => String(k.tutor_name).toLowerCase().includes(ara.toLowerCase()));
    const boyut = Number(q.get("limit") ?? 25);
    const kayma = Number(q.get("offset") ?? 0);
    // Uç DÜZ dizi + `x-total-count` başlığı döner (`api/admin.ts`).
    return {
      data: liste.slice(kayma, kayma + boyut),
      status: 200,
      statusText: "OK",
      headers: { "x-total-count": String(liste.length) },
      config,
    } as never;
  };
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: ["bookings.manage"] } as never,
  });
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

function Konum() {
  const konum = useLocation();
  return <span data-testid="adres">{konum.search}</span>;
}

function sar(yol = ROUTES.adminBookings) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Konum />
        <Routes>
          <Route path={ROUTES.adminBookings} element={<AdminBookingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const adres = () => screen.getByTestId("adres").textContent ?? "";
const sonListe = () => [...istekler].reverse().find((i) => i.method === "get");
const masaustu = (kap: HTMLElement) => kap.querySelector<HTMLElement>("table")!;
const mobil = (kap: HTMLElement) => kap.querySelector<HTMLElement>("[data-mobil-satirlar]")!;

/* ══════════════ 1. Mevcut davranış — göç bunları KIRMAZ ══════════════ */

describe("İP-A7d1 (b) · mevcut davranış korunur", () => {
  it("liste yüklenir; taraflar ve tutar görünür", async () => {
    const { container } = sar();
    await screen.findAllByText(/Ayşe Yılmaz/);
    expect(within(masaustu(container)).getByText(/400/)).toBeTruthy();
  });

  it("durum filtresi ANINDA adrese ve isteğe gider", async () => {
    sar();
    await screen.findAllByText(/Ayşe Yılmaz/);

    fireEvent.change(screen.getByLabelText("Rezervasyon durumu"), {
      target: { value: "COMPLETED" },
    });

    await waitFor(() => expect(adres()).toContain("status=COMPLETED"));
    await waitFor(() =>
      expect(sonListe()!.url, "filtre isteğe gitmedi").toContain("status=COMPLETED")
    );
  });

  it("arama kutusu yalnız SUBMIT ile adrese yazılır", async () => {
    sar();
    await screen.findAllByText(/Ayşe Yılmaz/);

    fireEvent.change(screen.getByLabelText("Rezervasyon ara"), {
      target: { value: "ayşe" },
    });
    expect(adres()).not.toContain("q=");

    fireEvent.click(screen.getByRole("button", { name: "Ara" }));
    await waitFor(() => expect(adres()).toContain("q=ay"));
  });

  it("iptal aksiyonu gerekçe ister ve gerekçeyi sunucuya gönderir", async () => {
    const { container } = sar();
    await screen.findAllByText(/Ayşe Yılmaz/);

    fireEvent.click(within(masaustu(container)).getByRole("button", { name: "İptal / iade" }));
    const pencere = await screen.findByRole("dialog");
    fireEvent.change(within(pencere).getByRole("textbox"), {
      target: { value: "Öğrenci vazgeçti" },
    });
    fireEvent.click(within(pencere).getByRole("button", { name: "İptal et" }));

    await waitFor(() => {
      const yazim = istekler.find((i) => i.method !== "get");
      expect(yazim?.body?.reason).toBe("Öğrenci vazgeçti");
    });
  });

  it("yetkisiz admin için satır aksiyonu yerine 'Salt okunur' yazar", async () => {
    useAuthStore.setState({
      token: "t",
      isAuthenticated: true,
      user: { id: 1, role_id: 1, admin_permissions: [] } as never,
    });
    const { container } = sar();
    await screen.findAllByText(/Ayşe Yılmaz/);
    expect(within(masaustu(container)).getAllByText("Salt okunur").length).toBeGreaterThan(0);
    expect(within(masaustu(container)).queryByRole("button", { name: "İptal / iade" })).toBeNull();
  });

  it("sunucu hatasında liste yerine hata + Yeniden dene çıkar", async () => {
    hataVer = true;
    sar();
    expect(await screen.findByRole("button", { name: /yeniden dene/i })).toBeTruthy();
  });
});

/* ══════════════ 2. Göçün getirdiği davranış — YAZILDIĞINDA KIRMIZI ══════════════ */

describe("İP-A7d1 (b) · göçün getirdiği davranış", () => {
  it("varsayılana eşit değer adrese YAZILMAZ", async () => {
    sar();
    await screen.findAllByText(/Ayşe Yılmaz/);
    fireEvent.click(screen.getByRole("button", { name: "Ara" }));
    await waitFor(() => expect(istekler.length).toBeGreaterThan(0));
    expect(adres(), "boş filtre adrese çöp yazdı").toBe("");
  });

  it("İKİ filtre arka arkaya yazılınca İKİSİ DE adreste kalır", async () => {
    // `useUrlDurumu`nun bekleyen-yazım mekanizması (İP-A6c · BULGU-4) burada
    // sınanır: ikinci yazım birincinin yazdığını görmezse ilk filtre kaybolur.
    sar();
    await screen.findAllByText(/Ayşe Yılmaz/);

    fireEvent.change(screen.getByLabelText("Rezervasyon durumu"), {
      target: { value: "COMPLETED" },
    });
    fireEvent.change(screen.getByLabelText("İhtilaf durumu"), {
      target: { value: "true" },
    });

    await waitFor(() => expect(adres()).toContain("disputed=true"));
    expect(adres(), "ilk filtre ikinci yazımda kayboldu").toContain("status=COMPLETED");
    await waitFor(() => {
      const son = sonListe()!.url;
      expect(son).toContain("status=COMPLETED");
      expect(son).toContain("is_disputed=true");
    });
  });

  it("FİLTRE değişince sayfa BAŞA döner", async () => {
    sar(`${ROUTES.adminBookings}?page=3`);
    await waitFor(() => expect(sonListe()).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Rezervasyon durumu"), {
      target: { value: "COMPLETED" },
    });

    await waitFor(() => expect(adres()).toContain("status=COMPLETED"));
    expect(adres(), "3. sayfada filtre daraltıldı ama sayfa sıfırlanmadı").not.toContain(
      "page=3"
    );
  });

  it("SAYFA değişince filtre korunur (ters prova)", async () => {
    // ── `limit=5` BİLİNÇLİ (İP-A8 · Görev 5 · B-4) ──
    //
    // Sayfa boyutu bir URL parametresidir (`filtreDisi`de yazılı, filtre
    // sayılmaz) ve sınanan davranış — sayfa değişince filtrenin korunması —
    // sayfa boyutundan BAĞIMSIZDIR. Varsayılan 25 ile bu test masaüstü
    // tablosunda 25 satır + mobil kartlarda 25 kart basıyordu ve tam suite
    // yükü altında ÖLÇÜLEN süresi **3.886 ms**ti (bağımsız denetçinin ~2 kat
    // yavaş makinesinde 9.000 ms'lik `testTimeout`u aşıyor ve tohuma bağlı
    // kırmızı düşüyordu — B-4). Bütçe BÜYÜTÜLMEDİ; ölçüm küçültüldü.
    kayitlar = Array.from({ length: 30 }, (_, i) => ({ ...REZ, id: i + 1 }));
    sar(`${ROUTES.adminBookings}?status=PENDING&limit=5`);
    await screen.findAllByText(/Ayşe Yılmaz/);

    fireEvent.click(screen.getByRole("button", { name: "Sonraki" }));
    await waitFor(() => expect(adres()).toContain("page=2"));
    expect(adres()).toContain("status=PENDING");
  });

  it("SIRALAMA iki anahtarı TEK adımda yazar ve sayfayı sıfırlar", async () => {
    // `limit=5` gerekçesi bir üstteki testte yazılı (B-4). Bu dosyanın en
    // yavaş testiydi: ölçülen **4.459 ms**. Sıralamanın iki anahtarı tek
    // adımda yazması sayfa boyutundan bağımsızdır.
    kayitlar = Array.from({ length: 30 }, (_, i) => ({ ...REZ, id: i + 1 }));
    sar(`${ROUTES.adminBookings}?page=2&limit=5`);
    await screen.findAllByText(/Ayşe Yılmaz/);

    fireEvent.click(screen.getByRole("button", { name: /Tutar/ }));

    await waitFor(() => expect(adres()).toContain("sort=price"));
    // `order=desc` VARSAYILANDIR ve adrese yazılmaz; isteğe ise gider.
    expect(adres(), "varsayılan yön adrese yazıldı").not.toContain("order=");
    expect(adres(), "sıralama değişti ama sayfa sıfırlanmadı").not.toContain("page=2");
    await waitFor(() => expect(sonListe()!.url).toContain("sort=price"));
    expect(sonListe()!.url).toContain("order=desc");

    // İkinci tıklama yönü çevirir; varsayılan OLMAYAN yön adrese yazılır.
    fireEvent.click(screen.getByRole("button", { name: /Tutar/ }));
    await waitFor(() => expect(adres()).toContain("order=asc"));
    expect(adres(), "iki anahtar tek adımda yazılmadı").toContain("sort=price");
  });

  it("boş durum AYRIŞIR: hiç kayıt yok", async () => {
    kayitlar = [];
    sar();
    expect(await screen.findByText("Rezervasyon yok")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /filtreleri temizle/i })).toBeNull();
  });

  it("filtre eşleşmeyince BAŞKA bir boş durum ve çıkış yolu gösterilir", async () => {
    sar(`${ROUTES.adminBookings}?status=COMPLETED`);
    expect(await screen.findByText("Bu filtreyle rezervasyon bulunamadı")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /filtreleri temizle/i }));
    await waitFor(() => expect(adres()).toBe(""));
  });

  it("mobil kartta satır aksiyonu iç içe <button> üretmez", async () => {
    const { container } = sar();
    await screen.findAllByText(/Ayşe Yılmaz/);
    expect(mobil(container).querySelectorAll("button button")).toHaveLength(0);
    expect(within(mobil(container)).getByRole("button", { name: "İptal / iade" })).toBeTruthy();
  });
});

/* ══════════════ 3. İhtilaf kararı — iade / öğretmene ödeme ══════════════ */

describe("ihtilaflı derste karar (iade / öğretmene öde)", () => {
  const IHTILAFLI = { ...REZ, status: "COMPLETED", is_disputed: true };
  const yazimlar = () => istekler.filter((i) => i.method !== "get");

  it("onay verilmeden istek GİTMEZ; vazgeçince de gitmez", async () => {
    kayitlar = [IHTILAFLI];
    const { container } = sar();
    await screen.findAllByText(/Ayşe Yılmaz/);

    fireEvent.click(within(masaustu(container)).getByRole("button", { name: "Öğrenciye iade et" }));
    const pencere = await screen.findByRole("dialog");
    // Not zorunlu: boş notla onay isteği göndermez.
    fireEvent.click(within(pencere).getByRole("button", { name: "İade et" }));
    expect(yazimlar()).toHaveLength(0);

    fireEvent.click(within(pencere).getByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(yazimlar()).toHaveLength(0);
  });

  it.each([
    ["Öğrenciye iade et", "İade et", "refund"],
    ["Öğretmene öde", "Öğretmene öde", "release"],
  ])("'%s' onaylanınca doğru gövdeyle POST gider (tutar YOK)", async (dugme, onay, karar) => {
    kayitlar = [IHTILAFLI];
    const { container } = sar();
    await screen.findAllByText(/Ayşe Yılmaz/);

    fireEvent.click(within(masaustu(container)).getByRole("button", { name: dugme }));
    const pencere = await screen.findByRole("dialog");
    fireEvent.change(within(pencere).getByRole("textbox"), { target: { value: "Ders yapılmadı" } });
    fireEvent.click(within(pencere).getByRole("button", { name: onay }));

    await waitFor(() => expect(yazimlar()).toHaveLength(1));
    expect(yazimlar()[0]).toEqual({
      method: "post",
      url: "/admin/bookings/7/dispute/resolve",
      body: { decision: karar, note: "Ders yapılmadı" },
    });
  });

  it("karar verilemeyen durumda (bekleyen) ve ihtilafsız satırda aksiyon yok", async () => {
    kayitlar = [{ ...REZ, is_disputed: true }, { ...REZ, id: 8, status: "COMPLETED" }];
    const { container } = sar();
    await screen.findAllByText(/Ayşe Yılmaz/);
    expect(within(masaustu(container)).queryByRole("button", { name: "Öğrenciye iade et" })).toBeNull();
    expect(within(masaustu(container)).queryByRole("button", { name: "Öğretmene öde" })).toBeNull();
  });

  it("bookings.manage izni olmayan yöneticide karar aksiyonu yok", async () => {
    kayitlar = [IHTILAFLI];
    useAuthStore.setState({
      token: "t",
      isAuthenticated: true,
      user: { id: 1, role_id: 1, admin_permissions: ["bookings.view"] } as never,
    });
    const { container } = sar();
    await screen.findAllByText(/Ayşe Yılmaz/);
    expect(within(masaustu(container)).queryByRole("button", { name: "Öğrenciye iade et" })).toBeNull();
    expect(within(masaustu(container)).queryByRole("button", { name: "Öğretmene öde" })).toBeNull();
  });
});
