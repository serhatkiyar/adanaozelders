import { MutationObserver } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "@/lib/queryClient";
import { toast, useToastStore } from "@/store/toastStore";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

/**
 * Global mutation hata yakalayıcısı: ekran hatayı kendi toast'ıyla
 * bildirdiyse ikinci bir toast çıkmamalı; ekran bildirmediyse global toast
 * kalmalı (kullanıcı hatayı hiç görmeden kalmasın).
 */
function sunucuHatasi(detail: string) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("500", "ERR_BAD_RESPONSE", config, null, {
    status: 500,
    statusText: "",
    headers: {},
    config,
    data: { detail },
  });
}

function hataliGozlemci(detail: string) {
  const observer = new MutationObserver(queryClient, {
    mutationFn: () => Promise.reject(sunucuHatasi(detail)),
  });
  // `hasListeners` false iken mutate düzeyi `onError` hiç çağrılmaz.
  const unsubscribe = observer.subscribe(() => {});
  return { observer, unsubscribe };
}

const hataToastlari = () =>
  useToastStore.getState().toasts.filter((t) => t.type === "error").map((t) => t.message);

async function bildirimleriBekle() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("queryClient · mutation hata bildirimi", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("mutate düzeyi onError toast gösteriyorsa global toast çıkmaz", async () => {
    const { observer, unsubscribe } = hataliGozlemci("sunucu-a");
    await observer
      .mutate(undefined, { onError: () => toast.error("Ekranın kendi mesajı") })
      .catch(() => {});
    await bildirimleriBekle();
    expect(hataToastlari()).toEqual(["Ekranın kendi mesajı"]);
    unsubscribe();
  });

  it("hiç ele alınmayan hata global toast olarak görünür", async () => {
    const { observer, unsubscribe } = hataliGozlemci("sunucu-b");
    await observer.mutate(undefined).catch(() => {});
    await bildirimleriBekle();
    expect(hataToastlari()).toEqual(["sunucu-b"]);
    unsubscribe();
  });

  it("mutate düzeyi onError toast göstermiyorsa global toast kalır", async () => {
    const { observer, unsubscribe } = hataliGozlemci("sunucu-c");
    await observer.mutate(undefined, { onError: () => {} }).catch(() => {});
    await bildirimleriBekle();
    expect(hataToastlari()).toEqual(["sunucu-c"]);
    unsubscribe();
  });

  it("mutateAsync + catch içinde toast gösteren ekranda tek toast çıkar", async () => {
    const { observer, unsubscribe } = hataliGozlemci("sunucu-d");
    try {
      await observer.mutate(undefined);
    } catch {
      toast.error("Catch mesajı");
    }
    await bildirimleriBekle();
    expect(hataToastlari()).toEqual(["Catch mesajı"]);
    unsubscribe();
  });
});
