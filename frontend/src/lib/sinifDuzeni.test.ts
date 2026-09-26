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
  it("tek araç: son araç görünümü, yoksa tahtada CORNER, paylaşımda SIDEBAR", () => {
    expect(secim({ aracAcik: true })).toBe("CORNER");
    expect(secim({ aracAcik: true, sonVideo: "GRID" })).toBe("CORNER");
    expect(secim({ aracAcik: true, sonArac: "SIDEBAR" })).toBe("SIDEBAR");
    expect(secim({ paylasim: true })).toBe("SIDEBAR");
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
    expect(y.video).toEqual({ x: y.grup.x + y.grup.w - 12 - 200, y: y.grup.y + 120, w: 200, h: 100 });
    expect(y.benKaro.w).toBe(100);
    expect(y.daraltDugmesi).toBeNull();
  });

  it("paylaşım + CORNER: yüzen kutu sol üstte, başlığın 8px altı", () => {
    const y = yerlesimHesapla(girdi({ gorunum: "CORNER", paylasim: true }));
    expect(y.video).toEqual({ x: y.grup.x + 12, y: y.grup.y + 56, w: 200, h: 100 });
  });

  it("telefonda tahta: yüzen kutu sol altta, Excalidraw alt çubuğunun üstünde; sürüklenebilir", () => {
    const tel = { telefon: true, dikey: true, kucukEkran: true, pencereDikey: true, genislik: 390, yukseklik: 757 };
    const y = yerlesimHesapla(girdi({ ...tel, gorunum: "SPOTLIGHT", aracAcik: true }));
    expect(y.video).toEqual({ x: y.grup.x + 12, y: y.grup.y + y.grup.h - 132 - 100, w: 200, h: 100 });
    expect(y.suruklenebilir).toBe("yuzen");
    expect(y.suruklemeSiniri!.min.y).toBe(56 - (y.grup.h - 132 - 100));
    // Paylaşımda (telefon) eski sol üst kalır.
    const p = yerlesimHesapla(girdi({ ...tel, gorunum: "SPOTLIGHT", paylasim: true }));
    expect(p.video).toMatchObject({ x: p.grup.x + 12, y: p.grup.y + 56 });
  });

  it("karşı taraf yokken yüzen kutu 200×133 tek karo", () => {
    const y = yerlesimHesapla(girdi({ gorunum: "CORNER", aracAcik: true, karsiTarafVar: false }));
    expect(y.video).toMatchObject({ w: 200, h: 133 });
    expect(y.karsiKaro).toBeNull();
  });

  it("yüzen kutu sol üst (12, 56) ile sağ alt arasında kalır, sahne dışına taşamaz", () => {
    const y = yerlesimHesapla(
      girdi({ gorunum: "CORNER", aracAcik: true, surukleme: { x: -99999, y: 99999 } }),
    );
    expect(y.video.x).toBe(y.grup.x + 12);
    expect(y.video.y + y.video.h).toBe(y.grup.y + y.grup.h - 12);
    const u = yerlesimHesapla(
      girdi({ gorunum: "CORNER", aracAcik: true, surukleme: { x: 99999, y: -99999 } }),
    );
    expect(u.video.x + u.video.w).toBe(u.grup.x + u.grup.w - 12);
    expect(u.video.y).toBe(u.grup.y + 56);
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
