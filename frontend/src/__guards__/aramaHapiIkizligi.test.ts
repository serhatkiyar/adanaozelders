/**
 * Ana sayfadaki iki arama hapı İKİZDİR — nöbetçi.
 *
 * ## Karar (kullanıcı, 7 Eyl 2026)
 *
 * Ana sayfada sekme değiştirince arama çubuğunun TASARIMI da değişiyordu:
 * eğitmende yazılabilir iki eşit bölme (`DersArama`), kütüphanede pin + açılır
 * ilçe menüsü + serbest metin (`BigSearch`). Aynı çubuğun iki farklı hâli
 * olmasının bir gerekçesi yoktu. Kütüphane hapı `KutuphaneArama` olarak
 * eğitmen hapının ikizi yazıldı.
 *
 * İZİN VERİLEN TEK FARK sağ bölmenin içeriği: eğitmende "Online / Yüz yüze /
 * İkisi de olur" satırları var (`MekanSelect`), kütüphanede yok (`IlceSelect`)
 * çünkü kütüphane fiziksel bir mekândır.
 *
 * ## Bu nöbetçinin ASIL iddiası
 *
 * Sessizce yanlış gidebilecek şey şu: biri hapın kabuğunu (yuvarlaklık, gölge,
 * odak halkası, bölme genişliği, Ara düğmesi) YALNIZ bir tarafta değiştirir.
 * İki dosya da derlenir, hiçbir test kırılmaz ve iki sekme yeniden ayrışır —
 * bunu ancak sekmeler arasında gidip gelen bir insan fark eder. Bu düğüm o
 * ayrışmayı kaynak düzeyinde yakalar.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * KAYNAK SÖZLEŞMESİ testidir: "ekranda aynı görünüyor" demez, "aynı sınıfları
 * taşıyorlar" der. Piksel eşitliğinin kanıtı değildir; ikisinin ayrı ayrı
 * evrilmesinin önündeki engeldir.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);

const oku = (...parcalar: string[]) => readFileSync(join(KOK, ...parcalar), "utf8");

const HERO = oku("src", "components", "HeroSearch.tsx");
const MEKAN = oku("src", "components", "MekanSelect.tsx");
const LANDING = oku("src", "pages", "Landing.tsx");

/** `export function <ad>(` ile başlayan bloğu bir sonraki `export function`a kadar alır. */
function govde(kaynak: string, ad: string): string {
  const bas = kaynak.indexOf(`export function ${ad}(`);
  if (bas < 0) return "";
  const sonraki = kaynak.indexOf("\nexport function ", bas + 1);
  return kaynak.slice(bas, sonraki < 0 ? kaynak.length : sonraki);
}

/** Bloktaki ilk `<form ... className="…">` sınıf dizesi. */
function formSinifi(blok: string): string {
  const i = blok.indexOf("<form");
  const j = blok.indexOf('className="', i);
  return j < 0 ? "" : blok.slice(j + 11, blok.indexOf('"', j + 11));
}

const DERS = govde(HERO, "DersArama");
const KUTUPHANE = govde(HERO, "KutuphaneArama");

describe("ana sayfa arama hapları ikizdir", () => {
  it("DOLULUK: iki bileşen de gerçekten bulundu", () => {
    // Boş bir blok, aşağıdaki "aynı sınıf" iddialarını bedava geçirirdi:
    // "" === "" doğrudur.
    expect(DERS.length, "DersArama bulunamadı").toBeGreaterThan(500);
    expect(KUTUPHANE.length, "KutuphaneArama bulunamadı").toBeGreaterThan(500);
  });

  it("hapın kabuğu (form) BİREBİR aynı sınıfları taşır", () => {
    const a = formSinifi(DERS);
    const b = formSinifi(KUTUPHANE);
    expect(a.length, "DersArama'nın form sınıfı okunamadı").toBeGreaterThan(100);
    expect(b).toBe(a);
  });

  it("iki bölme de EŞİT genişlikte (flex-1 basis-0), her hapta iki tane", () => {
    // Yorum satırları sayılmaz: `DersArama`nın açıklaması da bu ifadeyi
    // içeriyor ve sayıyı şişiriyordu.
    const say = (s: string) =>
      s
        .split(/\r?\n/)
        .filter((satir) => !satir.trim().startsWith("//"))
        .filter((satir) => satir.includes("flex-1 basis-0")).length;
    expect(say(DERS)).toBe(2);
    expect(say(KUTUPHANE)).toBe(2);
  });

  it("Ara düğmesi aynı", () => {
    const dugme = (s: string) => {
      const i = s.indexOf('type="submit"');
      const j = s.indexOf('className="', i);
      return s.slice(j + 11, s.indexOf('"', j + 11));
    };
    expect(dugme(DERS)).toContain("from-marka to-marka-hover");
    expect(dugme(KUTUPHANE)).toBe(dugme(DERS));
  });

  it("İZİN VERİLEN TEK FARK: sağ bölmenin seçicisi", () => {
    // Farkın kendisi de çıpalı. Yoksa bir sonraki tur "ikizler tamamen aynı
    // olsun" diye anlar ve kütüphaneye "Online ders" seçeneği koyar.
    expect(DERS).toContain("<MekanSelect");
    expect(DERS).not.toContain("<IlceSelect");
    expect(KUTUPHANE).toContain("<IlceSelect");
    expect(KUTUPHANE).not.toContain("<MekanSelect");
  });

  it("kütüphane seçicisi ders mekânı satırları SUNMAZ", () => {
    const ilce = govde(MEKAN, "IlceSelect");
    expect(ilce.length, "IlceSelect bulunamadı").toBeGreaterThan(500);
    for (const satir of ["Online", "Yüz yüze", "İkisi de olur"]) {
      expect(ilce, `IlceSelect '${satir}' sunuyor — kütüphane fiziksel mekân`).not.toContain(
        `"${satir}"`
      );
    }
    // DOLULUK: seçici gerçekten ilçe sunuyor (boş bir panel de yukarıdakini
    // geçerdi).
    expect(ilce).toContain("SEARCH_PRIMARY_DISTRICTS");
    expect(ilce).toContain("Tüm ilçeler");
  });

  it("iki seçici de AYNI satır bileşenini kullanır", () => {
    // `Satir` tek yerden gelmezse biri değişip diğeri kalır.
    expect(govde(MEKAN, "MekanSelect")).toContain("<Satir");
    expect(govde(MEKAN, "IlceSelect")).toContain("<Satir");
    expect(MEKAN.split("function Satir(").length - 1).toBe(1);
  });

  it("ana sayfa artık iki farklı hap tipi basmıyor", () => {
    expect(LANDING).toContain("<KutuphaneArama");
    expect(LANDING).toContain("<DersArama");
    expect(LANDING, "ana sayfa hâlâ BigSearch basıyor — ikizlik bozuldu").not.toContain(
      "<BigSearch"
    );
  });
});
