/**
 * İP-A2 · M7 — zod hata mesajları Türkçeleşiyor mu?
 *
 * Bu dosya `form.tsx`'i **statik import ETMEZ**. Sebebi ölçüm dürüstlüğü:
 * Türkçe harita global bir yan etkidir (`z.config`), modül yüklenir yüklenmez
 * kurulur. Statik import olsaydı "önce İngilizceydi" iddiası kanıtlanamazdı —
 * test kendi kurulumunu ölçmüş olurdu. Burada sıra elle kurulur:
 * önce çıplak zod ölçülür, SONRA katman yüklenir, sonra tekrar ölçülür.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

const mesaj = (r: z.ZodSafeParseResult<unknown>) =>
  r.success ? "" : r.error.issues[0].message;

describe("İP-A2 · zod Türkçe hata haritası", () => {
  it("M7 — katman yüklenmeden İngilizce, yüklendikten sonra Türkçe", async () => {
    // 1) Çıplak zod: varsayılan mesajlar İngilizce.
    const oncesi = mesaj(z.string().safeParse(42));
    expect(oncesi).toMatch(/expected string/i);
    expect(oncesi).not.toMatch(/beklenen|geçersiz/i);

    // 2) Katman yüklenir — Türkçe harita kurulumu bunun yan etkisidir.
    await import("./form");

    // 3) Aynı çağrı artık Türkçe.
    const sonrasi = mesaj(z.string().safeParse(42));
    // Not: yerel, tip ADINI ("string") çevirmez — çeviren cümledir:
    // "Geçersiz değer: beklenen string, alınan sayı".
    expect(sonrasi).toMatch(/geçersiz değer: beklenen/i);
    expect(sonrasi).not.toMatch(/expected|received|invalid/i);
  });

  it("M7b — sık kullanılan kısıtların mesajları da Türkçe", async () => {
    await import("./form");
    expect(mesaj(z.string().min(3).safeParse("a"))).not.toMatch(
      /expected|at least|too small/i
    );
    expect(mesaj(z.number().int().safeParse(1.5))).not.toMatch(
      /expected|integer/i
    );
    expect(mesaj(z.string().email().safeParse("x"))).not.toMatch(
      /invalid|email/i
    );
  });
});
