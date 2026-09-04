import { describe, expect, it } from "vitest";

import {
  dersleriAyristir,
  dogrulaAdim1,
  dogrulaUcret,
  dogrulaVideo,
  ucretiNormalle,
} from "./dogrula";

/**
 * Ders alanı artık AÇIK UÇLU: kapalı çip listesi kalktı, kullanıcı serbest
 * metin yazıyor. Sunucu sözleşmesi (`subjects: string[]`) korunduğu için tüm
 * yük bu ayrıştırıcıda; sessizce bozulursa ya kullanıcı 422 yer ya da panele
 * tek satırlık çöp düşer.
 */
describe("dersleriAyristir", () => {
  it("virgül, noktalı virgül ve satır sonundan böler", () => {
    expect(dersleriAyristir("Matematik, Geometri; Fizik\nKimya")).toEqual([
      "Matematik",
      "Geometri",
      "Fizik",
      "Kimya",
    ]);
  });

  it("fazla boşlukları kırpar ve içerideki boşluk yığınını teke indirir", () => {
    expect(dersleriAyristir("  lise   matematik  ,  ")).toEqual(["lise matematik"]);
  });

  it("aynı dersi büyük/küçük harf farkına rağmen tekrar etmez", () => {
    expect(dersleriAyristir("Matematik, matematik, MATEMATİK")).toEqual(["Matematik"]);
  });

  it("boş metinde boş liste döner", () => {
    expect(dersleriAyristir("   , ;\n ")).toEqual([]);
  });

  it("tek başlık yazılırsa bölmeye çalışmaz", () => {
    expect(dersleriAyristir("Gitar dersi")).toEqual(["Gitar dersi"]);
  });
});

describe("dogrulaAdim1", () => {
  const gecerli = {
    ad: "Ayşe Yılmaz",
    telefon: "0532 123 45 67",
    dersler: "Matematik, Fizik",
    kvkk: true,
  };

  it("geçerli formda hata üretmez", () => {
    expect(dogrulaAdim1(gecerli)).toEqual({});
  });

  it("sabit hattı reddeder", () => {
    expect(dogrulaAdim1({ ...gecerli, telefon: "0322 111 22 33" }).telefon).toBeTruthy();
  });

  it("ders alanı boşsa uyarır", () => {
    expect(dogrulaAdim1({ ...gecerli, dersler: "  " }).dersler).toBeTruthy();
  });

  it("tek başlık 100 karakteri geçemez", () => {
    expect(dogrulaAdim1({ ...gecerli, dersler: "a".repeat(101) }).dersler).toBeTruthy();
  });

  it("KVKK onayı olmadan geçilmez", () => {
    expect(dogrulaAdim1({ ...gecerli, kvkk: false }).kvkk).toBeTruthy();
  });
});

describe("dogrulaVideo", () => {
  it("boş bırakılabilir", () => {
    expect(dogrulaVideo("")).toBeUndefined();
  });

  it("YouTube ve Vimeo https adreslerini kabul eder", () => {
    expect(dogrulaVideo("https://youtu.be/abc")).toBeUndefined();
    expect(dogrulaVideo("https://vimeo.com/123")).toBeUndefined();
  });

  it("http ve yabancı konağı reddeder", () => {
    expect(dogrulaVideo("http://youtu.be/abc")).toBeTruthy();
    expect(dogrulaVideo("https://kotu-site.example/abc")).toBeTruthy();
  });
});

describe("ücret", () => {
  it("Türkçe biçimi ondalığa çevirir", () => {
    expect(ucretiNormalle("1.250,5")).toBe("1250.5");
    expect(ucretiNormalle(" 400 ")).toBe("400");
  });

  it("Türkçe biçim geçerli sayılır", () => {
    expect(dogrulaUcret("1.250,5")).toBeUndefined();
    expect(dogrulaUcret("")).toBeUndefined();
  });

  it("sayı olmayanı ve aşırı tutarı reddeder", () => {
    expect(dogrulaUcret("çok")).toBeTruthy();
    expect(dogrulaUcret("999999")).toBeTruthy();
  });
});
