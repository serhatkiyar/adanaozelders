// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildSpecGroups, buildSpecRows, hasSpecs } from "./productSpecs";

// ── DAVRANIŞ BİLİNÇLİ DEĞİŞTİ ──
//
// 1. "ISBN / Barkod" etiketi "ISBN" oldu. Bu kod tabanında ISBN ile BARKOD
//    AYRI kimliklerdir ve `models/store.py` ISBN'in barkoda kopyalanmasını
//    açıkça yasaklar; vitrinde ikisini tek etikette birleştirmek, depo ve kasa
//    tarafında ayrı tutulan iki numarayı birmiş gibi gösteriyordu.
// 2. Sıra anlamsal gruplara göre yeniden düzenlendi (Eser → Basım → Fiziksel
//    → Kimlik). Gerekçe ölçüldü: künye tablolarının dörtte biri hiç
//    gruplanmıyor ve sonuç taranamayan bir "özellik duvarı" oluyor.

describe("buildSpecRows", () => {
  it("künye boşsa boş döner", () => {
    expect(buildSpecRows({})).toEqual([]);
    expect(hasSpecs({})).toBe(false);
  });

  it("yalnız dolu alanları sıralı döndürür", () => {
    const rows = buildSpecRows({ isbn: "9786051949291", author: "Kolektif" });
    // Sıra SPEC_ORDER'a göre: Yazar, sonra ISBN.
    expect(rows.map((r) => r.label)).toEqual(["Yazar", "ISBN"]);
    expect(rows[0].value).toBe("Kolektif");
    expect(hasSpecs({ author: "Kolektif" })).toBe(true);
  });

  it("sayısal alanları string'e çevirir; 0 dahil edilir", () => {
    const rows = buildSpecRows({ page_count: 360, publication_year: 2022 });
    // Basım grubunda yıl sayfadan ÖNCE gelir (basım kimliği → hacim).
    expect(rows).toEqual([
      { key: "publication_year", label: "Basım yılı", value: "2022" },
      { key: "page_count", label: "Sayfa sayısı", value: "360" },
    ]);
  });

  it("null/boş/boşluk-only değerleri eler", () => {
    const rows = buildSpecRows({
      author: null,
      publisher: "   ",
      language: "Türkçe",
    });
    expect(rows.map((r) => r.label)).toEqual(["Dil"]);
  });

  it("tam künyeyi doğru sırayla verir", () => {
    const rows = buildSpecRows({
      author: "Özgür Bula",
      publisher: "3D Yayınları",
      isbn: "9786051949291",
      page_count: 360,
      dimensions: "20 x 27",
      publication_year: 2022,
      edition: "1. Basım",
      language: "Türkçe",
      cover_type: "İnce Kapak",
    });
    expect(rows.map((r) => r.label)).toEqual([
      // Eser
      "Yazar",
      "Yayınevi",
      "Dil",
      // Basım
      "Basım yılı",
      "Baskı",
      "Sayfa sayısı",
      // Fiziksel
      "Ebat",
      "Kapak tipi",
      // Kimlik — satın almadan önce nadiren okunur, EKSİKLİĞİ güven düşürür.
      "ISBN",
    ]);
  });
});

describe("buildSpecGroups", () => {
  it("dolu grupları anlamsal sırayla verir, boş grupları ATLAR", () => {
    const gruplar = buildSpecGroups({ author: "Kolektif", isbn: "978" });
    expect(gruplar.map((g) => g.key)).toEqual(["eser", "kimlik"]);
    expect(gruplar[0].title).toBe("Eser");
  });

  it("yönetilen nitelikleri kendi grubunda gösterir", () => {
    // Bu alan yönetimden uzun süredir GİRİLEBİLİYOR ama vitrine hiç
    // çıkmıyordu: kırtasiye ürününde künye tablosu bomboş kalıyordu.
    const gruplar = buildSpecGroups({}, [
      { definition_name: "Kağıt Cinsi", label: "80 gr", sort_order: 0 },
    ]);
    expect(gruplar.map((g) => g.key)).toEqual(["ozellik"]);
    expect(gruplar[0].rows[0]).toMatchObject({
      label: "Kağıt Cinsi",
      value: "80 gr",
    });
  });

  it("nitelik yoksa 'Özellikler' grubu hiç doğmaz", () => {
    const gruplar = buildSpecGroups({ author: "Kolektif" }, []);
    expect(gruplar.some((g) => g.key === "ozellik")).toBe(false);
  });

  it("künye ve nitelikler birlikte, nitelikler kimlikten ÖNCE", () => {
    const gruplar = buildSpecGroups({ author: "K", isbn: "978" }, [
      { definition_name: "Kağıt Cinsi", label: "80 gr", sort_order: 0 },
    ]);
    expect(gruplar.map((g) => g.key)).toEqual(["eser", "ozellik", "kimlik"]);
  });
});
