/**
 * İP-A3a · Nöbetçi eşiklerinin mutasyon provası.
 *
 * İP-A2 sürücüsünün (`ip_a2_mutasyon.mjs`) devamıdır: `<label htmlFor>` oranı
 * eşiği İP-A3a'da KALDIRILDI (gerekçe: `docs/arsiv/ip-a/ip-a3a-rapor.md` → Görev 1),
 * yerine "erişilebilir adı olmayan form kontrolü" geldi. Bu sürücü güncel
 * eşik kümesini sınar; A2 sürücüsü kayıt olarak durur ama artık koşmaz.
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
 * Kullanım (frontend/ dizininden):  node scripts/ip_a3a_mutasyon.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NOBETCI = "src/__guards__/uiBaseline.test.ts";
const PILOT = "src/components/admin/inventory/DamageDialog.tsx";
const AYRAC = '        <div className="flex justify-end gap-2">';

/** Mutasyonlar: her biri bir eşiği hedefler. */
const MUTASYONLAR = [
  {
    ad: "ham <button sayısı",
    dosya: PILOT,
    // Gerçek bir JSX düğümü ekler → taban 126'dan 127'ye çıkar.
    uygula: (s) =>
      s.replace(AYRAC, `        <button type="button">Ham buton</button>\n${AYRAC}`),
    beklenen: /ham <button sayısı artamaz/,
  },
  {
    ad: "erişilebilir adı olmayan form kontrolü",
    dosya: PILOT,
    // `Form.Control` dışında, etiketsiz, yalnız placeholder taşıyan gerçek bir
    // kontrol: tam olarak metriğin yakalaması gereken borç (41 → 42).
    uygula: (s) =>
      s.replace(
        AYRAC,
        `        <input className="input" placeholder="Serbest not" />\n${AYRAC}`
      ),
    beklenen: /erişilebilir adı olmayan form kontrolü artamaz/,
  },
  {
    ad: "ui2 dışı @medusajs/ui importu",
    dosya: PILOT,
    uygula: (s) => `import { Tooltip } from "@medusajs/ui";\n${s}`,
    beklenen: /ui2\/ dışında @medusajs\/ui import eden dosya yok/,
  },
  {
    ad: "etiketsiz overlay",
    dosya: PILOT,
    // role/aria-modal taşımayan gerçek bir overlay: sayı 5'ten 6'ya çıkar ve
    // dosya listesi genişler.
    uygula: (s) =>
      s.replace(AYRAC, `        <div className="fixed inset-0 bg-black/40" />\n${AYRAC}`),
    beklenen: /overlay/,
  },
  {
    ad: "ölçüm tabanı çökmesi (yalancı yeşil koruması)",
    dosya: "scripts/ui-baseline-sayim.mjs",
    // Sayacın kontrol tarayıcısını sustur: `adsizKontrol` 0'a düşer ve
    // "artamaz" yönü MEMNUN olur. Taban kontrolü olmasaydı bu sessizce
    // geçerdi — eşiği ölçen alet bozulunca eşik kendiliğinden yeşile döner.
    uygula: (s) =>
      s.replace(
        "      if (KONTROL_ETIKETLERI.has(ad)) {",
        "      if (false && KONTROL_ETIKETLERI.has(ad)) {"
      ),
    beklenen: /erişilebilir adı olmayan form kontrolü artamaz/,
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
