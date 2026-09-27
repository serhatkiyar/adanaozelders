import { describe, expect, it } from "vitest";

import {
  BALON,
  HAP,
  KOSELER,
  KUTU_TERCIHI_ANAHTARI,
  VARSAYILAN_KUTU_TERCIHI,
  enYakinKose,
  kaydirmaSonucu,
  koseAlani,
  koseEsle,
  koseKutusu,
  kutuOlcusu,
  kutuTercihiCoz,
  kutuTercihiOku,
  kutuTercihiYaz,
  serbestKonumSinirla,
  seritYerlesimi,
  videoKalitesi,
} from "./kameraKutusu";

const zemin = { x: 12, y: 12, w: 1000, h: 700 };

describe("kutuOlcusu", () => {
  it("tek karo 3:2, iki karo yan yana kare", () => {
    expect(kutuOlcusu("kucuk", false)).toEqual({ w: 160, h: 107 });
    expect(kutuOlcusu("orta", false)).toEqual({ w: 200, h: 133 });
    expect(kutuOlcusu("buyuk", false)).toEqual({ w: 280, h: 187 });
    expect(kutuOlcusu("kucuk", true)).toEqual({ w: 160, h: 80 });
    expect(kutuOlcusu("orta", true)).toEqual({ w: 200, h: 100 });
    expect(kutuOlcusu("buyuk", true)).toEqual({ w: 280, h: 140 });
  });
});

describe("koseAlani / koseEsle", () => {
  it("tahta: üst 120, alt 76, yalnız sağ köşeler (stil paneli), varsayılan sağ üst", () => {
    const a = koseAlani("tahta", zemin);
    expect(a.alan).toEqual({ x: 28, y: 132, w: 968, h: 700 - 120 - 76 });
    expect([...a.izinli].sort()).toEqual(["sagAlt", "sagUst"]);
    expect(a.varsayilan).toBe("sagUst");
  });
  it("telefon dikey tahta: yalnız sol köşeler, varsayılan sol alt", () => {
    const a = koseAlani("telefonTahtaDikey", zemin);
    expect(a.izinli.sort()).toEqual(["solAlt", "solUst"]);
    expect(a.varsayilan).toBe("solAlt");
    expect(a.alan.y + a.alan.h).toBe(zemin.y + zemin.h - 132);
  });
  it("paylaşım/bölünmüş: dört köşe, üst 56, diğer kenarlar 16", () => {
    for (const b of ["paylasim", "bolunmus"] as const) {
      const a = koseAlani(b, zemin);
      expect(a.izinli).toHaveLength(4);
      expect(a.alan).toEqual({ x: 28, y: 68, w: 968, h: 700 - 56 - 16 });
      expect(a.varsayilan).toBe("solUst");
    }
  });
  it("telefon paylaşım: alt pay 64, alt köşedeki kutu yakınlaştırma çubuğunun üstünde", () => {
    const a = koseAlani("telefonDiger", zemin);
    expect(a.izinli).toHaveLength(4);
    expect(a.alan).toEqual({ x: 28, y: 68, w: 968, h: 700 - 56 - 64 });
    // Çubuk: alttan 12 px, 44 px yüksek → üst ucu zeminin altından 56 px.
    const kutu = koseKutusu("solAlt", a.alan, { w: 200, h: 100 });
    expect(kutu.y + kutu.h).toBeLessThanOrEqual(zemin.y + zemin.h - 12 - 44 - 8);
  });
  it("izinli değilse önce aynı yanda dikey, sonra yatay çevirme", () => {
    expect(koseEsle("solUst", koseAlani("tahta", zemin).izinli)).toBe("sagUst");
    expect(koseEsle("solAlt", koseAlani("tahta", zemin).izinli)).toBe("sagAlt");
    const tel = koseAlani("telefonTahtaDikey", zemin).izinli;
    expect(koseEsle("sagUst", tel)).toBe("solUst");
    expect(koseEsle("sagAlt", tel)).toBe("solAlt");
    expect(koseEsle("sagAlt", [...KOSELER])).toBe("sagAlt");
  });
});

describe("koseKutusu / enYakinKose / serbestKonumSinirla", () => {
  const alan = { x: 16, y: 56, w: 800, h: 500 };
  it("kutu, hap ve balon aynı köşeye yaslanır", () => {
    const olculer = [
      { w: 200, h: 100 },
      { w: HAP.genislik, h: HAP.yukseklik },
      { w: BALON, h: BALON },
    ];
    for (const k of KOSELER) {
      const kutular = olculer.map((o) => koseKutusu(k, alan, o));
      const kenar = kutular.map((b) => ({
        yatay: k.startsWith("sol") ? b.x : b.x + b.w,
        dikey: k.endsWith("Ust") ? b.y : b.y + b.h,
      }));
      expect(new Set(kenar.map((e) => `${e.yatay},${e.dikey}`)).size).toBe(1);
    }
    expect(koseKutusu("sagAlt", alan, { w: 200, h: 100 })).toEqual({ x: 616, y: 456, w: 200, h: 100 });
  });
  it("bırakılan kutu en yakın izinli köşeye gider", () => {
    const b = { x: 580, y: 70, w: 200, h: 100 };
    expect(enYakinKose(b, alan, [...KOSELER])).toBe("sagUst");
    // Sol üst izinli değil (tahta): sol üste bırakılan kutu sol alta gider.
    expect(enYakinKose({ ...b, x: 30 }, alan, ["sagUst", "sagAlt", "solAlt"])).toBe("solAlt");
    expect(enYakinKose({ ...b, x: 600, y: 400 }, alan, ["sagUst", "sagAlt", "solAlt"])).toBe("sagAlt");
  });
  it("serbest konum sınır dışına taşmaz", () => {
    expect(serbestKonumSinirla({ x: -50, y: 9999 }, alan, { w: 200, h: 100 })).toEqual({ x: 16, y: 456 });
  });
});

describe("kaydirmaSonucu", () => {
  const dort = [...KOSELER];
  it("kısa ve az hareket dokunmadır", () => {
    expect(kaydirmaSonucu("solAlt", { dx: 3, dy: -4, sureMs: 120 }, dort)).toEqual({ tur: "dokunma" });
    expect(kaydirmaSonucu("solAlt", { dx: 3, dy: -4, sureMs: 500 }, dort)).toEqual({ tur: "yok" });
    expect(kaydirmaSonucu("solAlt", { dx: 25, dy: 0, sureMs: 100 }, dort)).toEqual({ tur: "yok" });
  });
  it("40px ve üstü kaydırma yöndeki köşeye götürür", () => {
    expect(kaydirmaSonucu("solAlt", { dx: 60, dy: 0, sureMs: 200 }, dort)).toEqual({ tur: "kaydirma", kose: "sagAlt" });
    expect(kaydirmaSonucu("solAlt", { dx: 0, dy: -80, sureMs: 200 }, dort)).toEqual({ tur: "kaydirma", kose: "solUst" });
    expect(kaydirmaSonucu("solAlt", { dx: 60, dy: -60, sureMs: 200 }, dort)).toEqual({ tur: "kaydirma", kose: "sagUst" });
  });
  it("izinli olmayan yöne kaydırma hareket etmez", () => {
    const sol = ["solAlt", "solUst"] as const;
    expect(kaydirmaSonucu("solAlt", { dx: 90, dy: 0, sureMs: 200 }, sol)).toEqual({ tur: "yok" });
    expect(kaydirmaSonucu("solAlt", { dx: 90, dy: -90, sureMs: 200 }, sol)).toEqual({ tur: "kaydirma", kose: "solUst" });
  });
});

describe("videoKalitesi", () => {
  it("genişlik × dpr eşikleri 360 / 900", () => {
    expect(videoKalitesi(100, 1)).toBe("dusuk");
    expect(videoKalitesi(200, 2)).toBe("orta");
    expect(videoKalitesi(359, 1)).toBe("dusuk");
    expect(videoKalitesi(360, 1)).toBe("orta");
    expect(videoKalitesi(900, 1)).toBe("yuksek");
    expect(videoKalitesi(500, 2)).toBe("yuksek");
    expect(videoKalitesi(0, 0)).toBe("dusuk");
  });
  it("önceki seviyeden ±%15 aşılmadan çıkılmaz", () => {
    expect(videoKalitesi(380, 1, "dusuk")).toBe("dusuk");
    expect(videoKalitesi(414, 1, "dusuk")).toBe("orta");
    expect(videoKalitesi(320, 1, "orta")).toBe("orta");
    expect(videoKalitesi(300, 1, "orta")).toBe("dusuk");
    expect(videoKalitesi(1000, 1, "orta")).toBe("orta");
    expect(videoKalitesi(1040, 1, "orta")).toBe("yuksek");
    expect(videoKalitesi(800, 1, "yuksek")).toBe("yuksek");
    expect(videoKalitesi(100, 1, "yuksek")).toBe("dusuk");
  });
});

describe("seritYerlesimi", () => {
  it("sağda 112px şerit, karolar 112×84 alt alta, tahta kalanı alır", () => {
    const grup = { x: 12, y: 12, w: 820, h: 330 };
    const s = seritYerlesimi(grup, 2);
    expect(s.serit).toEqual({ x: 12 + 820 - 112, y: 12, w: 112, h: 330 });
    expect(s.karolar).toEqual([
      { x: 720, y: 12, w: 112, h: 84 },
      { x: 720, y: 12 + 84 + 8, w: 112, h: 84 },
    ]);
    expect(s.arac.x + s.arac.w + 8).toBe(s.serit.x);
    expect(seritYerlesimi(grup, 1).karolar).toHaveLength(1);
  });
});

describe("kutu tercihi", () => {
  it("bozuk/eksik alan varsayılana düşer", () => {
    expect(kutuTercihiCoz(null)).toEqual(VARSAYILAN_KUTU_TERCIHI);
    expect(kutuTercihiCoz("{bozuk")).toEqual(VARSAYILAN_KUTU_TERCIHI);
    expect(kutuTercihiCoz(JSON.stringify({ koseMasaustu: "orta", boyut: "dev", kendiGizli: "evet" }))).toEqual(
      VARSAYILAN_KUTU_TERCIHI,
    );
    expect(
      kutuTercihiCoz(JSON.stringify({ koseMasaustu: "sagAlt", koseTelefon: "solUst", boyut: "buyuk", kendiGizli: true })),
    ).toEqual({ koseMasaustu: "sagAlt", koseTelefon: "solUst", boyut: "buyuk", kendiGizli: true });
  });
  it("yazılan tercih okunur", () => {
    window.localStorage.removeItem(KUTU_TERCIHI_ANAHTARI);
    expect(kutuTercihiOku()).toEqual(VARSAYILAN_KUTU_TERCIHI);
    const t = { koseMasaustu: "solAlt", koseTelefon: null, boyut: "kucuk", kendiGizli: true } as const;
    kutuTercihiYaz(t);
    expect(kutuTercihiOku()).toEqual(t);
    window.localStorage.removeItem(KUTU_TERCIHI_ANAHTARI);
  });
});
