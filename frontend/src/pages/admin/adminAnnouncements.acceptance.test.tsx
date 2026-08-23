import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AxiosRequestConfig } from "axios";

import { apiClient } from "@/api/axios";
import { ROUTES } from "@/lib/routes";
import AdminAnnouncementsPage from "@/pages/admin/AdminAnnouncementsPage";
import { useAuthStore } from "@/store/authStore";
import { useToastStore } from "@/store/toastStore";

interface RequestRecord {
  method: string;
  url: string;
  body: unknown;
}

type ResponseRecord = { status?: number; data: unknown };
let routes: { matches: (request: RequestRecord) => boolean; response: ResponseRecord }[] = [];
let requests: RequestRecord[] = [];
let oldAdapter: unknown;

function server(pattern: string, response: ResponseRecord, method?: string) {
  routes.unshift({
    matches: (request) => (!method || request.method === method) && request.url.split("?")[0].includes(pattern),
    response,
  });
}

beforeEach(() => {
  oldAdapter = apiClient.defaults.adapter;
  routes = [];
  requests = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const request = { method: (config.method ?? "get").toLowerCase(), url: String(config.url), body: config.data };
    requests.push(request);
    const response = routes.find((route) => route.matches(request))?.response ?? { data: [] };
    return { data: response.data, status: response.status ?? 200, statusText: "OK", headers: {}, config } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = oldAdapter as never;
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  useToastStore.setState({ toasts: [] });
});

function login(permissions: string[]) {
  useAuthStore.setState({
    token: "test-token",
    isAuthenticated: true,
    user: { id: 1, role_id: 1, admin_permissions: permissions } as never,
  });
}

const SLIDE = {
  id: 7,
  image_url: "https://cdn.example.com/hero.webp",
  mobile_image_url: null,
  alt_text: "Okula dönüş kampanyası",
  link_url: "/magaza?q=okul",
  is_active: true,
  starts_at: null,
  ends_at: null,
  sort_order: 0,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ROUTES.adminStoreHero]}>
        <Routes><Route path={ROUTES.adminStoreHero} element={<AdminAnnouncementsPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Admin vitrin görselleri", () => {
  it("görüntüleme izni yoksa erişimi kapatır", async () => {
    login(["settings.view"]);
    server("/admin/store-hero-slides", { data: [SLIDE] }, "get");
    renderPage();
    expect(await screen.findByRole("heading", { name: /yetkiniz yok/i })).not.toBeNull();
  });

  it("API görselini ve durumunu gösterir", async () => {
    login(["announcements.view", "announcements.manage"]);
    server("/admin/store-hero-slides", { data: [SLIDE] }, "get");
    renderPage();
    expect(await screen.findByRole("img", { name: "Okula dönüş kampanyası" })).not.toBeNull();
    expect(screen.getByText("Aktif")).not.toBeNull();
  });

  it("yalnız görüntüleme izninde yükleme ve kaydetme aksiyonlarını gizler", async () => {
    login(["announcements.view"]);
    server("/admin/store-hero-slides", { data: [SLIDE] }, "get");
    renderPage();
    await screen.findByRole("img", { name: "Okula dönüş kampanyası" });
    expect(screen.queryByRole("button", { name: /yeni görsel yükle/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^kaydet$/i })).toBeNull();
  });

  it("seçilen dosyayı multipart olarak yükler", async () => {
    login(["announcements.view", "announcements.manage"]);
    server("/admin/store-hero-slides", { data: [] }, "get");
    server("/admin/store-hero-slides", { status: 201, data: SLIDE }, "post");
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /yeni görsel yükle/i }));
    const image = new File(["image"], "hero.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Masaüstü görseli"), { target: { files: [image] } });
    await screen.findByText("hero.png");
    const submit = screen.getByRole("button", { name: /görseli yükle/i });
    fireEvent.submit(submit.closest("form")!);

    await waitFor(() => {
      const request = requests.find((item) => item.method === "post");
      expect(request?.body).toBeInstanceOf(FormData);
      expect((request?.body as FormData).get("image")).toBe(image);
    });
  });

  it("silme işleminden önce onay ister", async () => {
    login(["announcements.view", "announcements.manage"]);
    server("/admin/store-hero-slides", { data: [SLIDE] }, "get");
    server("/admin/store-hero-slides/7", { status: 204, data: null }, "delete");
    renderPage();
    await screen.findByRole("img", { name: "Okula dönüş kampanyası" });
    fireEvent.click(screen.getByRole("button", { name: /^sil$/i }));
    expect(requests.some((request) => request.method === "delete")).toBe(false);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /görseli sil/i }));
    await waitFor(() => expect(requests.some((request) => request.method === "delete")).toBe(true));
  });
});
