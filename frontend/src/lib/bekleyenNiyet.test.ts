/**
 * Bekleyen niyet sözleşmesi — TİP KAPSAMLI tüketim.
 *
 * ## Ölçtüğü kusur sınıfı
 *
 * Niyetler iki yerde uygulanıyor: `favori` global uygulayıcıda, diğerleri
 * kendi sayfalarında. Global uygulayıcı niyeti KOŞULSUZ tüketseydi sayfanınkini
 * yerdi — kullanıcı "Ders Talep Et"e basar, giriş yapar, hiçbir şey olmaz,
 * hata da çıkmaz. ÜK-6'da bir kez ölçülmüş sessiz kaybın birebir tekrarı.
 *
 * İkinci sınıf: `sessionStorage` GÜVENİLMEZ girdidir. Elle kurcalanmış ya da
 * eski sürümden kalmış bir kayıt, uygulayıcıyı tanımsız alanlara sokmamalı.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Saf modül testi: gerçek `sessionStorage` (jsdom). Uygulayıcıların bu
 * sözleşmeye UYDUĞUNU görmez — onu `favoriRolKapisi` (global) ve
 * `dersTalebiNiyeti` (sayfa) ölçer.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  niyetiAl,
  niyetiGozle,
  niyetiSakla,
  niyetiTemizle,
  type BekleyenNiyet,
} from "@/lib/bekleyenNiyet";

const ANAHTAR = "bekleyen_niyet";

afterEach(() => niyetiTemizle());

describe("bekleyen niyet · tip kapsamlı tüketim", () => {
  it("ASIL İDDİA: `niyetiAl('favori')` bir `dersTalebi` niyetini TÜKETMEZ", () => {
    // Global uygulayıcının sayfanın niyetini yemesi bu satırla imkânsızlaşır.
    niyetiSakla({ tip: "dersTalebi", egitmenId: 42 });

    expect(niyetiAl("favori")).toBeNull();
    expect(niyetiGozle()).toEqual({ tip: "dersTalebi", egitmenId: 42 });
  });

  it("eşleşen tipi tüketir ve TEK KULLANIMLIKTIR", () => {
    niyetiSakla({ tip: "favori", hedef: "egitmen", id: 7 });

    expect(niyetiAl("favori")).toEqual({ tip: "favori", hedef: "egitmen", id: 7 });
    expect(niyetiAl("favori")).toBeNull();
    expect(niyetiGozle()).toBeNull();
  });

  it("birden fazla tip verilebilir", () => {
    niyetiSakla({ tip: "odeme" });
    expect(niyetiAl("favori", "odeme")).toEqual({ tip: "odeme" });
  });

  it("`niyetiGozle` TÜKETMEZ", () => {
    // Sayfa hook'u önce eşleşmeye bakar; eşleşmezse niyet yerinde kalmalı.
    niyetiSakla({ tip: "kutuphaneRezervasyonu", kutuphaneId: 3 });
    expect(niyetiGozle()).toEqual({ tip: "kutuphaneRezervasyonu", kutuphaneId: 3 });
    expect(niyetiGozle()).toEqual({ tip: "kutuphaneRezervasyonu", kutuphaneId: 3 });
  });

  it("son tıklama kazanır (tek niyet)", () => {
    // Tek anahtar kararının davranışsal karşılığı: iki bekleyen niyet aynı
    // anda var olamaz, yoksa tek girişten sonra ikisi birden ateşlenirdi.
    niyetiSakla({ tip: "favori", hedef: "egitmen", id: 1 });
    niyetiSakla({ tip: "dersTalebi", egitmenId: 2 });
    expect(niyetiGozle()).toEqual({ tip: "dersTalebi", egitmenId: 2 });
  });
});

describe("bekleyen niyet · güvenilmez girdi", () => {
  const BOZUK: [string, string][] = [
    ["JSON değil", "{bozuk"],
    ["dizi", "[1,2]"],
    ["null", "null"],
    ["tip yok", '{"id":5}'],
    ["tanınmayan tip", '{"tip":"zirva","id":5}'],
    ["favori: hedef yanlış", '{"tip":"favori","hedef":"uzay","id":5}'],
    ["favori: id metin", '{"tip":"favori","hedef":"egitmen","id":"5"}'],
    ["dersTalebi: alan eksik", '{"tip":"dersTalebi"}'],
  ];

  it.each(BOZUK)("%s → null", (_ad, ham) => {
    sessionStorage.setItem(ANAHTAR, ham);
    expect(niyetiGozle()).toBeNull();
  });

  it("bozuk kayıt tüketim denemesinde TEMİZLENİR", () => {
    // Yoksa oturum boyunca çöp olarak kalır ve her girişte yeniden çözülür.
    sessionStorage.setItem(ANAHTAR, '{"tip":"zirva"}');
    expect(niyetiAl("favori")).toBeNull();
    expect(sessionStorage.getItem(ANAHTAR)).toBeNull();
  });

  it("GEÇERLİ ama başka tipteki kayıt SİLİNMEZ", () => {
    // Bozuk kayıt temizliği ile tip kapsamı karışırsa, sayfa niyeti bozuk
    // sanılıp silinir. İkisi ayrı yollar.
    niyetiSakla({ tip: "dersTalebi", egitmenId: 9 });
    niyetiAl("favori");
    expect(sessionStorage.getItem(ANAHTAR)).not.toBeNull();
  });
});

describe("bekleyen niyet · DOLULUK", () => {
  it("her niyet tipi round-trip yapıyor", () => {
    // Bu olmadan yukarıdaki iddialar, bir tip hiç saklanamıyorken de
    // yeşil kalabilirdi.
    const ornekler: BekleyenNiyet[] = [
      { tip: "favori", hedef: "egitmen", id: 1 },
      { tip: "favori", hedef: "kutuphane", id: 2 },
      { tip: "dersTalebi", egitmenId: 3 },
      { tip: "kutuphaneRezervasyonu", kutuphaneId: 4 },
      { tip: "odeme" },
    ];
    for (const n of ornekler) {
      niyetiSakla(n);
      expect(niyetiGozle(), `${n.tip} round-trip yapmıyor`).toEqual(n);
    }
  });
});
