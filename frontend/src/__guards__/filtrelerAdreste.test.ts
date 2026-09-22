// @vitest-environment node
/**
 * HER FİLTRE ADRESTE — ve HİÇBİR KOORDİNAT adreste değil.
 *
 * ## Karar (kullanıcı, 9 Eyl 2026)
 *
 * Kullanıcı Airbnb'nin her filtreyi adrese yazan arama URL'ini referans
 * gösterdi. Ölçtüğümde filtrelerin çoğu YEREL state'teydi: eğitmende
 * sıralama/fiyat/yaş/"yakınımda", kütüphanede sıralama ve olanaklar,
 * mağazada sekiz daraltma. Sonucu: seçim paylaşılamıyor, yenilemede
 * sıfırlanıyor, geri tuşu geri almıyordu.
 *
 * İncelenen yedi platformun yedisinde de sayfalama, sıralama ve "yakınımda"
 * adreste. Baymard'ın ölçümünde e-ticaret sitelerinin %27'si filtreyi
 * geçmişe yazmadığı için geri tuşunu bozuyor.
 *
 * ## İki ayrı iddia
 *
 * 1. KAPSAM — API'nin kabul ettiği her filtrenin URL'de bir evi var.
 *    Doğrudan ölçülür: şemanın TAM dolu bir değeri, isteğin bütün
 *    alanlarını üretmeli. Bir alan URL'de yoksa istekte de doğamaz.
 * 2. GİZLİLİK — ham enlem/boylam adrese ASLA yazılmaz. Airbnb'nin
 *    `location_search=NEARBY` fikri alındı, koordinat alınmadı: paylaşılan
 *    bir arama bağlantısı kullanıcının bulunduğu yeri taşımamalı. Aynı
 *    gerekçe `yerArama`nın mahalle ADI taşıma kararında da var.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Saf fonksiyon testi: gerçek şema, gerçek `URLSearchParams`. Ekranların bu
 * alanları GERÇEKTEN sürdüğünü görmez — onu `aramaUrlTekKapi` (köken) ve
 * sayfa testleri ölçer.
 */
import { describe, expect, it } from "vitest";

import {
  EGITMEN_ARAMA,
  KUTUPHANE_ARAMA,
  MAGAZA_ARAMA,
  egitmenAramaAdresi,
  egitmenIstegi,
  kutuphaneAramaAdresi,
  kutuphaneIstegi,
  type EgitmenAramasi,
  type KutuphaneAramasi,
} from "@/lib/aramaUrl";
import { aramayiOku, aramayiYaz, bosDeger, type Sema } from "@/lib/urlSemasi";
import { Gender, TeachingMode, TutorSort } from "@/types";

const sorgu = (adres: string) =>
  new URLSearchParams(adres.includes("?") ? adres.split("?")[1] : "");

const KONUMUM = { lat: 37.001, lng: 35.321 };

/** Her alanı varsayılan-dışına çekilmiş eğitmen araması. */
const DOLU_EGITMEN: EgitmenAramasi = {
  q: "matematik",
  ders: ["Matematik"],
  konum: { yer: null, ilce: ["Seyhan"] },
  sekil: [TeachingMode.IN_PERSON],
  sinav: "TYT",
  cinsiyet: Gender.FEMALE,
  sirala: TutorSort.PRICE_ASC,
  minFiyat: 100,
  maxFiyat: 500,
  minYas: 20,
  maxYas: 45,
  yakinimda: true,
  yaricap: 10,
  sayfa: 2,
};

const DOLU_KUTUPHANE: KutuphaneAramasi = {
  q: "merkez",
  konum: { yer: null, ilce: ["Çukurova"] },
  olanaklar: ["wifi", "otopark"],
  sirala: "distance",
  yakinimda: true,
  yaricap: 15,
  sayfa: 3,
};

describe("filtreler adreste · KAPSAM", () => {
  it("öğretmen: API'nin her filtresi URL'den doğuyor", () => {
    // Bu düğüm "hangi filtreler adreste" sorusunun tam cevabı. Yeni bir API
    // filtresi eklenip URL'e bağlanmazsa burada eksik çıkar.
    const istek = egitmenIstegi(DOLU_EGITMEN, {
      limit: 20,
      offset: 0,
      konumum: KONUMUM,
    });
    expect(Object.keys(istek).sort()).toEqual(
      [
        "district",
        "exam",
        "gender",
        "lat",
        "limit",
        "lng",
        "max_age",
        "max_rate",
        "min_age",
        "min_rate",
        "mode",
        "offset",
        "q",
        "radius_km",
        "sort",
        "subject",
      ].sort()
    );
  });

  it("kütüphane: API'nin her filtresi URL'den doğuyor", () => {
    const istek = kutuphaneIstegi(DOLU_KUTUPHANE, {
      limit: 30,
      offset: 0,
      konumum: KONUMUM,
    });
    expect(Object.keys(istek).sort()).toEqual(
      [
        "amenities",
        "district",
        "lat",
        "limit",
        "lng",
        "offset",
        "q",
        "radius_km",
        "sort",
      ].sort()
    );
  });

  it("boş şema BOŞ istek üretir (sayfalama hariç)", () => {
    // Varsayılanın istekte görünmesi, sunucuya "filtre var" demek olurdu.
    expect(egitmenIstegi(bosDeger(EGITMEN_ARAMA))).toEqual({});
    expect(kutuphaneIstegi(bosDeger(KUTUPHANE_ARAMA))).toEqual({});
  });

  it("sıralama adreste yaşıyor ve geri okunuyor", () => {
    const adres = egitmenAramaAdresi({ sirala: TutorSort.RATING_DESC });
    expect(adres).toContain("sirala=puan");
    expect(aramayiOku(EGITMEN_ARAMA, sorgu(adres)).sirala).toBe(
      TutorSort.RATING_DESC
    );
  });
});

describe("filtreler adreste · GİZLİLİK", () => {
  const SEMALAR: [string, Sema<Record<string, unknown>>, Record<string, unknown>][] =
    [
      [
        "egitmen",
        EGITMEN_ARAMA as unknown as Sema<Record<string, unknown>>,
        DOLU_EGITMEN as unknown as Record<string, unknown>,
      ],
      [
        "kutuphane",
        KUTUPHANE_ARAMA as unknown as Sema<Record<string, unknown>>,
        DOLU_KUTUPHANE as unknown as Record<string, unknown>,
      ],
      [
        "magaza",
        MAGAZA_ARAMA as unknown as Sema<Record<string, unknown>>,
        bosDeger(MAGAZA_ARAMA) as unknown as Record<string, unknown>,
      ],
    ];

  it.each(SEMALAR)("%s: adreste ham KOORDİNAT yok", (_ad, sema, dolu) => {
    const sp = aramayiYaz(sema, dolu);
    for (const yasak of ["lat", "lng", "latitude", "longitude"]) {
      expect(sp.has(yasak), `${yasak} adrese yazılmış`).toBe(false);
    }
  });

  it("'yakınımda' adreste NİYET olarak yaşar, koordinat olarak değil", () => {
    const adres = egitmenAramaAdresi({ yakinimda: true, yaricap: 10 });
    expect(adres).toContain("yakinimda=1");
    expect(adres).toContain("yaricap=10");
    expect(adres).not.toContain("lat");
    expect(adres).not.toContain("lng");
  });

  it("koordinat İSTEĞE girer (URL'e değil) — yön ayrımı", () => {
    // Gizlilik kuralı "koordinat hiç kullanılmasın" değil: sunucuya gider,
    // adrese yazılmaz. Bu düğüm olmasaydı yukarıdaki iddia, özellik hiç
    // çalışmasa da yeşil kalırdı.
    const istek = egitmenIstegi(
      { ...bosDeger(EGITMEN_ARAMA), yakinimda: true, yaricap: 10 },
      { konumum: KONUMUM }
    );
    expect(istek.lat).toBe(KONUMUM.lat);
    expect(istek.radius_km).toBe(10);
  });

  it("konum İZNİ yoksa koordinat uydurulmaz", () => {
    const istek = egitmenIstegi(
      { ...bosDeger(EGITMEN_ARAMA), yakinimda: true },
      { konumum: null }
    );
    expect(istek.lat).toBeUndefined();
    expect(istek.radius_km).toBeUndefined();
  });
});

describe("filtreler adreste · ALANLAR ARASI KURAL", () => {
  it("yarıçap TEK BAŞINA adreste durmaz", () => {
    // Yoksa `?yaricap=25` hiçbir şey yapmayan ama filtre gibi görünen bir
    // anahtar olurdu.
    expect(egitmenAramaAdresi({ yaricap: 25 })).not.toContain("yaricap");
    expect(kutuphaneAramaAdresi({ yaricap: 25 })).not.toContain("yaricap");
  });

  it("kütüphanede 'mesafeye göre' sıralama konum niyetini AÇAR", () => {
    // İkisi tek bir niyetin iki yarısı: referans noktası olmadan mesafe
    // sıralaması sunucuda sessizce hiçbir şey yapmaz.
    const okunan = aramayiOku(
      KUTUPHANE_ARAMA,
      new URLSearchParams("sirala=mesafe")
    );
    expect(okunan.yakinimda).toBe(true);
  });

  it("uzaktan aramada 'yakınımda' da düşer", () => {
    // Konum düşerken konum NİYETİNİN kalması, uzaktan eğitmenleri sessizce
    // eleyen bir yarıçap filtresi bırakırdı.
    const adres = egitmenAramaAdresi({
      sekil: [TeachingMode.ONLINE],
      yakinimda: true,
      yaricap: 10,
    });
    expect(adres).not.toContain("yakinimda");
    expect(adres).not.toContain("yaricap");
  });
});
