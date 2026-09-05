/**
 * Sihirbaz sözleşmesinin saf testi.
 *
 * Buradaki iki şey sessizce bozulursa kullanıcı akışın SONUNDA 422 yer ve
 * yazdıklarını nereye dönüp düzelteceğini bulamaz:
 *
 *  1. Adım doğrulaması ile sunucunun kabul ettiği değer aralığı ayrışırsa
 *     (özellikle başlık kelime eşiği — sunucuda `HEADLINE_MIN_WORDS`).
 *  2. `eksikler()` yayın kapısıyla hizasını kaybederse; özet ekranı "her şey
 *     tamam" derken sunucu reddeder.
 */
import { describe, expect, it } from "vitest";

import { BASLIK_EN_AZ_KELIME } from "@/lib/metin";
import { TeachingMode } from "@/types";

import {
  ADIMLAR,
  BOS_DURUM,
  SON_ADIM,
  adimIndeksi,
  adimiSinirla,
  eksikler,
  ucretiCoz,
  type DisDurum,
  type Durum,
} from "./sozlesme";

const DIS_TAM: DisDurum = {
  avatarUrl: "/x.webp",
  belgeVar: true,
  telefonDogrulandi: true,
};

const DIS_BOS: DisDurum = {
  avatarUrl: null,
  belgeVar: false,
  telefonDogrulandi: false,
};

function tamDurum(): Durum {
  return {
    ...BOS_DURUM,
    subjects: ["Arkeoloji"],
    headline: Array.from({ length: BASLIK_EN_AZ_KELIME }, (_, i) => `s${i}`).join(
      " ",
    ),
    lessonInfo: Array.from({ length: 30 }, (_, i) => `y${i}`).join(" "),
    bio: Array.from({ length: 30 }, (_, i) => `h${i}`).join(" "),
    teachingMode: TeachingMode.ONLINE,
    hourlyRate: "400",
  };
}

function adimAra(anahtar: string) {
  const i = ADIMLAR.findIndex((a) => a.anahtar === anahtar);
  expect(i, `${anahtar} adımı yok`).toBeGreaterThanOrEqual(0);
  return { i, adim: ADIMLAR[i] };
}

describe("adım sırası", () => {
  it("son adım özet, ilk adım ders seçimi", () => {
    expect(ADIMLAR[0].anahtar).toBe("dersler");
    expect(ADIMLAR[SON_ADIM].anahtar).toBe("ozet");
  });

  it("adım numarası aralık dışına taşmaz", () => {
    expect(adimiSinirla(-5)).toBe(0);
    expect(adimiSinirla(999)).toBe(SON_ADIM);
    expect(adimiSinirla(Number.NaN)).toBe(0);
    // "?adim=abc" → Number("abc") = NaN; kullanıcı elle URL yazabilir.
    expect(adimiSinirla(Number("abc"))).toBe(0);
  });
});

describe("adım doğrulaması", () => {
  it("başlık eşiği sunucudaki sabitle aynı", () => {
    const { adim } = adimAra("baslik");
    const d = { ...BOS_DURUM };

    d.headline = Array.from({ length: BASLIK_EN_AZ_KELIME - 1 }, () => "a").join(
      " ",
    );
    expect(adim.dogrula?.(d, DIS_TAM)).not.toBeNull();

    d.headline = Array.from({ length: BASLIK_EN_AZ_KELIME }, () => "a").join(" ");
    expect(adim.dogrula?.(d, DIS_TAM)).toBeNull();
  });

  it("yalnız uzaktan ders verende ilçe İSTENMEZ", () => {
    const { adim } = adimAra("yer");
    const uzaktan: Durum = {
      ...BOS_DURUM,
      teachingMode: TeachingMode.ONLINE,
      district: "",
    };
    expect(adim.dogrula?.(uzaktan, DIS_TAM)).toBeNull();

    const yuzyuze: Durum = {
      ...BOS_DURUM,
      teachingMode: TeachingMode.IN_PERSON,
      district: "",
    };
    expect(adim.dogrula?.(yuzyuze, DIS_TAM)?.alan).toBe("ilce");
  });

  it("ücret virgüllü yazılabilir ve aralık dışına çıkamaz", () => {
    expect(ucretiCoz("1250,5")).toBe(1250.5);
    expect(ucretiCoz("abc")).toBeNull();
    expect(ucretiCoz("0")).toBeNull();

    const { adim } = adimAra("ucret");
    expect(adim.dogrula?.({ ...BOS_DURUM, hourlyRate: "10" }, DIS_TAM)).not.toBeNull();
    expect(
      adim.dogrula?.({ ...BOS_DURUM, hourlyRate: "999999" }, DIS_TAM),
    ).not.toBeNull();
    expect(adim.dogrula?.({ ...BOS_DURUM, hourlyRate: "400" }, DIS_TAM)).toBeNull();
  });

  // 5 Eyl 2026: müsaitlik ve belge adımları sihirbazdan ÇIKARILDI. Belge artık
  // yayın kapısı değil, rozet koşulu; müsaitlik ilan yayına girdikten sonra
  // panelden doldurulur. Bu nöbetçi ikisinin sessizce geri eklenmesini
  // engeller — geri gelirlerse akış yine 11 adıma çıkar ve karar kaybolur.
  it("müsaitlik ve belge adımları sihirbazda YOKTUR", () => {
    const anahtarlar = ADIMLAR.map((a) => a.anahtar);
    expect(anahtarlar).not.toContain("belgeler");
    expect(anahtarlar).not.toContain("musaitlik");
  });

  it("atlanabilir adımların doğrulaması yoktur", () => {
    for (const adim of ADIMLAR.filter((a) => a.atlanabilir)) {
      expect(adim.dogrula, adim.anahtar).toBeUndefined();
    }
  });
});

describe("yayın kapısı önizlemesi", () => {
  // Belge artık yayın koşulu DEĞİL: belgesiz eğitmenin özet ekranı temiz
  // olmalı, yoksa kullanıcı düzeltemeyeceği bir eksik görür.
  it("belge eksik olsa da yayın kapısı temizdir", () => {
    expect(eksikler(tamDurum(), DIS_BOS)).toEqual([]);
  });

  it("her şey tamamsa liste boş", () => {
    expect(eksikler(tamDurum(), DIS_TAM)).toEqual([]);
  });

  it("boş ilanda her zorunlu adım ayrı ayrı listelenir", () => {
    const eksik = eksikler(BOS_DURUM, DIS_BOS);
    const zorunlu = ADIMLAR.filter((a) => a.dogrula).length;
    expect(eksik).toHaveLength(zorunlu);
    // Her madde kendi adımına bağlı olmalı — "Düzelt" bağlantısı buna dayanıyor.
    expect(new Set(eksik.map((e) => e.adim)).size).toBe(eksik.length);
  });
});

describe("adım yamaları", () => {
  it("ders adımı yalnız seviyesi seçilmiş dersleri gönderir", () => {
    const { adim } = adimAra("dersler");
    const yama = adim.yama?.({
      ...BOS_DURUM,
      subjects: ["Arkeoloji", "Ortografi"],
      subjectLevels: { 7: [1, 2], 9: [] },
    });
    expect(yama?.subjects).toEqual(["Arkeoloji", "Ortografi"]);
    // Boş seviye listesi GÖNDERİLMEZ: sunucu onu "seviye yok" olarak zaten
    // yorumluyor, boş dizi göndermek gereksiz yazma üretirdi.
    expect(yama?.subject_levels).toEqual([{ subject_id: 7, level_ids: [1, 2] }]);
  });

  it("yer adımı boş metinleri null yollar", () => {
    const { adim } = adimAra("yer");
    const yama = adim.yama?.({
      ...BOS_DURUM,
      teachingMode: TeachingMode.ONLINE,
      district: "",
      locationText: "   ",
    });
    expect(yama?.district).toBeNull();
    expect(yama?.location_text).toBeNull();
  });
});

describe("adimIndeksi", () => {
  it("anahtardan doğru sırayı verir", () => {
    expect(adimIndeksi("dersler")).toBe(0);
    expect(adimIndeksi("ozet")).toBe(SON_ADIM);
  });

  // Sessiz kaymanın kapısı: silinmiş bir adıma bağlanan kod 0. adıma düşerse
  // kullanıcı hata görmeden yanlış ekrana gider. Fırlatmak bunu görünür yapar.
  it("bilinmeyen anahtarda fırlatır", () => {
    expect(() => adimIndeksi("yokBoyleAdim")).toThrow(/Bilinmeyen adım/);
  });

  it("her adımın anahtarı benzersizdir", () => {
    const anahtarlar = ADIMLAR.map((a) => a.anahtar);
    expect(new Set(anahtarlar).size).toBe(anahtarlar.length);
  });
});
