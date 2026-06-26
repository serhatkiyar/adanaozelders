// PreToolUse hook: .env (sır içeren ortam) dosyalarının Edit/Write ile
// değiştirilmesini engeller. .env.example / .sample / .template serbesttir.
// stdin'den tool çağrısı JSON'unu okur; eşleşirse exit(2) ile bloklar.
import { readFileSync } from "node:fs";

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
const filePath = ti.file_path || ti.path || "";
const base = String(filePath).replace(/\\/g, "/").split("/").pop() || "";

const isEnv = /^\.env(\.[A-Za-z0-9_-]+)?$/.test(base);
const isAllowed = /\.(example|sample|template)$/.test(base);

if (isEnv && !isAllowed) {
  console.error(
    `🔒 Bu hook .env dosyalarının düzenlenmesini engeller: ${filePath}\n` +
      `Sır içeren ortam dosyaları (anahtarlar, parolalar) elle düzenlenmelidir. ` +
      `Şablon gerekiyorsa .env.example üzerinde çalışın.`
  );
  process.exit(2); // PreToolUse'da exit 2 → tool çağrısını bloklar
}

process.exit(0);
