// İP-4 · "Hata Çözme" ekranı — UI KABUL MATRİSİ (bölüm B-5: gerçek DOM).
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.
//
// Paketin ilk commit'i olduğu için ekran henüz YOKTUR: ilk koşum kırmızıdır.
//
// ## Neden (P1-4)
//
// `escrow_reconciler.py` deneme sınırı dolan iadeyi `logger.error("MANUEL
// müdahale gerekli")` ile bırakıyor ve `outbox` dead-letter satırları hiçbir
// uçtan görünmüyor. Yani sarkan para ve ölü SMS/e-posta işi YALNIZ sunucu
// logunda; düzeltme YALNIZ SQL'den. Ekranın işi bu iki kuyruğu operatöre
// görünür kılmak ve ölü işi güvenle yeniden kuyruğa almaktır.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { ADMIN_NAV_ITEMS } from "@/components/admin/layout/adminNavigation";
import { Toaster } from "@/components/Toaster";
import AdminOperationsPage from "@/pages/admin/AdminOperationsPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";

import type { AxiosRequestConfig } from "axios";

const OPS_VIEW = "operations.view";
const OPS_MANAGE = "operations.manage";

/* ══════════════ Sahte sunucu ══════════════ */

interface Istek {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

type Yanit = { status?: number; data: unknown } | ((istek: Istek) => { status?: number; data: unknown });

let istekler: Istek[] = [];
let rotalar: { esles: (i: Istek) => boolean; yanit: Yanit }[] = [];
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
  istekler = [];
  rotalar = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const istek: Istek = {
      method: (config.method ?? "get").toLowerCase(),
      url: String(config.url),
      body: config.data ? JSON.parse(String(config.data)) : null,
    };
    istekler.push(istek);
    const rota = rotalar.find((r) => r.esles(istek));
    const ham = rota ? (typeof rota.yanit === "function" ? rota.yanit(istek) : rota.yanit) : { data: {} };
    const status = ham.status ?? 200;
    if (status >= 400) {
      const hata = new Error(`istek başarısız: ${status}`) as Error & {
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

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ROUTES.adminOperations]}>
        <Routes>
          <Route path={ROUTES.adminOperations} element={<AdminOperationsPage />} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

/* ══════════════ Fixture'lar ══════════════ */

const SIKISIK_IADE = {
  entity: "order_return",
  entity_id: 12,
  order_id: 77,
  reason: "RETRY_EXHAUSTED",
  money_status: "REFUNDING",
  amount: "250.00",
  currency: "TRY",
  refund_attempts: 3,
  refund_requested_at: "2027-04-02T09:00:00+00:00",
  provider_ref: "pay-tx-77",
  updated_at: "2027-04-02T10:00:00+00:00",
};

const SIKISIK_SIPARIS = {
  ...SIKISIK_IADE,
  entity: "order",
  entity_id: 77,
  reason: "MANUAL_REVIEW",
  money_status: "MANUAL_REVIEW",
};

const OLU_IS = {
  id: 501,
  kind: "sms:failed",
  status: "FAILED",
  attempts: 5,
  last_error: "SMSGatewayError: 503",
  order_id: 77,
  created_at: "2027-04-02T08:00:00+00:00",
  updated_at: "2027-04-02T09:30:00+00:00",
  next_attempt_at: "2027-04-02T09:35:00+00:00",
};

function sunucularHazir(sikisik = [SIKISIK_IADE, SIKISIK_SIPARIS], isler = [OLU_IS]) {
  sunucu("/admin/escrow/stuck", { data: sikisik }, "get");
  sunucu("/admin/outbox/failed", { data: isler }, "get");
}

/* ═════════════════════ Menü ve erişim ═════════════════════ */

describe("B-5/0 · ekran menüden ulaşılabilir ve izinle kapılı", () => {
  it("navigasyonda operations.view ile kapılı bir öğe vardır", () => {
    const oge = ADMIN_NAV_ITEMS.find((i) => i.to === ROUTES.adminOperations);
    expect(oge, "Hata Çözme menü öğesi yok — ekran ulaşılamaz").toBeTruthy();
    expect(oge?.requiredPermission).toBe(OPS_VIEW);
  });

  it("izni olmayan admin ekranı göremez (fail-closed)", async () => {
    izinVer("orders.view");
    sunucularHazir();

    sar();

    expect(await screen.findByText(/yetkiniz yok/i)).toBeTruthy();
    expect(istekler.some((i) => i.url.includes("/admin/escrow/stuck"))).toBe(false);
  });
});

/* ═════════════════════ B-5 · İki kuyruk da listeleniyor ═════════════════════ */

describe("B-5 · ekran sıkışmış escrow ve ölü outbox işlerini listeler", () => {
  it("sıkışmış para kayıtları sipariş numarası ve sebebiyle görünür", async () => {
    izinVer(OPS_VIEW);
    sunucularHazir();

    sar();

    // Deterministik bekleme: başlık VERİDEN BAĞIMSIZ basıldığı için ona
    // bakmak yetmez — önce satırın kendisi beklenir, sonra bölüme daralınır.
    const satir = await screen.findByText(/İade talebi #12/);
    const bolum = satir.closest("section");
    expect(bolum).not.toBeNull();
    const icinde = within(bolum as HTMLElement);
    expect(icinde.getByRole("heading", { name: /sıkışmış para/i })).toBeTruthy();
    // Sipariş göndermesi İADE SATIRININ kendi içinde aranır: "Sipariş #77"
    // metni ayrıca sipariş kaydının kendi etiketinde de geçiyor ve genel bir
    // sorgu iki eşleşmeyi ayırt edemezdi (yani neyin doğrulandığı bulanıklaşır).
    expect(within(satir.closest("li") as HTMLElement).getByText(/Sipariş #77/)).toBeTruthy();
    expect(icinde.getByText(/manuel inceleme/i)).toBeTruthy();
    expect(icinde.getByText(/deneme tükendi/i)).toBeTruthy();
  });

  it("ölü işler hata metniyle görünür", async () => {
    izinVer(OPS_VIEW);
    sunucularHazir();

    sar();

    const kind = await screen.findByText("sms:failed");
    const bolum = kind.closest("section");
    const icinde = within(bolum as HTMLElement);
    expect(icinde.getByRole("heading", { name: /ölü iş/i })).toBeTruthy();
    expect(icinde.getByText(/SMSGatewayError/)).toBeTruthy();
  });

  it("iki kuyruk da boşsa 'iş yok' açıkça söylenir", async () => {
    izinVer(OPS_VIEW);
    sunucularHazir([], []);

    sar();

    expect(await screen.findByText(/sıkışmış para kaydı yok/i)).toBeTruthy();
    expect(await screen.findByText(/ölü iş yok/i)).toBeTruthy();
  });

  it("sorgu patlarsa 'kayıt yok' DEĞİL hata gösterilir (P1-6 sınıfı)", async () => {
    izinVer(OPS_VIEW);
    sunucu("/admin/escrow/stuck", { status: 500, data: {} }, "get");
    sunucu("/admin/outbox/failed", { status: 500, data: {} }, "get");

    sar();

    expect((await screen.findAllByText(/yüklenemedi/i)).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/sıkışmış para kaydı yok/i)).toBeNull();
    expect(screen.queryByText(/ölü iş yok/i)).toBeNull();
  });
});

/* ═════════════════════ B-5 · Retry butonu ═════════════════════ */

describe("B-5 · yeniden dene butonu gerçek POST üretir", () => {
  it("onaydan sonra POST /admin/outbox/{id}/retry gider ve liste tazelenir", async () => {
    izinVer(OPS_VIEW, OPS_MANAGE);
    let isler = [OLU_IS];
    sunucu("/admin/escrow/stuck", { data: [] }, "get");
    sunucu("/admin/outbox/failed", () => ({ data: isler }), "get");
    sunucu("/admin/outbox/501/retry", () => {
      isler = [];
      return { data: { ...OLU_IS, status: "PENDING", attempts: 0, requeued: true } };
    }, "post");

    sar();

    fireEvent.click(await screen.findByRole("button", { name: "Yeniden dene" }));
    fireEvent.click(await screen.findByRole("button", { name: "İşi yeniden kuyruğa al" }));

    await screen.findByText(/yeniden kuyruğa alındı/i);
    expect(
      istekler.some((i) => i.method === "post" && i.url.endsWith("/admin/outbox/501/retry"))
    ).toBe(true);
    expect(await screen.findByText(/ölü iş yok/i)).toBeTruthy();
  });

  it("onay penceresi açılmadan istek gitmez", async () => {
    izinVer(OPS_VIEW, OPS_MANAGE);
    sunucularHazir([], [OLU_IS]);
    sunucu("/admin/outbox/501/retry", { data: {} }, "post");

    sar();

    fireEvent.click(await screen.findByRole("button", { name: "Yeniden dene" }));

    expect(await screen.findByRole("button", { name: "İşi yeniden kuyruğa al" })).toBeTruthy();
    expect(istekler.some((i) => i.method === "post")).toBe(false);
  });

  it("retry patlarsa kullanıcı hatayı GÖRÜR", async () => {
    izinVer(OPS_VIEW, OPS_MANAGE);
    sunucularHazir([], [OLU_IS]);
    sunucu(
      "/admin/outbox/501/retry",
      { status: 409, data: { detail: "Gönderilmiş iş yeniden kuyruğa alınamaz." } },
      "post"
    );

    sar();

    fireEvent.click(await screen.findByRole("button", { name: "Yeniden dene" }));
    fireEvent.click(await screen.findByRole("button", { name: "İşi yeniden kuyruğa al" }));

    expect(await screen.findByText(/yeniden kuyruğa alınamaz/i)).toBeTruthy();
  });

  it("yalnız görüntüleme izni olan admin retry butonunu GÖRMEZ", async () => {
    izinVer(OPS_VIEW);
    sunucularHazir([], [OLU_IS]);

    sar();

    expect(await screen.findByText("sms:failed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Yeniden dene" })).toBeNull();
  });
});
