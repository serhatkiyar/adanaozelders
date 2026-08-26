/**
 * P5 · Yayın bir OLAYDIR; taslak kaydetmek değildir.
 *
 * ## İki ayrı kusur
 *
 * 1. `useMerchandisingMutations` içindeki ortak `refresh()` HER mutasyonda
 *    public `["store","home"]` ve `["store","page"]` anahtarlarını da
 *    geçersiz kılıyordu. Yani **taslak kaydetmek** — ki 900 ms'de bir
 *    olabiliyor — mağaza vitrininin public önbelleğini tazeliyordu. Hem
 *    boşuna istek hem kavramsal karışıklık: taslak canlıyı değiştirmez.
 *
 * 2. Yayınladıktan sonra açık duran bir mağaza sekmesi bunu HİÇ öğrenmiyordu.
 *    Global `refetchOnWindowFocus` kapalı (`lib/queryClient.ts`) ve o ayar
 *    tek bir vitrin ihtiyacı için DEĞİŞTİRİLMEZ — bütün uygulamanın ağ
 *    davranışını ölçülmemiş biçimde değiştirirdi. Çözüm hedeflenmiş olmalı.
 *
 * ## Ölçülen sözleşme
 *
 *   • Taslak kaydı public vitrin isteği DOĞURMAZ; yayınlamak doğurur.
 *   • Yayın aynı tarayıcıdaki açık mağaza sekmesine DUYURULUR
 *     (`BroadcastChannel`; WebSocket gerekmez).
 *   • Sekmeye geri dönüldüğünde vitrin bayatsa kendini tazeler.
 */
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { focusManager } from "@tanstack/react-query";
import { render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient } from "@/api/axios";
import {
  useMerchandisingMutations,
  useStoreHomePage,
} from "@/hooks/useStoreMerchandising";
import { VITRIN_KANALI, yayinDuyur } from "@/lib/storefrontBroadcast";

import type { AxiosRequestConfig } from "axios";
import type { ReactNode } from "react";

let istekler: string[] = [];
let eskiAdapter: unknown;

const HOME = {
  id: 1,
  slug: "ana-sayfa",
  page_type: "HOME",
  state: "LIVE",
  revision: { id: 9, blocks: [] },
};

beforeEach(() => {
  eskiAdapter = apiClient.defaults.adapter;
  istekler = [];
  apiClient.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = String(config.url);
    istekler.push(`${(config.method ?? "get").toUpperCase()} ${url.split("?")[0]}`);
    return {
      data: url.includes("/store/home") ? HOME : {},
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as never;
  };
});

afterEach(() => {
  apiClient.defaults.adapter = eskiAdapter as never;
  focusManager.setFocused(undefined);
});

function sarici(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const vitrinIstekleri = () =>
  istekler.filter((i) => i.includes("/store/home"));

describe("yayın olayı", () => {
  it("TASLAK kaydı public vitrin isteği DOĞURMAZ", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Vitrin bir kez yüklensin ki önbellekte bir gözlemci olsun.
    renderHook(() => useStoreHomePage(), { wrapper: sarici(qc) });
    await waitFor(() => expect(vitrinIstekleri().length).toBe(1));

    const { result } = renderHook(() => useMerchandisingMutations(), {
      wrapper: sarici(qc),
    });
    await result.current.saveDraft.mutateAsync({
      pageId: 1,
      payload: { title: "x", seo_title: "", seo_description: "", blocks: [] },
    });

    // Bir tur bekle: geçersiz kılma olsaydı yeniden çekilirdi.
    await new Promise((r) => setTimeout(r, 150));
    expect(vitrinIstekleri().length).toBe(1);
  });

  it("YAYINLAMAK public vitrini tazeler", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useStoreHomePage(), { wrapper: sarici(qc) });
    await waitFor(() => expect(vitrinIstekleri().length).toBe(1));

    const { result } = renderHook(() => useMerchandisingMutations(), {
      wrapper: sarici(qc),
    });
    await result.current.publishPage.mutateAsync({
      pageId: 1,
      startsAt: new Date().toISOString(),
    });

    await waitFor(() => expect(vitrinIstekleri().length).toBe(2));
  });

  it("YAYINLAMAK duyuruyu GERÇEKTEN gönderir (kablo testi)", async () => {
    // TEST KUSURU NOTU (ölçüldü): aşağıdaki dinleyici testi `yayinDuyur()`u
    // DOĞRUDAN çağırıyor, yani yalnız dinleyiciyi kanıtlıyor. `refreshPublished`
    // içinden `yayinDuyur()` çağrısını SİLEN mutasyon onu kırmıyordu. Kabloyu
    // ölçen şey budur: yayın mutasyonu kanala gerçekten mesaj koyuyor mu.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const dinleyici = new BroadcastChannel(VITRIN_KANALI);
    const mesajlar: unknown[] = [];
    dinleyici.addEventListener("message", (olay) => mesajlar.push(olay.data));
    try {
      const { result } = renderHook(() => useMerchandisingMutations(), {
        wrapper: sarici(qc),
      });
      await result.current.publishPage.mutateAsync({
        pageId: 1,
        startsAt: new Date().toISOString(),
      });
      await waitFor(() => expect(mesajlar.length).toBeGreaterThan(0), {
        timeout: 4000,
      });
    } finally {
      dinleyici.close();
    }
  });

  it("yayın duyurusu açık mağaza sekmesini tazeler", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useStoreHomePage(), { wrapper: sarici(qc) });
    await waitFor(() => expect(vitrinIstekleri().length).toBe(1));

    // Yönetici başka bir sekmede yayınladı.
    yayinDuyur();

    await waitFor(() => expect(vitrinIstekleri().length).toBe(2), {
      timeout: 4000,
    });
  });

  it("sekmeye geri dönülünce BAYAT vitrin tazelenir (taze olan tazelenmez)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useStoreHomePage(), { wrapper: sarici(qc) });
    await waitFor(() => expect(vitrinIstekleri().length).toBe(1));

    // ÖNCE: veri TAZEyken odaklanmak istek DOĞURMAMALI. Her odakta yeniden
    // çekmek ziyaretçi başına boşuna trafik olurdu; sözleşme "bayatsa
    // tazele"dir. (İlk yazımda bu ayrım atlanmış ve test yanlış bir
    // beklentiyle kurulmuştu.)
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(vitrinIstekleri().length).toBe(1);

    // SONRA: veriyi bayatlat (staleTime 60 sn) ve tekrar odaklan.
    qc.setQueryData(["store", "home"], HOME, {
      updatedAt: Date.now() - 120_000,
    });
    focusManager.setFocused(false);
    focusManager.setFocused(true);

    // Global ayar DEĞİŞMEDEN, yalnız bu sorgu odakta tazeleniyor.
    await waitFor(() => expect(vitrinIstekleri().length).toBe(2), {
      timeout: 4000,
    });
  });
});
