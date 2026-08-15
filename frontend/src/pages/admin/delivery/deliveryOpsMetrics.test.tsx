// İP-19 · Operasyon metrikleri bölümü (DeliveryPerformancePage) — gerçek DOM +
// GERÇEKTEN gönderilen query parametreleri. "Element var" tek başına kanıt
// sayılmaz: istekler axios interceptor'ından okunur, null→"—" ayrımı ölçülür
// (backend null'u bilinçli gönderir; %0 ile karıştırılamaz).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";

import DeliveryPerformancePage from "./DeliveryPerformancePage";

import type { DeliveryMetrics } from "@/api/delivery";
import type { AxiosRequestConfig } from "axios";

/* ══════════════ Sahte sunucu (İP-12/İP-19 deseni) ══════════════ */

interface Istek {
  method: string;
  url: string;
  params: Record<string, unknown> | null;
}

const istekler: Istek[] = [];
let interceptorId: number | null = null;

// Sayfadaki KPI bölümü de istek atar — boş ama şekil-doğru yanıt yeter.
const KPI_BOS = {
  on_time_rate: null,
  first_attempt_rate: null,
  satisfaction_rate: null,
  delivered: 0,
  failed: 0,
  rescheduled: 0,
  on_time_delivered: 0,
  promised_delivered: 0,
  first_attempt_delivered: 0,
  delivered_count: 0,
  failed_not_courier_fault: 0,
  feedback_up: 0,
  feedback_down: 0,
  feedback_problems: {},
  fail_by_reason: {},
};

let metrikYaniti: DeliveryMetrics;

function kur() {
  interceptorId = apiClient.interceptors.request.use((cfg: AxiosRequestConfig) => {
    const url = cfg.url ?? "";
    istekler.push({
      method: (cfg.method ?? "get").toLowerCase(),
      url,
      params: (cfg.params as Record<string, unknown>) ?? null,
    });
    const veri = url.includes("/delivery/metrics")
      ? metrikYaniti
      : url.includes("/delivery/kpi")
        ? KPI_BOS
        : url.includes("/delivery/feedback")
          ? []
          : {};
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
  metrikYaniti = {
    on_time_rate: null,
    first_attempt_rate: 0.5,
    stops_per_hour: null,
    fail_reasons: {},
    km_per_delivery: null,
    delivered: 3,
    planned: 4,
  };
  useAuthStore.setState({
    token: "t",
    user: { id: 1, role_id: 1, full_name: "Admin", email: "a@b.c" } as never,
  });
  kur();
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
        <DeliveryPerformancePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Sayfayla aynı yerel-gün formülü: bugün dahil son N günün başlangıcı. */
function yerelGun(gunOnce: number): string {
  const d = new Date();
  d.setDate(d.getDate() - gunOnce);
  const ay = String(d.getMonth() + 1).padStart(2, "0");
  const gun = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${ay}-${gun}`;
}

const metrikIstekleri = () => istekler.filter((i) => i.url.includes("/delivery/metrics"));

/* ══════════════ Testler ══════════════ */

describe("İP-19 — operasyon metrikleri bölümü", () => {
  it("varsayılan son 7 gün: from_date/to_date GERÇEKTEN gönderilir", async () => {
    bas();
    await waitFor(() => expect(metrikIstekleri().length).toBeGreaterThan(0));
    expect(metrikIstekleri()[0].params).toEqual({
      from_date: yerelGun(6), // bugün dahil 7 takvim günü
      to_date: yerelGun(0),
    });
  });

  it("30 gün seçilince istek genişletilmiş from_date ile YENİDEN atılır", async () => {
    bas();
    const bolum = await screen.findByTestId("ops-metrikler");
    await waitFor(() => expect(metrikIstekleri().length).toBeGreaterThan(0));

    // KPI başlığında da "30 gün" var — ops bölümüne SCOPE'lanır.
    fireEvent.click(within(bolum).getByRole("button", { name: "30 gün" }));

    await waitFor(() => {
      const son = metrikIstekleri().at(-1)!;
      expect(son.params).toEqual({ from_date: yerelGun(29), to_date: yerelGun(0) });
    });
  });

  it("null metrik '—' + 'henüz veri yok' — dolu metrik yüzde olarak (nöbetçi)", async () => {
    bas();
    const bolum = await screen.findByTestId("ops-metrikler");

    // null → "—" ve alt metin; ASLA "%0" değil.
    const zamaninda = await within(bolum).findByTestId("ops-metrik-zamaninda");
    expect(zamaninda.textContent).toContain("—");
    expect(zamaninda.textContent).toContain("henüz veri yok");
    expect(zamaninda.textContent).not.toContain("%0");

    // NÖBETÇİ: dolu değer normal görünür — null işleme gerçek veriyi maskelemiyor.
    const ilkDeneme = within(bolum).getByTestId("ops-metrik-ilk-deneme");
    expect(ilkDeneme.textContent).toContain("%50");
    expect(ilkDeneme.textContent).not.toContain("henüz veri yok");

    // Sayaç çifti her zaman sayıdır.
    expect(within(bolum).getByTestId("ops-metrik-teslim-plan").textContent).toContain("3/4");
  });

  it("fail_reasons dağılımı Türkçe etiketli çubuklarla listelenir", async () => {
    metrikYaniti = {
      ...metrikYaniti,
      fail_reasons: { EVDE_YOK: 5, ADRES_SORUNU: 2 },
    };
    bas();
    const bolum = await screen.findByTestId("ops-metrikler");

    // lib/deliveryRun.ts'teki FAIL_REASON_LABEL sözlüğü kullanılır (kod değil etiket).
    expect(await within(bolum).findByText("Kimse evde yok")).toBeTruthy();
    expect(within(bolum).getByText("Adres bulunamadı / pin yanlış")).toBeTruthy();
    expect(within(bolum).getByText("5")).toBeTruthy();
    expect(within(bolum).queryByText("EVDE_YOK")).toBeNull();
  });
});
