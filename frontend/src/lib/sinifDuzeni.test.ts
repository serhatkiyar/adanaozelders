import { describe, expect, it } from "vitest";

import {
  gorunumSec,
  kaymayiSinirla,
  secilebilirGorunumler,
  VIDEOLAR_GIZLI_ANAHTARI,
  videolarGizliHatirla,
  videolarGizliOku,
  yanPanelGenisligi,
  yerlesimHesapla,
  type YerlesimGirdisi,
} from "./sinifDuzeni";

const secim = (p: Partial<Parameters<typeof gorunumSec>[0]>) =>
  gorunumSec({
    paylasim: false,
    aracAcik: false,
    mobilKucuk: false,
    sonVideo: null,
    sonArac: null,
    ...p,
  });

describe("gorunumSec (Preply rT)", () => {
  it("araç yok: son video görünümü, yoksa SPOTLIGHT", () => {
    expect(secim({})).toBe("SPOTLIGHT");
    expect(secim({ sonVideo: "GRID" })).toBe("GRID");
  });
  it("tek araç: son araç görünümü, yoksa CORNER (paylaşım da sahneyi alır)", () => {
    expect(secim({ aracAcik: true })).toBe("CORNER");
    expect(secim({ aracAcik: true, sonVideo: "GRID" })).toBe("CORNER");
    expect(secim({ aracAcik: true, sonArac: "SIDEBAR" })).toBe("SIDEBAR");
    expect(secim({ paylasim: true })).toBe("CORNER");
    expect(secim({ paylasim: true, sonArac: "SIDEBAR" })).toBe("SIDEBAR");
    expect(secim({ paylasim: true, sonArac: "CORNER" })).toBe("CORNER");
  });
  it("telefon + küçük ekran + araç: zorla yüzen (SPOTLIGHT)", () => {
    expect(secim({ aracAcik: true, mobilKucuk: true, sonArac: "SIDEBAR" })).toBe("SPOTLIGHT");
  });
  it("paylaşım + araç: seçimden bağımsız SPOTLIGHT, menüde seçenek yok", () => {
    expect(secim({ aracAcik: true, paylasim: true, sonArac: "SIDEBAR" })).toBe("SPOTLIGHT");
    expect(secilebilirGorunumler(true, true)).toEqual([]);
    expect(secilebilirGorunumler(false, true)).toEqual(["SIDEBAR", "CORNER"]);
    expect(secilebilirGorunumler(false, false)).toEqual(["SPOTLIGHT", "GRID"]);
  });
});

const girdi = (p: Partial<YerlesimGirdisi>): YerlesimGirdisi => ({
  genislik: 1440,
  yukseklik: 820,
  gorunum: "SPOTLIGHT",
  paylasim: false,
  aracAcik: false,
  karsiTarafVar: true,
  telefon: false,
  dikey: false,
  ogrenciTelefon: false,
  kucukEkran: false,
  pencereDikey: false,
  yanPanelOrani: null,
  bolunmusOran: null,
  surukleme: { x: 0, y: 0 },
  ...p,
});

describe("yerlesimHesapla", () => {
  it("yan panel en az 240px, en çok %50 (içerik genişliğiyle)", () => {
    expect(yanPanelGenisligi(1416, null)).toBe(240);
    expect(yanPanelGenisligi(1416, 0.9)).toBe(708);
    expect(yanPanelGenisligi(1416, 0.05)).toBe(240);
    // Oran korunur: grup daralınca (sohbet açıldı) genişlik de orantılı.
    expect(yanPanelGenisligi(1000, 0.3)).toBe(300);
    expect(yanPanelGenisligi(700, 0.3)).toBe(240);
  });

  it("araçsız SPOTLIGHT: kendi karon 160×120 sağ üstte 16px içeride", () => {
    const y = yerlesimHesapla(girdi({}));
    expect(y.karsiKaro).toEqual(y.grup);
    expect(y.benKaro).toMatchObject({ w: 160, h: 120, y: y.grup.y + 16 });
    expect(y.benKaro.x + y.benKaro.w).toBe(y.grup.x + y.grup.w - 16);
    expect(y.suruklenebilir).toBe("benKaro");
  });

  it("telefon dikey araçsız: kendi karon 90×120 ve sürüklenmez", () => {
    const y = yerlesimHesapla(girdi({ telefon: true, dikey: true, genislik: 390, yukseklik: 700 }));
    expect(y.benKaro).toMatchObject({ w: 90, h: 120 });
    expect(y.suruklenebilir).toBeNull();
  });

  it("GRID: iki eşit sütun, 12px boşluk", () => {
    const y = yerlesimHesapla(girdi({ gorunum: "GRID" }));
    expect(y.benKaro.w).toBe(y.karsiKaro!.w);
    expect(y.karsiKaro!.x - (y.benKaro.x + y.benKaro.w)).toBe(12);
  });

  it("tahta + SIDEBAR: yan panel sağda 240px, araç kalanı alır", () => {
    const y = yerlesimHesapla(girdi({ gorunum: "SIDEBAR", aracAcik: true }));
    expect(y.video.w).toBe(240);
    expect(y.arac!.w + 4 + y.video.w).toBe(y.grup.w);
    expect(y.yuzen).toBe(false);
    expect(y.benKaro.h).toBeLessThanOrEqual(y.grup.h / 2 - 6);
  });

  it("tahta + CORNER: yüzen kutu 200×100 (iki karo), sağ üstte üst çubuğun altında", () => {
    const y = yerlesimHesapla(girdi({ gorunum: "CORNER", aracAcik: true }));
    expect(y.arac).toEqual(y.grup);
    expect(y.video).toEqual({ x: y.grup.x + y.grup.w - 16 - 200, y: y.grup.y + 120, w: 200, h: 100 });
    expect(y.kose).toBe("sagUst");
    expect(y.suruklenebilir).toBe("yuzen");
    expect(y.suruklemeSiniri).toBeNull();
    expect(y.serbestAlan).toEqual(y.grup);
    expect(y.benKaro.w).toBe(100);
    expect(y.daraltDugmesi).toBeNull();
  });

  it("paylaşım + CORNER: yüzen kutu sol üstte, başlığın 16px altı", () => {
    const y = yerlesimHesapla(girdi({ gorunum: "CORNER", paylasim: true }));
    expect(y.video).toEqual({ x: y.grup.x + 16, y: y.grup.y + 56, w: 200, h: 100 });
    // Paylaşım-büyük: tek paylaşım sahnenin tamamını alır, videolar yüzen kutuda.
    expect(y.paylasim).toEqual(y.grup);
    expect(y.yuzen).toBe(true);
    expect(y.kose).toBe("solUst");
  });

  it("telefonda tahta: yüzen kutu sol altta, Excalidraw alt çubuğunun üstünde; kaydırılır", () => {
    const tel = { telefon: true, dikey: true, kucukEkran: true, pencereDikey: true, genislik: 390, yukseklik: 757 };
    const y = yerlesimHesapla(girdi({ ...tel, gorunum: "SPOTLIGHT", aracAcik: true }));
    expect(y.video).toEqual({ x: y.grup.x + 16, y: y.grup.y + y.grup.h - 132 - 100, w: 200, h: 100 });
    expect(y.suruklenebilir).toBeNull();
    expect(y.kaydirilabilir).toBe(true);
    expect(y.serbestAlan).toBeNull();
    // Sağ köşeler izinli değil: sağ üst tercihi sol üste eşlenir.
    const s = yerlesimHesapla(girdi({ ...tel, gorunum: "SPOTLIGHT", aracAcik: true, kose: "sagUst" }));
    expect(s.kose).toBe("solUst");
    expect(s.video).toMatchObject({ x: s.grup.x + 16, y: s.grup.y + 64 });
    // Telefonda serbest sürükleme yok sayılır.
    const d = yerlesimHesapla(
      girdi({ ...tel, gorunum: "SPOTLIGHT", aracAcik: true, suruklenen: { x: 200, y: 200 } }),
    );
    expect(d.video).toEqual(y.video);
    // Paylaşımda (telefon) sol üst kalır.
    const p = yerlesimHesapla(girdi({ ...tel, gorunum: "SPOTLIGHT", paylasim: true }));
    expect(p.video).toMatchObject({ x: p.grup.x + 16, y: p.grup.y + 56 });
  });

  it("karşı taraf yokken yüzen kutu 200×133 tek karo", () => {
    const y = yerlesimHesapla(girdi({ gorunum: "CORNER", aracAcik: true, karsiTarafVar: false }));
    expect(y.video).toMatchObject({ w: 200, h: 133 });
    expect(y.karsiKaro).toBeNull();
  });

  it("sürüklenen yüzen kutu sahnenin her yerine gider ama dışına taşamaz", () => {
    const y = yerlesimHesapla(
      girdi({ gorunum: "CORNER", aracAcik: true, suruklenen: { x: -99999, y: 99999 } }),
    );
    expect(y.video.x).toBe(y.grup.x);
    expect(y.video.y + y.video.h).toBe(y.grup.y + y.grup.h);
    const u = yerlesimHesapla(
      girdi({ gorunum: "CORNER", aracAcik: true, suruklenen: { x: 99999, y: -99999 } }),
    );
    expect(u.video.x + u.video.w).toBe(u.grup.x + u.grup.w);
    expect(u.video.y).toBe(u.grup.y);
    const o = yerlesimHesapla(
      girdi({ gorunum: "CORNER", aracAcik: true, suruklenen: { x: 300, y: 250 } }),
    );
    expect(o.video).toMatchObject({ x: 300, y: 250 });
    expect(o.benKaro).toMatchObject({ x: 300, y: 250, w: 100 });
  });

  it("köşe tercihi: izinli köşeye yaslanır; tahtada sol üst sağ üste eşlenir", () => {
    const sa = yerlesimHesapla(girdi({ gorunum: "CORNER", paylasim: true, kose: "sagAlt" }));
    expect(sa.video.x + sa.video.w).toBe(sa.grup.x + sa.grup.w - 16);
    expect(sa.video.y + sa.video.h).toBe(sa.grup.y + sa.grup.h - 16);
    const t = yerlesimHesapla(girdi({ gorunum: "CORNER", aracAcik: true, kose: "solUst" }));
    expect(t.kose).toBe("sagUst");
    expect(t.video.x + t.video.w).toBe(t.grup.x + t.grup.w - 16);
    expect(t.video.y).toBe(t.grup.y + 120);
    const ta = yerlesimHesapla(girdi({ gorunum: "CORNER", aracAcik: true, kose: "solAlt" }));
    expect(ta.kose).toBe("sagAlt");
    expect(ta.video.y + ta.video.h).toBe(ta.grup.y + ta.grup.h - 76);
    expect(t.koseAlani!.izinli).not.toContain("solUst");
    expect(t.koseAlani!.izinli).not.toContain("solAlt");
  });

  it("boyut: Küçük 160, Büyük 280 genişlik", () => {
    const k = yerlesimHesapla(girdi({ gorunum: "CORNER", paylasim: true, boyut: "kucuk" }));
    expect(k.video).toMatchObject({ w: 160, h: 80 });
    const b = yerlesimHesapla(
      girdi({ gorunum: "CORNER", paylasim: true, boyut: "buyuk", karsiTarafVar: false }),
    );
    expect(b.video).toMatchObject({ w: 280, h: 187 });
  });

  it("küçültülünce: masaüstü hap, telefon balon; karolar sahne dışında, görünmez", () => {
    const y = yerlesimHesapla(girdi({ gorunum: "CORNER", aracAcik: true, kucuk: true }));
    expect(y.kucukHal!.tur).toBe("hap");
    expect(y.kucukHal!.kutu).toEqual({
      x: y.grup.x + y.grup.w - 16 - 200,
      y: y.grup.y + 120,
      w: 200,
      h: 40,
    });
    expect(y.benKaro).toMatchObject({ w: 1, h: 1 });
    expect(y.karsiKaro).toMatchObject({ w: 1, h: 1 });
    expect(y.benGorunur).toBe(false);
    expect(y.karsiGorunur).toBe(false);
    expect(y.suruklenebilir).toBeNull();
    const tel = { telefon: true, dikey: true, kucukEkran: true, pencereDikey: true, genislik: 390, yukseklik: 757 };
    const t = yerlesimHesapla(girdi({ ...tel, aracAcik: true, kucuk: true }));
    expect(t.kucukHal).toMatchObject({ tur: "balon", kutu: { w: 48, h: 48, x: t.grup.x + 16 } });
    expect(t.kucukHal!.kutu.y + 48).toBe(t.grup.y + t.grup.h - 132);
    expect(t.kaydirilabilir).toBe(true);
  });

  it("kendi görüntüm gizli: yalnız karşı karo; karşı taraf yokken kendi karo kalır", () => {
    const y = yerlesimHesapla(girdi({ gorunum: "CORNER", aracAcik: true, kendiGizli: true }));
    expect(y.video).toMatchObject({ w: 200, h: 133 });
    expect(y.karsiKaro).toEqual(y.video);
    expect(y.benKaro).toMatchObject({ w: 1, h: 1 });
    expect(y.benGorunur).toBe(false);
    expect(y.karsiGorunur).toBe(true);
    const yalniz = yerlesimHesapla(
      girdi({ gorunum: "CORNER", aracAcik: true, kendiGizli: true, karsiTarafVar: false }),
    );
    expect(yalniz.benKaro).toEqual(yalniz.video);
    expect(yalniz.benGorunur).toBe(true);
    const spot = yerlesimHesapla(girdi({ kendiGizli: true }));
    expect(spot.benGorunur).toBe(false);
    expect(spot.suruklenebilir).toBeNull();
    const grid = yerlesimHesapla(girdi({ gorunum: "GRID", kendiGizli: true }));
    expect(grid.karsiKaro).toEqual(grid.grup);
    const yan = yerlesimHesapla(girdi({ gorunum: "SIDEBAR", aracAcik: true, kendiGizli: true }));
    expect(yan.karsiKaro!.y).toBe(yan.video.y);
    expect(yan.benGorunur).toBe(false);
  });

  it("telefon yatay + tahta: sağda 112px şerit, tahta kalanı alır", () => {
    const tel = { telefon: true, dikey: false, kucukEkran: true, pencereDikey: false, genislik: 844, yukseklik: 330 };
    const y = yerlesimHesapla(girdi({ ...tel, gorunum: "SPOTLIGHT", aracAcik: true }));
    expect(y.yuzen).toBe(false);
    expect(y.video).toMatchObject({ w: 112, x: y.grup.x + y.grup.w - 112 });
    expect(y.benKaro).toMatchObject({ w: 112, h: 84, y: y.grup.y });
    expect(y.karsiKaro).toMatchObject({ w: 112, h: 84, y: y.grup.y + 92 });
    expect(y.arac!.x + y.arac!.w + 8).toBe(y.video.x);
    expect(y.benGorunur && y.karsiGorunur).toBe(true);
    // Paylaşım varken şerit yok (bölünmüş, yüzen kutu).
    expect(yerlesimHesapla(girdi({ ...tel, aracAcik: true, paylasim: true })).yuzen).toBe(true);
  });

  it("odak: araç tüm sahneyi alır, diğer araç gizlenir, kamera yüzen kutuda", () => {
    const t = yerlesimHesapla(
      girdi({ gorunum: "SIDEBAR", aracAcik: true, paylasim: true, odak: "tahta" }),
    );
    expect(t.odak).toBe("tahta");
    expect(t.arac).toEqual({ x: 0, y: 0, w: 1440, h: 820 });
    expect(t.paylasim).toMatchObject({ w: 1, h: 1 });
    expect(t.paylasim!.x).toBeGreaterThanOrEqual(1440);
    expect(t.yuzen).toBe(true);
    expect(t.bolme).toBeNull();
    expect(t.koseAlani!.izinli).not.toContain("solUst");
    const p = yerlesimHesapla(
      girdi({ gorunum: "SIDEBAR", paylasim: true, aracAcik: true, odak: "paylasim" }),
    );
    expect(p.paylasim).toEqual({ x: 0, y: 0, w: 1440, h: 820 });
    expect(p.arac).toMatchObject({ w: 0, h: 0 });
    expect(p.yuzen).toBe(true);
    expect(p.kose).toBe("sagUst");
    // Açık olmayan araç için odak yok sayılır.
    const yok = yerlesimHesapla(girdi({ gorunum: "CORNER", aracAcik: true, odak: "paylasim" }));
    expect(yok.odak).toBeNull();
    expect(yok).toEqual(yerlesimHesapla(girdi({ gorunum: "CORNER", aracAcik: true })));
  });

  it("karo kalitesi genişlik × dpr ile", () => {
    const y = yerlesimHesapla(girdi({ gorunum: "CORNER", paylasim: true }));
    expect(y.karsiKalite).toBe("dusuk");
    expect(
      yerlesimHesapla(girdi({ gorunum: "CORNER", paylasim: true, dpr: 4 })).karsiKalite,
    ).toBe("orta");
    expect(yerlesimHesapla(girdi({})).karsiKalite).toBe("yuksek");
    expect(yerlesimHesapla(girdi({})).benKalite).toBe("dusuk");
  });

  it("Kenar çubuğu + tahta: videolar gizlenince araç tam genişlik, kaplar 1×1 sahne dışında", () => {
    const acik = yerlesimHesapla(girdi({ gorunum: "SIDEBAR", aracAcik: true }));
    expect(acik.daraltDugmesi).toMatchObject({ gizli: false });
    expect(acik.daraltDugmesi!.kutu.x + acik.daraltDugmesi!.kutu.w).toBe(acik.bolme!.kutu.x);
    const y = yerlesimHesapla(girdi({ gorunum: "SIDEBAR", aracAcik: true, videolarGizli: true }));
    expect(y.arac!.w).toBe(y.grup.w);
    expect(y.bolme).toBeNull();
    expect(y.suruklenebilir).toBeNull();
    expect(y.daraltDugmesi).toMatchObject({ gizli: true });
    expect(y.daraltDugmesi!.kutu.x + y.daraltDugmesi!.kutu.w).toBe(y.grup.x + y.grup.w);
    expect(y.video).toMatchObject({ w: 1, h: 1 });
    expect(y.video.x).toBeGreaterThanOrEqual(1440);
    expect(y.benKaro).toMatchObject({ w: 1, h: 1 });
    expect(y.benGorunur).toBe(false);
    expect(y.karsiGorunur).toBe(false);
    expect(acik.benGorunur && acik.karsiGorunur).toBe(true);
  });

  it("videolarGizli bayrağı diğer düzenlerde yok sayılır", () => {
    for (const p of [
      { gorunum: "CORNER" as const, aracAcik: true },
      { gorunum: "SIDEBAR" as const, paylasim: true },
      { gorunum: "SPOTLIGHT" as const },
      { gorunum: "SPOTLIGHT" as const, paylasim: true, aracAcik: true },
    ]) {
      const a = yerlesimHesapla(girdi(p));
      const b = yerlesimHesapla(girdi({ ...p, videolarGizli: true }));
      expect(b).toEqual(a);
      expect(b.daraltDugmesi).toBeNull();
    }
  });

  it("paylaşım + tahta: %50/50, küçük ekranda 65/35, sürükleme %35–65", () => {
    const y = yerlesimHesapla(girdi({ paylasim: true, aracAcik: true }));
    expect(Math.abs(y.paylasim!.w - y.arac!.w)).toBeLessThanOrEqual(1);
    expect(y.yuzen).toBe(true);
    const k = yerlesimHesapla(girdi({ paylasim: true, aracAcik: true, kucukEkran: true }));
    expect(k.bolme).toMatchObject({ tur: "bolunmus", deger: 65 });
    const s = yerlesimHesapla(girdi({ paylasim: true, aracAcik: true, bolunmusOran: 90 }));
    expect(s.bolme).toMatchObject({ deger: 65 });
  });

  it("bölünmüşte kamera kutusu paylaşım panelinin köşesinde (tahtayı örtmez)", () => {
    for (const kose of ["sagUst", "sagAlt"] as const) {
      const y = yerlesimHesapla(girdi({ paylasim: true, aracAcik: true, kose }));
      const p = y.paylasim!;
      expect(y.video.x + y.video.w).toBe(p.x + p.w - 16);
      expect(y.video.x + y.video.w).toBeLessThan(y.arac!.x);
    }
  });

  it("dikey pencerede bölünmüş görünüm alt alta", () => {
    const y = yerlesimHesapla(
      girdi({ paylasim: true, aracAcik: true, pencereDikey: true, genislik: 800, yukseklik: 1200 }),
    );
    expect(y.bolunmusDikey).toBe(true);
    expect(y.paylasim!.w).toBe(y.arac!.w);
  });

  it("öğrenci telefondaysa bölünmüşte paylaşım tam, araç gizli", () => {
    const y = yerlesimHesapla(girdi({ paylasim: true, aracAcik: true, ogrenciTelefon: true }));
    expect(y.paylasim).toEqual(y.grup);
    expect(y.arac!.w).toBe(0);
  });

  it("kayma sınıra itilir", () => {
    expect(kaymayiSinirla({ x: 500, y: -3 }, { min: { x: 0, y: 0 }, max: { x: 100, y: 50 } })).toEqual({
      x: 100,
      y: 0,
    });
  });
});

describe("videolarGizli hatırlama", () => {
  it("yalnız \"1\" gizli sayılır; bozuk değer hayır", () => {
    window.sessionStorage.removeItem(VIDEOLAR_GIZLI_ANAHTARI);
    expect(videolarGizliOku()).toBe(false);
    videolarGizliHatirla(true);
    expect(videolarGizliOku()).toBe(true);
    videolarGizliHatirla(false);
    expect(window.sessionStorage.getItem(VIDEOLAR_GIZLI_ANAHTARI)).toBeNull();
    window.sessionStorage.setItem(VIDEOLAR_GIZLI_ANAHTARI, "evet");
    expect(videolarGizliOku()).toBe(false);
    window.sessionStorage.removeItem(VIDEOLAR_GIZLI_ANAHTARI);
  });
});
