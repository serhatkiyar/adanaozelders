// @vitest-environment node
import { describe, expect, it } from "vitest";

import { oauthStartUrl } from "./auth";

/**
 * ## Bu nöbetçi neden var — ölçülmüş bir üretim kusuru
 *
 * Düğme ilk yazımda adresi `apiClient.defaults.baseURL` üzerinden kuruyordu ve
 * o değer GÖRELİ (`/api/v1`). Sonuç: tarayıcı akışı Vite dev sunucusu üzerinden
 * başlatıyor, Vite'ın proxy'si dış bir siteye (`accounts.google.com`) giden
 * 303'ü iletemiyor ve kullanıcı **500 Internal Server Error** görüyordu.
 *
 * Ölçüldü:
 *   proxy üzerinden (5173) → HTTP 500
 *   doğrudan API kökü (8000) → HTTP 303 → accounts.google.com
 *
 * Backend testlerinin hiçbiri bunu göremezdi: hepsi API'ye DOĞRUDAN gidiyor,
 * yani proxy hiç devreye girmiyordu. Kusur yalnız gerçek tarayıcıda vardı.
 *
 * Kural: OAuth başlangıcı bir XHR değil, TAM SAYFA GEZİNMEdir ve adresi
 * MUTLAK olmalıdır. Kök artık sunucudan gelir
 * (`/auth/oauth/providers` → `google_start_url`, `BACKEND_BASE_URL`den
 * türetilir), böylece `GOOGLE_OAUTH_REDIRECT_URI` ile aynı kaynağı paylaşır ve
 * ikisi hiçbir ortamda ayrışamaz.
 */

const KOK = "http://localhost:8000/api/v1/auth/google/start";

describe("oauthStartUrl", () => {
  it("MUTLAK adres üretir — göreli olursa proxy'ye düşer ve 500 verir", () => {
    const url = oauthStartUrl(KOK, { mod: "giris" });
    expect(url.startsWith("http://") || url.startsWith("https://")).toBe(true);
    // Göreli adresin imzası: "/" ile başlamak. Bu testin asıl iddiası bu.
    expect(url.startsWith("/")).toBe(false);
  });

  it("sunucudan gelen kökü olduğu gibi korur", () => {
    const uretim = "https://adanaozelders.com.tr/api/v1/auth/google/start";
    expect(oauthStartUrl(uretim, { mod: "giris" }).startsWith(uretim)).toBe(true);
  });

  it("giriş modunda yalnız mod ve hatırla taşır", () => {
    const q = new URL(oauthStartUrl(KOK, { mod: "giris" })).searchParams;
    expect(q.get("mod")).toBe("giris");
    expect(q.get("hatirla")).toBe("true");
    expect(q.get("rol")).toBeNull();
    expect(q.get("onay_surumu")).toBeNull();
  });

  it("kayıt modunda rol ve onay sürümü taşınır", () => {
    const q = new URL(
      oauthStartUrl(KOK, {
        mod: "kayit",
        rol: "tutor",
        onaySurumu: "2026-09-07",
        donus: "/magaza/urun/kitap-42",
      })
    ).searchParams;
    expect(q.get("mod")).toBe("kayit");
    expect(q.get("rol")).toBe("tutor");
    expect(q.get("onay_surumu")).toBe("2026-09-07");
    expect(q.get("donus")).toBe("/magaza/urun/kitap-42");
  });

  it("hatırla=false açıkça gönderilir", () => {
    // Atlanırsa sunucu varsayılanı (kalıcı çerez) uygulanır ve kullanıcının
    // "beni hatırlama" tercihi sessizce tersine döner.
    const q = new URL(oauthStartUrl(KOK, { mod: "giris", hatirla: false })).searchParams;
    expect(q.get("hatirla")).toBe("false");
  });

  it("dönüş adresi URL olarak kodlanır", () => {
    const url = oauthStartUrl(KOK, {
      mod: "giris",
      donus: "/egitmenler?ders=matematik&ilce=seyhan",
    });
    // Ham "&" kodlanmazsa `ilce` ayrı bir sorgu parametresine dönüşür ve
    // dönüş adresi sessizce kırpılır.
    expect(url).toContain("donus=%2Fegitmenler%3Fders%3Dmatematik%26ilce%3Dseyhan");
    expect(new URL(url).searchParams.get("donus")).toBe(
      "/egitmenler?ders=matematik&ilce=seyhan"
    );
  });
});
