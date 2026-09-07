#!/usr/bin/env node
/**
 * Marka tonunu TEK KOMUTLA değiştir ve bedelini ölç.
 *
 * ## Neden var (kullanıcı, 7 Eyl 2026)
 *
 * *"Tema rengini değiştirmen neden bu kadar uzun sürüyor, her seferinde biraz
 * daha aç diyorum sadece."* Haklı. Her turda elle yapılan şey şuydu: hex seç,
 * RGB'ye çevir, `index.css`teki üç token'ı düzenle, kontrastları hesapla,
 * nöbetçideki çıpayı güncelle, yorumları tazele. Altı adım, hepsi mekanik.
 *
 * Artık tek komut:
 *
 *     node scripts/marka-tonu.mjs "#F0850F"          # uygula
 *     node scripts/marka-tonu.mjs "#F0850F" --olc    # yalnız ölç, yazma
 *     node scripts/marka-tonu.mjs --tara             # aday tonları listele
 *
 * ## Ne yapar
 *
 * `--marka` ve `--marka-hover`ı yazar (hover, dolgunun %12 koyusu), sonra
 * BÜTÜN kontrastları ölçüp tabloyu basar. Yazdıktan sonra çalıştırılacak tek
 * şey `npx vitest run src/__guards__/markaAksani.test.ts` kalır.
 *
 * ## Ne YAPMAZ
 *
 * Nöbetçideki çıpayı kendiliğinden güncellemez. Kasıtlı: çıpanın değişmesi bir
 * ÜRÜN KARARIDIR ve gerekçesiyle elle yazılır (bkz. `markaAksani.test.ts`).
 * Script sadece yeni değeri söyler.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = join(KOK, "src", "index.css");

const ARGS = process.argv.slice(2);
const YALNIZ_OLC = ARGS.includes("--olc");
const TARA = ARGS.includes("--tara");
const HEX = ARGS.find((a) => /^#?[0-9a-fA-F]{6}$/.test(a));

/* ── renk yardımcıları ───────────────────────────────────────────────── */
const rgb = (hex) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const hex = ([r, g, b]) =>
  "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0").toUpperCase()).join("");

const parlaklik = ([r, g, b]) => {
  const k = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
};
const kontrast = (a, b) => {
  const [x, y] = [parlaklik(a), parlaklik(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** `--ad: r g b;` biçimindeki token'ı CSS'ten oku. */
function token(css, ad) {
  const m = css.match(new RegExp(`--${ad}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`));
  if (!m) throw new Error(`token bulunamadı: --${ad}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Eşikler `markaAksani.test.ts` ile AYNI — burada ikinci bir kaynak doğmasın. */
const KURALLAR = [
  ["dolgu üstündeki yazı", "marka-fg", "marka", 4.5],
  ["dolgu hover üstündeki yazı", "marka-fg", "marka-hover", 4.5],
  ["marka yazısı / beyaz", "marka-metin", null, 4.5],
  ["marka yazısı / soft", "marka-metin", "marka-soft", 4.5],
  ["odak halkası / beyaz", "marka-focus", null, 3],
  ["kenarlık / beyaz", "marka-mid", null, 3],
];
const BEYAZ = [255, 255, 255];

function rapor(css) {
  const dolgu = token(css, "marka");
  console.log(`\n  dolgu       ${hex(dolgu)}  (${dolgu.join(" ")})`);
  console.log(`  beyaz zemin ${kontrast(dolgu, BEYAZ).toFixed(2)}   <- SC 1.4.11, ürün kararıyla gevşetildi\n`);
  let kirik = 0;
  for (const [ad, a, b, esik] of KURALLAR) {
    const deger = kontrast(token(css, a), b ? token(css, b) : BEYAZ);
    const gecti = deger >= esik;
    if (!gecti) kirik++;
    console.log(`  ${gecti ? "OK  " : "KIRIK"} ${ad.padEnd(28)} ${deger.toFixed(2)} (eşik ${esik})`);
  }
  console.log("");
  if (kirik) {
    console.log(`  ${kirik} kural kırık — bu ton bu hâliyle kullanılamaz.\n`);
    process.exitCode = 1;
  }
}

/* ── --tara: eşikleri koruyan adaylar ────────────────────────────────── */
if (TARA) {
  const fg = token(readFileSync(CSS, "utf8"), "marka-fg");
  console.log("\n  Dolgu adayları — yazı okunurluğu (4,5) korunanlar:\n");
  console.log("  hex        beyaz   yazı");
  for (let l = 40; l <= 62; l += 2) {
    const r = Math.round(255 * Math.min(1, (l / 50) * 0.96));
    const g = Math.round(133 * (l / 52));
    const b = Math.round(15 * (l / 52));
    const c = [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
    const yazi = kontrast(c, fg);
    if (yazi < 4.5) continue;
    console.log(`  ${hex(c)}   ${kontrast(c, BEYAZ).toFixed(2)}    ${yazi.toFixed(2)}`);
  }
  console.log("");
  process.exit(0);
}

if (!HEX) {
  console.error("Kullanım: node scripts/marka-tonu.mjs \"#F0850F\" [--olc]");
  process.exit(2);
}

let css = readFileSync(CSS, "utf8");
const yeni = rgb(HEX);
// Hover = dolgunun %12 koyusu. Elle seçilen ikinci bir değer, dolgu değişince
// unutulup dolguyla ilişkisini kaybediyordu.
const hover = yeni.map((c) => Math.round(c * 0.88));

if (!YALNIZ_OLC) {
  css = css.replace(/--marka:\s*\d+\s+\d+\s+\d+;/, `--marka: ${yeni.join(" ")};`);
  css = css.replace(/--marka-hover:\s*\d+\s+\d+\s+\d+;/, `--marka-hover: ${hover.join(" ")};`);
  writeFileSync(CSS, css);
  console.log(`\n  yazıldı: --marka ${hex(yeni)} · --marka-hover ${hex(hover)}`);
} else {
  css = css
    .replace(/--marka:\s*\d+\s+\d+\s+\d+;/, `--marka: ${yeni.join(" ")};`)
    .replace(/--marka-hover:\s*\d+\s+\d+\s+\d+;/, `--marka-hover: ${hover.join(" ")};`);
  console.log(`\n  (yalnız ölçüm — dosya YAZILMADI)`);
}

rapor(css);

if (!YALNIZ_OLC) {
  console.log("  Sırada: nöbetçideki çıpayı elle güncelle —");
  console.log(`    markaAksani.test.ts  ->  expect(token("marka")).toBe("${yeni.join(" ")}")`);
  console.log("    npx vitest run src/__guards__/markaAksani.test.ts\n");
}
