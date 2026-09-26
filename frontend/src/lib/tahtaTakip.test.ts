// @vitest-environment node
/**
 * "Öğretmeni takip et" hesapları. Neden test: bozulduğunda belirtisi ancak
 * iki gerçek ekranda görülür — öğrenci öğretmenin gösterdiğini kısmen görür,
 * takip kendiliğinden kopar ya da iki taraf birbirine sığdırıp yakınlığı
 * 0.1'e kaydırır.
 */
import { describe, expect, it } from "vitest";

import {
  GIRDI_PENCERESI_MS,
  alanaSigdir,
  ayniGorunum,
  gorunumDegisti,
  gorunurAlan,
  takipKoptuMu,
  yayinlamaliMi,
  zoomNormalle,
  type Alan,
} from "./tahtaTakip";

const MASAUSTU = { width: 1280, height: 720 };
const TELEFON = { width: 390, height: 700 };

/** `alan`ı `ekran`a sığdırır ve sığdırılmış görünümün görünür alanını döner. */
function sigdirilmisAlan(alan: Alan, ekran: { width: number; height: number }) {
  const g = alanaSigdir(alan, ekran);
  return { g, gorunen: gorunurAlan({ ...g, ...ekran }) };
}

function kapsar(dis: Alan, ic: Alan, pay = 0.02) {
  expect(dis.x1).toBeLessThanOrEqual(ic.x1 + pay);
  expect(dis.y1).toBeLessThanOrEqual(ic.y1 + pay);
  expect(dis.x2).toBeGreaterThanOrEqual(ic.x2 - pay);
  expect(dis.y2).toBeGreaterThanOrEqual(ic.y2 - pay);
}

describe("alanaSigdir", () => {
  it("masaüstü alanı telefona: tamamen görünür, genişlikte tam oturur", () => {
    const hedef = gorunurAlan({ scrollX: -100, scrollY: 50, zoom: 1.5, ...MASAUSTU });
    const { gorunen } = sigdirilmisAlan(hedef, TELEFON);
    kapsar(gorunen, hedef);
    expect(gorunen.x1).toBeCloseTo(hedef.x1, 1);
    expect(gorunen.x2).toBeCloseTo(hedef.x2, 1);
  });

  it("telefon alanı masaüstüne: tamamen görünür, yükseklikte tam oturur", () => {
    const hedef = gorunurAlan({ scrollX: 300, scrollY: -20, zoom: 0.8, ...TELEFON });
    const { gorunen } = sigdirilmisAlan(hedef, MASAUSTU);
    kapsar(gorunen, hedef);
    expect(gorunen.y1).toBeCloseTo(hedef.y1, 1);
    expect(gorunen.y2).toBeCloseTo(hedef.y2, 1);
  });

  it("merkezler çakışır", () => {
    const hedef: Alan = { x1: 10, y1: 20, x2: 810, y2: 470 };
    const { gorunen } = sigdirilmisAlan(hedef, TELEFON);
    expect((gorunen.x1 + gorunen.x2) / 2).toBeCloseTo(410, 1);
    expect((gorunen.y1 + gorunen.y2) / 2).toBeCloseTo(245, 1);
  });

  it("yakınlık 0.1–30 aralığında kalır", () => {
    expect(alanaSigdir({ x1: 0, y1: 0, x2: 1e6, y2: 1e6 }, TELEFON).zoom).toBe(0.1);
    expect(alanaSigdir({ x1: 0, y1: 0, x2: 1, y2: 1 }, MASAUSTU).zoom).toBe(30);
  });
});

describe("zoomNormalle", () => {
  it("6 basamağa yuvarlar ve kıstırır", () => {
    expect(zoomNormalle(1.23456789)).toBe(1.234568);
    expect(zoomNormalle(0.01)).toBe(0.1);
    expect(zoomNormalle(99)).toBe(30);
  });
});

describe("gorunumDegisti / ayniGorunum", () => {
  const a: Alan = { x1: 0, y1: 0, x2: 100, y2: 100 };
  it("ekranda yarım pikselden küçük fark yayına değmez", () => {
    expect(gorunumDegisti(a, { ...a, x1: 0.4 }, 1)).toBe(false);
    expect(gorunumDegisti(a, { ...a, x1: 0.4 }, 2)).toBe(true);
    expect(gorunumDegisti(null, a, 1)).toBe(true);
  });
  it("eps içinde aynı sayılır", () => {
    const g = { scrollX: 1, scrollY: 2, zoom: 1 };
    expect(ayniGorunum(g, { ...g, scrollX: 1 + 1e-7 })).toBe(true);
    expect(ayniGorunum(g, { ...g, zoom: 1.001 })).toBe(false);
  });
});

describe("takipKoptuMu", () => {
  const beklenen = { scrollX: 10, scrollY: 20, zoom: 1 };
  const simdi = 100_000;
  it("programatik (beklenen) görünüm koparmaz, girdi olsa bile", () => {
    expect(takipKoptuMu(beklenen, { ...beklenen }, simdi, simdi)).toBe(false);
  });
  it("girdi + fark koparır", () => {
    expect(takipKoptuMu(beklenen, { ...beklenen, scrollX: 50 }, simdi - 200, simdi)).toBe(true);
  });
  it("girdisiz fark koparmaz", () => {
    const eski = simdi - GIRDI_PENCERESI_MS - 1;
    expect(takipKoptuMu(beklenen, { ...beklenen, scrollX: 50 }, eski, simdi)).toBe(false);
  });
});

describe("yayinlamaliMi", () => {
  const ogretmen = {
    ogretmen: true,
    karsiVar: true,
    ogrenciTakip: null,
    ogretmenTakipEdiyor: false,
    izleniyor: false,
  };
  it("öğretmen: öğrenci takipte ya da bilinmiyorsa yayınlar, bıraktıysa yayınlamaz", () => {
    expect(yayinlamaliMi(ogretmen)).toBe(true);
    expect(yayinlamaliMi({ ...ogretmen, ogrenciTakip: true })).toBe(true);
    expect(yayinlamaliMi({ ...ogretmen, ogrenciTakip: false })).toBe(false);
    expect(yayinlamaliMi({ ...ogretmen, karsiVar: false })).toBe(false);
  });
  it("öğretmen öğrenciyi takip ederken yayınlamaz", () => {
    expect(yayinlamaliMi({ ...ogretmen, ogretmenTakipEdiyor: true })).toBe(false);
  });
  it("öğrenci yalnız izleniyorsa yayınlar", () => {
    const ogrenci = { ...ogretmen, ogretmen: false };
    expect(yayinlamaliMi(ogrenci)).toBe(false);
    expect(yayinlamaliMi({ ...ogrenci, izleniyor: true })).toBe(true);
  });

  it("karşılıklı takipte döngü yok: alan büyümez", () => {
    // Öğretmen öğrenciyi izliyor, öğrenci öğretmeni takip ediyor.
    let ogrenciAlani = gorunurAlan({ scrollX: 0, scrollY: 0, zoom: 1, ...TELEFON });
    const ilk = { ...ogrenciAlani };
    let ogretmenAlani: Alan | null = null;
    for (let tur = 0; tur < 20; tur += 1) {
      // Öğrenci yayınlar (izleniyor), öğretmen sığdırır.
      ogretmenAlani = sigdirilmisAlan(ogrenciAlani, MASAUSTU).gorunen;
      // Öğretmen de yayınlasaydı öğrenci ona sığdırır, alan büyürdü.
      if (yayinlamaliMi({ ...ogretmen, ogrenciTakip: true, ogretmenTakipEdiyor: true })) {
        ogrenciAlani = sigdirilmisAlan(ogretmenAlani, TELEFON).gorunen;
      }
    }
    expect(ogrenciAlani).toEqual(ilk);
    expect(ogretmenAlani).not.toBeNull();
  });
});
