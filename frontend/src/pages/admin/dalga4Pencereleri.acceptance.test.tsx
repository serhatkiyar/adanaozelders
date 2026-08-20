/**
 * İP-A7d4 · göç dalgası 4 · ekranlar (2)-(6).
 *
 * Beş ekranın pencere durumu ortak `useDuzenlemeYuzeyi`ye taşındı:
 * `ClosedDays` · `DeliveryTodayPage` · `DeliveryBoardPage` ·
 * `AdminOperationsPage` · `AdminSettingsPage`.
 *
 * ## Bu dosyanın iddiası NEDEN "kirli formda sorar" DEĞİL
 *
 * Beşinin de penceresi bir ONAY penceresidir (`ConfirmDialog`) ya da gerekçe
 * penceresidir (`ReasonDialog`). Onay penceresinde yazılan bir şey yoktur —
 * bekçi orada anlamsız bir soru üretirdi (A7d3'ün `ConfirmDialog` kararı).
 * Gerekçe penceresinin kirli-kapatma davranışı ORTAK KATMANDA sınanıyor
 * (`ui2/gerekcePenceresi.test.tsx`, SK-7 düzeltmesi) ve bu dosya onun bu
 * ekranda GERÇEKTEN bağlı olduğunu ölçer.
 *
 * Yani zorunlu ikilinin birinci maddesi burada şu biçimi alır: **pencere
 * ortak yüzeyden geliyor mu** (etiketli, ESC ile kapanıyor, odak tuzağı
 * `Dialog`tan geliyor) — A7d3'ün `DeliveryRunDetailPage` için yazdığı T-3'ün
 * aynısı. İkinci madde (tüm koşullu dallar + alan adları) tam olarak
 * uygulanıyor.
 *
 * `AdminSettingsPage`in gerekçe alanı GERÇEK metin taşıdığı için orada
 * kirli-kapatma AYRICA ölçülüyor.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { ClosedDays } from "@/components/admin/delivery/ClosedDays";
import AdminOperationsPage from "@/pages/admin/AdminOperationsPage";
import AdminSettingsPage from "@/pages/admin/AdminSettingsPage";
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

function izinVer(...izinler: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: izinler } as never,
  });
}

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

function pencere(): HTMLElement {
  const p = document.querySelector('[role="dialog"]');
  if (!p) throw new Error("pencere yok");
  return p as HTMLElement;
}

/* ═════════ D4-1 · ClosedDays: pencere + kilitli karar ihlali ═════════ */

const GUN = { id: 5, day: "2026-08-30", label: "Zafer Bayramı", source: "holiday" };

describe("D4-1 · ClosedDays — pencere ortak yüzeyde, gönder düğmesi AÇIK", () => {
  const kur = (gunler = [GUN]) => {
    izinVer("delivery.view", "delivery.manage");
    sunucu(/\/delivery\/calendar$/, { data: gunler }, "get");
    sar(<ClosedDays />);
  };

  it("tatil yükleme onayı ortak pencereden gelir (etiketli + ESC kapatır)", async () => {
    kur();
    fireEvent.click(await screen.findByRole("button", { name: "Resmî tatilleri yükle" }));
    const p = await screen.findByRole("dialog");
    expect(p.getAttribute("aria-modal")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("onaylanınca seed isteği GERÇEKTEN gider ve pencere kapanır", async () => {
    kur();
    sunucu("/delivery/calendar/seed-holidays", { data: [GUN] }, "post");
    fireEvent.click(await screen.findByRole("button", { name: "Resmî tatilleri yükle" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yükle" }));

    await waitFor(() => {
      expect(istekler.some((i) => i.url.includes("seed-holidays"))).toBe(true);
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("gün seçmeden 'Günü kapat' BASILABİLİR; istek gitmez, hata ALANDA çıkar", async () => {
    // Eski hâl: `disabled={!newDay}`. Kilitli kararın açık ihlaliydi ve
    // kullanıcı düğmenin neden ölü olduğunu göremiyordu.
    kur([]);
    const dugme = await screen.findByRole("button", { name: "Günü kapat" });
    expect((dugme as HTMLButtonElement).disabled, "gönder düğmesi geçerlilikle kapanmış").toBe(false);

    fireEvent.click(dugme);

    expect(await screen.findByText("Kapatılacak günü seçin.")).toBeTruthy();
    expect(istekler.filter((i) => i.method === "post")).toEqual([]);
  });

  it("geçerli girdide POST /delivery/calendar gider ve form SIFIRLANIR", async () => {
    kur([]);
    sunucu(/\/delivery\/calendar$/, { data: GUN }, "post");
    const gun = await screen.findByLabelText(/Kapatılacak gün/);
    fireEvent.change(gun, { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText(/Açıklama/), { target: { value: "Yıllık bakım" } });
    fireEvent.click(screen.getByRole("button", { name: "Günü kapat" }));

    await waitFor(() => {
      const post = istekler.find((i) => i.method === "post" && i.url.endsWith("/delivery/calendar"));
      expect(post, "gün ekleme isteği hiç gitmedi").toBeTruthy();
      expect(post!.body).toEqual({ day: "2026-09-01", label: "Yıllık bakım" });
    });
    await waitFor(() => expect((gun as HTMLInputElement).value).toBe(""));
  });

  it("iki dal da adlandırılmıştır: yönetici formu + salt-okunur liste", async () => {
    kur();
    // Satır aksiyonu AÇIK DÜĞME ve gün adını taşır (kilitli karar). Liste
    // asenkron geldiği için ÖNCE beklenir: `getBy` ile sormak, listeyi hiç
    // render etmeden "adsız kontrol yok" demeye yol açardı.
    expect(await screen.findByRole("button", { name: /gününü yeniden aç/ })).toBeTruthy();
    expect(adsizKontroller(document.body), "ekranda adsız kontrol var").toEqual([]);

    // Salt-okunur dal: yönetme izni yoksa form ve satır aksiyonu YOK.
    useToastStore.setState({ toasts: [] });
    izinVer("delivery.view");
    sar(<ClosedDays />);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Günü kapat" })).toBeNull();
    });
  });

  it("boş liste ve hata AYRI durumlardır", async () => {
    izinVer("delivery.view");
    sunucu(/\/delivery\/calendar$/, { status: 500, data: { detail: "patladi" } }, "get");
    sar(<ClosedDays />);
    expect(await screen.findByRole("button", { name: /Yeniden dene/i })).toBeTruthy();
    expect(screen.queryByText("Yaklaşan kapalı gün yok")).toBeNull();
  });
});

/* ═════════ D4-2 · AdminOperationsPage ═════════ */

const OLU_IS = {
  id: 42,
  kind: "order.delivered.sms",
  attempts: 5,
  last_error: "SMS sağlayıcısı 503 döndü",
  updated_at: "2026-08-19T09:00:00Z",
};

describe("D4-2 · AdminOperationsPage — onay penceresi ortak yüzeyde", () => {
  const kur = () => {
    izinVer("operations.view", "operations.manage");
    sunucu("/admin/outbox/failed", { data: [OLU_IS] }, "get");
    sunucu("/admin/escrow", { data: [] }, "get");
    sar(<AdminOperationsPage />);
  };

  it("'Yeniden dene' artık ortak `Button` (ham <button> değil) ve pencereyi açar", async () => {
    kur();
    const dugme = await screen.findByRole("button", { name: "Yeniden dene" });
    fireEvent.click(dugme);
    const p = await screen.findByRole("dialog");
    expect(p.getAttribute("aria-modal")).toBe("true");
    // Hedef pencerenin metnine iner: yüzeyin `kayit`i doğru olay.
    expect(p.textContent).toContain("#42");
  });

  it("ESC kapatır ve istek GİTMEZ", async () => {
    kur();
    fireEvent.click(await screen.findByRole("button", { name: "Yeniden dene" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(istekler.filter((i) => i.url.includes("/retry"))).toEqual([]);
  });
});

/* ═════════ D4-3 · AdminSettingsPage — gerekçe penceresi ═════════ */

const BAYRAK = {
  key: "store_checkout",
  label: "Mağaza ödemesi",
  enabled: true,
  enforced: true,
  description: "Mağaza kolunda ödeme alınabilir.",
};

describe("D4-3 · AdminSettingsPage — gerekçe penceresi ortak yüzeyde", () => {
  const kur = (izinler = ["settings.view", "settings.manage"]) => {
    izinVer(...izinler);
    sunucu("/admin/feature-flags", { data: [BAYRAK] }, "get");
    sunucu("/payments/availability", { data: { branches: {} } }, "get");
    sar(<AdminSettingsPage />);
  };

  const pencereAc = async () => {
    kur();
    // Satırda çok sayıda "Aç"/"Kapat" olabildiği için düğmenin erişilebilir
    // adı bayrağın ADINI taşır; test de o adla sorar.
    const dugme = await screen.findByRole("button", {
      name: "Mağaza ödemesi bayrağını kapat",
    });
    fireEvent.click(dugme);
    return screen.findByRole("dialog");
  };

  it("bayrak değiştirme gerekçe penceresini ortak yüzeyden açar", async () => {
    const p = await pencereAc();
    expect(p.getAttribute("aria-modal")).toBe("true");
    expect(p.textContent).toContain("Mağaza ödemesi");
  });

  it("KİRLİ gerekçede kapatma ÖNCE SORAR (SK-7 bu ekranda da bağlı)", async () => {
    const p = await pencereAc();
    fireEvent.change(within(p).getByLabelText(/gerekçe/i), {
      target: { value: "Sağlayıcı bakımı nedeniyle kapatıldı." },
    });
    await act(async () => {});

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText("Kaydedilmemiş değişiklikler var")).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("yönetme izni YOKKEN aç/kapa düğmesi çıkmaz", async () => {
    kur(["settings.view"]);
    await screen.findByText("Mağaza ödemesi");
    expect(screen.queryByRole("button", { name: /bayrağını (kapat|aç)/ })).toBeNull();
  });
});
