/**
 * İP-A1 nöbetçi taban sayımı (İP-A0 `sayim.sh`'in taşınabilir Node sürümü).
 *
 * KRİTİK: JSX etiket sayımı dosya BÜTÜNÜ üzerinde yapılır, satır bazlı değil.
 * Prettier `<button` etiketlerinin 104'ünü satır sonuyla böldüğü için satır
 * bazlı `grep` bu tabanda ham buton sayısını 5,7 kat eksik ölçüyordu (22 vs 126).
 *
 * Hem CLI'dan (`node scripts/ui-baseline-sayim.mjs`) hem testten çağrılır.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";

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
    else if (/\.(ts|tsx)$/.test(name)) out.push(r);
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
const countAll = (s, re) => (s.match(re) || []).length;

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

export function sayim() {
  const base = adminBase();
  let rawButton = 0;
  let labels = 0;
  let labelsWithHtmlFor = 0;

  for (const f of base) {
    const s = read(f);
    rawButton += countAll(s, /<button\b/gs);
    for (const m of s.match(/<label\b[^>]*>/gs) || []) {
      labels += 1;
      if (/\bhtmlFor\b/.test(m)) labelsWithHtmlFor += 1;
    }
  }

  // `ui2/` dışında `@medusajs/ui` import eden dosyalar (tüm kaynak ağacı).
  const medusaDirectImports = allSource().filter(
    (f) =>
      !f.includes("/admin/ui2/") &&
      /from\s+["']@medusajs\/ui["']/.test(read(f))
  );

  // role="dialog" + aria-modal taşımayan gerçek overlay sayısı.
  const overlayOffenders = [];
  let unlabeledOverlays = 0;
  for (const f of base) {
    if (PRINT_LAYERS.includes(f)) continue;
    const s = read(f);
    const overlays = countAll(s, /fixed inset-0/g);
    if (!overlays) continue;
    const labeled = Math.min(
      countAll(s, /role="dialog"/g),
      countAll(s, /aria-modal/g)
    );
    const missing = Math.max(0, overlays - labeled);
    if (missing > 0) {
      unlabeledOverlays += missing;
      overlayOffenders.push(f);
    }
  }

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
