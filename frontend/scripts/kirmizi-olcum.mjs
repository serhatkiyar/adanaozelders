/**
 * Kırmızı matris ölçüm sürücüsü (İP-A7d3 · Görev 3 · **İP-A7d4'te onarıldı**).
 *
 * ## Ne yapar
 *
 * Bir ya da daha çok ÜRETİM dosyasını bir TABAN sürümüne geçici olarak geri
 * alır, verilen test dosyalarını koşar ve hangi iddianın kırmızıya döndüğünü
 * raporlar. Sonra dosyaları **bayt bayt** geri yazar.
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
 * ## ── İP-A7d4 · Görev 2: SÜRÜCÜNÜN KENDİSİ YALANCI YEŞİL ÜRETİYORDU ──
 *
 * A7d3 bunu dürüstçe raporladı: `PackingStationPage`in beş testi tabana karşı
 * **yeşil** çıktı ve ilk okuma "bu testler göçü kanıtlamıyor" oldu. Yanlıştı.
 * Testlerin doğruladığı koruma o ekranda değil ORTAK KATMANDAYDI
 * (`ui/ConfirmDialog` → `ReasonDialog`) ve o dosya geri alınmamıştı. İkisi
 * birden geri alınınca beşi de kırmızıya döndü.
 *
 * Yani sürücü şunu diyordu: **"kırmızı değil"**. Söylemesi gereken şuydu:
 * **"bu ölçüm eksik — testin dokunduğu değişmiş dosyaların hepsini geri
 * almadım."** İkisi arasındaki fark, matrisin bütün değeridir.
 *
 * Onarım iki parçalı:
 *
 *   1. **Kapsam denetimi.** Sürücü her test dosyasının modül grafiğini çıkarır
 *      (`.ts` ve `.tsx`, `@/` takma adı dahil) ve tabandan bu yana DEĞİŞMİŞ
 *      olup geri alınmayan dosyaları bulur. Böyle bir dosya varsa geçen
 *      testler **YEŞİL değil BELİRSİZ** sayılır ve eksik dosyalar isimle
 *      yazılır. Çıkış kodu 4 olur: sessiz yeşil ARTIK ÜRETİLEMEZ.
 *   2. **`--otomatik`.** Geri alınacak kümeyi sürücü kendi türetir: testin
 *      modül grafiğindeki, tabandan bu yana değişmiş HER üretim dosyası.
 *      "Hangi dosyalarda yaşıyor" sorusunu insana sormaz.
 *
 * ## Kullanım
 *
 *   node scripts/kirmizi-olcum.mjs --taban <ref> --otomatik --test <dosya…>
 *   node scripts/kirmizi-olcum.mjs --taban <ref> --uretim <dosya…> --test <dosya…>
 *
 * `--taban` verilmezse `HEAD` kullanılır; paket COMMIT EDİLDİKTEN sonra HEAD
 * zaten göç etmiş hâlidir ve ölçüm "hiç kırmızı yok" der — bu bir sonuç değil,
 * yanlış tabana bakmaktır. Dalganın tabanını açıkça ver.
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const KOK = path.resolve(process.cwd(), "..");
const FRONT = process.cwd();

function git(...argv) {
  return execFileSync("git", argv, { cwd: KOK, encoding: "buffer" });
}

function durum() {
  return git("status", "--porcelain").toString("utf8");
}

const argv = process.argv.slice(2);
const uretim = [];
const testler = [];
const tabanKovasi = [];
let otomatik = false;
let kova = null;
for (const a of argv) {
  if (a === "--uretim") kova = uretim;
  else if (a === "--test") kova = testler;
  else if (a === "--taban") kova = tabanKovasi;
  else if (a === "--otomatik") {
    otomatik = true;
    kova = null;
  } else if (kova) kova.push(a);
}
const TABAN = tabanKovasi[0] ?? "HEAD";
if (!testler.length || (!uretim.length && !otomatik)) {
  console.error(
    "kullanim: --taban <ref> [--otomatik | --uretim <dosya…>] --test <dosya…>"
  );
  process.exit(2);
}

/* ══════════════════ Modül grafiği (testin gerçekten dokunduğu dosyalar) ══════════════════ */

const UZANTILAR = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** Bir import metnini `frontend/`e göreli yola çözer; çözemezse null. */
function ithalCoz(kaynakDosya, metin) {
  let temel;
  if (metin.startsWith("@/")) temel = path.posix.join("src", metin.slice(2));
  else if (metin.startsWith("."))
    temel = path.posix.normalize(path.posix.join(path.posix.dirname(kaynakDosya), metin));
  else return null; // paket importu
  const varMi = (y) => (fs.existsSync(path.join(FRONT, y)) ? y : null);
  if (/\.(ts|tsx|mjs)$/.test(temel)) return varMi(temel);
  for (const ek of UZANTILAR) {
    const bulunan = varMi(temel + ek);
    if (bulunan) return bulunan;
  }
  return null;
}

/**
 * Import metinleri — kaba ama YETERLİ bir tarama.
 *
 * Burada AST kullanılmıyor ve gerekçesi şudur: bu fonksiyon bir NÖBETÇİ değil
 * bir ÖLÇÜM ARACIDIR ve hata yönü güvenli taraftadır. Yorumdaki bir yol
 * yanlışlıkla grafiğe girerse en kötü ihtimalle "bu dosya da değişmiş" denir
 * ve ölçüm BELİRSİZ işaretlenir — yani fazla temkinli olur, sessiz yeşil
 * üretmez. Tersi (yolu kaçırmak) tehlikeli olurdu ve o da olmaz: `import`
 * ifadeleri tek biçimde yazılıyor.
 */
function ithalMetinleri(kaynak) {
  const out = [];
  const desenler = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\.meta\.glob\s*\(\s*["']([^"']+)["']/g,
  ];
  for (const d of desenler) {
    let m;
    while ((m = d.exec(kaynak))) out.push(m[1]);
  }
  return out;
}

/** Test dosyalarından ulaşılan tüm yerel modüller (geçişli kapanış). */
function ulasilanModuller(tohumlar) {
  const gorulen = new Set();
  const kuyruk = [...tohumlar];
  while (kuyruk.length) {
    const dosya = kuyruk.pop();
    if (gorulen.has(dosya)) continue;
    gorulen.add(dosya);
    let kaynak;
    try {
      kaynak = fs.readFileSync(path.join(FRONT, dosya), "utf8");
    } catch {
      continue;
    }
    for (const metin of ithalMetinleri(kaynak)) {
      const cozulen = ithalCoz(dosya, metin);
      if (cozulen && !gorulen.has(cozulen)) kuyruk.push(cozulen);
    }
  }
  return gorulen;
}

/** Tabandan bu yana değişmiş `frontend/src` dosyaları (`frontend/`e göreli). */
function degisenDosyalar() {
  const cikti = git("diff", "--name-only", TABAN, "--", "frontend/src").toString("utf8");
  return cikti
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^frontend\//, ""))
    .filter((s) => !/\.test\.tsx?$/.test(s));
}

const normal = (p) => p.replace(/\\/g, "/");
const testYollari = testler.map(normal);
const grafik = ulasilanModuller(testYollari);
const degisen = degisenDosyalar();
/** Testin dokunduğu VE tabandan bu yana değişmiş üretim dosyaları. */
const ilgili = degisen.filter((d) => grafik.has(d));

let geriAlinacak = otomatik ? ilgili : uretim.map(normal);
const kapsanmayan = ilgili.filter((d) => !geriAlinacak.includes(d));

console.log(`taban: ${TABAN}`);
console.log(`testin modül grafiği: ${grafik.size} dosya`);
console.log(`tabandan bu yana değişmiş + grafikte olan: ${ilgili.length}`);
for (const d of ilgili) console.log(`  ${geriAlinacak.includes(d) ? "geri alınacak" : "KAPSANMAYAN"}  ${d}`);
if (!geriAlinacak.length) {
  console.error("!! geri alınacak dosya yok — ölçüm hiçbir şey kanıtlamaz");
  process.exit(2);
}

/* ══════════════════ Geri alma + koşum + bayt bayt geri yazma ══════════════════ */

const baslangicDurumu = durum();
const yedek = new Map();
for (const dosya of geriAlinacak) yedek.set(dosya, fs.readFileSync(path.join(FRONT, dosya)));

let sonuc = null;
const raporYolu = path.join(FRONT, "node_modules", ".kirmizi-olcum.json");
try {
  for (const dosya of geriAlinacak) {
    const eski = git("show", `${TABAN}:frontend/${dosya}`);
    fs.writeFileSync(path.join(FRONT, dosya), eski);
  }
  try {
    execSync(
      `npx vitest run ${testler.join(" ")} --reporter=json --outputFile=${JSON.stringify(raporYolu)}`,
      { encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 }
    );
  } catch {
    /* kırmızı test varsa vitest sıfırdan farklı döner — rapor yine yazılır */
  }
  if (fs.existsSync(raporYolu)) sonuc = JSON.parse(fs.readFileSync(raporYolu, "utf8"));
} finally {
  for (const [dosya, baytlar] of yedek) fs.writeFileSync(path.join(FRONT, dosya), baytlar);
  const sonDurum = durum();
  if (sonDurum !== baslangicDurumu) {
    console.error("!! CALISMA AGACI DEGISTI — geri yazma basarisiz");
    console.error("once:\n" + baslangicDurumu);
    console.error("sonra:\n" + sonDurum);
    process.exit(3);
  }
  console.log("calisma agaci basta ve sonda AYNI (git status --porcelain)");
}

if (!sonuc) {
  console.error("!! vitest raporu okunamadi");
  process.exit(2);
}

/* ══════════════════ Sınıflandırma: KIRMIZI / BELİRSİZ / YEŞİL ══════════════════ */

const kirmizi = [];
const gecen = [];
for (const dosya of sonuc.testResults ?? []) {
  for (const t of dosya.assertionResults ?? []) {
    const ad = `${path.basename(dosya.name)} :: ${t.fullName ?? t.title}`;
    if (t.status === "failed") kirmizi.push(ad);
    else if (t.status === "passed") gecen.push(ad);
  }
}

const belirsizMi = kapsanmayan.length > 0;
console.log("");
console.log(`KIRMIZI  ${kirmizi.length}`);
for (const a of kirmizi) console.log(`  × ${a}`);
console.log(`${belirsizMi ? "BELİRSİZ" : "YEŞİL   "} ${gecen.length}`);
if (belirsizMi) {
  console.log("");
  console.log("!! ÖLÇÜM EKSİK — geçen testler YEŞİL SAYILAMAZ.");
  console.log("   Testin dokunduğu şu dosyalar tabandan bu yana DEĞİŞTİ ama geri alınmadı:");
  for (const d of kapsanmayan) console.log(`     ${d}`);
  console.log("   (A7d3 · `PackingStationPage` tam olarak buydu: koruma ortak katmandaydı.)");
  console.log("   Düzeltme: --otomatik kullan ya da bu dosyaları --uretim'e ekle.");
  process.exit(4);
}
if (!kirmizi.length) {
  console.log("");
  console.log("!! HİÇBİR TEST KIRMIZI DEĞİL — kapsam TAM, yani bu testler bu değişikliği kanıtlamıyor.");
  process.exit(1);
}
