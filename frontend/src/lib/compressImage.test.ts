// compressImage — jsdom'da canvas/createImageBitmap yoktur; burada test edilen
// şey ERKEN DÖNÜŞ sözleşmesidir: sıkıştırılamayacak/gereksiz dosyalar DOKUNULMADAN
// aynen döner (akış asla bloklanmaz). Gerçek küçültme tarayıcıda çalışır.
import { describe, expect, it } from "vitest";

import { compressImage } from "./compressImage";

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe("compressImage", () => {
  it("görsel olmayan dosyayı aynen döndürür", async () => {
    const f = makeFile("belge.pdf", "application/pdf", 5_000_000);
    expect(await compressImage(f)).toBe(f);
  });

  it("zaten küçük görseli aynen döndürür (yeniden kodlama israfı yok)", async () => {
    const f = makeFile("kucuk.jpg", "image/jpeg", 100 * 1024);
    expect(await compressImage(f)).toBe(f);
  });

  it("ortam desteklemiyorsa (jsdom: createImageBitmap yok) orijinali döndürür", async () => {
    // Büyük görsel → sıkıştırma denenir → jsdom'da patlar → orijinal dönmeli.
    const f = makeFile("buyuk.jpg", "image/jpeg", 5_000_000);
    expect(await compressImage(f)).toBe(f);
  });
});
