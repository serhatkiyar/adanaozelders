/**
 * Öne çıkarmalar ve öğretmen ön başvuruları: süzgeç ADRESTE yaşar.
 *
 * Önceden iki ekran da süzgeci `useState`te tutuyordu; yenileme, geri tuşu ya
 * da paylaşılan bağlantı süzgeci sıfırlıyordu. Kanıt gönderilen istektir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminPromotionsPage from "@/pages/admin/AdminPromotionsPage";
import AdminTutorApplicationsPage from "@/pages/admin/AdminTutorApplicationsPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

let istekler: { url: string; params: Record<string, unknown> }[] = [];
let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    istekler.push({ url: String(config.url), params: (config.params ?? {}) as Record<string, unknown> });
    return { data: [], status: 200, statusText: "OK", headers: {}, config } as never;
  };
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: ["tutors.view", "promotions.view"] } as never,
  });
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

function Konum() {
  return <span data-testid="adres">{useLocation().search}</span>;
}

function sar(yol: string, rota: string, sayfa: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[yol]}>
        <Konum />
        <Routes>
          <Route path={rota} element={sayfa} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const adres = () => screen.getByTestId("adres").textContent ?? "";
const son = (url: string) => [...istekler].reverse().find((i) => i.url === url);

describe("Ön başvurular · süzgeç adreste", () => {
  const URL = "/admin/tutor-pre-applications";
  const ac = (yol: string) =>
    sar(yol, ROUTES.adminTutorApplications, <AdminTutorApplicationsPage />);

  it("adresteki süzgeç ekranı ORADA açar ve isteğe konur", async () => {
    ac(`${ROUTES.adminTutorApplications}?durum=CONTACTED`);
    await waitFor(() => expect(son(URL)?.params.status).toBe("CONTACTED"));
    expect(screen.getByRole("button", { name: "Arandı" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("tıklama adrese yazılır; 'Tümü' durum göndermez, varsayılan 'Yeni' adrese yazılmaz", async () => {
    ac(ROUTES.adminTutorApplications);
    await waitFor(() => expect(son(URL)?.params.status).toBe("NEW"));
    expect(adres()).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Tümü" }));
    await waitFor(() => expect(adres()).toContain("durum=TUMU"));
    await waitFor(() => expect(son(URL)?.params).not.toHaveProperty("status"));
  });

  it("uydurma değer API'ye gitmez, varsayılana düşer", async () => {
    ac(`${ROUTES.adminTutorApplications}?durum=drop_table`);
    await waitFor(() => expect(son(URL)?.params.status).toBe("NEW"));
  });
});

describe("Öne çıkarmalar · süzgeç adreste", () => {
  const URL = "/admin/promotions";
  const ac = (yol: string) => sar(yol, ROUTES.adminPromotions, <AdminPromotionsPage />);

  it("adresteki süzgeç isteğe konur, tıklama adrese yazılır", async () => {
    ac(`${ROUTES.adminPromotions}?durum=PAID`);
    await waitFor(() => expect(son(URL)?.params.status).toBe("PAID"));
    expect(screen.getByRole("button", { name: "Ödenmiş" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Ödeme bekliyor" }));
    await waitFor(() => expect(adres()).toContain("durum=PENDING"));
    await waitFor(() => expect(son(URL)?.params.status).toBe("PENDING"));
  });

  it("uydurma değer API'ye gitmez", async () => {
    ac(`${ROUTES.adminPromotions}?durum=drop_table`);
    await waitFor(() => expect(son(URL)).toBeTruthy());
    expect(son(URL)?.params).not.toHaveProperty("status");
  });
});
