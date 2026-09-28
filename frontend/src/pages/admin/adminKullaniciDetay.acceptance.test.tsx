/** Kullanıcı detayı: ilan durumu Türkçe etiketle görünür, ham enum kodu basılmaz. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import AdminUserDetailPage from "@/pages/admin/AdminUserDetailPage";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

let eskiAdapter: unknown;

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) =>
    ({
      data: {
        id: 5, role: "TUTOR", full_name: "Ayşe Yılmaz", email: "ayse@ornek.test",
        is_active: true, created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-02T10:00:00Z",
        last_seen_at: null, email_verified: true, tutor_status: "PENDING_APPROVAL",
        booking_count: 0, review_count: 0, demand_count: 0, order_count: 0,
      },
      status: 200, statusText: "OK", headers: {}, config,
    }) as never;
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: ["users.view"] } as never,
  });
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

it("ilan durumu Türkçe etiketle görünür", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`${ROUTES.adminUsers}/tutor/5`]}>
        <Routes>
          <Route path={`${ROUTES.adminUsers}/:role/:id`} element={<AdminUserDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  expect(await screen.findByText("Onay Bekliyor")).toBeTruthy();
  expect(screen.queryByText("PENDING_APPROVAL")).toBeNull();
});
