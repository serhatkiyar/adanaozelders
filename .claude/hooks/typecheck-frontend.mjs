// PostToolUse hook: frontend altındaki bir .ts/.tsx dosyası düzenlendiğinde
// `tsc -b` ile tip kontrolü koşar. Hata varsa exit(2) ile Claude'a geri besler.
// Test dosyaları tsc -b build'inden (tsconfig exclude) ayrıldığı için atlanır.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

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
const p = String(ti.file_path || ti.path || "").replace(/\\/g, "/");

const isFrontendTs = /\/frontend\/.*\.(ts|tsx)$/.test(p);
const isTest = /\.(test|spec)\.(ts|tsx)$/.test(p);
if (!isFrontendTs || isTest) {
  process.exit(0);
}

try {
  execSync("npx tsc -b", { cwd: "frontend", stdio: "pipe" });
  process.exit(0);
} catch (e) {
  const out =
    (e.stdout ? e.stdout.toString() : "") +
    (e.stderr ? e.stderr.toString() : "");
  console.error(
    "❌ TypeScript tip kontrolü başarısız (frontend `tsc -b`):\n" +
      out.slice(-4000)
  );
  process.exit(2); // PostToolUse'da exit 2 → stderr Claude'a geri beslenir
}
