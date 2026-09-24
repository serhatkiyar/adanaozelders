// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  biletHataMetni,
  bostaKalmaSuresiDk,
  dersSayaci,
  firefoxMu,
  karsiTarafNotu,
  sayacMetni,
  telefonMu,
} from "@/lib/canliDers";

const BITIS = "2026-09-24T15:00:00Z";
const bitis = new Date(BITIS).getTime();
const dk = 60_000;

describe("ders sayacı", () => {
  it("son 5 dakikadan önce sessiz", () => {
    expect(dersSayaci(BITIS, bitis - 10 * dk)).toEqual({ tur: "normal" });
    expect(sayacMetni(dersSayaci(BITIS, bitis - 5 * dk - 1))).toBeNull();
  });

  it("son 5 dakikada kalan süreyi yukarı yuvarlar", () => {
    expect(sayacMetni(dersSayaci(BITIS, bitis - 5 * dk))).toBe("Ders 5 dk sonra bitiyor");
    expect(sayacMetni(dersSayaci(BITIS, bitis - 4 * dk - 10_000))).toBe(
      "Ders 5 dk sonra bitiyor",
    );
    expect(sayacMetni(dersSayaci(BITIS, bitis - 30_000))).toBe("Ders 1 dk sonra bitiyor");
  });

  it("süre dolunca 'doldu' der ama oturumu kapatacak bir şey döndürmez", () => {
    expect(dersSayaci(BITIS, bitis)).toEqual({ tur: "doldu" });
    expect(sayacMetni(dersSayaci(BITIS, bitis + 20 * dk))).toBe("Ders süresi doldu");
  });

  it("bozuk tarihte sessiz kalır", () => {
    expect(dersSayaci("gecersiz", bitis)).toEqual({ tur: "normal" });
  });
});

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_TELEFON =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MASAUSTU =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";

describe("telefon tespiti (genişliğe değil cihaza bakar)", () => {
  it("telefon UA'sı telefondur", () => {
    expect(telefonMu({ ua: IPHONE, dokunmatik: true, kisaKenar: 390 })).toBe(true);
    expect(telefonMu({ ua: ANDROID_TELEFON, dokunmatik: true, kisaKenar: 412 })).toBe(true);
  });

  it("daraltılmış masaüstü penceresi telefon DEĞİLDİR", () => {
    // Dokunmatik değil; ekranın kısa kenarı pencere değil cihazdır.
    expect(telefonMu({ ua: MASAUSTU, dokunmatik: false, kisaKenar: 1080 })).toBe(false);
  });

  it("tablet masaüstü düzenini alır", () => {
    expect(telefonMu({ ua: ANDROID_TABLET, dokunmatik: true, kisaKenar: 800 })).toBe(false);
  });

  it("masaüstü UA'lı dokunmatik küçük ekran telefondur", () => {
    expect(telefonMu({ ua: MASAUSTU, dokunmatik: true, kisaKenar: 390 })).toBe(true);
  });
});

describe("Firefox şeridi", () => {
  it("yalnız Firefox'ta", () => {
    expect(firefoxMu(FIREFOX)).toBe(true);
    expect(firefoxMu(MASAUSTU)).toBe(false);
    expect(firefoxMu(IPHONE)).toBe(false);
  });
});

describe("karşı taraf notu", () => {
  it("öğretmen (host) öğrencisini, öğrenci öğretmenini bekler", () => {
    expect(karsiTarafNotu("ayrildi", "host")).toBe(
      "Öğrencin dersten ayrıldı, geri dönmesi bekleniyor.",
    );
    expect(karsiTarafNotu("ayrildi", "katilimci")).toBe(
      "Öğretmenin dersten ayrıldı, geri dönmesi bekleniyor.",
    );
    expect(karsiTarafNotu("bekleniyor", "katilimci")).toBe("Öğretmenin henüz derse katılmadı.");
    expect(karsiTarafNotu("odada", "host")).toBeNull();
  });
});

describe("giriş bileti hatası", () => {
  it("402/403/503 sabit Türkçe metin", () => {
    expect(biletHataMetni(402, "x")).toMatch(/ödenmeden/);
    expect(biletHataMetni(403, undefined)).toMatch(/yetkin yok/);
    expect(biletHataMetni(503, undefined)).toMatch(/altyapısı/);
  });

  it("409'da sunucunun nedeni korunur", () => {
    expect(biletHataMetni(409, "Canlı ders yalnız ders saatinde açıktır.")).toBe(
      "Canlı ders yalnız ders saatinde açıktır.",
    );
    expect(biletHataMetni(409, undefined)).toBe("Canlı ders şu an açık değil.");
  });

  it("yanıt yoksa bağlantı sorunu", () => {
    expect(biletHataMetni(undefined, undefined)).toMatch(/Sunucuya ulaşılamıyor/);
  });
});

describe("tek kişi kalınca kapanma süresi", () => {
  it("ders bitişi + 30 dk; en az Zoom varsayılanı 40", () => {
    expect(bostaKalmaSuresiDk(BITIS, bitis - 60 * dk)).toBe(90);
    expect(bostaKalmaSuresiDk(BITIS, bitis + 25 * dk)).toBe(40);
  });
});
