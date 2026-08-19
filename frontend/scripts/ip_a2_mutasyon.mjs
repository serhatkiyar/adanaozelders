/**
 * İP-A2 · Nöbetçi eşiklerinin mutasyon provası.
 *
 * Her eşik için GERÇEK JSX ihlali uygulanır (yorum satırı değil — yorumdaki
 * ihlali AST sayacı zaten görmez, o bir prova sayılmaz), nöbetçi testinin
 * kırıldığı gösterilir, mutasyon geri alınır ve yeşile döndüğü doğrulanır.
 *
 * GÜVENLİK (kök CLAUDE.md §D): sürücü `git checkout --` KULLANMAZ. Dosyanın
 * ham baytları bellekte tutulur ve aynen geri yazılır; başlangıçta ve sonda
 * `git status --porcelain` çıktısı karşılaştırılır. Kullanıcının commit
 * edilmemiş değişikliği asla kaybolmaz.
 *
 * Kullanım (frontend/ dizininden):  node scripts/ip_a2_mutasyon.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NOBETCI = "src/__guards__/uiBaseline.test.ts";

/** Mutasyonlar: her biri bir eşiği hedefler. */
const MUTASYONLAR = [
  {
    ad: "ham <button sayısı",
    dosya: "src/components/admin/inventory/DamageDialog.tsx",
    // Gerçek bir JSX düğümü ekler → taban 126'dan 127'ye çıkar.
    uygula: (s) =>
      s.replace(
        '        <div className="flex justify-end gap-2">',
        '        <button type="button">Ham buton</button>\n        <div className="flex justify-end gap-2">'
      ),
    beklenen: /ham <button sayısı artamaz/,
  },
  {
    ad: "<label htmlFor oranı",
    dosya: "src/components/admin/ui2/form.tsx",
    // `Form.Label`ın bağını koparır: htmlFor'lu etiket 4'ten 3'e düşer.
    uygula: (s) =>
      s.replace(
        "    <label htmlFor={kimlik?.id} className={className}>",
        "    <label className={className}>"
      ),
    beklenen: /label htmlFor oranı azalamaz/,
  },
  {
    ad: "ui2 dışı @medusajs/ui importu",
    dosya: "src/components/admin/inventory/DamageDialog.tsx",
    uygula: (s) => `import { Tooltip } from "@medusajs/ui";\n${s}`,
    beklenen: /ui2\/ dışında @medusajs\/ui import eden dosya yok/,
  },
  {
    ad: "etiketsiz overlay",
    dosya: "src/components/admin/inventory/DamageDialog.tsx",
    // role/aria-modal taşımayan gerçek bir overlay: sayı 5'ten 6'ya çıkar ve
    // dosya listesi genişler.
    uygula: (s) =>
      s.replace(
        '        <div className="flex justify-end gap-2">',
        '        <div className="fixed inset-0 bg-black/40" />\n        <div className="flex justify-end gap-2">'
      ),
    beklenen: /overlay/,
  },
];

function gitDurumu() {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd: "..",
    encoding: "utf8",
  });
}

function nobetciKos() {
  try {
    const cikti = execFileSync(
      "npx",
      ["vitest", "run", NOBETCI, "--reporter=basic"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true }
    );
    return { gecti: true, cikti };
  } catch (e) {
    return { gecti: false, cikti: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const baslangicDurumu = gitDurumu();

const ilk = nobetciKos();
if (!ilk.gecti) {
  console.error("HATA: nöbetçi mutasyondan ÖNCE zaten kırmızı. Prova anlamsız.");
  process.exit(1);
}
console.log("Taban: nöbetçi YEŞİL.\n");

let hepsiYakalandi = true;

for (const m of MUTASYONLAR) {
  const orijinal = readFileSync(m.dosya, "utf8");
  const bozuk = m.uygula(orijinal);
  if (bozuk === orijinal) {
    console.error(`✗ ${m.ad}: mutasyon UYGULANAMADI (desen bulunamadı).`);
    hepsiYakalandi = false;
    continue;
  }

  writeFileSync(m.dosya, bozuk, "utf8");
  const sonuc = nobetciKos();
  writeFileSync(m.dosya, orijinal, "utf8");

  const yakalandi = !sonuc.gecti && m.beklenen.test(sonuc.cikti);
  hepsiYakalandi &&= yakalandi;
  console.log(
    `${yakalandi ? "✓" : "✗"} ${m.ad}: mutasyon ${
      sonuc.gecti ? "YAKALANMADI (nöbetçi geçti!)" : "yakalandı"
    }`
  );

  const geri = nobetciKos();
  if (!geri.gecti) {
    console.error(`  ✗ geri alma sonrası nöbetçi hâlâ kırmızı — DUR.`);
    process.exit(1);
  }
}

const sonDurum = gitDurumu();
if (sonDurum !== baslangicDurumu) {
  console.error("\n✗ ÇALIŞMA AĞACI DEĞİŞTİ — sürücü temiz kapanmadı.");
  console.error(`önce:\n${baslangicDurumu}\nsonra:\n${sonDurum}`);
  process.exit(1);
}
console.log("\nÇalışma ağacı başlangıçtaki hâline döndü.");
process.exit(hepsiYakalandi ? 0 : 1);
