// @vitest-environment node
// Toplu ürün içe aktarma ŞABLONU — hizalama nöbetçisi.
//
// Neden var: şablonun örnek satırı 18 alan taşıyordu, başlık ise 19 kolon.
// `tax_rate` atlanmıştı ve sonraki her değer bir kolon kaymıştı:
//
//   başlık : title,kind,price,tax_rate,compare_at_price,stock,category_slug,...
//   örnek  : AYT …,PHYSICAL,339,399,25,yks-kitaplari,ACTIVE,…
//                              ^^^ tax_rate=399   ^^^ stock="yks-kitaplari"
//
// Sonuç: şablonu indirip dolduran herkes geçersiz veri gönderiyordu — backend
// `tax_rate 0 ≤ oran < 1 olmalı` diyerek satırı reddediyor
// (`services/store_service.py::bulk_import_products`), ama kullanıcı hatanın
// KENDİ dosyasından değil şablondan geldiğini göremiyordu.
//
// Bu dosya kolon SAYISINI değil, her alanın kendi anlamına uyduğunu da
// doğrular: yalnız sayı sayan bir test, iki alanın yer değiştirdiği bir
// kaymayı yakalamazdı.
import { describe, expect, it } from "vitest";

import {
  CSV_COLUMNS,
  CSV_SAMPLE_ROW,
  buildCsvTemplate,
} from "./productCsvTemplate";

/** Basit CSV ayrıştırıcı — şablonda tırnaklı alan YOKTUR (kural aşağıda). */
function alanlar(satir: string): string[] {
  return satir.split(",");
}

const baslikAdlari = alanlar(CSV_COLUMNS);

describe("şablon başlık ↔ örnek satır hizası", () => {
  it("örnek satır başlıkla AYNI sayıda alan taşır", () => {
    expect(alanlar(CSV_SAMPLE_ROW)).toHaveLength(baslikAdlari.length);
  });

  it("şablonda tırnaklı/virgüllü alan yoktur — naif ayrıştırma geçerli kalsın", () => {
    // Örnek satıra virgül içeren bir değer konursa bu testin ayrıştırıcısı da,
    // kullanıcının Excel'i de kayar. Kural açıkça korunur.
    expect(CSV_SAMPLE_ROW).not.toContain('"');
  });

  it("indirilen şablon başlık + örnek satırdan oluşur", () => {
    const satirlar = buildCsvTemplate().split("\n");
    expect(satirlar).toHaveLength(2);
    expect(satirlar[0]).toBe(CSV_COLUMNS);
    expect(satirlar[1]).toBe(CSV_SAMPLE_ROW);
  });
});

describe("örnek satırın alanları kendi anlamına uyar", () => {
  // Sayı saymak yetmez: iki alanın yer değiştirdiği bir kayma sayıyı bozmaz.
  const deger = Object.fromEntries(
    baslikAdlari.map((ad, i) => [ad, alanlar(CSV_SAMPLE_ROW)[i]])
  ) as Record<string, string>;

  it("kind PHYSICAL veya DIGITAL", () => {
    expect(["PHYSICAL", "DIGITAL"]).toContain(deger.kind);
  });

  it("tax_rate ORAN olarak yazılır (0 ≤ oran < 1) — yüzde DEĞİL", () => {
    // Backend kuralının aynası: store_service.bulk_import_products.
    const oran = Number(deger.tax_rate);
    expect(Number.isFinite(oran)).toBe(true);
    expect(oran).toBeGreaterThanOrEqual(0);
    expect(oran).toBeLessThan(1);
  });

  it("price pozitif bir sayıdır", () => {
    expect(Number(deger.price)).toBeGreaterThan(0);
  });

  it("compare_at_price boş değilse fiyattan BÜYÜKTÜR", () => {
    // Backend `compare_at_price fiyattan büyük olmalı` ile reddeder; şablonun
    // kendisi bu kuralı ihlal ederse örnek satır hiç içe aktarılamaz.
    if (deger.compare_at_price !== "") {
      expect(Number(deger.compare_at_price)).toBeGreaterThan(Number(deger.price));
    }
  });

  it("stock tam sayıdır", () => {
    expect(Number.isInteger(Number(deger.stock))).toBe(true);
  });

  it("status ACTIVE/HIDDEN/DRAFT", () => {
    expect(["ACTIVE", "HIDDEN", "DRAFT"]).toContain(deger.status);
  });

  it("category_slug slug biçimindedir (boşluk/büyük harf yok)", () => {
    if (deger.category_slug !== "") {
      expect(deger.category_slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("page_count ve publication_year tam sayıdır", () => {
    expect(Number.isInteger(Number(deger.page_count))).toBe(true);
    expect(Number.isInteger(Number(deger.publication_year))).toBe(true);
  });

  it("isbn yalnız rakamlardan oluşur", () => {
    // Kaymanın en görünür belirtisi: bu alana yayınevi adı düşmüştü.
    expect(deger.isbn).toMatch(/^\d{10,13}$/);
  });
});
