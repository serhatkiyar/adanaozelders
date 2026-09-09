/**
 * ESKİ ARAMA ADRESLERİ ÖLMEZ — Türkçeleşme göçünün iki yönü.
 *
 * ## Karar
 *
 * Arama parametreleri 9 Eyl 2026'da Türkçeleşti (kullanıcı kararı):
 * `subject→ders`, `district→ilce`, `mode→sekil`, `exam→sinav`,
 * `gender→cinsiyet`, `sort→sirala`, `category→kategori`, `kind→tur`.
 * `q`, `mahalle` ve `sayfa` değişmedi.
 *
 * Gerekçe: public yollarımız zaten Türkçe (`/egitmenler`, `/kutuphaneler`) ve
 * Google'ın URL rehberi *"use words in your audience's language in the URL"*
 * diyor. Bugünkü karışıklık ölçülmüştü: `district` İngilizce ama `mahalle`
 * Türkçe, `sort` İngilizce ama `sayfa` Türkçe.
 *
 * ## Bu nöbetçinin ölçtüğü kusur sınıfı
 *
 * Ad değişimi SESSİZ bir kırılma sınıfıdır: paylaşılmış bir bağlantı, e-posta
 * içindeki bir link ya da Google'ın indekslediği bir adres açıldığında hata
 * VERMEZ — yalnız filtre uygulanmamış, "sonuç yok" ya da "her şey" görünür.
 * Kimse şikâyet etmez, kimse fark etmez.
 *
 * Bu yüzden iki yön birden çıpalanır:
 *   1. eski ad OKUNUR (bağlantı çalışmaya devam eder),
 *   2. yalnız yeni ad YAZILIR (adres kendini yeniler, iki ad yan yana yaşamaz).
 *
 * İkincisi olmasaydı eski anahtar yeni yazılanın yanında kalır ve aynı içerik
 * iki farklı adreste yaşardı — Google'ın duplicate tanımı.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Saf fonksiyon testi: gerçek `URLSearchParams`, gerçek şema. Sayfaların bu
 * şemayı kullandığını görmez (`aramaUrlTekKapi` onu ölçer); burada ölçülen
 * yalnız göç yolunun kendisidir.
 */
import { describe, expect, it } from "vitest";

import {
  EGITMEN_ARAMA,
  KUTUPHANE_ARAMA,
  MAGAZA_ARAMA,
  egitmenAramaAdresi,
  kutuphaneAramaAdresi,
  magazaAramaAdresi,
} from "@/lib/aramaUrl";
import { aramayiOku, type Sema } from "@/lib/urlSemasi";
import { TeachingMode, Gender } from "@/types";

const sorgu = (adres: string) =>
  new URLSearchParams(adres.includes("?") ? adres.split("?")[1] : "");

describe("eski adres göçü · ESKİ AD OKUNUR", () => {
  it("eğitmen: `?subject=&mode=&exam=&gender=&district=` bugünküyle aynı sonucu verir", () => {
    const eski = new URLSearchParams(
      "subject=matematik&subject=fizik&mode=IN_PERSON&exam=TYT&gender=FEMALE&district=Seyhan&sayfa=2"
    );
    const okunan = aramayiOku(EGITMEN_ARAMA, eski);

    expect(okunan.ders).toEqual(["matematik", "fizik"]);
    expect(okunan.sekil).toEqual([TeachingMode.IN_PERSON]);
    expect(okunan.sinav).toBe("TYT");
    expect(okunan.cinsiyet).toBe(Gender.FEMALE);
    expect(okunan.konum.ilce).toEqual(["Seyhan"]);
    expect(okunan.sayfa).toBe(2);
  });

  it("mağaza: `?category=&kind=&sort=` okunur", () => {
    const okunan = aramayiOku(
      MAGAZA_ARAMA,
      new URLSearchParams("q=roman&category=12&kind=PHYSICAL&sort=fiyat_artan")
    );
    expect(okunan.kategori).toBe(12);
    expect(okunan.tur).toBe("PHYSICAL");
    expect(okunan.sirala).toBe("fiyat_artan");
  });

  it("kütüphane: `?district=` + `?mahalle=` birlikte okunur", () => {
    const okunan = aramayiOku(
      KUTUPHANE_ARAMA,
      new URLSearchParams("q=merkez&mahalle=Reşatbey&district=Seyhan")
    );
    expect(okunan.q).toBe("merkez");
    expect(okunan.konum.yer?.mahalle).toBe("Reşatbey");
  });

  it("KANONİK ÖNCELİKLİ: iki ad birden yazılıysa yeni ad kazanır", () => {
    // Elle kurcalanmış ya da yarım göç etmiş bir adres. Belirsizlik sessizce
    // eski değere düşmemeli.
    const okunan = aramayiOku(
      EGITMEN_ARAMA,
      new URLSearchParams("ders=kimya&subject=matematik")
    );
    expect(okunan.ders).toEqual(["kimya"]);
  });
});

describe("eski adres göçü · YALNIZ YENİ AD YAZILIR", () => {
  it("eğitmen: okunan eski adres yeniden yazılınca Türkçeleşir", () => {
    const eski = new URLSearchParams(
      "subject=matematik&mode=IN_PERSON&exam=TYT&gender=FEMALE&district=Seyhan"
    );
    const yeniAdres = egitmenAramaAdresi(aramayiOku(EGITMEN_ARAMA, eski));
    const sp = sorgu(yeniAdres);

    // Yeni adlar var…
    expect(sp.getAll("ders")).toEqual(["matematik"]);
    expect(sp.getAll("sekil")).toEqual(["IN_PERSON"]);
    expect(sp.get("sinav")).toBe("TYT");
    expect(sp.get("cinsiyet")).toBe("FEMALE");
    expect(sp.getAll("ilce")).toEqual(["Seyhan"]);

    // …eskiler YOK. Kalsalardı aynı içerik iki adreste yaşardı.
    for (const eskiAd of ["subject", "mode", "exam", "gender"]) {
      expect(sp.has(eskiAd), `${eskiAd} adreste kalmış — duplicate URL`).toBe(false);
    }
  });

  it("mağaza: eski adlar yazılan adreste kalmaz", () => {
    const yeni = magazaAramaAdresi(
      aramayiOku(MAGAZA_ARAMA, new URLSearchParams("category=12&kind=DIGITAL&sort=yeni"))
    );
    const sp = sorgu(yeni);
    expect(sp.get("kategori")).toBe("12");
    expect(sp.get("tur")).toBe("DIGITAL");
    expect(sp.get("sirala")).toBe("yeni");
    for (const eskiAd of ["category", "kind", "sort"]) {
      expect(sp.has(eskiAd), `${eskiAd} adreste kalmış`).toBe(false);
    }
  });

  it("kütüphane: `district` → `ilce` (ILCE_PARAM göçüyle birlikte)", () => {
    const yeni = kutuphaneAramaAdresi(
      aramayiOku(KUTUPHANE_ARAMA, new URLSearchParams("district=Çukurova"))
    );
    const sp = sorgu(yeni);
    // ILCE_PARAM bugün hâlâ `district`; göç günü tek satırda `ilce` olacak ve
    // bu iddia o gün kendiliğinden doğru kalmalı — bu yüzden ADI değil
    // DEĞERİN taşındığı çıpalanıyor.
    expect([...sp.values()]).toContain("Çukurova");
  });
});

describe("eski adres göçü · DOLULUK", () => {
  it("her eski anahtar bir alanda GERÇEKTEN bildirilmiş", () => {
    // Bu olmadan yukarıdaki "okunur" iddiaları, alan eski adı hiç tanımasa
    // bile başka bir yoldan geçebilirdi.
    const bekleniyor: Record<string, string[]> = {
      egitmen: ["subject", "mode", "exam", "gender"],
      magaza: ["category", "kind", "sort"],
    };
    const semalar: Record<string, Sema<Record<string, unknown>>> = {
      egitmen: EGITMEN_ARAMA as unknown as Sema<Record<string, unknown>>,
      magaza: MAGAZA_ARAMA as unknown as Sema<Record<string, unknown>>,
    };
    for (const [ad, eskiler] of Object.entries(bekleniyor)) {
      const bildirilen = new Set(
        Object.values(semalar[ad].alanlar).flatMap((a) => [...(a.eskiAnahtarlar ?? [])])
      );
      for (const e of eskiler) {
        expect(
          bildirilen.has(e),
          `${ad} şemasında "${e}" eski anahtar olarak bildirilmemiş`
        ).toBe(true);
      }
    }
  });
});
