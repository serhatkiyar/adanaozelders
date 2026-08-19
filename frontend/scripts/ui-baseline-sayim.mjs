/**
 * İP-A1/A2 nöbetçi taban sayımı (İP-A0 `sayim.sh`'in taşınabilir Node sürümü).
 *
 * ## Neden AST (İP-A2 düzeltmesi)
 *
 * İlk sürüm (İP-A1) sayımı ham metin üzerinde regex ile yapıyordu. Bu iki
 * yanlışı birden üretiyordu:
 *
 *   1. **Yorum satırları sayılıyordu.** Bir satır yorumunda ya da JSX içine
 *      gömülü blok yorumda geçen `<button` gerçek bir buton sanılıyordu.
 *   2. **String/şablon içerikleri sayılıyordu.** Bir örnek metninde geçen
 *      `<label htmlFor=…` oran paydasını şişiriyordu.
 *
 * Yön "artamaz" olduğu için bu sessiz geçiş üretmiyordu; ama İP-A6/A7'de
 * eşikler AŞAĞI çekilecek ve yorumda kalmış tek bir `<button` **meşru bir
 * düşüşü bloklardı** — nöbetçi, düzeltmeyi cezalandırırdı.
 *
 * Çözüm satır penceresi ya da "önce yorumları sil" tarzı bir metin ön temizliği
 * DEĞİL: bu kod tabanı Türkçe ve JSX metinleri kesme işaretiyle dolu
 * (`Medusa'nın`, `preset'in`). Elle yazılmış bir tarayıcı o kesme işaretini
 * string başlangıcı sanar ve dosyanın yarısını yutar. Bu yüzden sayım
 * TypeScript'in kendi parser'ıyla üretilen **AST** üzerinde yapılır
 * (kök CLAUDE.md §C: sınıf/fonksiyon sınırı AST ile bulunmalı).
 *
 * Yan kazanç: `<button` ile `<ButtonGroup` ayrımı, kendi kapanan `<button />`
 * biçimi ve `role={"dialog"}` gibi ifade biçimleri artık doğru okunuyor.
 *
 * Hem CLI'dan (`node scripts/ui-baseline-sayim.mjs`) hem testten çağrılır.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";

// Hem CLI (`node scripts/...`) hem Vitest, çalışma dizini `frontend/` iken koşar.
// Vitest kaynağı dönüştürdüğü için `import.meta.url` dosya URL'i olmayabilir;
// bu yüzden kök cwd'den alınır ve varlığı doğrulanır.
const ROOT = process.cwd();
if (!existsSync(join(ROOT, "src")) || !existsSync(join(ROOT, "package.json"))) {
  throw new Error(
    `ui-baseline-sayim: calisma dizini frontend/ olmali, bulundu: ${ROOT}`
  );
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return out;
  }
  for (const name of entries) {
    const r = posix.join(dir, name);
    if (statSync(join(ROOT, r)).isDirectory()) walk(r, out);
    // Test dosyaları ÖLÇÜM DIŞI: taban, kullanıcıya sevk edilen arayüzü ölçer.
    // Test fixture'larındaki `<button>`/`<label>` kasten ilkeldir (erişilebilirlik
    // sözleşmesini kanıtlamak için ham etiket gerekir) ve borç sayılamaz. İP-A2'de
    // ui2/ ve inventory/ altına ilk test dosyaları girince taban 126'dan 128'e
    // "yükseldi"; sayılan şey borç değil, borcu ölçen testlerdi.
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(r);
  }
  return out;
}

/** Ölçüm tabanı: admin bileşenleri + admin sayfaları + Admin* dashboard'ları. */
export function adminBase() {
  const files = [...walk("src/components/admin"), ...walk("src/pages/admin")];
  for (const f of walk("src/pages/dashboards")) {
    if (/\/Admin[^/]*\.tsx$/.test(f)) files.push(f);
  }
  return files.sort();
}

/** Tüm kaynak ağacı. */
export function allSource() {
  return walk("src").sort();
}

const read = (f) => readFileSync(join(ROOT, f), "utf8");

/** Baskı katmanları gerçek overlay değildir — isimle sabitlenmiş istisna listesi. */
export const PRINT_LAYERS = [
  "src/components/admin/delivery/LabelSheet.tsx",
  "src/components/admin/packing/PackageLabel.tsx",
  "src/components/admin/packing/PackingLabelSheet.tsx",
];

/** `role="dialog"` + `aria-modal` taşımayan gerçek overlay'i olan dosyalar (İP-A0 tespiti). */
export const UNLABELED_OVERLAY_FILES = [
  "src/pages/admin/AdminPayoutsPage.tsx",
  "src/pages/dashboards/AdminExamCatalogs.tsx",
  "src/pages/dashboards/AdminLibraries.tsx",
  "src/pages/dashboards/AdminStore.tsx",
];

const MEDUSA = "@medusajs/ui";

/** Bir JSX özniteliğinin (varsa) düz metin değeri; `x="a"` ve `x={"a"}` aynı okunur. */
function ozniteligeDeger(init) {
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      return e.text;
    }
  }
  return null;
}

/**
 * TEK BİR DOSYANIN ölçümü — saf fonksiyon, dosya sistemine dokunmaz.
 *
 * Testten doğrudan çağrılabilsin diye ayrıldı: sayacın yorum/string
 * saymadığını kanıtlamanın yolu, ona elde yazılmış bir kaynak vermektir.
 */
export function dosyaOlcumu(kaynak, dosyaAdi = "olcum.tsx") {
  const sf = ts.createSourceFile(
    dosyaAdi,
    kaynak,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.tsx$/.test(dosyaAdi) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const o = {
    rawButton: 0,
    labels: 0,
    labelsWithHtmlFor: 0,
    overlays: 0,
    dialogRoles: 0,
    ariaModals: 0,
    medusaImport: false,
  };

  const gez = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const ad = n.tagName.getText(sf);
      const oz = n.attributes.properties;
      if (ad === "button") o.rawButton += 1;
      if (ad === "label") {
        o.labels += 1;
        if (
          oz.some(
            (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "htmlFor"
          )
        ) {
          o.labelsWithHtmlFor += 1;
        }
      }
      for (const p of oz) {
        if (!ts.isJsxAttribute(p)) continue;
        const pad = p.name.getText(sf);
        if (pad === "aria-modal") o.ariaModals += 1;
        if (pad === "role" && ozniteligeDeger(p.initializer) === "dialog") {
          o.dialogRoles += 1;
        }
      }
    }

    // Overlay tespiti sınıf adına bakar; sınıf adı ancak bir string/şablon
    // parçasının İÇİNDE geçebilir. Yorumdaki `fixed inset-0` artık sayılmaz.
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      o.overlays += (n.text.match(/fixed inset-0/g) || []).length;
    }

    // `import`, `export … from` ve dinamik `import()` — üçü de doğrudan
    // bağımlılıktır; regex sürümü yalnız ilkini görüyordu.
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      n.moduleSpecifier.text === MEDUSA
    ) {
      o.medusaImport = true;
    }
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      n.arguments[0].text === MEDUSA
    ) {
      o.medusaImport = true;
    }

    ts.forEachChild(n, gez);
  };

  gez(sf);
  return o;
}

export function sayim() {
  const base = adminBase();
  let rawButton = 0;
  let labels = 0;
  let labelsWithHtmlFor = 0;

  const overlayOffenders = [];
  let unlabeledOverlays = 0;

  for (const f of base) {
    const o = dosyaOlcumu(read(f), f);
    rawButton += o.rawButton;
    labels += o.labels;
    labelsWithHtmlFor += o.labelsWithHtmlFor;

    if (PRINT_LAYERS.includes(f) || !o.overlays) continue;
    // Bir overlay'in "etiketli" sayılması için HEM role="dialog" HEM
    // aria-modal gerekir; ikisinin küçüğü kadarı etiketli kabul edilir.
    const labeled = Math.min(o.dialogRoles, o.ariaModals);
    const missing = Math.max(0, o.overlays - labeled);
    if (missing > 0) {
      unlabeledOverlays += missing;
      overlayOffenders.push(f);
    }
  }

  // `ui2/` dışında `@medusajs/ui` import eden dosyalar (tüm kaynak ağacı).
  // Ön eleme yalnız hız içindir: metinde adı hiç geçmeyen dosya parse edilmez.
  const medusaDirectImports = allSource().filter((f) => {
    if (f.includes("/admin/ui2/")) return false;
    const s = read(f);
    return s.includes(MEDUSA) && dosyaOlcumu(s, f).medusaImport;
  });

  return {
    files: base.length,
    rawButton,
    labels,
    labelsWithHtmlFor,
    medusaDirectImports,
    unlabeledOverlays,
    overlayOffenders: overlayOffenders.sort(),
  };
}

if (process.argv[1] && process.argv[1].endsWith("ui-baseline-sayim.mjs")) {
  console.log(JSON.stringify(sayim(), null, 2));
}
