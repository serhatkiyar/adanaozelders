/**
 * İP-A7d5 · Görev 3 — **bekleme bütçesi envanteri** (AST).
 *
 * Üç şeyi ayrı ayrı sayar:
 *
 *   1. `configure({ asyncUtilTimeout: … })` — RTL'in `configure`u modül
 *      düzeyinde GLOBALDİR ve `@testing-library/dom` bir node_modules
 *      bağımlılığı olduğu için vitest işçisinin ESM önbelleğinde dosyalar
 *      arasında PAYLAŞILIR: bir test dosyasındaki çağrı, aynı işçide sonra
 *      koşan her dosyanın bütçesini de değiştirir (ölçüldü: A7d5 · Görev 3).
 *      Sızıntının kapsamı karışık tohumda değişir — yani maskeleme
 *      KARARSIZDIR. Bu yüzden yasak.
 *   2. `vi.setConfig({ testTimeout | hookTimeout })` — `vitest.config.ts`'in
 *      yazılı kuralı: "dosya başına testTimeout ezmesi YAPILMAZ".
 *   3. Çağrı yerindeki `{ timeout: N }` — MEŞRU biçim (yalnız o çağrıyı
 *      etkiler) ama envanteri kimlikle sabitlenir: her yeni bütçe ölçümüyle
 *      birlikte rapora girmek zorundadır.
 *
 * Tarama AST iledir: yorumda geçen `configure({ asyncUtilTimeout: 5_000 })`
 * yanlış pozitif üretmez (bu dosyaların YORUMLARINDA tam olarak o metin var).
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const KOK = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  ".."
);

function testDosyalari(kok = path.join(KOK, "src")) {
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

/** Tek dosyanın taraması. */
export function butceOlcumu(kaynak, dosyaAdi = "a.tsx") {
  const sf = ts.createSourceFile(
    dosyaAdi,
    kaynak,
    ts.ScriptTarget.Latest,
    true,
    dosyaAdi.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const sizanConfigure = [];
  const testTimeoutEzmesi = [];
  const cagriButceleri = [];
  const dosyaButceleri = [];
  const satir = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  const alanlar = (nesne) =>
    ts.isObjectLiteralExpression(nesne)
      ? nesne.properties
          .filter((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name))
          .map((p) => [p.name.text, p.initializer])
      : [];

  const gez = (n) => {
    if (ts.isCallExpression(n) && n.arguments.length) {
      const ad = ts.isIdentifier(n.expression)
        ? n.expression.text
        : ts.isPropertyAccessExpression(n.expression)
          ? `${n.expression.expression.getText()}.${n.expression.name.text}`
          : "";
      if (ad === "configure" && alanlar(n.arguments[0]).some(([k]) => k === "asyncUtilTimeout"))
        sizanConfigure.push(satir(n));
      if (ad === "vi.setConfig") {
        const anahtarlar = alanlar(n.arguments[0]).map(([k]) => k);
        if (anahtarlar.some((k) => k === "testTimeout" || k === "hookTimeout"))
          testTimeoutEzmesi.push(satir(n));
      }
      if (ad === "dosyaBeklemeButcesi" && ts.isNumericLiteral(n.arguments[0]))
        dosyaButceleri.push({ satir: satir(n), deger: Number(n.arguments[0].text) });
    }
    // `{ timeout: N }` — nerede yazılmış olursa olsun.
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "timeout") {
      const d = n.initializer;
      if (ts.isNumericLiteral(d)) cagriButceleri.push({ satir: satir(n), deger: Number(d.text) });
    }
    n.forEachChild(gez);
  };
  gez(sf);
  return { sizanConfigure, testTimeoutEzmesi, cagriButceleri, dosyaButceleri };
}

/** Bütün test ağacı. */
export function tabanTaramasi() {
  const sizinti = [];
  const ezme = [];
  const butceler = [];
  const dosyaButceleri = [];
  for (const dosya of testDosyalari()) {
    const kaynak = fs.readFileSync(dosya, "utf8");
    if (!/configure\s*\(|setConfig\s*\(|timeout\s*:|dosyaBeklemeButcesi/.test(kaynak)) continue;
    const goreli = path.relative(KOK, dosya).split(path.sep).join("/");
    const o = butceOlcumu(kaynak, dosya);
    for (const s of o.sizanConfigure) sizinti.push(`${goreli}:${s}`);
    for (const s of o.testTimeoutEzmesi) ezme.push(`${goreli}:${s}`);
    for (const b of o.cagriButceleri) butceler.push(`${goreli}:${b.satir} ${b.deger}`);
    for (const b of o.dosyaButceleri) dosyaButceleri.push(`${goreli}:${b.satir} ${b.deger}`);
  }
  return {
    sizinti: sizinti.sort(),
    ezme: ezme.sort(),
    butceler: butceler.sort(),
    dosyaButceleri: dosyaButceleri.sort(),
  };
}
