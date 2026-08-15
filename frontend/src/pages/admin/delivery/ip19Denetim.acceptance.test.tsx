// İP-19 bağımsız denetim · B-13b — salt-okunur admin'e SAHTE kontrol gösterilmez.
//
// SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.
//
// Paketin kendi ilkesi (§0.4): "hiçbir şey yapmayan düzenleme kontrolü YOK".
// Tur kurma formundaki araç seçicisi yalnız "Yeni Tur"un girdisidir; manage
// izni olmayan admin o butona zaten basamaz. Seçici bir süre `canManage`
// kapısının DIŞINDA durdu — çünkü kabul testi izinsiz bir admin sürüyordu ve
// kapının içinde kalınca bulunamıyordu. Bu düğüm, kapının geri konmuş hâlini
// nöbetleyerek aynı eğilmenin tekrarını engeller.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";
import DeliveryTodayPage from "@/pages/admin/delivery/DeliveryTodayPage";

import type { AxiosRequestConfig } from "axios";

const ARACLAR = [
  { id: 7, code: "LADA", label: "Lada", max_stops: 3, is_active: true, sort_order: 0 },
  { id: 9, code: "DOBLO", label: "Doblo", max_stops: 8, is_active: true, sort_order: 1 },
];

let interceptorId: number | null = null;

function kur() {
  interceptorId = apiClient.interceptors.request.use((cfg: AxiosRequestConfig) => {
    const url = cfg.url ?? "";
    const veri = url.includes("/delivery/vehicles") ? ARACLAR : [];
    return {
      ...cfg,
      adapter: async () => ({
        data: veri,
        status: 200,
        statusText: "OK",
        headers: {},
        config: cfg,
      }),
    } as never;
  });
}

function girisYap(izinler: string[]) {
  useAuthStore.setState({
    token: "t",
    user: {
      id: 1,
      role_id: 1,
      full_name: "Admin",
      email: "a@b.c",
      admin_permissions: izinler,
    } as never,
  });
}

function bas() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DeliveryTodayPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => kur());
afterEach(() => {
  if (interceptorId !== null) apiClient.interceptors.request.eject(interceptorId);
  interceptorId = null;
});

describe("B-13b · yetki kapısı", () => {
  it("manage izni olan admin araç seçicisini GÖRÜR", async () => {
    girisYap(["delivery.view", "delivery.manage"]);
    bas();
    await waitFor(() => expect(screen.getByLabelText(/^Araç$/)).toBeTruthy());
  });

  it("salt-okunur admin araç seçicisini GÖRMEZ", async () => {
    girisYap(["delivery.view"]);
    bas();
    // Sayfanın kendisi yüklendi (tarih girdisi her rolde var) ama hiçbir şey
    // yapmayan seçici yok.
    await waitFor(() => expect(screen.getByLabelText("Tur tarihi")).toBeTruthy());
    expect(screen.queryByLabelText(/^Araç$/)).toBeNull();
  });
});
