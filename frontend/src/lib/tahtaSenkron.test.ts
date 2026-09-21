// @vitest-environment node
/**
 * Tahtanın bize özgü (pakette karşılığı olmayan) mantığı burada sınanır.
 *
 * Neden test var (kök CLAUDE.md "her değişikliğe test yazma" der): bu üç
 * davranışın üçü de ancak İKİ gerçek tarayıcı ile elle görülebilir, yani
 * kolayca sessizce bozulur — ve bozulduğunda belirtisi "tahta bazen tuhaf
 * davranıyor" gibi teşhis edilmesi pahalı bir şeydir:
 *   1. eko kırılmazsa iki taraf birbirini sonsuz besler,
 *   2. sayfa etiketi/görünürlük kuralı bozulursa bir sayfanın çizimleri
 *      öteki sayfada görünür (kullanıcının bildirdiği kusur), ya da her turda
 *      yeniden etiketlenip sürüm tırmanır ve kanal hiç susmaz,
 *   3. bozuk bir paket çözücüyü düşürürse tahta sessizce donar.
 *
 * Çakışma çözümü (hangi sürüm kazanır) BURADA DEĞİL: onu paketin kendi
 * `reconcileElements`i yapıyor, kendi testleri var, kopyalanmadı.
 */
import { describe, expect, it } from "vitest";

import {
  SERBEST_SAYFA,
  degisenler,
  elemanSayfasi,
  gorunurMu,
  mesajCoz,
  sayfaAnahtari,
  sayfaEtiketle,
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

describe("sayfa görünürlüğü", () => {
  const etiketli = (id: string, sayfa: string) =>
    el(id, 1, { customData: { tahtaSayfa: sayfa } });

  it("başka sayfanın elemanı gizlenir, kendi sayfasınınki görünür", () => {
    expect(gorunurMu(etiketli("a", sayfaAnahtari(1)), sayfaAnahtari(2))).toBe(false);
    expect(gorunurMu(etiketli("a", sayfaAnahtari(2)), sayfaAnahtari(2))).toBe(true);
  });

  it("serbest katman HER sayfada görünür", () => {
    expect(gorunurMu(etiketli("a", SERBEST_SAYFA), sayfaAnahtari(7))).toBe(true);
    expect(gorunurMu(etiketli("a", SERBEST_SAYFA), SERBEST_SAYFA)).toBe(true);
  });

  it("etiketsiz eleman gizlenmez — uzaktan gelen çizim yanıp sönmesin", () => {
    expect(gorunurMu(el("a", 1), sayfaAnahtari(3))).toBe(true);
    expect(elemanSayfasi(el("a", 1))).toBeNull();
  });
});

describe("sayfaEtiketle", () => {
  it("etiketler, sürümü artırır ve özgün elemanı bozmaz", () => {
    const once = el("a", 4);
    const sonra = sayfaEtiketle(once, sayfaAnahtari(2));
    expect(elemanSayfasi(sonra)).toBe("s2");
    expect(sonra.version).toBe(5);
    expect(once.customData).toBeUndefined();
  });

  it("etiketlenmiş eleman `degisenler` ile bir kez yayınlanır, sonra susar", () => {
    const bilinen = new Map<string, number>();
    const etiketlenmis = sayfaEtiketle(el("a", 4), SERBEST_SAYFA);
    const yayinlanacak = degisenler([etiketlenmis], bilinen);
    expect(yayinlanacak).toHaveLength(1);
    surumleriYaz(yayinlanacak, bilinen);
    // İkinci tur: eleman ARTIK ETİKETLİ olduğu için yeniden etiketlenmez.
    expect(degisenler([etiketlenmis], bilinen)).toEqual([]);
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

  it("sayfa alanını taşır — eleman listesi boş olsa bile", () => {
    expect(mesajCoz(JSON.stringify({ t: "durum", elemanlar: [], sayfa: "s4" }))).toEqual({
      t: "durum",
      elemanlar: [],
      sayfa: "s4",
    });
  });

  it("istek ve temizle geçer", () => {
    expect(mesajCoz(JSON.stringify({ t: "istek" }))).toEqual({ t: "istek" });
    expect(mesajCoz(JSON.stringify({ t: "temizle" }))).toEqual({ t: "temizle" });
  });
});
