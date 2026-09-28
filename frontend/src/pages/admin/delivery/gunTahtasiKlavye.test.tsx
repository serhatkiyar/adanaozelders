// Gün tahtası — sürükle-bırakın klavye/dokunmatik karşılığı ("Tura ata").
//
// Denetim bulgusu: siparişi tura atamanın TEK yolu HTML5 sürükle-bıraktı;
// klavyede ve çoğu dokunmatik tarayıcıda çalışmıyordu. Menü aynı atama yolunu
// kullanır; burada sunucuya GERÇEKTEN giden istek gövdesi ölçülür (ip19Filo
// D-11 deseni) — "menü açıldı" tek başına kanıt değil.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import DeliveryBoardPage from "./DeliveryBoardPage";

import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";

import type { AxiosRequestConfig } from "axios";

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
];

const TAHTA = {
  unassigned: [{ order_id: 101, address: "Seyhan / A Sok.", lat: 36.99, lng: 35.32 }],
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
    { id: 56, vehicle_id: 9, status: "PLANNED", stops: [] },
  ],
};

beforeEach(() => {
  istekler.length = 0;
  useAuthStore.setState({
    token: "t",
    user: {
      id: 1,
      role_id: 1,
      full_name: "Admin",
      email: "a@b.c",
      admin_permissions: ["delivery.view", "delivery.manage"],
    } as never,
  });
  interceptorId = apiClient.interceptors.request.use((cfg: AxiosRequestConfig) => {
    const url = cfg.url ?? "";
    istekler.push({
      method: (cfg.method ?? "get").toLowerCase(),
      url,
      body:
        typeof cfg.data === "string"
          ? JSON.parse(cfg.data)
          : ((cfg.data as Record<string, unknown> | undefined) ?? null),
    });
    const veri = url.includes("/delivery/vehicles")
      ? ARACLAR
      : url.includes("/delivery/board")
        ? TAHTA
        : {};
    return {
      ...cfg,
      adapter: async () => ({ data: veri, status: 200, statusText: "OK", headers: {}, config: cfg }),
    };
  });
});

afterEach(() => {
  if (interceptorId !== null) apiClient.interceptors.request.eject(interceptorId);
  interceptorId = null;
});

function bas() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DeliveryBoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Gün tahtası — klavyeyle tura atama", () => {
  it("'Tura ata' menüsü klavyeyle sürükle-bırakla AYNI POST'u atar", async () => {
    const u = userEvent.setup();
    bas();

    const tetik = await screen.findByRole("button", { name: /^Tura ata, Sipariş #101$/ });
    tetik.focus();
    await u.keyboard("{Enter}");

    // Menü ilk öğeye odaklanır; ok tuşuyla ikinci tura geç, Enter ile seç.
    await screen.findByRole("menu", { name: "Sipariş #101 için tur seç" });
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain("Tur #55"),
    );
    await u.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      const post = istekler.find(
        (i) => i.method === "post" && i.url.includes("/delivery/runs/56/stops"),
      );
      expect(post, "menü seçimi sunucuya gitmedi").toBeTruthy();
      expect(post!.body).toMatchObject({ order_ids: [101] });
    });
  });

  it("kapasite aşımında menüden atama da uyarıyı gösterir ama ENGELLEMEZ", async () => {
    const u = userEvent.setup();
    bas();

    await u.click(await screen.findByRole("button", { name: /^Tura ata, Sipariş #101$/ }));
    await u.click(await screen.findByRole("menuitem", { name: /Tur #55 · Lada \(3\/3 durak\)/ }));

    expect(await screen.findByTestId("kapasite-uyarisi-55")).toBeTruthy();
    await waitFor(() =>
      expect(
        istekler.some((i) => i.method === "post" && i.url.includes("/delivery/runs/55/stops")),
      ).toBe(true),
    );
  });
});
