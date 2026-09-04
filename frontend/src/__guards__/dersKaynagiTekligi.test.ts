import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ── Ders kaynağı tekliği nöbetçisi ────────────────────────────────────────
 *
 * ÖLÇÜLEN ARIZA (bu nöbetçinin varlık sebebi): ders listesi frontend'te İKİ
 * AYRI TypeScript sabitinde yaşıyordu — `lib/examTree.ts` (24 kanonik değer)
 * YAZMA tarafını, `lib/dersTaksonomisi.ts` (109 kalem) ARAMA tarafını
 * besliyordu. İkisinin hizalı kalmasını sınayan hiçbir test yoktu ve sessizce
 * ayrıştılar:
 *
 *   - `dersTaksonomisi`'nin 85+ kalemi hiçbir eğitmenin SEÇEMEYECEĞİ değerdi
 *     → aratılınca GARANTİLİ SIFIR SONUÇ (Piyano, Python, IELTS, Yüzme…),
 *   - ters yönde 5 kalem seçilebiliyor ama aranamıyordu (`Fen Bilgisi`,
 *     `Sayısal`, `Sözel`, `Eğitim`, `Vatandaşlık`).
 *
 * Hiçbiri hata vermiyordu; yalnız "sonuç bulunamadı" diyordu — fark edilmesi
 * en zor arıza türü. Artık tek kaynak veritabanı ve `GET /subjects`.
 *
 * Bu nöbetçi o iki dosyanın geri dönmesini ve yerlerine yeni bir koda gömülü
 * ders listesi doğmasını engeller.
 */

function srcKoku(): string {
  let dizin = process.cwd();
  for (let i = 0; i < 4; i++) {
    for (const aday of ["src", "frontend/src"]) {
      const yol = join(dizin, aday);
      if (existsSync(join(yol, "main.tsx"))) return yol;
    }
    dizin = join(dizin, "..");
  }
  throw new Error("src koku bulunamadi — nobetci olcemedi");
}

const KOK = srcKoku();

/** Emekliye ayrılan dosyalar — geri gelmemeli. */
const EMEKLI = [
  "lib/examTree.ts",
  "lib/dersTaksonomisi.ts",
  "components/SubjectMegaMenu.tsx",
];

/**
 * Ders adı taşıyan koda gömülü listeye izin verilen tek yer: bu nöbetçinin
 * kendisi (desenleri tanım olarak taşır) ve `trendingSearches` (küratörlü
 * ÖNERİ listesi — ders kataloğu değil, arama kutusunun başlangıç önerileri).
 */
const ISTISNALAR = new Set([
  "src/__guards__/dersKaynagiTekligi.test.ts",
  // Küratörlü ÖNERİ listesi (arama kutusunun başlangıç önerileri) — ders
  // kataloğu değil. Girdileri katalogda karşılığı olan terimlerdir.
  "src/lib/trendingSearches.ts",
  // Deneme sınavı ŞABLONLARI: ders başına soru sayısı/süre. Farklı alan —
  // öğrencinin deneme sonucu girmesi için, ders seçimi/araması için değil.
  "src/lib/examTemplates.ts",
]);

/** "Bu bir ders listesi" işareti: birlikte geçen kanonik ders adları. */
const DERS_ADLARI = [
  "Matematik",
  "Geometri",
  "Fizik",
  "Kimya",
  "Biyoloji",
  "Coğrafya",
  "Felsefe",
  "Piyano",
  "Keman",
];

function* dosyalar(dizin: string): Generator<string> {
  for (const giris of readdirSync(dizin, { withFileTypes: true })) {
    const yol = join(dizin, giris.name);
    if (giris.isDirectory()) {
      yield* dosyalar(yol);
    } else if (/\.tsx?$/.test(giris.name)) {
      yield yol;
    }
  }
}

describe("ders kaynağı tekliği", () => {
  it("emekliye ayrılan iki liste ve ölü mega-menü geri DÖNMEDİ", () => {
    const geriDonenler = EMEKLI.filter((y) => existsSync(join(KOK, y)));
    expect(geriDonenler).toEqual([]);
  });

  it("kodda yeni bir gömülü ders listesi doğmadı", () => {
    const ihlal: string[] = [];
    for (const yol of dosyalar(KOK)) {
      const gorece = relative(join(KOK, ".."), yol).replaceAll("\\", "/");
      if (ISTISNALAR.has(gorece)) continue;
      // Test dosyaları ders adlarını FIXTURE olarak kullanır (ürün verisi,
      // ayrıştırıcı girdisi); kural üretim koduna bakar.
      if (/\.test\.tsx?$/.test(gorece)) continue;
      const metin = readFileSync(yol, "utf8");
      // Üç ve daha fazla kanonik ders adının AYNI dosyada birlikte geçmesi,
      // koda gömülü bir katalog anlamına gelir.
      const kacTane = DERS_ADLARI.filter((ad) => metin.includes(`"${ad}"`)).length;
      if (kacTane >= 3) ihlal.push(`${gorece} (${kacTane} ders adı)`);
    }
    expect(ihlal).toEqual([]);
  });

  it("ders listesini tüketen ekranlar katalog kancasını kullanıyor", () => {
    // Bu üç yüzey listeyi gösteren yerlerdir; biri sabite dönerse ayrışma
    // yeniden başlar.
    for (const yol of [
      "pages/TutorSettings.tsx",
      "pages/Demands.tsx",
      "components/HeroSearch.tsx",
    ]) {
      const metin = readFileSync(join(KOK, yol), "utf8");
      expect(metin, yol).toContain("useSubjects");
    }
  });
});
