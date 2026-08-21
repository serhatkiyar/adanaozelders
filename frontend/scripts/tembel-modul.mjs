/**
 * İP-A7d5 · **Tembel modül yükleyen test** dedektörü.
 *
 * ## Ölçülen kusur sınıfı
 *
 * Bir test dosyası ağır bir modülü **çalışma zamanında** yüklerse (`import()`
 * ya da `import.meta.glob` yükleyicisi), transform + değerlendirme maliyeti
 * TOPLAMA (collect) evresinde değil, **testin kendi bütçesinin içinde** ödenir.
 * Bu maliyet ölçülen davranışla ilgisizdir ve paralel yük altında:
 *
 *   - testi `testTimeout`a düşürür (A7d2: `PackagesPage` 10.093 ms,
 *     `OperatorSessions` 11.235 ms),
 *   - ya da yükleme bir sorgunun (`findBy*`) beklemesiyle çakışırsa RTL'in
 *     `asyncUtilTimeout` bütçesini yer (A7d3'te üç zaman aşımının sebebi).
 *
 * İlaç bütçe büyütmek DEĞİLDİR: modül test dosyasında **statik** import
 * edilince maliyet collect evresine geçer — orada test bütçesi yoktur.
 *
 * ## Sözleşme
 *
 * Bir test dosyasında çalışma zamanında yüklenen her modül, AYNI dosyada
 * statik olarak da import edilmiş olmalıdır (yan etki importu yeter) — ya da
 * `tembelModul.test.ts`teki gerekçeli listede adıyla yazılı olmalıdır.
 *
 * Tarama **AST** iledir (yorum/dize yanlış pozitif üretmez).
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const KOK = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

/** `src/` altındaki bütün test dosyaları. */
export function testDosyalari(kok = path.join(KOK, "src")) {
  const cikti = [];
  const yuru = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) yuru(p);
      else if (/\.test\.tsx?$/.test(e.name)) cikti.push(p);
    }
  };
  yuru(kok);
  return cikti.sort();
}

/** Uzantı/`./` gürültüsünü atarak karşılaştırılabilir bir anahtar üretir. */
function anahtar(belirtec) {
  return belirtec.replace(/^\.\//, "").replace(/\.(tsx?|jsx?)$/, "");
}

/**
 * Tek dosyanın taraması.
 * @returns {{statik: string[], tembel: {belirtec: string, satir: number, tur: "import()"|"glob"}[]}}
 */
export function tembelYuklemeler(kaynak, dosyaAdi = "a.tsx") {
  const sf = ts.createSourceFile(
    dosyaAdi,
    kaynak,
    ts.ScriptTarget.Latest,
    true,
    dosyaAdi.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const statik = [];
  const tembel = [];

  const satir = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  const gez = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      statik.push(n.moduleSpecifier.text);
    }
    // `import("...")`
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments.length === 1 &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      tembel.push({ belirtec: n.arguments[0].text, satir: satir(n), tur: "import()" });
    }
    // `import.meta.glob("..." | [...])`
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "glob" &&
      ts.isMetaProperty(n.expression.expression)
    ) {
      const arg = n.arguments[0];
      const desenler = [];
      if (arg && ts.isStringLiteralLike(arg)) desenler.push(arg.text);
      if (arg && ts.isArrayLiteralExpression(arg))
        for (const e of arg.elements) if (ts.isStringLiteralLike(e)) desenler.push(e.text);
      for (const d of desenler) tembel.push({ belirtec: d, satir: satir(n), tur: "glob" });
    }
    n.forEachChild(gez);
  };
  gez(sf);
  return { statik, tembel };
}

/** Statik karşılığı OLMAYAN çalışma zamanı yüklemeleri. */
export function korumasizTembeller(kaynak, dosyaAdi = "a.tsx") {
  const { statik, tembel } = tembelYuklemeler(kaynak, dosyaAdi);
  const statikAnahtarlar = new Set(statik.map(anahtar));
  return tembel.filter((t) => !statikAnahtarlar.has(anahtar(t.belirtec)));
}

/** Bütün test ağacının taraması: `["göreli/yol:satır belirteç"]`. */
export function tabanTaramasi() {
  const bulgular = [];
  for (const dosya of testDosyalari()) {
    const kaynak = fs.readFileSync(dosya, "utf8");
    // Ön eleme yalnız hız içindir.
    if (!/import\s*\(|import\.meta\.glob/.test(kaynak)) continue;
    const goreli = path.relative(KOK, dosya).split(path.sep).join("/");
    for (const t of korumasizTembeller(kaynak, dosya)) {
      bulgular.push(`${goreli}:${t.satir} ${t.belirtec}`);
    }
  }
  return bulgular.sort();
}
