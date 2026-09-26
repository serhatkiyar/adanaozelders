// @vitest-environment node
/**
 * Tahta sahiplik/izin kuralları. İki gerçek tarayıcı olmadan görülemeyen,
 * bozulunca "öğrenci öğretmenin çizimini sessizce siliyor" ya da "öğrenci
 * kendi çizimini düzenleyemiyor" diye görünen davranışlar.
 */
import { describe, expect, it } from "vitest";

import {
  anlamliFark,
  damgala,
  gidenKopya,
  ogrenciDegisikliginiAyir,
  ogretmenDenetimi,
  onerileriHazirla,
  sahibi,
  uzakEzerMi,
  type IzinElemani,
} from "./tahtaIzin";

function el(
  id: string,
  version: number,
  ek: Partial<IzinElemani> = {},
): IzinElemani {
  return { id, version, versionNonce: 1, type: "rectangle", x: 0, y: 0, ...ek };
}

const bos = new Set<string>();

describe("sahip", () => {
  it("sahipsiz (eski) eleman ve PDF zemini öğretmenindir", () => {
    expect(sahibi(el("a", 1), bos, "ogrenci")).toBe("ogretmen");
    const zemin = el("z", 1, { type: "image", fileId: "pdf-3-1", customData: { sahip: "ogrenci" } });
    expect(sahibi(zemin, new Set(["z"]), "ogrenci")).toBe("ogretmen");
  });

  it("damgalı eleman damgasına göre", () => {
    expect(sahibi(el("a", 1, { customData: { sahip: "ogrenci" } }), bos, "ogretmen")).toBe("ogrenci");
  });

  it("yerelde doğan eleman, üstündeki damga ne olursa olsun oluşturanındır (çoğaltma/yapıştırma)", () => {
    const kopya = el("k", 1, { customData: { sahip: "ogretmen", tahtaSayfa: "p1" } });
    expect(sahibi(kopya, new Set(["k"]), "ogrenci")).toBe("ogrenci");
  });
});

describe("sahiplik damgası", () => {
  it("çizim sürerken giden kopyaya sahip yazılır, sürüm artmaz", () => {
    const e = el("a", 3);
    const g = gidenKopya(e, new Set(["a"]), "ogrenci");
    expect(g.customData?.sahip).toBe("ogrenci");
    expect(g.version).toBe(3);
    // Karşıdan gelen elemana dokunulmaz.
    expect(gidenKopya(e, bos, "ogrenci")).toBe(e);
  });

  it("damgala sayfa ve sahibi TEK sürüm artışıyla yazar; gerekmiyorsa null", () => {
    const yerel = new Set(["a"]);
    const d = damgala(el("a", 3), "p2", yerel, "ogretmen");
    expect(d?.customData).toEqual({ tahtaSayfa: "p2", sahip: "ogretmen" });
    expect(d?.version).toBe(4);
    expect(damgala(d as IzinElemani, "p2", yerel, "ogretmen")).toBeNull();
  });

  it("yapıştırılan kopyanın yanlış sahibi düzeltilir, sayfası korunur", () => {
    const d = damgala(
      el("k", 1, { customData: { tahtaSayfa: "p1", sahip: "ogretmen" } }),
      "p2",
      new Set(["k"]),
      "ogrenci",
    );
    expect(d?.customData).toEqual({ tahtaSayfa: "p1", sahip: "ogrenci" });
  });

  it("karşıdan gelen etiketsiz elemanın yalnız sayfası yazılır, sahibi değil", () => {
    const d = damgala(el("a", 1), "p1", bos, "ogrenci");
    expect(d?.customData).toEqual({ tahtaSayfa: "p1" });
  });
});

describe("anlamlı fark", () => {
  it("sürüm, nonce, updated, boundElements ve index (z-sırası onarımı) sayılmaz", () => {
    const a = el("a", 1, { updated: 1, boundElements: null, index: "a0" });
    const b = el("a", 9, {
      versionNonce: 5,
      updated: 2,
      boundElements: [{ id: "ok", type: "arrow" }],
      index: "a0V",
    });
    expect(anlamliFark(a, b)).toBe(false);
  });

  it("konum, silinme ve iç içe alan sayılır", () => {
    expect(anlamliFark(el("a", 1), el("a", 2, { x: 5 }))).toBe(true);
    expect(anlamliFark(el("a", 1), el("a", 2, { isDeleted: true }))).toBe(true);
    expect(anlamliFark(el("a", 1, { points: [[0, 0], [1, 1]] }), el("a", 2, { points: [[0, 0], [1, 2]] }))).toBe(true);
  });
});

describe("öğrenci tarafı: yetkisiz değişikliğin tespiti", () => {
  const defter = new Map<string, IzinElemani>([
    ["o", el("o", 5)], // öğretmenin (sahipsiz)
    ["s", el("s", 2, { customData: { sahip: "ogrenci" } })],
    ["z", el("z", 1, { type: "image", fileId: "pdf-1-1", locked: true })],
  ]);
  const onceki = (id: string) => defter.get(id);

  it("öğretmenin elemanını taşımak/silmek reddedilir; kendi elemanı ve yeni eleman serbest", () => {
    const { kabul, ret } = ogrenciDegisikliginiAyir(
      [
        el("o", 6, { x: 10 }),
        el("s", 3, { customData: { sahip: "ogrenci" }, x: 4 }),
        el("yeni", 1),
        { ...(defter.get("z") as IzinElemani), version: 2, isDeleted: true },
      ],
      onceki,
      new Set(["s", "yeni"]),
    );
    expect(ret.map((e) => e.id)).toEqual(["o", "z"]);
    expect(kabul.map((e) => e.id)).toEqual(["s", "yeni"]);
  });

  it("aynı ya da eski sürüm, ve yalnız okun bağlanması reddedilmez", () => {
    const { ret } = ogrenciDegisikliginiAyir(
      [el("o", 5), el("o", 7, { boundElements: [{ id: "ok", type: "arrow" }] })],
      onceki,
      bos,
    );
    expect(ret).toEqual([]);
  });
});

describe("öğretmen tarafı denetimi", () => {
  const yerel = new Map<string, IzinElemani>([
    ["o", el("o", 5, { customData: { sahip: "ogretmen" } })],
    ["s", el("s", 2, { customData: { sahip: "ogrenci" } })],
  ]);
  const bul = (id: string) => yerel.get(id);

  it("öğrencinin öğretmen elemanını değiştiren güncellemesi uygulanmaz, sürümü aşan geri yayın üretilir", () => {
    const { kabul, geriYayin } = ogretmenDenetimi(
      [el("o", 9, { x: 50, customData: { sahip: "ogrenci" } }), el("s", 3, { x: 1 }), el("n", 1)],
      bul,
      bos,
    );
    expect(kabul.map((e) => e.id)).toEqual(["s", "n"]);
    expect(geriYayin).toHaveLength(1);
    expect(geriYayin[0].x).toBe(0);
    expect(geriYayin[0].customData?.sahip).toBe("ogretmen");
    expect(geriYayin[0].version).toBe(10);
  });

  it("eski sürümlü (dürüst tam senkron) kopya sorun sayılmaz", () => {
    const { kabul, geriYayin } = ogretmenDenetimi([el("o", 5, { customData: { sahip: "ogretmen" } })], bul, bos);
    expect(geriYayin).toEqual([]);
    expect(kabul).toHaveLength(1);
  });

  it("eşit sürüm, farklı nonce: temkinle geri yayın", () => {
    expect(uzakEzerMi(el("o", 5), el("o", 5, { versionNonce: 2 }))).toBe(true);
    expect(uzakEzerMi(el("o", 5), el("o", 4))).toBe(false);
  });
});

describe("onaylanan öneri", () => {
  it("iki tarafta kazanacak sürümle, sahibi öğretmendeki kopyadan", () => {
    const yerel = new Map([["o", el("o", 12, { customData: { sahip: "ogretmen" } })]]);
    const [h] = onerileriHazirla(
      [el("o", 8, { x: 3, customData: { sahip: "ogrenci", tahtaSayfa: "p1" } })],
      (id) => yerel.get(id),
      bos,
    );
    expect(h.version).toBe(13);
    expect(h.x).toBe(3);
    expect(h.customData).toEqual({ sahip: "ogretmen", tahtaSayfa: "p1" });
  });

  it("öğretmende olmayan eleman için öneri atlanır", () => {
    expect(onerileriHazirla([el("yok", 1)], () => undefined, bos)).toEqual([]);
  });
});
