import { describe, expect, it } from "vitest";
import { stripSensitiveParams } from "./monitoring";

/**
 * Hata raporları üçüncü bir servise (Sentry) gider. Bu uygulamada token'lar
 * URL'de taşınabiliyor — WebSocket `?token=`, kargo takip linki, e-posta
 * doğrulama/şifre sıfırlama bağlantıları. Maskelenmezlerse hata izleme paneli
 * geçerli oturum anahtarlarının deposuna dönüşür.
 */
describe("stripSensitiveParams", () => {
  it("token parametresini maskeler", () => {
    expect(stripSensitiveParams("https://x.tr/ws?token=abc123")).toContain(
      "token=%5Bgizlendi%5D"
    );
    expect(stripSensitiveParams("https://x.tr/ws?token=abc123")).not.toContain("abc123");
  });

  it("oturum ve OTP anahtarlarını maskeler", () => {
    for (const key of ["access_token", "refresh_token", "code", "otp"]) {
      const out = stripSensitiveParams(`https://x.tr/y?${key}=SIR`);
      expect(out).not.toContain("SIR");
    }
  });

  it("birden çok hassas parametreyi birlikte maskeler", () => {
    // Not: tek harflik sır değeri kullanmayın — maskelenmiş çıktı
    // `%5Bgizlendi%5D` içerdiğinden "B" gibi harfler yanlış eşleşir.
    const out = stripSensitiveParams(
      "https://x.tr/y?token=ILK_SIR&refresh_token=IKINCI_SIR&sayfa=2"
    );
    expect(out).not.toContain("ILK_SIR");
    expect(out).not.toContain("IKINCI_SIR");
    expect(out).toContain("sayfa=2"); // zararsız parametre korunur
  });

  it("hassas parametre yoksa URL'i değiştirmez", () => {
    const url = "https://x.tr/egitmenler?ilce=Seyhan&sayfa=2";
    expect(stripSensitiveParams(url)).toBe(url);
  });

  it("göreli yolları da işler", () => {
    expect(stripSensitiveParams("/kargo-takip?token=GIZLI")).not.toContain("GIZLI");
  });

  it("ayrıştırılamayan girdide çökmez", () => {
    expect(stripSensitiveParams("http://[bozuk")).toBe("http://[bozuk");
    expect(stripSensitiveParams("")).toBe("");
  });
});
