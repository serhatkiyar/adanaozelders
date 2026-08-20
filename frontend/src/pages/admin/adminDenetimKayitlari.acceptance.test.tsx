/**
 * İP-A7d1 · Ekran (c) — `AdminAuditLogsPage` kabul matrisi.
 *
 * Göç dalgası 1'in "satır aksiyonlu / satır tıklamalı liste" ekranı. Bu ekran
 * tabanda YAPISAL OLARAK TEKTİR: pencere durumunun ekranda yaşayıp bir
 * bileşene **prop olarak indiği** tek örnektir (İP-A6b · BULGU-3) ve
 * `onRowClick` + `renderMobileRow` ikilisini birlikte kullanan iki ekrandan
 * biridir — yani Görev 1'in çakışmasını gerçekten taşır.
 *
 * Dosya İKİ bölümdür:
 *
 *   1. **Mevcut davranışı sabitleyen** iddialar — göç bunları KIRMAMALIDIR.
 *      (Ekranın bugüne dek hiç kabul testi yoktu; göçten önce yazıldı ki
 *      "çalışıyordu, sonra bozuldu" sessiz kalmasın.)
 *   2. Göçün **yeni getirdiği** davranışlar — yazıldığı anda KIRMIZI.
 *
 * Gerçek DOM + gerçek axios örneği: "filtre gerçekten isteğe gidiyor mu"
 * sorusunun tek geçerli kanıtı gönderilen istektir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminAuditLogsPage from "@/pages/admin/AdminAuditLogsPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

/* ── Sahte sunucu ── */

interface Istek {
  method: string;
  url: string;
}

let istekler: Istek[] = [];
let eskiAdapter: unknown;
let kayitlar: Record<string, unknown>[] = [];
let hataVer = false;

const KAYIT = {
  id: 91,
  action: "BOOKING_CANCEL",
  target_type: "booking",
  target_id: 12,
  actor_id: 3,
  actor_role: 1,
  reason: "Öğrenci talebi",
  details: null,
  ip_address: "10.0.0.1",
  request_id: "req-abc",
  before_values: { status: "ACCEPTED" },
  after_values: { status: "CANCELLED" },
  meta: null,
  created_at: "2027-03-03T11:00:00+00:00",
};

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  kayitlar = [KAYIT];
  hataVer = false;
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    // `undefined` değerler axios tarafından HİÇ gönderilmez; `String(v)`
    // ile "undefined" yazmak sahte bir filtre üretir ve testi yalancı
    // kırmızı yapar (bu tuzağa bir kez düşüldü).
    const sorgu = new URLSearchParams(
      Object.entries((config.params ?? {}) as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => [k, String(v)] as [string, string])
    ).toString();
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url) + (sorgu ? `?${sorgu}` : ""),
    };
    istekler.push(istek);
    if (hataVer && istek.url.includes("audit")) {
      const hata = new Error("500") as Error & { isAxiosError: boolean; response: unknown };
      hata.isAxiosError = true;
      hata.response = { status: 500, data: {}, headers: {}, config };
      throw hata;
    }
    // Filtre GERÇEKTEN uygulanmış gibi davranır: eşleşmezse boş liste.
    const q = new URLSearchParams(istek.url.split("?")[1] ?? "");
    const hedef = q.get("target_type");
    const suzulmus = hedef
      ? kayitlar.filter((k) => k.target_type === hedef)
      : kayitlar;
    // Uç DÜZ dizi + `x-total-count` başlığı döner (`api/admin.ts`).
    const boyut = Number(q.get("limit") ?? 25);
    const kayma = Number(q.get("offset") ?? 0);
    return {
      data: suzulmus.slice(kayma, kayma + boyut),
      status: 200,
      statusText: "OK",
      headers: { "x-total-count": String(suzulmus.length) },
      config,
    } as never;
  };
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: ["*"] } as never,
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

function sar(yol = ROUTES.adminAuditLogs) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Konum />
        <Routes>
          <Route path={ROUTES.adminAuditLogs} element={<AdminAuditLogsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const adres = () => screen.getByTestId("adres").textContent ?? "";
const sonListe = () => [...istekler].reverse().find((i) => i.url.includes("audit"));
const mobilBolum = (kap: HTMLElement) => {
  const el = kap.querySelector<HTMLElement>("[data-mobil-satirlar]");
  if (!el) throw new Error("mobil kart bölümü yok");
  return el;
};

/* ══════════════ 1. Mevcut davranış — göç bunları KIRMAZ ══════════════ */

describe("İP-A7d1 (c) · mevcut davranış korunur", () => {
  it("liste yüklenir ve kayıt satırı görünür", async () => {
    sar();
    expect(await screen.findAllByText("BOOKING_CANCEL")).not.toHaveLength(0);
  });

  it("adresteki filtre ilk isteğe girer (yenileme/paylaşım)", async () => {
    sar(`${ROUTES.adminAuditLogs}?target=booking`);
    await waitFor(() =>
      expect(sonListe()!.url, "adresteki filtre isteğe gitmedi").toContain(
        "target_type=booking"
      )
    );
  });

  it("arama kutusu SUBMIT ile adrese yazılır (her tuşta değil)", async () => {
    sar();
    await screen.findAllByText("BOOKING_CANCEL");

    fireEvent.change(screen.getByLabelText("Denetim kaydı ara"), {
      target: { value: "iptal" },
    });
    expect(adres(), "yazarken adres değişmemeli").not.toContain("q=iptal");

    fireEvent.click(screen.getByRole("button", { name: "Ara" }));
    await waitFor(() => expect(adres()).toContain("q=iptal"));
  });

  it("satıra tıklayınca kaydın tüm alanları bir pencerede açılır", async () => {
    const { container } = sar();
    await screen.findAllByText("BOOKING_CANCEL");

    const tablo = container.querySelector("table")!;
    fireEvent.click(within(tablo).getByText("booking #12"));

    const pencere = await screen.findByRole("dialog");
    expect(pencere.getAttribute("aria-modal")).toBe("true");
    expect(within(pencere).getByText("req-abc")).toBeTruthy();
    expect(within(pencere).getByText("Öğrenci talebi")).toBeTruthy();
  });

  it("sunucu hatasında liste yerine hata + Yeniden dene çıkar", async () => {
    hataVer = true;
    sar();
    expect(await screen.findByRole("button", { name: /yeniden dene/i })).toBeTruthy();
  });
});

/* ══════════════ 2. Göçün getirdiği davranış — YAZILDIĞINDA KIRMIZI ══════════════ */

describe("İP-A7d1 (c) · göçün getirdiği davranış", () => {
  it("varsayılana eşit değer adrese YAZILMAZ", async () => {
    sar();
    await screen.findAllByText("BOOKING_CANCEL");
    fireEvent.click(screen.getByRole("button", { name: "Ara" }));
    await waitFor(() => expect(istekler.length).toBeGreaterThan(0));
    expect(adres(), "boş filtre adrese çöp yazdı").toBe("");
  });

  it("FİLTRE değişince sayfa BAŞA döner", async () => {
    // 3. sayfa: kayıt yok (liste boş) — kullanıcının filtre daralttığı an tam
    // olarak burasıdır ve sıfırlama olmazsa boş ekranda kalır.
    sar(`${ROUTES.adminAuditLogs}?page=3`);
    await waitFor(() => expect(sonListe()).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Hedef türü"), {
      target: { value: "booking" },
    });

    await waitFor(() => expect(adres()).toContain("target=booking"));
    expect(adres(), "3. sayfada filtre daraltıldı ama sayfa sıfırlanmadı").not.toContain(
      "page=3"
    );
  });

  it("SAYFA değişince filtre korunur ve sayfa sıfırlanmaz", async () => {
    // Ters prova: sıfırlama kuralı "her yazımda başa dön" değildir.
    kayitlar = Array.from({ length: 30 }, (_, i) => ({ ...KAYIT, id: i + 1 }));
    sar(`${ROUTES.adminAuditLogs}?target=booking`);
    await screen.findAllByText("BOOKING_CANCEL");

    fireEvent.click(screen.getByRole("button", { name: "Sonraki" }));
    await waitFor(() => expect(adres()).toContain("page=2"));
    expect(adres()).toContain("target=booking");
  });

  it("boş durum AYRIŞIR: filtre eşleşmedi ≠ hiç kayıt yok", async () => {
    kayitlar = [];
    sar();
    expect(await screen.findByText("Denetim kaydı yok")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /filtreleri temizle/i }),
      "filtre yokken 'temizle' önerilemez"
    ).toBeNull();
  });

  it("filtre eşleşmeyince BAŞKA bir boş durum ve çıkış yolu gösterilir", async () => {
    sar(`${ROUTES.adminAuditLogs}?target=order`);
    expect(await screen.findByText("Bu filtreyle kayıt bulunamadı")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /filtreleri temizle/i }));
    await waitFor(() => expect(adres()).toBe(""));
  });

  it("mobil kartta satır açılabilir ve iç içe <button> yoktur", async () => {
    const { container } = sar();
    await screen.findAllByText("BOOKING_CANCEL");

    const mobil = mobilBolum(container);
    expect(mobil.querySelectorAll("button button")).toHaveLength(0);

    fireEvent.click(within(mobil).getByText("booking #12"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("detay penceresi ESC ile kapanır", async () => {
    const { container } = sar();
    await screen.findAllByText("BOOKING_CANCEL");
    fireEvent.click(within(container.querySelector("table")!).getByText("booking #12"));
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
