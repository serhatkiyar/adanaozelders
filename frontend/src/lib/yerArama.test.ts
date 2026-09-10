/**
 * Konum arama mantığı — saf fonksiyon testleri.
 *
 * Asıl çıpaladığı şey Türkçe katlama: eski seçicinin süzgeci düz
 * `toLowerCase().includes()` idi ve "Cukurova" yazan kullanıcı "Çukurova"yı
 * bulamıyordu. Hata vermiyordu, sadece boş liste dönüyordu — fark edilmesi en
 * zor arıza türü.
 */
import { describe, expect, it } from "vitest";

import { ADANA_YERLER } from "@/lib/adanaYerler";
import { mahalleyiCoz, yerAra, yerEtiketi } from "@/lib/yerArama";

describe("yerAra · veri seti", () => {
  it("DOLULUK: veri seti gerçekten dolu ve 15 ilçeyi kapsıyor", () => {
    // Bu olmadan aşağıdaki tüm "bulur" iddiaları boş kümede bedava geçerdi.
    expect(ADANA_YERLER.length).toBeGreaterThan(300);
    expect(new Set(ADANA_YERLER.map((y) => y.ilce)).size).toBe(15);
    // Her kaydın kullanılabilir bir koordinatı olmalı — koordinat yarıçap
    // aramasının çapası, eksikse mahalle seçimi sessizce işlevsiz kalır.
    for (const y of ADANA_YERLER) {
      expect(Number.isFinite(y.lat), `${y.mahalle}: lat yok`).toBe(true);
      expect(Number.isFinite(y.lng), `${y.mahalle}: lng yok`).toBe(true);
      // Adana il sınırlarını saran kutu — veri setine başka bir ilin kaydı
      // karışmışsa burada yakalanır. Sınırlar ölçülerek belirlendi: kuzeyde
      // Tufanbeyli (38.37), güneyde Karataş'ın Akdeniz kıyısı (36.56), batıda
      // Pozantı (34.83), doğuda yine Tufanbeyli (36.38). Kutu bunların biraz
      // dışına açılır; daha dar tutmak gerçek Adana mahallelerini eler.
      expect(y.lat).toBeGreaterThan(36.4);
      expect(y.lat).toBeLessThan(38.5);
      expect(y.lng).toBeGreaterThan(34.7);
      expect(y.lng).toBeLessThan(36.6);
    }
  });
});

describe("yerAra · eşleşme", () => {
  it("boş sorguda YALNIZ ilçeler döner", () => {
    const sonuc = yerAra("");
    expect(sonuc.length).toBe(15);
    expect(sonuc.every((o) => o.secim.tur === "ilce")).toBe(true);
  });

  /* MAHALLE ÖNERİSİ KAPALI (kullanıcı kararı, 10 Eyl 2026 — gerekçe
     `yerArama.ts`teki bayrağın başında). Kapanan tek şey ÖNERİ SUNMAK:
     mahalle verisi, koordinatı ve `?mahalle=` okuması yerinde duruyor ve
     aşağıdaki `mahalleyiCoz` düğümleri onu sınamaya devam ediyor.

     Bayrak yeniden `true` yapıldığı gün bu düğüm kırmızıya döner; yani karar
     sessizce değil, bilerek geri alınır. */
  it("mahalle ÖNERİLMEZ: liste yalnız ilçelerden oluşur", () => {
    // Hiçbir ilçe "Reşatbey"e benzemiyor; mahalle açık olsaydı dolu dönerdi.
    expect(yerAra("Reşatbey")).toEqual([]);
    expect(yerAra("res").every((o) => o.secim.tur === "ilce")).toBe(true);
  });

  it("AKSANSIZ yazım da bulur — asıl mesele bu", () => {
    // Eski süzgeç bu sorguda BOŞ dönüyordu.
    const aksanli = yerAra("Çukurova").map((o) => o.baslik);
    const aksansiz = yerAra("Cukurova").map((o) => o.baslik);
    expect(aksansiz).toContain("Çukurova");
    expect(aksansiz).toEqual(aksanli);
  });

  it("noktasız 'i' ve büyük harf de bulur", () => {
    expect(yerAra("YÜREĞİR").map((o) => o.baslik)).toContain("Yüreğir");
    expect(yerAra("yuregir").map((o) => o.baslik)).toContain("Yüreğir");
  });

  it("ilçeler mahallelerden ÖNCE gelir", () => {
    // "Ceyhan" hem ilçe hem de başka ilçelerde mahalle adı olabilir.
    const sonuc = yerAra("Ceyhan");
    expect(sonuc[0].secim.tur).toBe("ilce");
  });

  it("önek eşleşmesi öne alınır", () => {
    // Sorgu ilçeler üzerinden kuruldu: mahalleler kapalıyken eski hâli
    // (mahalleleri süzüp `length > 1` kontrolüne bırakma) BOŞ kümede bedava
    // geçen ölü bir iddiaya dönmüştü.
    const sonuc = yerAra("s");
    const adlar = sonuc.map((o) => o.baslik);
    // DOLULUK: hem önekle başlayan hem yalnız içinde geçen ilçeler var.
    expect(adlar).toContain("Seyhan");
    expect(adlar).toContain("Karataş");
    expect(sonuc[0].baslik.toLocaleLowerCase("tr-TR").startsWith("s")).toBe(true);
  });

  it("eşleşmeyen sorgu boş döner", () => {
    expect(yerAra("zzzyokboyleyer")).toEqual([]);
  });

  it("ilçe önerisi ilini alt başlıkta taşır", () => {
    // Alt başlık VERİDE durur; telefon yüzeyi onu bilerek çizmiyor (hepsinde
    // aynı "Adana" yazıyordu), masaüstü seçicisi çiziyor.
    const r = yerAra("Seyhan").find((o) => o.baslik === "Seyhan")!;
    expect(r.altBaslik).toBe("Adana");
  });
});

describe("mahalleyiCoz · URL'den geri okuma", () => {
  it("mahalle adından koordinat çözer", () => {
    const s = mahalleyiCoz("Reşatbey");
    expect(s?.tur).toBe("mahalle");
    if (s?.tur === "mahalle") expect(s.ilce).toBe("Seyhan");
  });

  it("aksansız gelen URL değerini de çözer", () => {
    expect(mahalleyiCoz("Resatbey")?.tur).toBe("mahalle");
  });

  it("aynı ada sahip mahalleler arasında İLÇEYE göre ayırır", () => {
    // Adana'da birden fazla ilçede aynı mahalle adı var; ilçe verilmezse
    // ilk eşleşme döner, verilirse doğru olan seçilir.
    const tekrarli = new Map<string, string[]>();
    for (const y of ADANA_YERLER) {
      const k = y.mahalle.toLocaleLowerCase("tr-TR");
      tekrarli.set(k, [...(tekrarli.get(k) ?? []), y.ilce]);
    }
    const ornek = [...tekrarli.entries()].find(([, ilceler]) => ilceler.length > 1);
    expect(ornek, "veri setinde tekrarlı mahalle adı yok — test konusuz").toBeTruthy();
    const [ad, ilceler] = ornek!;
    for (const ilce of ilceler) {
      expect(mahalleyiCoz(ad, ilce)).toMatchObject({ ilce });
    }
  });

  it("bilinmeyen mahalle null döner", () => {
    expect(mahalleyiCoz("Yokboyle")).toBeNull();
    expect(mahalleyiCoz(null)).toBeNull();
  });
});

describe("yerEtiketi", () => {
  it("mahallede ilçeyi de yazar, ilçede yalnız ilçeyi", () => {
    expect(yerEtiketi({ tur: "ilce", ilce: "Seyhan" })).toBe("Seyhan");
    expect(
      yerEtiketi({
        tur: "mahalle",
        ilce: "Seyhan",
        mahalle: "Reşatbey",
        lat: 1,
        lng: 2,
      }),
    ).toBe("Reşatbey, Seyhan");
    expect(yerEtiketi(null)).toBe("");
  });
});
