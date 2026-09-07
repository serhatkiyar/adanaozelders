/**
 * `gorunurCinsiyet` — iki ayrı "boş" durumun TEK cevaba indirgendiği yer.
 *
 * Bu yardımcı, dört ekranda tekrarlanan `g && g !== UNSPECIFIED` koşulunun
 * yerine geçti. Tekrarın riski somuttu: dördünden birinde `UNSPECIFIED`
 * kontrolü unutulsa, kullanıcının **söylemek istemediği** şey ekrana basılırdı.
 *
 * Veri katmanında `NULL` ile `UNSPECIFIED` ayrımı KORUNUR (biri "hiç
 * sorulmadı", diğeri "soruldu, söylemek istemedi"); burada sadeleşen yalnız
 * ifadedir.
 */
import { describe, expect, it } from "vitest";

import { GENDER_LABEL, ageFromBirthDate, gorunurCinsiyet } from "@/lib/demographics";
import { Gender } from "@/types";

describe("gorunurCinsiyet", () => {
  it("ÜÇ boş durumda da `null` döner", () => {
    expect(gorunurCinsiyet(null)).toBeNull();
    expect(gorunurCinsiyet(undefined)).toBeNull();
    // `UNSPECIFIED` bir DEĞERDİR ama gösterilecek bir değer değildir:
    // "Belirtilmemiş" yazmak, kişinin söylememe tercihini ekrana ilan eder.
    expect(gorunurCinsiyet(Gender.UNSPECIFIED)).toBeNull();
  });

  it("gerçek değerlerde Türkçe etiketi döner", () => {
    expect(gorunurCinsiyet(Gender.FEMALE)).toBe("Kadın");
    expect(gorunurCinsiyet(Gender.MALE)).toBe("Erkek");
  });

  it("etiket haritası ikinci bir doğruluk kaynağı DEĞİL", () => {
    // Yardımcı kendi metnini üretseydi, `GENDER_LABEL`i güncelleyen biri
    // burayı unuturdu ve aynı kişi iki ekranda iki farklı etiketle görünürdü.
    expect(gorunurCinsiyet(Gender.FEMALE)).toBe(GENDER_LABEL[Gender.FEMALE]);
    expect(gorunurCinsiyet(Gender.MALE)).toBe(GENDER_LABEL[Gender.MALE]);
  });

  it("DOLULUK: enum'un her üyesi haritada karşılık buluyor", () => {
    // Enum'a yeni bir üye eklendiğinde etiketi de eklenmezse, o kişiler
    // ekranda `undefined` görünürdü.
    for (const uye of Object.values(Gender)) {
      expect(GENDER_LABEL[uye], `${uye} için etiket yok`).toBeTruthy();
    }
    expect(Object.values(Gender).length).toBeGreaterThanOrEqual(3);
  });
});

describe("ageFromBirthDate (mevcut davranış çıpası)", () => {
  it("geçersiz ve boş girdide `null`", () => {
    expect(ageFromBirthDate(null)).toBeNull();
    expect(ageFromBirthDate("")).toBeNull();
    expect(ageFromBirthDate("bugün")).toBeNull();
  });

  it("makul bir doğum tarihinde sayı döner", () => {
    const yil = new Date().getFullYear() - 30;
    expect(ageFromBirthDate(`${yil}-01-01`)).toBe(30);
  });
});
