// @vitest-environment node
import { describe, expect, it } from "vitest";

import { KISA_CEVAP_ESIGI, cevapCokKisaMi } from "@/lib/kisaCevapUyarisi";

describe("cevapCokKisaMi", () => {
  it("boş metni kısa saymaz (gönder düğmesi zaten ayrı yerde kapalı)", () => {
    expect(cevapCokKisaMi("")).toBe(false);
    expect(cevapCokKisaMi("   ")).toBe(false);
  });

  it("eşiğin altındaki metni kısa sayar", () => {
    expect(cevapCokKisaMi("Merhaba, IELTS hedefin kaç puan?")).toBe(false); // 32 karakter — eşiğin (30) üstünde
    expect(cevapCokKisaMi("Merhaba, hedefin ne?")).toBe(true); // 20 karakter
  });

  it("sınır tam eşit uzunlukta kısa SAYILMAZ (yön: 'altında', 'eşit veya üstünde' değil)", () => {
    const tamEsik = "a".repeat(KISA_CEVAP_ESIGI);
    expect(cevapCokKisaMi(tamEsik)).toBe(false);
    expect(cevapCokKisaMi(tamEsik.slice(0, -1))).toBe(true);
  });

  it("baştaki/sondaki boşluk uzunluğa sayılmaz", () => {
    expect(cevapCokKisaMi("   kısa   ")).toBe(true);
  });
});
