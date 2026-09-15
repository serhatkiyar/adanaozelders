/**
 * `apiClient` 401 → sessiz yenileme nöbetçisi (tani-sonsuz-spinner.md).
 *
 * Kök neden: yenileme isteği (`refreshAccessToken`, ham `axios.post`) zaman
 * aşımı taşımıyordu. Ağdaki yenileme isteği hiç settle olmazsa modül
 * seviyesindeki `refreshPromise` singleton'ı sonsuza kadar pending kalıyordu:
 * (1) o anki isteği bekleyen `apiClient` çağrısı hiç settle olmuyor, React
 * Query'nin `retry`i (yalnız reddedilince tetiklenir) hiç devreye girmiyordu;
 * (2) `.finally()` hiç çalışmadığı için `refreshPromise` temizlenmiyor, aynı
 * sekmedeki SONRAKİ her 401 yeni bir `/auth/refresh` isteği ATMADAN aynı ölü
 * promise'i bekliyordu.
 *
 * Bu testler gerçek `apiClient` interceptor zincirini kullanır; yalnız HTTP
 * taşıma katmanını (axios adapter) taklit eder — gerçek bir http/xhr
 * adapter'ın yaptığı gibi `config.timeout` varsa kendi zamanlayıcısını kurar
 * ve "ağ" hiç yanıt vermese bile o süre dolunca isteği reddeder. Sahte
 * zamanlayıcı (`vi.useFakeTimers`) ile ilerletiyoruz; gerçek süre beklemiyoruz.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

import { apiClient, REFRESH_TIMEOUT_MS } from "@/api/axios";
import { useAuthStore } from "@/store/authStore";

type HandlerResult = { status: number; data?: unknown } | "hang";
type Handler = (config: AxiosRequestConfig) => HandlerResult;

/**
 * Gerçek axios http/xhr adapter'larının davranışını taklit eder: `config`a
 * bakıp anında (mikro görev sırasına yakın) bir "ağ" sonucu üretir, AMA
 * `config.timeout` set edilmişse bağımsız bir zamanlayıcı da kurar — hangisi
 * önce settle ederse o kazanır. `handler` "hang" dönerse "ağ" tarafı asla
 * settle etmez; yalnız zamanlayıcı (varsa) isteği bitirebilir.
 */
function fakeAdapter(handler: Handler) {
  return (config: AxiosRequestConfig): Promise<AxiosResponse> => {
    return new Promise((resolve, reject) => {
      let settled = false;

      if (config.timeout && config.timeout > 0) {
        setTimeout(() => {
          if (settled) return;
          settled = true;
          const err = Object.assign(
            new Error(`timeout of ${config.timeout}ms exceeded`),
            { code: "ECONNABORTED", isAxiosError: true, config }
          );
          reject(err);
        }, config.timeout);
      }

      const result = handler(config);
      if (result === "hang") return; // "ağ" hiç yanıt vermiyor

      const response = {
        data: result.data ?? {},
        status: result.status,
        statusText: "",
        headers: {},
        config: config as AxiosRequestConfig & { headers: never },
      } as AxiosResponse;

      // Gerçek adapter'lar bile senkron değildir; bir mikro görev arkasına
      // koyup zamanlayıcıyla yarışı gerçekçi kılıyoruz.
      Promise.resolve().then(() => {
        if (settled) return;
        settled = true;
        if (result.status >= 200 && result.status < 300) {
          resolve(response);
        } else {
          reject(
            Object.assign(new Error(`Request failed with status code ${result.status}`), {
              isAxiosError: true,
              response,
              config,
              toJSON: () => ({}),
            })
          );
        }
      });
    });
  };
}

const TARGET_URL = "/panel/sinav-tanimlari";

describe("apiClient — 401 sessiz yenileme", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.getState().setToken("bayat-access-token");
  });

  afterEach(() => {
    useAuthStore.getState().logout();
    apiClient.defaults.adapter = undefined;
    axios.defaults.adapter = undefined;
    vi.useRealTimers();
  });

  it("askıda kalan yenileme: bekleyen istek REFRESH_TIMEOUT_MS sonunda reddedilir, sonsuza kadar beklemez", async () => {
    const handler: Handler = (config) => {
      if (String(config.url).includes("/auth/refresh")) return "hang";
      return { status: 401 };
    };
    apiClient.defaults.adapter = fakeAdapter(handler);
    axios.defaults.adapter = fakeAdapter(handler);

    let settled = false;
    let rejected = false;
    apiClient.get(TARGET_URL).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
        rejected = true;
      }
    );

    // Süre dolmadan ÖNCE hâlâ pending.
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS - 500);
    expect(settled).toBe(false);

    // Süre dolunca reddedilir — sonsuza kadar askıda kalmaz.
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(true);
    expect(rejected).toBe(true);
  });

  it("wedge yok: askıda kalan yenilemeden sonraki 401 YENİ bir /auth/refresh isteği atar", async () => {
    let refreshCalls = 0;
    const handler: Handler = (config) => {
      if (String(config.url).includes("/auth/refresh")) {
        refreshCalls += 1;
        return "hang";
      }
      return { status: 401 };
    };
    apiClient.defaults.adapter = fakeAdapter(handler);
    axios.defaults.adapter = fakeAdapter(handler);

    // İlk 401: refresh isteği atılır (ve askıda kalır), süre dolunca reddedilir
    // — bu da (mevcut, doğru davranış olarak) `logout()`ı tetikler ve token'ı
    // temizler. O ayrı kapı (token yoksa refresh denenmez) 4. testte zaten
    // kontrol ediliyor; burada asıl iddiayı (refreshPromise gerçekten sıfırlanıp
    // sıfırlanmadığını) o kapıdan bağımsız izole etmek için oturumu elle
    // yeniden kuruyoruz (örn. kullanıcı aynı sekmede tekrar giriş yapmış gibi).
    const first = apiClient.get(TARGET_URL).catch(() => "rejected");
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + 100);
    await first;
    expect(refreshCalls).toBe(1);
    useAuthStore.getState().setToken("yeniden-kurulan-token");

    // İkinci 401 (ayrı bir istek): ölü promise'i beklemek yerine YENİ bir
    // /auth/refresh isteği atmalı. Axios'un kendi istek zinciri (interceptor
    // + transform + adapter çağrısı) birkaç mikro görev sürdüğü için önce
    // bunları boşaltıyoruz.
    const second = apiClient.get(TARGET_URL).catch(() => "rejected");
    await vi.advanceTimersByTimeAsync(10);
    expect(refreshCalls).toBe(2);

    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + 100);
    await second;
  });

  it("gerileme yok: başarılı yenilemede orijinal istek yeni token ile tekrar denenir", async () => {
    let targetCalls = 0;
    const handler: Handler = (config) => {
      if (String(config.url).includes("/auth/refresh")) {
        return { status: 200, data: { access_token: "taze-token" } };
      }
      targetCalls += 1;
      if (targetCalls === 1) return { status: 401 };
      return { status: 200, data: { ok: true, auth: config.headers?.Authorization } };
    };
    apiClient.defaults.adapter = fakeAdapter(handler);
    axios.defaults.adapter = fakeAdapter(handler);

    const promise = apiClient.get(TARGET_URL);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    const response = await promise;

    expect(targetCalls).toBe(2);
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true, auth: "Bearer taze-token" });
    expect(useAuthStore.getState().token).toBe("taze-token");
  });

  it("token yokken 401: refresh denenmeden logout çağrılır ve istek reddedilir", async () => {
    useAuthStore.getState().logout();
    let refreshCalls = 0;
    const handler: Handler = (config) => {
      if (String(config.url).includes("/auth/refresh")) {
        refreshCalls += 1;
        return { status: 200, data: { access_token: "x" } };
      }
      return { status: 401 };
    };
    apiClient.defaults.adapter = fakeAdapter(handler);
    axios.defaults.adapter = fakeAdapter(handler);

    const logoutSpy = vi.spyOn(useAuthStore.getState(), "logout");

    await expect(apiClient.get(TARGET_URL)).rejects.toBeTruthy();
    expect(refreshCalls).toBe(0);
    expect(logoutSpy).toHaveBeenCalled();
  });
});
