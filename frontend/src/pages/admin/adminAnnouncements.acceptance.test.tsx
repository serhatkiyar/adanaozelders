/**
 * İP-C2 · Duyuru şeridi panel CRUD — `AdminAnnouncementsPage` nöbetçisi.
 *
 * Kırmızı matrisin 18 testinin DIŞINDA (o matris yalnız public banner'ı
 * kapsıyordu); bu dosya paketin "Panel CRUD" bölümünü — Ç-2 satır aksiyonu
 * kuralı, yetki duvarı, gerçek POST gövdesi — ölçer. Gerçek DOM + gerçek
 * axios adapter üzerinden (kaynak taraması yok).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminAnnouncementsPage from "@/pages/admin/AdminAnnouncementsPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";

import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu — yöntem + yol eşleşmeli ══════════════ */

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

function girisYap(izinler: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: izinler } as never,
  });
}

const KAYIT = {
  id: 7,
  metin: "Kampanya başladı",
  link_url: "https://example.com",
  link_metni: "İncele",
  varyant: "bilgi" as const,
  aktif: true,
  baslangic_at: null,
  bitis_at: null,
  sira: 0,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

function sar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[ROUTES.adminAnnouncements]}>
        <Routes>
          <Route path={ROUTES.adminAnnouncements} element={<AdminAnnouncementsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("İP-C2 · AdminAnnouncementsPage", () => {
  it("announcements.view izni yoksa erişim reddedilir", async () => {
    girisYap(["settings.view"]);
    sunucu("/admin/duyuru-seridi", { data: [KAYIT] });
    sar();

    // İstemci fail-closed UI kararı verir; GERÇEK yetki sınırı backend'dedir
    // (bkz. `test_9_yetkisiz_kullanici_403` — backend/tests/integration).
    expect(await screen.findByRole("heading", { name: /yetkiniz yok/i })).not.toBeNull();
    expect(screen.queryByText("Kampanya başladı")).toBeNull();
  });

  it("liste satırları metin/varyant/durum ile render edilir", async () => {
    girisYap(["announcements.view", "announcements.manage"]);
    sunucu("/admin/duyuru-seridi", { data: [KAYIT] }, "get");
    sar();

    expect(await screen.findByText("Kampanya başladı")).not.toBeNull();
    expect(screen.getByText("Bilgi")).not.toBeNull();
    expect(screen.getByText("Aktif")).not.toBeNull();
  });

  it("yalnız view izniyle salt-okunur: Yeni duyuru düğmesi yok", async () => {
    girisYap(["announcements.view"]);
    sunucu("/admin/duyuru-seridi", { data: [KAYIT] }, "get");
    sar();

    await screen.findByText("Kampanya başladı");
    expect(screen.queryByRole("button", { name: /yeni duyuru/i })).toBeNull();
  });

  it("yeni duyuru formu doğru gövdeyle POST eder", async () => {
    girisYap(["announcements.view", "announcements.manage"]);
    sunucu("/admin/duyuru-seridi", { data: [] }, "get");
    sunucu("/admin/duyuru-seridi", { data: { ...KAYIT, id: 8 }, status: 201 }, "post");
    sar();

    fireEvent.click(await screen.findByRole("button", { name: /yeni duyuru/i }));
    const form = screen.getByLabelText("Metin");
    fireEvent.change(form, { target: { value: "Yılbaşı kampanyası" } });
    fireEvent.click(screen.getByRole("button", { name: /^kaydet$/i }));

    await waitFor(() => {
      const gonderilen = istekler.find((i) => i.method === "post" && i.url.includes("/admin/duyuru-seridi"));
      expect(gonderilen).toBeDefined();
      expect(gonderilen!.body).toMatchObject({ metin: "Yılbaşı kampanyası", varyant: "bilgi" });
    });
  });

  it("Ç-2: Sil menüde ve onaysız DELETE gitmez", async () => {
    girisYap(["announcements.view", "announcements.manage"]);
    sunucu("/admin/duyuru-seridi", { data: [KAYIT] }, "get");
    sunucu("/admin/duyuru-seridi/7", { status: 204, data: null }, "delete");
    sar();

    await screen.findByText("Kampanya başladı");
    // "Sil" açıkta bir düğme OLARAK yok — yalnız "diğer işlemler" menüsünde.
    expect(screen.queryByRole("button", { name: /^sil$/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /diğer işlemler/i }));
    fireEvent.click(await screen.findByText("Sil"));

    // Onay penceresi açılana kadar DELETE GİTMEMİŞ olmalı.
    expect(istekler.some((i) => i.method === "delete")).toBe(false);

    const pencere = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(pencere, "onay penceresi açılmadı").not.toBeNull();
    fireEvent.click(within(pencere).getByRole("button", { name: /duyuruyu sil/i }));

    await waitFor(() => {
      expect(istekler.some((i) => i.method === "delete" && i.url.includes("/7"))).toBe(true);
    });
  });
});
