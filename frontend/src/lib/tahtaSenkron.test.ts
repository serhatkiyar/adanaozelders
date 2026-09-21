// @vitest-environment node
/**
 * Tahtanın bize özgü (pakette karşılığı olmayan) mantığı burada sınanır.
 *
 * Neden test var (kök CLAUDE.md "her değişikliğe test yazma" der): bu üç
 * davranışın üçü de ancak İKİ gerçek tarayıcı ile elle görülebilir, yani
 * kolayca sessizce bozulur — ve bozulduğunda belirtisi "tahta bazen tuhaf
 * davranıyor" gibi teşhis edilmesi pahalı bir şeydir:
 *   1. eko kırılmazsa iki taraf birbirini sonsuz besler,
 *   2. mezar taşı sürümü artmazsa silgi karşı ekranda hiç işlemez,
 *   3. bozuk bir paket çözücüyü düşürürse tahta sessizce donar.
 *
 * Çakışma çözümü (hangi sürüm kazanır) BURADA DEĞİL: onu paketin kendi
 * `reconcileElements`i yapıyor, kendi testleri var, kopyalanmadı.
 */
import { describe, expect, it } from "vitest";

import {
  degisenler,
  mesajCoz,
  silindiIsaretle,
  surumleriYaz,
  type TahtaEleman,
} from "./tahtaSenkron";

const el = (id: string, version: number, ek: Partial<TahtaEleman> = {}): TahtaEleman => ({
  id,
  version,
  ...ek,
});

describe("degisenler / surumleriYaz — eko kırma", () => {
  it("uzaktan uygulanan eleman geri yayınlanmaz", () => {
    const bilinen = new Map<string, number>();
    const gelen = [el("a", 4)];
    surumleriYaz(gelen, bilinen); // uzak mesaj uygulandı
    expect(degisenler(gelen, bilinen)).toEqual([]);
  });

  it("uzak sürüm reddedilip yerel sürüm sahnede kalırsa TEKRAR gönderilir", () => {
    const bilinen = new Map<string, number>();
    surumleriYaz([el("a", 2)], bilinen); // karşı taraf 2'de
    const sahne = [el("a", 9)]; // reconcile yereli seçti
    expect(degisenler(sahne, bilinen)).toEqual([el("a", 9)]);
  });

  it("hiç bilinmeyen eleman gönderilecekler arasındadır", () => {
    expect(degisenler([el("a", 1)], new Map())).toHaveLength(1);
  });

  it("değişmemiş elemanları eler, yalnız değişeni bırakır", () => {
    const bilinen = new Map([
      ["a", 1],
      ["b", 1],
    ]);
    expect(degisenler([el("a", 1), el("b", 2)], bilinen).map((e) => e.id)).toEqual(["b"]);
  });
});

describe("silindiIsaretle", () => {
  it("işaretler ve sürümü artırır — artmazsa silme karşı tarafta reddedilirdi", () => {
    const once = el("a", 4);
    const sonra = silindiIsaretle(once);
    expect(sonra.isDeleted).toBe(true);
    expect(sonra.version).toBeGreaterThan(once.version);
    expect(once.isDeleted).toBeUndefined(); // özgün eleman değiştirilmez
  });
});

describe("mesajCoz", () => {
  it("bozuk JSON'u yutar", () => {
    expect(mesajCoz("{bu json değil")).toBeNull();
  });

  it("tanımadığı türü yutar", () => {
    expect(mesajCoz(JSON.stringify({ t: "baskaBirSey" }))).toBeNull();
  });

  it("şekli bozuk elemanları eler, sağlamları geçirir", () => {
    const cozulen = mesajCoz(
      JSON.stringify({ t: "durum", elemanlar: [{ id: "a", version: 1 }, { id: "b" }, null] })
    );
    expect(cozulen).toEqual({ t: "durum", elemanlar: [{ id: "a", version: 1 }] });
  });

  it("dosyaları taşır", () => {
    const cozulen = mesajCoz(
      JSON.stringify({
        t: "durum",
        elemanlar: [],
        dosyalar: [{ id: "d1", dataURL: "data:image/jpeg;base64,xx" }],
      })
    );
    expect(cozulen).toMatchObject({ t: "durum", dosyalar: [{ id: "d1" }] });
  });

  it("istek ve temizle geçer", () => {
    expect(mesajCoz(JSON.stringify({ t: "istek" }))).toEqual({ t: "istek" });
    expect(mesajCoz(JSON.stringify({ t: "temizle" }))).toEqual({ t: "temizle" });
  });
});
