/**
 * ── Tek tema nöbetçisi (CMS turu · dark mode sökümü) ──
 *
 * Ürün kararı: site TEK temadır (açık). 2026-08-28'de 249 dosyadan 5.557
 * `dark:` sınıfı söküldü, `themeStore` silindi, `.dark` CSS kuralları kalktı.
 * Bu nöbetçi sökümün KALICILIĞINI korur: yeni bir `dark:` sınıfı ya da
 * `.dark` seçicisi doğduğu gün CI kırılır — "bir ekranda unutulan koyu ikiz"
 * sınıfı (İP-A3c'nin ölçtüğü 891'lik borç) bir daha birikemez.
 *
 * Tarama satır bazlıdır ve YORUM satırlarını atlar: tarihçe notlarında
 * `dark:` sözcüğü geçebilir; nöbetçi dokümantasyonu yasaklamaz, kodu yasaklar.
 * Bilinçli istisnalar kimlikle aşağıda.
 */
import { readdirSync, readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

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

/** İstisnalar: `dark:` dizesi kodda ama sınıf olarak DEĞİL, yasak iddiası olarak geçer. */
const ISTISNALAR = new Set([
  // Bu dosyanın kendisi (desenleri tanım olarak taşır).
  "src/__guards__/tekTema.test.ts",
]);

const YORUM = /^\s*(\/\/|\*|\/\*)/;
const SINIF = /(?<![\w-])dark:/;

function ihlaller(): string[] {
  const kok = srcKoku();
  const bulunan: string[] = [];
  const gez = (dizin: string) => {
    for (const giris of readdirSync(dizin, { withFileTypes: true })) {
      const yol = join(dizin, giris.name);
      if (giris.isDirectory()) {
        gez(yol);
        continue;
      }
      if (!/\.(tsx?|css)$/.test(giris.name)) continue;
      const gorece = relative(join(kok, ".."), yol).replaceAll("\\", "/");
      if (ISTISNALAR.has(gorece)) continue;
      const metin = readFileSync(yol, "utf8");
      if (!metin.includes("dark")) continue;
      const cssDosyasi = giris.name.endsWith(".css");
      // CSS'te yorumlar blok hâlinde ayıklanır; TS/TSX'te satır bazlı atlanır.
      const govde = cssDosyasi ? metin.replace(/\/\*[\s\S]*?\*\//g, "") : metin;
      govde.split("\n").forEach((satir, i) => {
        if (!cssDosyasi && YORUM.test(satir)) return;
        if (SINIF.test(satir) || (cssDosyasi && /\.dark[\s.{[]/.test(satir))) {
          bulunan.push(`${gorece}:${i + 1}`);
        }
      });
    }
  };
  gez(kok);
  return bulunan;
}

describe("tek tema nöbetçisi", () => {
  it("`dark:` sınıfı ve `.dark` CSS kuralı kod tabanına geri DÖNEMEZ", () => {
    expect(ihlaller()).toEqual([]);
  });

  it("dedektör gerçek bir sınıfı yakalar (ters prova)", () => {
    expect(SINIF.test('className="bg-white dark:bg-slate-900"')).toBe(true);
    expect(SINIF.test('className={`a ${x} dark:hover:text-white`}')).toBe(true);
  });

  it("dedektör yorumu ve tire-bitişik sözcüğü kural sanmıyor", () => {
    expect(YORUM.test("  // eski dark: siniflari sokuldu")).toBe(true);
    expect(SINIF.test("data-dark:none")).toBe(false);
  });
});
