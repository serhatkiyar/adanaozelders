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
  BASLANGIC_SAYFALARI,
  ILK_SAYFA,
  ParcaToplayici,
  degisenler,
  elemanSayfasi,
  gorunurMu,
  mesajCoz,
  mezarTasi,
  parcala,
  parcaMi,
  pdfDosyaCoz,
  pdfDosyaKimligi,
  pdfSayfalariniYerlestir,
  sayfaEkle,
  sayfaEtiketle,
  sayfaGec,
  sayfaSil,
  sayfalariBirlestir,
  surumleriYaz,
  type TahtaEleman,
  type SayfaDurumu,
} from "./tahtaSenkron";

const sayfaAnahtari = (n: number) => `s${n}`;

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

  it("ilk sayfanın elemanı öteki sayfada görünmez", () => {
    expect(gorunurMu(etiketli("a", ILK_SAYFA), sayfaAnahtari(7))).toBe(false);
    expect(gorunurMu(etiketli("a", ILK_SAYFA), ILK_SAYFA)).toBe(true);
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
    const etiketlenmis = sayfaEtiketle(el("a", 4), ILK_SAYFA);
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
    expect(mesajCoz({ t: "baskaBirSey" })).toBeNull();
    // Eski LiveKit protokolündeki dosya taşıyan "temizle" artık yok.
    expect(mesajCoz({ t: "temizle" })).toBeNull();
  });

  it("şekli bozuk elemanları eler, sağlamları geçirir", () => {
    const cozulen = mesajCoz(
      JSON.stringify({ t: "durum", elemanlar: [{ id: "a", version: 1 }, { id: "b" }, null] })
    );
    expect(cozulen).toEqual({ t: "durum", elemanlar: [{ id: "a", version: 1 }] });
  });

  it("dosya (görüntü) taşımaz — PDF sayfaları telden gitmez", () => {
    const cozulen = mesajCoz({
      t: "durum",
      elemanlar: [],
      dosyalar: [{ id: "d1", dataURL: "data:image/jpeg;base64,xx" }],
    });
    expect(cozulen).toEqual({ t: "durum", elemanlar: [] });
  });

  it("geçerli sayfa listesini taşır, bozuğunu düşürür", () => {
    const sayfalar = { liste: [{ id: "p1" }, { id: "k5-1", pdf: { kaynak: 5, no: 1 } }], aktif: "k5-1", surum: 3 };
    expect(mesajCoz({ t: "durum", elemanlar: [], sayfalar })).toEqual({
      t: "durum",
      elemanlar: [],
      sayfalar,
    });
    expect(mesajCoz({ t: "durum", elemanlar: [], sayfalar: { liste: [], aktif: "x", surum: 1 } })).toEqual({
      t: "durum",
      elemanlar: [],
    });
  });

  it("istek ve imleç geçer (lazer imleçle gider)", () => {
    expect(mesajCoz({ t: "istek" })).toEqual({ t: "istek" });
    expect(mesajCoz({ t: "imlec", x: 1, y: 2, dugme: "down", arac: "laser" })).toEqual({
      t: "imlec",
      x: 1,
      y: 2,
      dugme: "down",
      arac: "laser",
    });
    // Tanınmayan araç/düğme güvenli varsayılana düşer.
    expect(mesajCoz({ t: "imlec", x: 1, y: 2, arac: "kalem" })).toEqual({
      t: "imlec",
      x: 1,
      y: 2,
      dugme: "up",
      arac: "pointer",
    });
    expect(mesajCoz({ t: "imlec", x: "1", y: 2 })).toBeNull();
    expect(mesajCoz({ t: "imlec", x: Number.NaN, y: 2 })).toBeNull();
    expect(mesajCoz({ t: "imlecGitti" })).toEqual({ t: "imlecGitti" });
  });

  it("izin mesajları doğrulanır", () => {
    expect(mesajCoz({ t: "yetki", tam: true })).toEqual({ t: "yetki", tam: true });
    expect(mesajCoz({ t: "yetki", tam: "evet" })).toBeNull();
    expect(mesajCoz({ t: "izinYaniti", k: "a1", karar: "bu" })).toEqual({
      t: "izinYaniti",
      k: "a1",
      karar: "bu",
    });
    expect(mesajCoz({ t: "izinYaniti", k: "a1", karar: "belki" })).toBeNull();
    expect(mesajCoz({ t: "izinYaniti", k: "", karar: "ret" })).toBeNull();
    expect(mesajCoz({ t: "pdfIstegi", k: "a1", dosya: "x".repeat(300) })).toEqual({
      t: "pdfIstegi",
      k: "a1",
      dosya: "x".repeat(200),
    });
    expect(mesajCoz({ t: "pdfEkle", k: "a1", kaynak: 5 })).toEqual({ t: "pdfEkle", k: "a1", kaynak: 5 });
    expect(mesajCoz({ t: "pdfEkle", k: "a1", kaynak: -1 })).toBeNull();
    expect(
      mesajCoz({ t: "izinIstegi", k: "a1", elemanlar: [{ id: "e", version: 2 }, { id: 3 }] }),
    ).toEqual({ t: "izinIstegi", k: "a1", elemanlar: [{ id: "e", version: 2 }] });
    expect(mesajCoz({ t: "izinIstegi", k: "a1", elemanlar: [] })).toBeNull();
  });

  it("görünür alan doğrulanır ve 2 ondalığa yuvarlanır", () => {
    expect(mesajCoz({ t: "gorunum", x1: 1.234, y1: -5, x2: 100.005, y2: 50 })).toEqual({
      t: "gorunum",
      x1: 1.23,
      y1: -5,
      x2: 100.01,
      y2: 50,
    });
    const gecersiz = [
      { x1: Number.NaN, y1: 0, x2: 10, y2: 10 },
      { x1: 0, y1: 0, x2: Number.POSITIVE_INFINITY, y2: 10 },
      { x1: 10, y1: 0, x2: 0, y2: 10 }, // ters
      { x1: 0, y1: 10, x2: 10, y2: 10 }, // sıfır yükseklik
      { x1: 0, y1: 0, x2: 2e7, y2: 10 }, // aşırı geniş
      { x1: 2e8, y1: 0, x2: 2e8 + 10, y2: 10 }, // aşırı uzak
      { x1: "0", y1: 0, x2: 10, y2: 10 },
    ];
    for (const g of gecersiz) expect(mesajCoz({ t: "gorunum", ...g })).toBeNull();
  });

  it("takip/getir/izle biçimleri", () => {
    expect(mesajCoz({ t: "takip", acik: false })).toEqual({ t: "takip", acik: false });
    expect(mesajCoz({ t: "takip" })).toBeNull();
    expect(mesajCoz({ t: "izle", acik: true })).toEqual({ t: "izle", acik: true });
    expect(mesajCoz({ t: "izle", acik: 1 })).toBeNull();
    expect(mesajCoz({ t: "getir", fazla: 1 })).toEqual({ t: "getir" });
  });
});

describe("sayfa listesi", () => {
  it("ekle aktifin ardına koyar ve ona geçer; sürüm artar", () => {
    const d = sayfaEkle(BASLANGIC_SAYFALARI, [{ id: "a" }, { id: "b" }]);
    expect(d.liste.map((s) => s.id)).toEqual(["p1", "a", "b"]);
    expect(d.aktif).toBe("a");
    expect(d.surum).toBe(1);
  });

  it("sil önceki sayfaya geçer; son sayfa silinmez", () => {
    const d = sayfaEkle(BASLANGIC_SAYFALARI, [{ id: "a" }]);
    const s = sayfaSil(d);
    expect(s.liste.map((x) => x.id)).toEqual(["p1"]);
    expect(s.aktif).toBe("p1");
    expect(sayfaSil(s)).toBe(s);
  });

  it("geç uçta durur", () => {
    const d = sayfaEkle(BASLANGIC_SAYFALARI, [{ id: "a" }]);
    expect(sayfaGec(d, 1)).toBe(d);
    expect(sayfaGec(d, -1).aktif).toBe("p1");
  });

  it("birleştirmede büyük sürüm kazanır", () => {
    const eski = BASLANGIC_SAYFALARI;
    const yeni = sayfaEkle(eski, [{ id: "a" }]);
    expect(sayfalariBirlestir(eski, yeni)).toBe(yeni);
    expect(sayfalariBirlestir(yeni, eski)).toBe(yeni);
  });

  it("PDF dosya kimliği iki yönlü", () => {
    expect(pdfDosyaCoz(pdfDosyaKimligi(12, 3))).toEqual({ kaynak: 12, no: 3 });
    expect(pdfDosyaCoz("baska")).toBeNull();
  });

  it("mezar taşı silinmiş ve yeni sürümlü kopya üretir", () => {
    const m = mezarTasi(el("a", 2));
    expect(m).toMatchObject({ id: "a", isDeleted: true, version: 3 });
  });
});

describe("parçalama", () => {
  it("sığan metni bölmez", () => {
    expect(parcala("kisa", "k1", 10)).toBeNull();
  });

  it("böler ve sırası karışık gelse de birleştirir", () => {
    const metin = "abcdefghijklmnopqrstuvwxyz";
    const parcalar = parcala(metin, "k1", 5)!;
    expect(parcalar).toHaveLength(6);
    expect(parcalar.every(parcaMi)).toBe(true);
    const t = new ParcaToplayici();
    const sira = [...parcalar].reverse();
    const sonuclar = sira.map((p) => t.ekle("gonderen", p));
    expect(sonuclar.slice(0, -1).every((s) => s === null)).toBe(true);
    expect(sonuclar.at(-1)).toBe(metin);
  });

  it("farklı gönderenlerin aynı kimlikli parçaları karışmaz; bayat yarım mesaj atılır", () => {
    const t = new ParcaToplayici(1000);
    const [a0, a1] = parcala("aaaaaa", "k", 3)!;
    const [b0] = parcala("bbbbbb", "k", 3)!;
    expect(t.ekle("A", a0, 0)).toBeNull();
    expect(t.ekle("B", b0, 0)).toBeNull();
    expect(t.ekle("A", a1, 10)).toBe("aaaaaa");
    const [c0, c1] = parcala("cccccc", "z", 3)!;
    expect(t.ekle("A", c0, 0)).toBeNull();
    expect(t.ekle("A", c1, 5000)).toBeNull();
  });

  it("şekli bozuk parçayı tanımaz", () => {
    expect(parcaMi({ t: "parca", k: "x", i: 3, n: 2, v: "" })).toBe(false);
    expect(parcaMi({ t: "parca", k: "x", i: 0, n: 1 })).toBe(false);
  });
});

describe("PDF açma yeri", () => {
  const uc: SayfaDurumu = {
    liste: [{ id: "p1" }, { id: "a" }, { id: "b" }],
    aktif: "a",
    surum: 4,
  };

  it("yeni sayfalarda: hepsi listenin SONUNA, ilkine geçilir", () => {
    const d = pdfSayfalariniYerlestir(uc, 7, 3, "yeni");
    expect(d.liste.map((s) => s.id)).toEqual(["p1", "a", "b", "k7-1", "k7-2", "k7-3"]);
    expect(d.liste[3].pdf).toEqual({ kaynak: 7, no: 1 });
    expect(d.aktif).toBe("k7-1");
    expect(d.surum).toBe(5);
  });

  it("bu sayfada: 1. sayfa açık sayfanın zemini, kalanlar hemen ardında", () => {
    const d = pdfSayfalariniYerlestir(uc, 7, 3, "bu");
    expect(d.liste.map((s) => s.id)).toEqual(["p1", "a", "k7-2", "k7-3", "b"]);
    // Açık sayfanın kimliği (üstündeki çizimler) korunur, zemini PDF'in 1. sayfası olur.
    expect(d.liste[1]).toEqual({ id: "a", pdf: { kaynak: 7, no: 1 } });
    expect(d.aktif).toBe("a");
    expect(d.surum).toBe(5);
  });

  it("tek sayfalık PDF bu sayfada: yalnız zemin değişir", () => {
    const d = pdfSayfalariniYerlestir(uc, 9, 1, "bu");
    expect(d.liste.map((s) => s.id)).toEqual(["p1", "a", "b"]);
    expect(d.liste[1].pdf).toEqual({ kaynak: 9, no: 1 });
  });

  it("sayfasız PDF listeyi değiştirmez", () => {
    expect(pdfSayfalariniYerlestir(uc, 7, 0, "yeni")).toBe(uc);
  });
});
