/**
 * Arama URL sözleşmesi — yaz/oku simetrisi.
 *
 * ## Ölçtüğü kusur sınıfı
 *
 * Bu katman, ölçülmüş bir dağınıklığı kapatmak için yazıldı: query string altı
 * ayrı yerde elle kuruluyordu ve iki sözleşme doğmuştu — ana sayfa eğitmen
 * araması `?subject=` yazarken `useNavSearch` aynı hedefe `?q=` yazıyordu.
 * Aynı kökün ikinci yüzü, yazılan ders metninin hiçbir yere gitmemesiydi.
 *
 * Bu sınıfın tamamı SESSİZDİR: yanlış yazılan bir parametre hata vermez, boş
 * sonuç verir. O yüzden buradaki iddialar "çalışıyor mu" değil, **yazılan ile
 * okunan aynı şey mi** sorusunu sorar.
 *
 * ## Yakalanması gereken mutasyonlar
 *
 * 1. Varsayılan değeri URL'e yazmak (adres şişer; `/x` ile `/x?sort=` Google
 *    için iki ayrı adres).
 * 2. `mahalle` yazılırken ilçe yedeğinin düşmesi (`yerArama` sözleşmesi).
 * 3. Tekrarlı anahtarın virgüle çevrilmesi (Google'ın kaçınılmasını istediği
 *    ayırıcı; ayrıca ders/mahalle adlarındaki virgülü bozar).
 * 4. **Okunan anahtar kümesi ≠ yazılan anahtar kümesi** — bugünkü `q`/`subject`
 *    ayrışmasının tam kalıbı.
 * 5. Filtre değişince `sayfa`nın sıfırlanmaması.
 * 6. `sekil !== IN_PERSON` iken konumun sızması (`duzelt` kaldırılırsa).
 * 7. Bilinmeyen anahtarın (`utm_*`, `sayfa`) yazma sırasında silinmesi — iki
 *    ayrı sayfada birden yaşayan `?sayfa=` bug'ının kökü.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Saf fonksiyon testi: gerçek veri, gerçek `URLSearchParams`. Sayfaların bu
 * katmanı GERÇEKTEN kullandığını görmez — onu `__guards__/aramaUrlTekKapi`
 * ölçer.
 */
import { describe, expect, it } from "vitest";

import {
  EGITMEN_ARAMA,
  KUTUPHANE_ARAMA,
  MAGAZA_ARAMA,
  dersSorgusu,
  egitmenAramaAdresi,
  filtreliMi,
  kutuphaneAramaAdresi,
} from "@/lib/aramaUrl";
import { aramayiOku, aramayiYaz, bosDeger, type Sema } from "@/lib/urlSemasi";
import { ROUTES } from "@/lib/routes";
import { TeachingMode, Gender } from "@/types";

const sorgu = (adres: string) =>
  new URLSearchParams(adres.includes("?") ? adres.split("?")[1] : "");

/** Tüm şemalar aynı sözleşmeye tabidir; ortak iddialar tek yerden koşar. */
const SEMALAR: [string, Sema<Record<string, unknown>>][] = [
  ["egitmen", EGITMEN_ARAMA as unknown as Sema<Record<string, unknown>>],
  ["kutuphane", KUTUPHANE_ARAMA as unknown as Sema<Record<string, unknown>>],
  ["magaza", MAGAZA_ARAMA as unknown as Sema<Record<string, unknown>>],
];

describe("arama URL · şema sözleşmesi", () => {
  it.each(SEMALAR)("%s: varsayılan değer HİÇBİR parametre yazmaz", (_ad, sema) => {
    // Mutasyon 1. Varsayılan yazılırsa `/egitmenler` ile
    // `/egitmenler?sekil=` iki ayrı adres olur (Google: duplicate).
    const sp = aramayiYaz(sema, bosDeger(sema));
    expect([...sp.keys()]).toEqual([]);
  });

  it.each(SEMALAR)("%s: okunan anahtar kümesi = yazılan anahtar kümesi", (_ad, sema) => {
    /*
     * Mutasyon 4 — bu düğümün ASIL işi.
     *
     * Her alanın `anahtarlar`ı sahiplendiği adları bildirir. Bir alan
     * bildirdiğinden başka bir anahtar yazarsa (ya da bildirdiğini hiç
     * yazmazsa) yazma ve okuma sessizce ayrışır; bugünkü `q`/`subject`
     * ayrışması tam olarak buydu.
     */
    for (const ad of Object.keys(sema.alanlar)) {
      const alan = sema.alanlar[ad];
      const sp = new URLSearchParams();
      // Alanın varsayılan-dışı bir değerle ne yazdığını ölç.
      const ornek = ORNEK_DEGERLER[ad];
      if (ornek === undefined) continue;
      alan.yaz(sp, ornek);
      const yazilan = new Set([...sp.keys()]);
      const bildirilen = new Set(alan.anahtarlar as string[]);
      for (const k of yazilan) {
        expect(
          bildirilen.has(k),
          `${ad} alanı "${k}" yazıyor ama anahtarlar listesinde bildirmiyor`
        ).toBe(true);
      }
    }
  });

  it.each(SEMALAR)("%s: bilinmeyen anahtar KORUNUR", (_ad, sema) => {
    // Mutasyon 7 — `?sayfa=` bug'ının kökü. Efektler URL'i sıfırdan kurup
    // kendi okudukları parametreyi siliyordu.
    const mevcut = new URLSearchParams("utm_source=bulten&bilinmeyen=1");
    const sp = aramayiYaz(sema, bosDeger(sema), mevcut);
    expect(sp.get("utm_source")).toBe("bulten");
    expect(sp.get("bilinmeyen")).toBe("1");
  });

  it.each(SEMALAR)("%s: aramaAdresi bilinmeyeni MİRAS ALMAZ", (_ad, sema) => {
    // Gezinme sıfırdan kurulur: bir önceki aramanın `utm`si yeni adrese
    // yapışmamalı. `aramayiYaz(…, mevcut)` ile bilinçli ayrım.
    const adres = `${sema.taban}?${aramayiYaz(sema, bosDeger(sema)).toString()}`;
    expect(adres).not.toContain("utm_source");
  });
});

/** Alan adı → varsayılan olmayan örnek değer (kümesi tam olmak zorunda değil). */
const ORNEK_DEGERLER: Record<string, unknown> = {
  q: "matematik",
  subject: ["matematik", "fizik"],
  konum: { yer: null, ilce: ["Seyhan", "Çukurova"] },
  sekil: TeachingMode.IN_PERSON,
  exam: "TYT",
  cinsiyet: Gender.FEMALE,
  sayfa: 3,
  kategori: 12,
  tur: "PHYSICAL",
  sirala: "fiyat",
};

describe("arama URL · eğitmen", () => {
  it("round-trip: yazılan her alan aynen okunuyor", () => {
    const deger = {
      q: "",
      subject: ["matematik", "fizik"],
      konum: { yer: null, ilce: ["Seyhan"] },
      sekil: TeachingMode.IN_PERSON,
      exam: "TYT",
      cinsiyet: Gender.FEMALE,
      sayfa: 3,
    };
    const geri = aramayiOku(EGITMEN_ARAMA, sorgu(egitmenAramaAdresi(deger)));
    expect(geri).toEqual(deger);
  });

  it("DEĞİŞMEZLİK: okunanı yeniden yazmak aynı adresi üretir", () => {
    // Kanonik sıra olmasaydı aynı filtre kümesi iki farklı dize üretirdi
    // (Google: "logical order of the filters always stays the same").
    const bir = egitmenAramaAdresi({
      subject: ["matematik"],
      sekil: TeachingMode.IN_PERSON,
      konum: { yer: null, ilce: ["Seyhan"] },
      sayfa: 2,
    });
    const iki = egitmenAramaAdresi(aramayiOku(EGITMEN_ARAMA, sorgu(bir)));
    expect(iki).toBe(bir);
  });

  it("çoklu değer TEKRARLI ANAHTAR ile yazılır, virgülle değil", () => {
    // Mutasyon 3. Virgül, "Fen Bilimleri, Ortaokul" gibi ders adlarını bozar
    // ve Google'ın kaçınılmasını istediği ayırıcıdır.
    const adres = egitmenAramaAdresi({ subject: ["matematik", "fizik"] });
    expect(sorgu(adres).getAll("subject")).toEqual(["matematik", "fizik"]);
    expect(adres).not.toContain("matematik,fizik");
  });

  it("KONUM uzaktan aramada düşer (şema kuralı, çağrı yerinde değil)", () => {
    // Mutasyon 6. Bu kural eskiden Landing'de vardı, useNavSearch'te yoktu.
    const uzaktan = egitmenAramaAdresi({
      sekil: TeachingMode.ONLINE,
      konum: { yer: null, ilce: ["Seyhan"] },
    });
    expect(uzaktan).not.toContain("Seyhan");

    const yuzYuze = egitmenAramaAdresi({
      sekil: TeachingMode.IN_PERSON,
      konum: { yer: null, ilce: ["Seyhan"] },
    });
    expect(sorgu(yuzYuze).getAll("district")).toEqual(["Seyhan"]);
  });

  it("şekil BELİRTİLMEMİŞken konum korunur", () => {
    // Üst bar araması şekil sormuyor; katı kural burada kullanıcının
    // seçmediği bir filtreyi zorlardı.
    const adres = egitmenAramaAdresi({ konum: { yer: null, ilce: ["Seyhan"] } });
    expect(sorgu(adres).getAll("district")).toEqual(["Seyhan"]);
    expect(adres).not.toContain("mode=");
  });

  it("KENDİNİ İYİLEŞTİRME: tanınmayan değer varsayılana düşer ve silinir", () => {
    const sp = new URLSearchParams("mode=zirva&gender=xyz&sayfa=-3");
    const okunan = aramayiOku(EGITMEN_ARAMA, sp);
    expect(okunan.sekil).toBe("");
    expect(okunan.cinsiyet).toBe("");
    expect(okunan.sayfa).toBe(1);

    const yeniden = egitmenAramaAdresi(okunan);
    expect(yeniden).not.toContain("mode=");
    expect(yeniden).not.toContain("gender=");
    expect(yeniden).not.toContain("sayfa=");
  });

  it("`sayfa=1` adrese YAZILMAZ", () => {
    expect(egitmenAramaAdresi({ q: "x", sayfa: 1 })).not.toContain("sayfa");
    expect(egitmenAramaAdresi({ q: "x", sayfa: 2 })).toContain("sayfa=2");
  });

  it("filtresiz adres taban yolun kendisidir", () => {
    expect(egitmenAramaAdresi({})).toBe(ROUTES.tutors);
  });
});

describe("arama URL · konum sözleşmesi", () => {
  it("mahalle yazılırken İLÇE de yazılır (yedek)", () => {
    // Mutasyon 2. Veri seti tazelenip mahalle adı değişirse arama tamamen
    // boşa düşmesin diye ilçe yedek olarak yazılır (yerArama sözleşmesi).
    const adres = kutuphaneAramaAdresi({
      konum: {
        yer: { tur: "mahalle", ilce: "Seyhan", mahalle: "Reşatbey", lat: 37, lng: 35 },
        ilce: [],
      },
    });
    const sp = sorgu(adres);
    expect(sp.get("mahalle")).toBe("Reşatbey");
    expect(sp.get("district")).toBe("Seyhan");
  });

  it("URL'de ham KOORDİNAT taşınmaz", () => {
    const adres = kutuphaneAramaAdresi({
      konum: {
        yer: { tur: "mahalle", ilce: "Seyhan", mahalle: "Reşatbey", lat: 37.05, lng: 35.32 },
        ilce: [],
      },
    });
    expect(adres).not.toContain("37.05");
    expect(adres).not.toContain("lat");
  });
});

describe("arama URL · filtreliMi", () => {
  it("sayfa FİLTRE SAYILMAZ", () => {
    // Kütüphane sayfasındaki keşif şeritleri buna bakıyor: 2. sayfaya geçmek
    // şeritleri kaybettirmemeli.
    expect(filtreliMi(KUTUPHANE_ARAMA, { ...bosDeger(KUTUPHANE_ARAMA), sayfa: 3 })).toBe(false);
  });

  it("gerçek filtre uygulanınca true", () => {
    expect(filtreliMi(KUTUPHANE_ARAMA, { ...bosDeger(KUTUPHANE_ARAMA), q: "merkez" })).toBe(true);
    expect(
      filtreliMi(KUTUPHANE_ARAMA, {
        ...bosDeger(KUTUPHANE_ARAMA),
        konum: { yer: null, ilce: ["Seyhan"] },
      })
    ).toBe(true);
  });

  it("boş değerde false", () => {
    expect(filtreliMi(KUTUPHANE_ARAMA, bosDeger(KUTUPHANE_ARAMA))).toBe(false);
  });
});

describe("arama URL · kaybolan metin", () => {
  /*
   * Ölçülen kusur: kullanıcı ders kutusuna "matematik" yazıp listeden SEÇMEDEN
   * Ara'ya bastığında adres parametresiz `/egitmenler` oluyordu ve tüm
   * eğitmenler listeleniyordu. Yazdığı şey hiçbir yere gitmiyordu — hata yok,
   * sessiz kayıp. Kütüphane hapında aynı akış `?q=` ile zaten çalışıyordu.
   */
  it("SEÇİLMEDİYSE yazılan metin `q` olur", () => {
    expect(dersSorgusu("", "matematik")).toEqual({ subject: [], q: "matematik" });
    expect(egitmenAramaAdresi(dersSorgusu("", "matematik"))).toContain("q=matematik");
  });

  it("SEÇİLDİYSE `subject` olur, metin yazılmaz", () => {
    expect(dersSorgusu("matematik", "mate")).toEqual({ subject: ["matematik"], q: "" });
    const adres = egitmenAramaAdresi(dersSorgusu("matematik", "mate"));
    expect(adres).toContain("subject=matematik");
    expect(adres).not.toContain("q=");
  });

  it("yalnız boşluk yazılmışsa filtre üretmez", () => {
    expect(egitmenAramaAdresi(dersSorgusu("", "   "))).toBe(ROUTES.tutors);
  });
});

describe("arama URL · mağaza", () => {
  it("round-trip", () => {
    const deger = { q: "roman", kategori: 12, tur: "PHYSICAL" as const, sirala: "fiyat", sayfa: 2 };
    expect(aramayiOku(MAGAZA_ARAMA, sorgu(
      `${MAGAZA_ARAMA.taban}?${aramayiYaz(MAGAZA_ARAMA, deger).toString()}`
    ))).toEqual(deger);
  });

  it("geçersiz kategori/tür düşer", () => {
    const okunan = aramayiOku(MAGAZA_ARAMA, new URLSearchParams("category=abc&kind=ZIRVA"));
    expect(okunan.kategori).toBeUndefined();
    expect(okunan.tur).toBe("");
  });
});
