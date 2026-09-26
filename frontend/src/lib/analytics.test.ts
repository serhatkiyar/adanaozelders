/**
 * Analitik katmanı — opt-in davranışı ve adres temizliği.
 *
 * Kritik iddia: takip/doğrulama/şifre-sıfırlama token'ları adres çubuğunda
 * taşınıyor; bunların analitik sunucusunda birikmesi tek başına bir güvenlik
 * olayı olurdu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initAnalytics, trackPageview } from "./analytics";

const SCRIPT_URL = "/istatistik/script.js";

function setEnv(src?: string, websiteId?: string) {
  vi.stubEnv("VITE_ANALYTICS_SCRIPT_URL", src ?? "");
  vi.stubEnv("VITE_ANALYTICS_WEBSITE_ID", websiteId ?? "");
}

function fakeUmami() {
  const track = vi.fn();
  (window as unknown as { umami: unknown }).umami = { track };
  return track;
}

beforeEach(() => {
  document.head.innerHTML = "";
  delete (window as unknown as { umami?: unknown }).umami;
  vi.unstubAllEnvs();
});

describe("initAnalytics", () => {
  it("ayar yoksa hiçbir script eklemez", () => {
    setEnv(undefined);
    initAnalytics();
    expect(document.getElementById("site-analytics")).toBeNull();
  });

  it("ayar varsa script'i bir kez ekler", () => {
    setEnv(SCRIPT_URL, "abc-123");
    initAnalytics();
    initAnalytics(); // ikinci çağrı yinelememeli
    const scripts = document.querySelectorAll("#site-analytics");
    expect(scripts).toHaveLength(1);
    const el = scripts[0] as HTMLScriptElement;
    expect(el.src).toContain(SCRIPT_URL);
    expect(el.dataset.websiteId).toBe("abc-123");
  });

  it("otomatik takibi kapatır (sayfa görüntülemesini kendimiz bildiririz)", () => {
    setEnv(SCRIPT_URL);
    initAnalytics();
    const el = document.getElementById("site-analytics") as HTMLScriptElement;
    expect(el.dataset.autoTrack).toBe("false");
  });
});

describe("trackPageview", () => {
  it("ayar yoksa sağlayıcıya dokunmaz", () => {
    setEnv(undefined);
    const track = fakeUmami();
    trackPageview("/hesabim");
    expect(track).not.toHaveBeenCalled();
  });

  it("sorgu dizesini ATAR — token'lar analitiğe gitmez", () => {
    setEnv(SCRIPT_URL);
    const track = fakeUmami();
    trackPageview("/siparis-takip?token=gizli-takip-anahtari");
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/siparis-takip" })
    );
    expect(JSON.stringify(track.mock.calls)).not.toContain("gizli-takip-anahtari");
  });

  it("fragment de atılır", () => {
    setEnv(SCRIPT_URL);
    const track = fakeUmami();
    trackPageview("/e-posta-dogrula#token=abc");
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ url: "/e-posta-dogrula" }));
  });

  it("sağlayıcı henüz yüklenmediyse patlamaz", () => {
    setEnv(SCRIPT_URL);
    expect(() => trackPageview("/egitmenler")).not.toThrow();
  });
});

describe("Google Analytics 4 ve Meta Pixel", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    const w = window as unknown as Record<string, unknown>;
    delete w.gtag;
    delete w.dataLayer;
    delete w.fbq;
    delete w._fbq;
    setEnv();
  });

  it("ID verilmezse hiçbir script yüklenmez", () => {
    vi.stubEnv("VITE_GA_ID", "");
    vi.stubEnv("VITE_META_PIXEL_ID", "");
    initAnalytics();
    expect(document.querySelectorAll("script").length).toBe(0);
  });

  it("ID verilince yüklenir; sayfa görüntülemesi sorgu dizesiz gider", () => {
    vi.stubEnv("VITE_GA_ID", "G-TEST123");
    vi.stubEnv("VITE_META_PIXEL_ID", "1234567890");
    initAnalytics();
    const kaynaklar = Array.from(document.querySelectorAll("script")).map((s) => s.src);
    expect(kaynaklar.some((s) => s.includes("googletagmanager.com/gtag/js?id=G-TEST123"))).toBe(true);
    expect(kaynaklar.some((s) => s.includes("connect.facebook.net"))).toBe(true);

    const w = window as unknown as { dataLayer: IArguments[]; fbq: { queue: unknown[][] } };
    trackPageview("/sifre-sifirla?token=gizli");
    const olay = w.dataLayer.map((a) => Array.from(a)).find((a) => a[1] === "page_view");
    expect(olay?.[2]).toMatchObject({ page_path: "/sifre-sifirla" });
    expect(JSON.stringify(w.dataLayer.map((a) => Array.from(a)))).not.toContain("gizli");
    expect(w.fbq.queue).toContainEqual(["track", "PageView"]);
  });
});
