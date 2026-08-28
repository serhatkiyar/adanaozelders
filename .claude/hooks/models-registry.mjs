// PostToolUse hook: backend/models/ altında bir model dosyası yazıldığında/
// düzenlendiğinde, o modülün models/__init__.py'de import edilip edilmediğini
// kontrol eder. Kayıtlı değilse exit(2) ile Claude'a uyarı verir (bloklamaz,
// PostToolUse sonrası geri bildirim) — Alembic autogenerate kayıtsız tabloyu
// GÖRMEZ, bu "sessiz eksik migration" tuzağını erkenden yakalar.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

let raw = "";
try {
  raw = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

let data = {};
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0);
}

const ti = data.tool_input || {};
const filePath = String(ti.file_path || ti.path || "");
const norm = filePath.replace(/\\/g, "/");

// Yalnız backend/models/*.py — __init__.py ve mixins.py hariç.
const m = norm.match(/backend\/models\/([A-Za-z0-9_]+)\.py$/);
if (!m) process.exit(0);

const moduleName = m[1];
if (moduleName === "__init__" || moduleName === "mixins") process.exit(0);

const initPath = join(dirname(filePath), "__init__.py");
let initSrc = "";
try {
  initSrc = readFileSync(initPath, "utf8");
} catch {
  process.exit(0); // __init__ okunamadıysa sessizce geç
}

// `from models.<modul> import ...` veya `from .<modul> import ...` arar.
const imported = new RegExp(
  `from\\s+(?:models\\.|\\.)${moduleName}\\s+import\\b`
).test(initSrc);

if (!imported) {
  console.error(
    `⚠️  models/${moduleName}.py models/__init__.py'de import EDİLMEMİŞ.\n` +
      `   Modeli \`from models.${moduleName} import <SınıfAdı>\` ile import et. ` +
      `Dışa aktarılacak sınıfları __all__ listesine ayrıca ekle.\n` +
      `   Aksi halde Alembic autogenerate tabloyu görmez → sessiz eksik migration. ` +
      `Şema değiştiyse Alembic migration üret.`
  );
  process.exit(2); // PostToolUse'da exit 2 → stderr Claude'a geri bildirim olur
}

process.exit(0);
