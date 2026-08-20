/**
 * Kırmızı matris ölçüm sürücüsü (İP-A7d3 · Görev 3).
 *
 * ## Ne yapar
 *
 * Bir ya da daha çok ÜRETİM dosyasını HEAD sürümüne geçici olarak geri alır,
 * verilen test dosyalarını koşar ve kaç iddianın kırmızıya döndüğünü raporlar.
 * Sonra dosyaları **bayt bayt** geri yazar.
 *
 * ## Neden ayrı bir sürücü
 *
 * Kırmızı matris "yazıldığı anda kırmızıydı" iddiasının kanıtıdır ve göç
 * bittikten sonra elle doğrulanamaz. Ama doğrulama sırasında kullanıcının
 * çalışma ağacı KAYBEDİLEMEZ. Bu yüzden proje kuralı (CLAUDE.md §D) burada da
 * geçerlidir:
 *
 *   • `git checkout --` KULLANILMAZ (aynı dosyadaki commit edilmemiş bir
 *     düzeltmeyi siler — projede bir kez yaşandı),
 *   • ham baytlar bellekte tutulur ve aynen geri yazılır (CRLF korunur),
 *   • başta ve sonda `git status --porcelain` karşılaştırılır; eşit değilse
 *     süreç HATA ile biter.
 *
 * ## Kullanım
 *
 *   node scripts/kirmizi-olcum.mjs --uretim <dosya…> --test <dosya…>
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const KOK = path.resolve(process.cwd(), "..");

function git(...argv) {
  return execFileSync("git", argv, { cwd: KOK, encoding: "buffer" });
}

function durum() {
  return git("status", "--porcelain").toString("utf8");
}

const argv = process.argv.slice(2);
const uretim = [];
const testler = [];
let kova = null;
for (const a of argv) {
  if (a === "--uretim") kova = uretim;
  else if (a === "--test") kova = testler;
  else if (kova) kova.push(a);
}
if (!uretim.length || !testler.length) {
  console.error("kullanim: --uretim <dosya…> --test <dosya…>");
  process.exit(2);
}

const baslangicDurumu = durum();
// Ham baytlar bellekte: geri yazma dönüşümsüzdür.
const yedek = new Map();
for (const dosya of uretim) {
  yedek.set(dosya, fs.readFileSync(dosya));
}

let cikis = 0;
try {
  for (const dosya of uretim) {
    const gitYolu = `frontend/${dosya.replace(/\\/g, "/")}`;
    const eski = git("show", `HEAD:${gitYolu}`);
    fs.writeFileSync(dosya, eski);
  }
  try {
    const cikti = execSync(
      `npx vitest run ${testler.join(" ")} --reporter=dot 2>&1`,
      { encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 }
    );
    console.log(cikti.split("\n").filter((l) => /Tests |×/.test(l)).join("\n"));
    console.log("!! HİÇBİR TEST KIRMIZI DEĞİL — matris kanıt üretmiyor");
    cikis = 1;
  } catch (e) {
    const cikti = String(e.stdout ?? "") + String(e.stderr ?? "");
    console.log(
      cikti
        .split("\n")
        .filter((l) => /Tests |Test Files |^\s*\S*×/.test(l))
        .join("\n")
    );
  }
} finally {
  for (const [dosya, baytlar] of yedek) fs.writeFileSync(dosya, baytlar);
  const sonDurum = durum();
  if (sonDurum !== baslangicDurumu) {
    console.error("!! CALISMA AGACI DEGISTI — geri yazma basarisiz");
    console.error("once:\n" + baslangicDurumu);
    console.error("sonra:\n" + sonDurum);
    process.exit(3);
  }
  console.log("calisma agaci basta ve sonda AYNI (git status --porcelain)");
}
process.exit(cikis);
