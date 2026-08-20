// İP-19 · Filo + gün tahtası — UI KABUL MATRİSİ (gerçek DOM + gerçek istek gövdesi).
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.
//
// Paketin kırmızı matris commit'i olduğu için ekranlar henüz bu sözleşmeyi
// taşımıyor: ilk koşum KIRMIZIDIR.
//
// ## Bu paketin tipik yalancı yeşili
//
// Araç seçeneği bugün `DeliveryTodayPage.tsx:252-253`'te **elle yazılmış iki
// `<option>`**. "Ekranda araç seçeneği var" iddiası, seçenekler sabit kodlanmış
// olsa da geçer — hatta sunucuya hiç istek atılmasa da geçer. Bu yüzden D-13
// seçenekleri değil, **sunucudan gelen veriyle eşleşmesini** ölçer ve isteğin
// GERÇEKTEN atıldığını `istekler` dizisinden okur.
//
// Aynı tuzak gün tahtasında: sürükle-bırak DOM'da "çalışıyor" görünüp hiçbir
// şey kaydetmeyebilir. D-11 bu yüzden POST gövdesini okur.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Ağır ortak modül BİLE BİLE statik import ediliyor (İP-A7d3 · Görev 5) ──
//
// Ekranlar bu dosyada TEMBEL yükleniyor (`await import("./DeliveryTodayPage")`)
// ve maliyeti ilk testin İÇİNDE ödeniyor. İP-A7d3'te `admin/ui` demeti
// `ui2/duzenlemeYuzeyi` üzerinden `@medusajs/ui`ye bağlandı (SK-7) ve D-13
// paralel yük altında 9 sn'lik bütçeyi aştı — YALNIZ ilk test.
//
// Bütçe BÜYÜTÜLMEDİ: yavaşlık üretim kodunda değil test kurulumunda; statik
// import maliyeti TOPLAMA evresine taşır (A7d2'nin `PackagesPage` kararı).
import "@/components/admin/ui2/duzenlemeYuzeyi";

import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu (İP-12 deseni) ══════════════ */

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

const istekler: Istek[] = [];
let interceptorId: number | null = null;

const ARACLAR = [
  { id: 7, code: "LADA", label: "Lada", max_stops: 3, is_active: true, sort_order: 0 },
  { id: 9, code: "COROLLA", label: "Corolla", max_stops: 10, is_active: true, sort_order: 1 },
  { id: 11, code: "DOBLO", label: "Doblo", max_stops: 20, is_active: true, sort_order: 2 },
];

/**
 * Istisna kuyrugu (IP-A7d4): eskiden bu uc `{}` donuyordu, `Array.isArray`
 * false kaliyordu ve kuyruk HIC render edilmiyordu — yani o penceresi olan
 * dal olculemez durumdaydi.
 */
const ISTISNA_KUYRUGU = [
  {
    order_id: 909,
    address: "Seyhan / F Sok.",
    attempts: 3,
    last_failure_reason: "Adreste bulunamadi",
  },
];

const TAHTA = {
  unassigned: [
    { order_id: 101, address: "Seyhan / A Sok.", lat: 36.99, lng: 35.32 },
    { order_id: 102, address: "Çukurova / B Sok.", lat: 37.0, lng: 35.33 },
  ],
  runs: [
    {
      id: 55,
      vehicle_id: 7,
      status: "PLANNED",
      stops: [
        { id: 1, order_id: 201, sequence: 1, address: "Yüreğir / C Sok." },
        { id: 2, order_id: 202, sequence: 2, address: "Yüreğir / D Sok." },
        { id: 3, order_id: 203, sequence: 3, address: "Yüreğir / E Sok." },
      ],
    },
  ],
};

function kur() {
  interceptorId = apiClient.interceptors.request.use((cfg: AxiosRequestConfig) => {
    const url = cfg.url ?? "";
    istekler.push({
      method: (cfg.method ?? "get").toLowerCase(),
      url,
      // Gövde HEM obje HEM string olabilir: request interceptor'ları axios'un
      // `transformRequest`'inden ÖNCE çalışır, yani normal çağrılarda `cfg.data`
      // henüz objedir. Eski hâl yalnız string bekliyordu ve bu yüzden ÜRETİM
      // KODU teste göre eğilmişti (`addBoardStops` gövdeyi önceden stringify
      // ediyordu — denetim B-13). Eğrilik burada düzeltildi; ölçülen iddia
      // (gerçekten gönderilen gövde) aynen duruyor.
      body:
        typeof cfg.data === "string"
          ? JSON.parse(cfg.data)
          : ((cfg.data as Record<string, unknown> | undefined) ?? null),
    });
    const veri = url.includes("/delivery/attention-orders")
      ? ISTISNA_KUYRUGU
      : url.includes("/delivery/vehicles")
        ? ARACLAR
      : url.includes("/delivery/board")
        ? TAHTA
        : url.includes("/delivery/eligible-orders")
          ? TAHTA.unassigned
          : {};
    // İsteği ağa çıkarmadan yanıtla (adapter override).
    return {
      ...cfg,
      adapter: async () => ({
        data: veri,
        status: 200,
        statusText: "OK",
        headers: {},
        config: cfg,
      }),
    };
  });
}

beforeEach(() => {
  istekler.length = 0;
  useAuthStore.setState({
    token: "t",
    // İzinler AÇIKÇA verilir (denetim B-13): eski hâlde `admin_permissions`
    // boştu, yani test SALT-OKUNUR bir admin sürüyordu — ve tur kurma
    // formundaki araç seçicisi bu yüzden `canManage` kapısının DIŞINA
    // alınmıştı. Kapı geri kondu; test artık gerçek yetki yolundan geçiyor.
    user: {
      id: 1,
      role_id: 1,
      full_name: "Admin",
      email: "a@b.c",
      admin_permissions: ["delivery.view", "delivery.manage"],
    } as never,
  });
  kur();
});

afterEach(() => {
  if (interceptorId !== null) apiClient.interceptors.request.eject(interceptorId);
  interceptorId = null;
});

function bas(Bilesen: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Bilesen />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/* ══════════════ D-13: araç seçenekleri SUNUCUDAN ══════════════ */

describe("D-13 — araç seçenekleri sunucudan gelir", () => {
  it("tur kurma formundaki araç listesi sabit iki seçenek DEĞİL", async () => {
    const { default: DeliveryTodayPage } = await import("./DeliveryTodayPage");
    bas(DeliveryTodayPage);

    // İstek GERÇEKTEN atılmalı — "seçenek var" tek başına kanıt değil.
    await waitFor(() =>
      expect(istekler.some((i) => i.url.includes("/delivery/vehicles"))).toBe(true)
    );

    const secim = await screen.findByLabelText(/araç/i);
    const secenekler = within(secim).getAllByRole("option").map((o) => o.textContent);

    // DOLULUK NÖBETÇİSİ: en az bir seçenek var (boş liste her iddiayı geçirirdi).
    expect(secenekler.length).toBeGreaterThan(0);
    expect(secenekler).toEqual(expect.arrayContaining(["Doblo"]));
    expect(secenekler).toHaveLength(ARACLAR.length);
  });

  it("'Lada ve Corolla' gibi sabit metin ekranda YOK", async () => {
    const { default: DeliveryTodayPage } = await import("./DeliveryTodayPage");
    const { container } = bas(DeliveryTodayPage);
    await waitFor(() =>
      expect(istekler.some((i) => i.url.includes("/delivery/vehicles"))).toBe(true)
    );
    expect(container.textContent).not.toMatch(/Lada ve Corolla/i);
  });
});

/* ══════════════ D-11: sürükle-bırak GERÇEKTEN kaydeder ══════════════ */

describe("D-11 — gün tahtası sürükle-bırak", () => {
  it("havuzdan araca bırakma POST /runs/{id}/stops isteğine dönüşür", async () => {
    const { default: DeliveryBoard } = await import("./DeliveryBoardPage");
    bas(DeliveryBoard);

    const kart = await screen.findByTestId("havuz-siparis-101");
    const hedef = await screen.findByTestId("tur-55");

    fireEvent.dragStart(kart);
    fireEvent.drop(hedef);

    await waitFor(() => {
      const post = istekler.find(
        (i) => i.method === "post" && i.url.includes("/delivery/runs/55/stops")
      );
      expect(post, "sürükleme sunucuya HİÇ gitmedi — DOM'da çalışıyor görünüyor").toBeTruthy();
      expect(post!.body).toMatchObject({ order_ids: [101] });
    });
  });
});

/* ══════════════ D-12: kapasite uyarısı görünür ama ENGELLEMEZ ══════════════ */

describe("D-12 — kapasite ihlali uyarısı", () => {
  it("max_stops aşılınca uyarı DOM'da görünür", async () => {
    const { default: DeliveryBoard } = await import("./DeliveryBoardPage");
    bas(DeliveryBoard);

    // Araç 7'nin max_stops'u 3, turunda zaten 3 durak var → dördüncü aşar.
    const kart = await screen.findByTestId("havuz-siparis-101");
    fireEvent.dragStart(kart);
    fireEvent.drop(await screen.findByTestId("tur-55"));

    expect(await screen.findByTestId("kapasite-uyarisi-55")).toBeTruthy();
  });

  it("uyarıya rağmen işlem ENGELLENMEZ — karar operatörün", async () => {
    const { default: DeliveryBoard } = await import("./DeliveryBoardPage");
    bas(DeliveryBoard);

    const kart = await screen.findByTestId("havuz-siparis-101");
    fireEvent.dragStart(kart);
    fireEvent.drop(await screen.findByTestId("tur-55"));

    await waitFor(() =>
      expect(
        istekler.some((i) => i.method === "post" && i.url.includes("/runs/55/stops")),
        "uyarı işlemi engellemiş — sözleşme §4.2 ihlali"
      ).toBe(true)
    );
  });

  // DOLULUK NÖBETÇİSİ: kapasitesi bol araçta uyarı ÇIKMAMALI.
  it("NÖBETÇİ: kapasite yeterliyse uyarı yok", async () => {
    const { default: DeliveryBoard } = await import("./DeliveryBoardPage");
    bas(DeliveryBoard);
    await screen.findByTestId("tur-55");
    expect(screen.queryByTestId("kapasite-uyarisi-9")).toBeNull();
  });
});

/* ══════════════ İP-A7d4 · göç dalgası 4: iki dağıtım ekranının pencereleri ══════════════ */

/**
 * `DeliveryTodayPage` (iki bağ: "yeniden dene" + "günü optimize et") ve
 * `DeliveryBoardPage` (bir bağ) pencere durumunu ekranda `useState` ile
 * tutuyordu; üç bağın üçü de `useDuzenlemeYuzeyi`ye geçti.
 *
 * İkisinin de penceresi ONAY penceresidir — içinde yazılan bir şey yok, bekçi
 * orada anlamsız bir soru üretirdi (A7d3'ün `ConfirmDialog` kararı). Bu yüzden
 * zorunlu ikilinin birinci maddesi burada "pencere ortak yüzeyden geliyor mu"
 * biçimini alır (A7d3 · T-3'ün aynısı).
 */
describe("İP-A7d4 · dağıtım pencereleri ortak düzenleme yüzeyinde", () => {
  /**
   * "Günü Optimize Et" konumlu sipariş YOKKEN kapalıdır (bu bir gönder
   * düğmesi değil, ön koşulu olmayan bir işlem). Düğme ilk render'da
   * kapalı doğar ve veri gelince açılır; beklemeden tıklamak sessizce
   * hiçbir şey yapmaz ve test "pencere açılmadı" derdi.
   */
  async function optimizeDugmesi() {
    const dugme = await screen.findByRole("button", { name: /Günü Optimize Et/ });
    await waitFor(() => expect((dugme as HTMLButtonElement).disabled).toBe(false));
    return dugme;
  }

  it("BUGÜN: 'Günü Optimize Et' etiketli pencere açar, ESC kapatır, istek GİTMEZ", async () => {
    const { default: DeliveryTodayPage } = await import("./DeliveryTodayPage");
    bas(DeliveryTodayPage);
    fireEvent.click(await optimizeDugmesi());

    const p = await screen.findByRole("dialog");
    expect(p.getAttribute("aria-modal")).toBe("true");
    expect(p.textContent).toContain("Turları kur");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(istekler.filter((i) => i.url.includes("dispatch-day"))).toEqual([]);
  });

  it("BUGÜN: onaylanınca dispatch isteği GERÇEKTEN gider", async () => {
    const { default: DeliveryTodayPage } = await import("./DeliveryTodayPage");
    bas(DeliveryTodayPage);
    fireEvent.click(await optimizeDugmesi());
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Turları kur" })
    );
    await waitFor(() =>
      expect(istekler.some((i) => i.url.includes("dispatch-day"))).toBe(true)
    );
  });

  it("BUGÜN: istisna kuyruğunun penceresi HEDEFİ taşır (yüzeyin `kayit`i)", async () => {
    // Eskiden ekranda `retrying` useState'i vardı ve pencere metnini o
    // besliyordu; artık hedef yüzeyin kendisinde yaşıyor.
    const { default: DeliveryTodayPage } = await import("./DeliveryTodayPage");
    bas(DeliveryTodayPage);
    fireEvent.click(await screen.findByRole("button", { name: "Yeniden Dene" }));
    const p = await screen.findByRole("dialog");
    expect(p.textContent).toContain("#909");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("TAHTA: 'Günü Optimize Et' etiketli pencere açar ve ESC kapatır", async () => {
    const { default: DeliveryBoard } = await import("./DeliveryBoardPage");
    bas(DeliveryBoard);
    fireEvent.click(await optimizeDugmesi());

    const p = await screen.findByRole("dialog");
    expect(p.getAttribute("aria-modal")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
